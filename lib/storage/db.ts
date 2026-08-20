import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

// La conexión vive en globalThis para sobrevivir a Fast Refresh: un segundo
// handle sobre el mismo archivo fallaría con "database is locked".
const g = globalThis as typeof globalThis & {
  __kiora_db?: SQLite.SQLiteDatabase;
  __kiora_web_warmup?: SQLite.SQLiteDatabase;
};

// Web: el primer openDatabaseSync timeoutea porque el worker de expo-sqlite
// se crea lazy y tarda en cargar wa-sqlite.wasm. Calentar la DB aquí mismo
// deja el worker listo para el open sync posterior.
let webWarmupPromise: Promise<void> | null = null;
function warmUpWebWorker(): Promise<void> {
  if (!webWarmupPromise) {
    webWarmupPromise = (async () => {
      try {
        const raw = await SQLite.openDatabaseAsync("kiora.db");
        g.__kiora_web_warmup = raw;
      } catch {
        webWarmupPromise = null;
      }
    })();
  }
  return webWarmupPromise;
}

// Serializa TODO acceso async a la BD: en Android, dos prepareAsync
// concurrentes liberan el mismo NativeStatement compartido. Un solo runner
// toma las ops de a una, con prioridad: las lecturas saltan escrituras
// PENDIENTES (nunca la en vuelo) para que un sync no congele las consultas —
// pero solo entre los primeros 5 puestos de la cola (anti-hambruna: un
// torrente de lecturas no posterga un sync para siempre).
//
// "database is locked" se reintenta solo en escrituras atómicas (runAsync,
// transacciones: rollback al lanzar). execAsync NO: ejecuta varias sentencias
// y un fallo a mitad dejaría efecto parcial.
interface QueueEntry {
  run: () => Promise<unknown>;
  isWrite: boolean;
  method: string;
  label: string;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const queue: QueueEntry[] = [];
let running = false; // una sola op en vuelo (carrera de Android)
let runningSince = 0;
let runningMethod: string | null = null;
let lastStallWarn = 0;
let pendingWrites = 0;
// Lecturas servidas desde la última escritura: tras 5 seguidas, la siguiente
// op ES la escritura pendiente — garantiza su progreso ante un torrente.
let readsSinceWrite = 0;

// Coalescing: misma query con mismos args comparte promesa (seguro en SELECTs
// puros) y aplasta avalanchas de lecturas repetidas. Las escrituras se
// excluyen (cada una es un efecto único); la entrada se borra al completar.
const pendingReads = new Map<string, { promise: Promise<unknown> }>();

// Métodos que escriben: las lecturas encoladas pueden saltárselos.
const WRITE_METHODS = new Set([
  "execAsync",
  "runAsync",
  "prepareAsync",
  "withTransactionAsync",
  "withExclusiveTransactionAsync",
  "closeAsync",
]);

// Escrituras atómicas reintentables ante "database is locked".
const RETRYABLE_WRITE_METHODS = new Set([
  "runAsync",
  "withTransactionAsync",
  "withExclusiveTransactionAsync",
]);

// Métodos async del SQLiteDatabase que deben pasar por la cola.
const ASYNC_METHODS = new Set([
  "execAsync",
  "runAsync",
  "getAllAsync",
  "getFirstAsync",
  "getEachAsync",
  "prepareAsync",
  "withTransactionAsync",
  "withExclusiveTransactionAsync",
  "closeAsync",
  "serializeAsync",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withLockRetry<T>(fn: () => Promise<T>): Promise<T> {
  let attempts = 0;
  for (;;) {
    try {
      return await fn();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!/database is locked/i.test(msg) || attempts >= 5) throw err;
      attempts += 1;
      console.warn(`[db] "database is locked", reintento ${attempts}/5`);
      await sleep(250 * attempts);
    }
  }
}

// Las lecturas saltan escrituras PENDIENTES (nunca la en vuelo). Reglas: tras
// 5 lecturas seguidas se elige SIEMPRE una escritura (turno garantizado); con
// >120 encolados se vuelve a FIFO estricto (un torrente de lecturas no puede
// postergar escrituras para siempre).
function nextEntry(): QueueEntry | null {
  if (queue.length > 120) return queue.length > 0 ? queue.shift()! : null;
  if (readsSinceWrite >= 5 && pendingWrites > 0) {
    const w = queue.findIndex((e) => e.isWrite);
    if (w >= 0) return queue.splice(w, 1)[0];
  }
  const limit = Math.min(queue.length, 5);
  for (let i = 0; i < limit; i += 1) {
    if (!queue[i].isWrite) return queue.splice(i, 1)[0];
  }
  return queue.length > 0 ? queue.shift()! : null;
}

function pump(): void {
  if (running) {
    // Watchdog: solo avisa, no interviene — abortar a mitad dejaría estado
    // parcial. Reporta en consola qué op tiene el runner estancado.
    if (queue.length > 0 && Date.now() - runningSince > 15000 && Date.now() - lastStallWarn > 15000) {
      lastStallWarn = Date.now();
      console.warn(
        `[db] runner ocupado >15s (op: ${runningMethod}); ${queue.length} ops esperando. ` +
          "Si el runner no se libera, un op zombie congela la DB: reiniciar la app. Diagnostico en consola."
      );
    }
    return;
  }
  const entry = nextEntry();
  if (!entry) return;
  running = true;
  runningSince = Date.now();
  runningMethod = entry.method;
  if (entry.isWrite) {
    readsSinceWrite = 0;
  } else {
    readsSinceWrite += 1;
  }
  // Solo se loguea cuando hay cola: si el op anterior nunca termina, el log
  // muestra qué op quedó corriendo — el diagnóstico del estancamiento.
  if (queue.length > 0) {
    console.info(`[db] -> ${entry.method}${entry.isWrite ? " (w)" : " (r)"}${entry.label ? " " + entry.label : ""}, ${queue.length} encolados`);
  }
  let runPromise: Promise<unknown>;
  try {
    runPromise = entry.run();
  } catch (err) {
    running = false;
    runningMethod = null;
    entry.reject(err);
    pump();
    return;
  }
  runPromise.then(entry.resolve, entry.reject).finally(() => {
    if (entry.isWrite) pendingWrites -= 1;
    running = false;
    runningMethod = null;
    pump();
  });
}

// Stack del llamador, solo en avalancha: en Hermes las continuaciones async
// son trampolines de promesa, así que se recortan hasta 12 frames para
// encontrar el call-site real (archivo:línea) que realimenta la cola.
function callerFrames(): string {
  const stack = new Error().stack?.split("\n") ?? [];
  return stack
    .map((s) => s.trim())
    .filter((s) => !s.includes("lib/storage/db.ts") && !s.includes("node_modules"))
    .slice(1, 12)
    .join(" | ");
}

let lastAvalancheWarn = 0; // throttle: 1 aviso por ráfaga, no uno por enqueue

function enqueue<T>(method: string, sql: string | undefined, args: unknown[], fn: () => Promise<T>): Promise<T> {
  const isWrite = WRITE_METHODS.has(method);
  if (isWrite) pendingWrites += 1;
  // El SQL (args[0]) identifica el helper/pantalla que realimenta la cola;
  // el stack solo da trampolines de promesa en Hermes.
  const label = typeof sql === "string" ? sql.slice(0, 120) : "";
  if (queue.length > 100) {
    const now = Date.now();
    if (now - lastAvalancheWarn > 1000) {
      lastAvalancheWarn = now;
      console.warn(
        `[db] AVALANCHA: ${method} ${label} (${queue.length} en cola). Origen: ${callerFrames()}`
      );
    }
  }

  // Colapsa lecturas idénticas a una promesa compartida; getEachAsync se
  // excluye: su callback no es serializable y dos llamantes compartirían
  // un mismo stream.
  const run =
    isWrite && RETRYABLE_WRITE_METHODS.has(method)
      ? () => withLockRetry(fn)
      : fn;
  if (!isWrite && (method === "getAllAsync" || method === "getFirstAsync")) {
    let key: string | null = null;
    try {
      key = method + ":" + JSON.stringify(args);
    } catch {
      key = null; // args no serializables: no colapsar, corre individual
    }
    if (key !== null) {
      const shared = pendingReads.get(key);
      if (shared) return shared.promise as Promise<T>;
      const holder: { promise: Promise<unknown> } = { promise: Promise.resolve() };
      holder.promise = new Promise<T>((resolve, reject) => {
        queue.push({
          run,
          isWrite,
          method,
          label,
          resolve: resolve as (value: unknown) => void,
          reject,
        });
        pump();
      }).finally(() => {
        if (pendingReads.get(key) === holder) pendingReads.delete(key);
      });
      pendingReads.set(key, holder);
      return holder.promise as Promise<T>;
    }
  }

  return new Promise<T>((resolve, reject) => {
    queue.push({
      run,
      isWrite,
      method,
      label,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
    pump();
  });
}

export function getDb(): SQLite.SQLiteDatabase {
  if (Platform.OS === "web" && !g.__kiora_web_warmup) {
    warmUpWebWorker();
  }
  if (!g.__kiora_db) {
    const raw = SQLite.openDatabaseSync("kiora.db");
    // Activar FKs por conexión: el PRAGMA no persiste entre aperturas y
    // evita filas huérfanas en goal_installments/pot_contributions/note_links.
    raw.execSync("PRAGMA foreign_keys = ON;");
    g.__kiora_db = new Proxy(raw, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, receiver);
        if (typeof prop === "string" && ASYNC_METHODS.has(prop) && typeof value === "function") {
          return (...args: unknown[]) =>
            enqueue(
              prop,
              typeof args[0] === "string" ? args[0] : "sync",
              args,
              () =>
                (value as (...a: unknown[]) => Promise<unknown>).apply(target, args)
            );
        }
        return value;
      },
    }) as SQLite.SQLiteDatabase;
  }
  return g.__kiora_db;
}

// Cierra la conexión y descarta el singleton. Usado por el restore de
// backups: después de esto, el próximo getDb() reabre el archivo desde cero.
export async function closeDatabase(): Promise<void> {
  if (g.__kiora_db) {
    await g.__kiora_db.closeAsync();
    g.__kiora_db = undefined;
  }
  // Reenvíos colgados morirían con la conexión; se descartan para que el
  // restore no los apele contra un handle reabierto.
  pendingReads.clear();
  // Web: el handle caliente comparte el puntero con el sync (ya cerrado
  // arriba); se descarta para que el restore reabra limpio.
  g.__kiora_web_warmup = undefined;
  webWarmupPromise = null;
}

export async function checkDatabaseIntegrity(): Promise<boolean> {
  const db = getDb();
  const row = await db.getFirstAsync<{ integrity_check: string }>(
    "PRAGMA integrity_check"
  );
  return row?.integrity_check === "ok";
}

export async function initDatabase(): Promise<void> {
  const db = getDb();

  // busy_timeout bajo: el lock en WAL dura milisegundos; si hay contienda,
  // el retry de enqueue() (250ms·intento) resuelve sin congelar la cola 5s.
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 1200;

    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id   INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      UNIQUE(type, name COLLATE NOCASE)
    );

