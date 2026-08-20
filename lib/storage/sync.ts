import * as SecureStore from "expo-secure-store";
import { getDb } from "./db";
import { addTransaction } from "./finance";
import { SYNC_KEY_SECURE } from "./helpers";

// Permite http:// solo a redes privadas (RFC 1918) o localhost: la app puede
// apuntar a un bridge en la LAN sin exponer la API key en texto plano por internet.
function isPrivateHostname(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  const match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!match) return false;

  const parts = match.slice(1).map((value) => Number(value));
  if (parts.some((value) => Number.isNaN(value) || value < 0 || value > 255)) {
    return false;
  }

  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true;

  return false;
}

function normalizeSyncUrl(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  if (!trimmed) throw new Error("La URL no puede estar vacía.");

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error("URL inválida.");
  }

  const isHttps = parsed.protocol === "https:";
  const isLocalHttp = parsed.protocol === "http:" && isPrivateHostname(parsed.hostname);
  if (!isHttps && !isLocalHttp) {
    throw new Error("La URL debe usar https:// (http:// solo en localhost o red local).");
  }

  return parsed.toString().replace(/\/$/, "");
}

export async function getSecureSyncKey(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(SYNC_KEY_SECURE)) ?? "";
  } catch {
    return "";
  }
}

export async function setSecureSyncKey(value: string): Promise<void> {
  await SecureStore.setItemAsync(SYNC_KEY_SECURE, value);
}

export async function deleteSecureSyncKey(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(SYNC_KEY_SECURE);
  } catch {
    // eliminar una key inexistente no debe romper la limpieza de config
  }
}

export async function getSyncConfig(): Promise<{ url: string; key: string }> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = 'sync_url'"
  );
  const key = await getSecureSyncKey();
  return { url: row?.value ?? "", key };
}

export async function setSyncConfig(url: string, key: string): Promise<void> {
  const trimmedUrl = url.trim();
  const trimmedKey = key.trim();
  const db = getDb();

  if (!trimmedUrl && !trimmedKey) {
    await db.runAsync("DELETE FROM settings WHERE key = 'sync_url'");
    await deleteSecureSyncKey();
    return;
  }

  if (!trimmedUrl) throw new Error("La URL es requerida.");
  if (!trimmedKey) throw new Error("La API key es requerida.");

  const normalizedUrl = normalizeSyncUrl(trimmedUrl);
  await db.runAsync(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ('sync_url', ?)",
    normalizedUrl
  );
  await setSecureSyncKey(trimmedKey);
}

const SYNCED_IDS_KEY = "synced_remote_ids";
const MAX_SYNCED_IDS = 2000;

// IDs remotos ya procesados, persistidos en SQLite: un crash a mitad del sync
// no reimporta lo ya insertado. Tope de MAX_SYNCED_IDS para que no crezca sin límite.
async function getSyncedIds(): Promise<Set<string>> {
  const db = getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    "SELECT value FROM settings WHERE key = ?", SYNCED_IDS_KEY
  );
  if (!row) return new Set();
  try {
    const arr = JSON.parse(row.value);
    return new Set<string>(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

async function addSyncedId(id: string): Promise<void> {
  const db = getDb();
  const ids = await getSyncedIds();
  ids.add(id);
  if (ids.size > MAX_SYNCED_IDS) {
    const arr = Array.from(ids).slice(-MAX_SYNCED_IDS);
    await db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [SYNCED_IDS_KEY, JSON.stringify(arr)]
    );
  } else {
    await db.runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [SYNCED_IDS_KEY, JSON.stringify(Array.from(ids))]
    );
  }
}

const SYNC_TIMEOUT_MS = 10000;

async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = SYNC_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

// Cada item pendiente trae un `id` UUID v4 del bridge: sirve de dedup para
// que un crash entre addTransaction y el DELETE no duplique el gasto.
export async function syncFromN8n(): Promise<number> {
  const { url, key } = await getSyncConfig();
  if (!url || !key) throw new Error("Configura la URL y la API key primero.");

  const base = normalizeSyncUrl(url);
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const response = await fetchWithTimeout(`${base}/api/expense/pending`, { headers });
  if (!response.ok) throw new Error(`Error del servidor: ${response.status}`);

  const pending: {
    id: string;
    amount: number;
    description: string;
    category: string;
    type: string;
    date: string;
  }[] = await response.json();

  const synced = await getSyncedIds();
  let imported = 0;

  for (const item of pending) {
    if (!synced.has(item.id)) {
      await addTransaction({
        amount: item.amount,
        description: item.description,
        category: item.category,
        type: item.type === "income" ? "income" : "expense",
      });
      synced.add(item.id);
      imported += 1;
    }
    // DELETE individual: si falla se ignora para que un error de red no bloquee el resto.
    try {
      await fetchWithTimeout(`${base}/api/expense/${item.id}`, { method: "DELETE", headers });
    } catch {
    }
  }

  if (synced.size > 0) {
    const arr = Array.from(synced).slice(-MAX_SYNCED_IDS);
    await getDb().runAsync(
      "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)",
      [SYNCED_IDS_KEY, JSON.stringify(arr)]
    );
  }

  return imported;
}
