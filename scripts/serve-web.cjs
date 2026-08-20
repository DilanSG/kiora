// Dev server para web con cross-origin isolation. expo-sqlite en browser
// necesita SharedArrayBuffer, que solo existe si el DOCUMENTO se sirve con
// COOP + COEP; el dev server de Expo no expone esos headers (el HTML lo
// genera el CLI, no Metro). Este script levanta Expo en un puerto interno y
// proxya hacia la URL pública inyectando los headers en cada respuesta y en
// el upgrade de websockets (HMR).
//
// IMPORTANTE: el puerto público es PROXY_PORT (por defecto 8083): el mismo
// que Expo anuncia en el terminal, para que abrir la URL que imprime el CLI
// siempre pase por el proxy. El puerto interno (EXPO_PORT = PROXY_PORT + 1)
// NO tiene headers; no abrirlo manualmente.
const http = require("http");
const { spawn } = require("child_process");

const PROXY_PORT = Number(process.env.PORT || 8083);
const EXPO_PORT = PROXY_PORT + 1;

const expo = spawn(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["expo", "start", "--web", "--port", String(EXPO_PORT)],
  { stdio: ["inherit", "pipe", "pipe"] }
);

// Expo imprime su propia URL con EXPO_PORT; se reescribe a la pública para
// que el terminal no lleve al puerto interno sin COOP/COEP.
function rewriteUrl(chunk) {
  return chunk
    .toString()
    .replaceAll(`localhost:${EXPO_PORT}`, `localhost:${PROXY_PORT}`)
    .replaceAll(`127.0.0.1:${EXPO_PORT}`, `localhost:${PROXY_PORT}`);
}
expo.stdout.on("data", (d) => process.stdout.write(rewriteUrl(d)));
expo.stderr.on("data", (d) => process.stderr.write(rewriteUrl(d)));

// Pre-calentar los bundles tras arrancar Metro: la primera peticion de
// entry/worker.bundle tarda ~44s con Metro frio, y como la app hace
// openDatabaseSync en el hydrate, el hilo queda bloqueado en blanco ese
// tiempo. Con el cache de Metro caliente ambos responden en ms.
function prewarm(readyCb) {
  const tryOnce = () => {
    const req = http.request({ host: "127.0.0.1", port: EXPO_PORT, path: "/", method: "GET", agent: false }, (res) => {
      res.resume();
      res.on("end", () => {
        const paths = [
          "/node_modules/expo-router/entry.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable",
          "/node_modules/expo-sqlite/web/worker.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable&modulesOnly=false&runModule=true",
        ];
        let done = 0;
        for (const p of paths) {
          const r2 = http.request({ host: "127.0.0.1", port: EXPO_PORT, path: p, method: "GET", agent: false }, (res2) => {
            res2.resume();
            res2.on("end", () => {
              done += 1;
              if (done === paths.length) console.log("[kiora-web] warm: bundles pre-calentados");
            });
          });
          r2.on("error", () => (done += 1));
          r2.end();
        }
      });
    });
    req.on("error", () => setTimeout(tryOnce, 2000));
    req.end();
  };
  setTimeout(tryOnce, 6000);
}

function withHeaders(headers) {
  headers["Cross-Origin-Opener-Policy"] = "same-origin";
  headers["Cross-Origin-Embedder-Policy"] = "require-corp";
}

