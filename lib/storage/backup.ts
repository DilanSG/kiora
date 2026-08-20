import * as SQLite from "expo-sqlite";
import { Directory, File, Paths } from "expo-file-system";
import { getDb, checkDatabaseIntegrity, closeDatabase } from "./db";

const BACKUP_DIR = "kiora-backups";
const MAX_BACKUPS = 7;
const BACKUP_DATE_KEY = "db_backup_last_date";

function backupDir(): Directory {
  return new Directory(Paths.document, BACKUP_DIR);
}

function listBackupFiles(): File[] {
  const dir = backupDir();
  if (!dir.exists) return [];
  return dir
    .list()
    .filter((f): f is File => f instanceof File && f.name.startsWith("kiora-") && f.name.endsWith(".db"))
    .sort((a, b) => b.name.localeCompare(a.name));
}

// serializeAsync produce un snapshot consistente sin bloquear escrituras.
export async function createDatabaseBackup(): Promise<boolean> {
  const db = getDb();
  const dir = backupDir();
  dir.create({ intermediates: true, idempotent: true });

  const today = new Date().toISOString().slice(0, 10);
  const files = listBackupFiles();
  if (files.some((f) => f.name.includes(today))) return false;

  const bytes = await db.serializeAsync();
  const dest = new File(dir, `kiora-${today}-${Date.now().toString(36)}.db`);
  dest.create({ overwrite: true });
  dest.write(bytes);

  // Rotación: conservar solo los MAX_BACKUPS más recientes.
  for (const old of listBackupFiles().slice(MAX_BACKUPS)) {
    try {
      old.delete();
    } catch {
      // archivo en uso o sin permiso: se ignora, la rotación vuelve a intentar mañana
    }
  }
  return true;
}

function dbFilePath(): string {
  const raw = getDb().databasePath;
  return raw.startsWith("file://") ? raw : `file://${raw}`;
}

// El archivo original se preserva como evidencia antes de borrarlo: si el
// backup resultara inválido, la DB viva no se pierde.
export async function restoreLatestBackup(): Promise<boolean> {
  const files = listBackupFiles();
  if (files.length === 0) return false;
  const backup = files[0];

  const bytes = await backup.bytes();
  if (!bytes || bytes.byteLength === 0) return false;

  const livePath = dbFilePath();
  const liveFile = new File(livePath);

  // Guardar la DB viva (aunque esté corrupta) como evidencia antes de tocar nada.
  const dir = backupDir();
  dir.create({ intermediates: true, idempotent: true });
  try {
    if (liveFile.exists) {
      liveFile.copy(new File(dir, `kiora-corrupt-${Date.now().toString(36)}.db`));
    }
  } catch {
    // sin espacio o sin permiso: se continúa de todos modos
  }

  await closeDatabase();

  // Eliminar WAL/SHM para que SQLite no mezcle páginas de la DB vieja.
  for (const suffix of ["-wal", "-shm"]) {
    try {
      const side = new File(`${livePath}${suffix}`);
      if (side.exists) side.delete();
    } catch {
    }
  }

  try {
    if (liveFile.exists) liveFile.delete();
    liveFile.create({ overwrite: true });
    liveFile.write(bytes);
  } catch {
    await closeDatabase();
    return false;
  }

  // getDb() reabre el archivo restaurado en el próximo acceso.
  return true;
}

// Rutina de arranque: verifica integridad, restaura si hace falta y agenda
// el backup diario. Nunca lanza: una falla aquí no debe tumbar el arranque.
export async function runDatabaseMaintenance(): Promise<void> {
  try {
    let ok = await checkDatabaseIntegrity();

    // DB corrupta: intentar recuperar el backup más reciente.
    if (!ok) {
      const restored = await restoreLatestBackup();
      if (restored) ok = await checkDatabaseIntegrity();
    }

    // Backup diario (una por día, flag en settings). Se hace igual si se
    // restauró, para capturar el estado ya saneado.
    if (ok) {
      const db = getDb();
      const row = await db.getFirstAsync<{ value: string }>(
        "SELECT value FROM settings WHERE key = ?",
        BACKUP_DATE_KEY
      );
      const today = new Date().toISOString().slice(0, 10);
      if (row?.value !== today) {
        const created = await createDatabaseBackup();
        if (created) {
          await db.runAsync(
            "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
            BACKUP_DATE_KEY,
            today
          );
        }
      }
    }
  } catch {
    // la DB aún no existe o fallo puntual: reintenta en el próximo arranque
  }
}

// Elimina la bandera de backup diario (usado por clearAllData para que la
// próxima sesión respalde el estado nuevo de inmediato).
export async function resetBackupSchedule(): Promise<void> {
  try {
    await getDb().runAsync("DELETE FROM settings WHERE key = ?", BACKUP_DATE_KEY);
  } catch {
  }
}