    CREATE TABLE IF NOT EXISTS tasks (
      id         TEXT PRIMARY KEY,
      title      TEXT NOT NULL,
      completed  INTEGER NOT NULL DEFAULT 0,
      priority   TEXT NOT NULL DEFAULT 'medium',
      category   TEXT NOT NULL DEFAULT '',
      due_date   TEXT,
      reminder   TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS notes (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      amount      REAL NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      category    TEXT NOT NULL,
      date        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS wish_items (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      link        TEXT NOT NULL DEFAULT '',
      amount      REAL,
      image       TEXT,
      description TEXT,
      category    TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goals (
      id          TEXT PRIMARY KEY,
      title       TEXT NOT NULL,
      description TEXT,
      status      TEXT NOT NULL DEFAULT 'active',
      target_date TEXT,
      created_at  TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goal_steps (
      id          TEXT PRIMARY KEY,
      goal_id     TEXT NOT NULL,
      title       TEXT NOT NULL,
      completed   INTEGER NOT NULL DEFAULT 0,
      step_order  INTEGER NOT NULL,
      unlocked_at TEXT
    );

    CREATE TABLE IF NOT EXISTS app_notifications (
      id         TEXT PRIMARY KEY,
      message    TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'info',
      read       INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS goal_installments (
      id       TEXT PRIMARY KEY,
      goal_id  TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      idx      INTEGER NOT NULL,
      amount   REAL NOT NULL DEFAULT 0,
      due_date TEXT NOT NULL,
      completed INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS pot_contributions (
      id         TEXT PRIMARY KEY,
      goal_id    TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      amount     REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS recurring_expenses (
      id            TEXT PRIMARY KEY,
      description   TEXT NOT NULL,
      amount        REAL NOT NULL,
      category      TEXT NOT NULL,
      interval      TEXT NOT NULL,
      anchor_date   TEXT NOT NULL,
      last_generated TEXT,
      created_at    TEXT NOT NULL
    );
  `);

  await ensureColumn(db, "transactions", "recurring_id", "TEXT");
  // Una ocurrencia por gasto recurrente y fecha: permite INSERT OR IGNORE en
  // la materialización sin duplicar aunque se corra varias veces.
  await db.execAsync(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_recurring
      ON transactions (recurring_id, date)
      WHERE recurring_id IS NOT NULL;
  `);

  // Las plantillas recurrentes soportan gastos e ingresos; las filas
  // existentes quedan como 'expense' para preservar el comportamiento.
  await ensureColumn(db, "recurring_expenses", "type", "TEXT NOT NULL DEFAULT 'expense'");

  await ensureColumn(db, "goal_steps", "description", "TEXT");
  await ensureColumn(db, "goals", "completed_at", "TEXT");
  await ensureColumn(db, "goals", "goal_type", "TEXT NOT NULL DEFAULT 'objective'");
  await ensureColumn(db, "goals", "installments", "INTEGER");
  await ensureColumn(db, "goals", "interval", "TEXT");
  await ensureColumn(db, "goals", "completed_installments", "INTEGER NOT NULL DEFAULT 0");
  await ensureColumn(db, "goals", "total_amount", "REAL");
  await ensureColumn(db, "goal_installments", "missed", "INTEGER NOT NULL DEFAULT 0");
  const sortAdded = await ensureColumn(db, "goals", "sort_order", "INTEGER NOT NULL DEFAULT 0");
  if (sortAdded) {
    const existing = await db.getAllAsync<{ id: string }>(
      "SELECT id FROM goals WHERE sort_order = 0 ORDER BY created_at ASC"
    );
    for (let i = 0; i < existing.length; i += 1) {
      await db.runAsync(
        "UPDATE goals SET sort_order = ? WHERE id = ?",
        [i + 1, existing[i].id]
      );
    }
  }
  await ensureColumn(db, "tasks", "priority", "TEXT NOT NULL DEFAULT 'medium'");
  await ensureColumn(db, "tasks", "category", "TEXT NOT NULL DEFAULT ''");
  await ensureColumn(db, "tasks", "due_date", "TEXT");
  await ensureColumn(db, "tasks", "reminder", "TEXT");

  await ensureColumn(db, "notes", "title", "TEXT");
  await ensureColumn(db, "notes", "pinned", "INTEGER NOT NULL DEFAULT 0");

  await db.execAsync(`
    CREATE TABLE IF NOT EXISTS note_links (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      note_id     TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id   TEXT NOT NULL,
      UNIQUE(note_id, entity_type, entity_id)
    );
  `);
}

async function ensureColumn(
  db: ReturnType<typeof getDb>,
  table: string,
  column: string,
  type: string
): Promise<boolean> {
  const info = await db.getAllAsync<{ name: string }>(`PRAGMA table_info(${table})`);
  if (info.some((c) => c.name === column)) return false;
  await db.execAsync(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  return true;
}