const server = http.createServer((req, res) => {
  // RUTA TEMPORAL DE DEBUG: sirve un probe en el mismo origen que el bundle.
  if (req.url === "/__probe/") {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    res.end(`<!DOCTYPE html><html><body><pre id="log"></pre><script>
const log = (m) => (document.getElementById("log").textContent += m + "\\n");
const WB = "/node_modules/expo-sqlite/web/worker.bundle?platform=web&dev=true&hot=false&lazy=true&transform.engine=hermes&transform.routerRoot=app&unstable_transformProfile=hermes-stable&modulesOnly=false&runModule=true";
log("probe: worker http directo (mismo path que la app)...");
const t0 = Date.now();
const w = new Worker(WB);
log("worker creado, esperando MSG_INIT...");
w.onmessage = (e) => {
  const d = e.data;
  const err = d && d.error ? (d.error.message || "Error(" + JSON.stringify(d.error).slice(0,150) + ")") : null;
  log("msg +" + ((Date.now()-t0)/1000).toFixed(1) + "s: id=" + d.id + " md5result=" + (d.result ? "SI" : "no") + (err ? " ERROR=" + err : ""));
  if (d && d.msgs) log("  MSG_INIT en:" + JSON.stringify(d.msgs));
};
w.onerror = (e) => { log("WORKER ERROR: " + (e.message || "?") + " | " + (e.filename || "")); };
setTimeout(() => log("--- END 12s ---"), 12000);
setTimeout(() => {
  log("enviando open SYNC (isSync:true con buffers compartidos)...");
  try {
    const lockBuffer = new Int32Array(new SharedArrayBuffer(4));
    const resultBuffer = new SharedArrayBuffer(16);
    const view = new DataView(resultBuffer);
    view.setUint8(0, 0);
    w.postMessage({ id: 7, type: "open", isSync: true, data: { nativeDatabaseId: 7, databasePath: "kiora.db", options: {}, serializedData: undefined }, lockBuffer, resultBuffer });
    log("Atomics.wait...");
    const res = Atomics.wait(lockBuffer, 0, 0, 10000);
    log("wait: " + res + " flag=" + view.getUint8(0) + " len=" + view.getUint32(1) + " bytes=" + new Uint8Array(resultBuffer).slice(0, 34).join(","));
  } catch (e2) {
    log("syncopen EXCEP: " + e2.message);
  }
}, 1500);
</script></body></html>`);
    return;
  }

// Sin keep-alive hacia Metro: con pooling (globalAgent keepAlive=true desde
// Node 19) el proxy reutilizaba sockets que Metro ya habia cerrado por idle y
// los requests se colgaban ("socket hang up"/502 aleatorios). El worker.bundle
// colgado congelaba la app en el spin de expo-sqlite. Conexion fresca por
// request: mas lento en local, pero determinista.
const UPSTREAM_AGENT = new http.Agent({ keepAlive: false, maxSockets: 6 });

  const t0 = Date.now();
  console.log(`[kiora-web] >> ${req.method} ${req.url.slice(0, 60)} (len=${req.headers["content-length"] ?? 0})`);
  const upstream = http.request(
    {
      host: "127.0.0.1",
      port: EXPO_PORT,
      path: req.url,
      method: req.method,
      agent: UPSTREAM_AGENT,
      headers: { ...req.headers, host: `localhost:${EXPO_PORT}` },
    },
    (upRes) => {
      console.log(`[kiora-web] << ${req.url.slice(0, 60)} ${upRes.statusCode} +${Date.now() - t0}ms`);
      withHeaders(upRes.headers);
      res.writeHead(upRes.statusCode ?? 502, upRes.headers);
      upRes.pipe(res);
      upRes.on("end", () => console.log(`[kiora-web] === ${req.url.slice(0, 60)} body-end +${Date.now() - t0}ms`));
    }
  );
  upstream.on("error", (err) => {
    console.log(`[kiora-web] !! ${req.url.slice(0, 60)} error +${Date.now() - t0}ms: ${err.message}`);
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`Proxy error: ${err.message}`);
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  const upReq = http.request({
    host: "127.0.0.1",
    port: EXPO_PORT,
    path: req.url,
    method: "GET",
    // El handshake del WS también con socket fresco: un socket stale de pooling
    // hacía fallar el upgrade con ECONNRESET.
    agent: false,
    headers: { ...req.headers, host: `localhost:${EXPO_PORT}` },
  });
  upReq.on("upgrade", (upRes, upSocket, upHead) => {
    // Reenviar TODOS los headers del upstream (sec-websocket-accept incluido:
    // sin él el browser rechaza el handshake), salvo hop-by-hop.
    const forwarded = [];
    for (const [key, value] of Object.entries(upRes.headers)) {
      const k = key.toLowerCase();
      if (["connection", "upgrade", "transfer-encoding", "content-length"].includes(k)) continue;
      if (Array.isArray(value)) value.forEach((v) => forwarded.push(`${key}: ${v}`));
      else forwarded.push(`${key}: ${value}`);
    }
    socket.write(
      "HTTP/1.1 101 Switching Protocols\r\n" +
        "Connection: Upgrade\r\n" +
        "Upgrade: websocket\r\n" +
        forwarded.map((h) => `${h}\r\n`).join("") +
        "\r\n"
    );
    socket.write(upHead);
    upSocket.pipe(socket);
    socket.pipe(upSocket);
  });
  upReq.on("error", () => socket.destroy());
  upReq.end(head || undefined);
});

server.listen(PROXY_PORT, () => {
  console.log(
    `[kiora-web] ejecutando: http://localhost:${PROXY_PORT} -> Expo :${EXPO_PORT} (COOP/COEP inyectados)`
  );
  prewarm();
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    expo.kill();
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}