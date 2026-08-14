const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
require("dotenv").config();

const app = express();
const PORT = process.env.PORT || 3001;
// Nota: ya no se acepta POINYTA_API_KEY como fallback — esa key se
// publico embebida en un APK distribuido y debe considerarse comprometida.
const API_KEY = process.env.KIORA_API_KEY;
const SENDGRID_KEY = process.env.SENDGRID_API_KEY;
const REPORT_TO = process.env.REPORT_TO || "nalidess2002@gmail.com";
const PENDING_FILE = path.join(__dirname, "pending.json");
const PENDING_TMP = PENDING_FILE + ".tmp";

if (!API_KEY) {
  console.error("ERROR: Set the KIORA_API_KEY environment variable before starting.");
  process.exit(1);
}

console.log(`SendGrid ${SENDGRID_KEY ? "configurado" : "NO CONFIGURADO"} — destino=${REPORT_TO}`);

// Limite de cuerpo: 50kb para POST de gastos y reportes evita que un
// request gigante agote la memoria o llene el file pendiente.
app.use(express.json({ limit: "50kb" }));

// ─── Rate limiting (in-memory) ───────────────────────────────────────────────
// Ventana deslizante por IP: limita intentos de auth fallidos y el uso total
// de rutas autenticadas para frenar fuerza bruta y abuso del puente.
const AUTH_WINDOW_MS = 10 * 60 * 1000;
const AUTH_MAX_ATTEMPTS = 20;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 120;

const authAttempts = new Map();
const requestCounts = new Map();

function pruneMap(map, now) {
  for (const [key, entry] of map) {
    if (now - entry.resetAt > 0) map.delete(key);
  }
}

function authRateLimiter(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  pruneMap(authAttempts, now);
  const entry = authAttempts.get(key) || { count: 0, resetAt: now + AUTH_WINDOW_MS };
  if (entry.count >= AUTH_MAX_ATTEMPTS) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Demasiados intentos. Reintenta más tarde." });
  }
  entry.count += 1;
  authAttempts.set(key, entry);
  next();
}

function rateLimiter(req, res, next) {
  const now = Date.now();
  const key = req.ip || "unknown";
  pruneMap(requestCounts, now);
  const entry = requestCounts.get(key) || { count: 0, resetAt: now + RATE_WINDOW_MS };
  if (entry.count >= RATE_MAX_REQUESTS) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    return res.status(429).json({ error: "Demasiadas solicitudes. Reintenta más tarde." });
  }
  entry.count += 1;
  requestCounts.set(key, entry);
  next();
}

// ─── Mutex para pending.json ─────────────────────────────────────────────────
// El archivo se lee-modifica-escribe en varias rutas; sin exclusión mutua dos
// requests concurrentes pueden pisarse (lost update). Este mutex serializa
// las operaciones en un solo proceso.
let queueTail = Promise.resolve();

function withPendingLock(fn) {
  const run = queueTail.then(fn, fn);
  queueTail = run.catch(() => {});
  return run;
}

function safeCompare(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

function auth(req, res, next) {
  const header = req.headers["authorization"];
  if (!header) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  const prefix = "Bearer ";
  if (!header.startsWith(prefix) || !safeCompare(header.slice(prefix.length), API_KEY)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

function writePending(data) {
  fs.writeFileSync(PENDING_TMP, JSON.stringify(data, null, 2));
  fs.renameSync(PENDING_TMP, PENDING_FILE);
}

function readPending() {
  if (!fs.existsSync(PENDING_FILE)) return [];
  return JSON.parse(fs.readFileSync(PENDING_FILE, "utf8"));
}

// Las rutas autenticadas comparten el rate limit total por IP; /api/report
// (enviar emails) es el abuso mas costoso, asi que tambien pasa por el limit
// de auth para frenar intentos de fuerza bruta sobre la key.
app.post("/api/expense", authRateLimiter, rateLimiter, auth, (req, res) => {
  const { amount, description, category, type } = req.body;
  if (!amount || !description) {
    return res.status(400).json({ error: "amount and description are required" });
  }
  const parsedAmount = parseFloat(amount);
  if (isNaN(parsedAmount) || parsedAmount <= 0 || parsedAmount > 999999999) {
    return res.status(400).json({ error: "amount must be a positive number" });
  }
  const entry = {
    id: crypto.randomUUID(),
    amount: parsedAmount,
    description: String(description).slice(0, 500),
    category: String(category || "General").slice(0, 100),
    type: type === "income" ? "income" : "expense",
    date: new Date().toISOString(),
  };
  withPendingLock(() => {
    const pending = readPending();
    pending.push(entry);
    writePending(pending);
  })
    .then(() => res.json({ ok: true, id: entry.id }))
    .catch((err) => {
      console.error("Error escribiendo pending.json:", err);
      res.status(500).json({ error: "Error interno al guardar el gasto" });
    });
});

app.get("/api/expense/pending", authRateLimiter, rateLimiter, auth, (req, res) => {
  withPendingLock(readPending)
    .then((pending) => res.json(pending))
    .catch(() => res.status(500).json({ error: "Error interno al leer pendientes" }));
});

app.delete("/api/expense/:id", authRateLimiter, rateLimiter, auth, (req, res) => {
  const { id } = req.params;
  if (!id || typeof id !== "string" || id.length > 64) {
    return res.status(400).json({ error: "invalid id" });
  }
  withPendingLock(() => {
    const updated = readPending().filter((e) => e.id !== id);
    writePending(updated);
  })
    .then(() => res.json({ ok: true }))
    .catch(() => res.status(500).json({ error: "Error interno al eliminar" }));
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true, uptime: process.uptime() });
});

app.post("/api/report", authRateLimiter, rateLimiter, auth, async (req, res) => {
  const { description, config } = req.body;
  if (!SENDGRID_KEY) {
    return res.status(500).json({ error: "SendGrid no configurado — define SENDGRID_API_KEY" });
  }
  if (config && JSON.stringify(config).length > 20000) {
    return res.status(400).json({ error: "config demasiado grande" });
  }
  const body = description
    ? `Descripción:\n${description}\n\n---\n${JSON.stringify(config, null, 2)}`
    : JSON.stringify(config, null, 2);
  try {
    const sgRes = await fetch("https://api.sendgrid.com/v3/mail/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SENDGRID_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: REPORT_TO }] }],
        from: { email: REPORT_TO },
        subject: `Reporte Kiora — ${config?.theme || "desconocido"}`,
        content: [{ type: "text/plain", value: body }],
      }),
    });
    if (!sgRes.ok) {
      const errBody = await sgRes.text().catch(() => "");
      throw new Error(`SendGrid ${sgRes.status}: ${errBody}`);
    }
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Error desconocido";
    console.error("Error enviando reporte:", msg);
    res.status(500).json({ error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`Kiora sync server running on port ${PORT}`);
});