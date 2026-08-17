// TakeaSeat self-hosted server.
// Reuses the EXACT Cloudflare Worker logic (../wedding-sync-worker.js -> copied to ./worker.mjs in Docker),
// but backs its KV with SQLite on disk and also serves the static app. Same API, same behaviour.
//
//   API paths (/plans, /codes, /venues, /admin) -> worker.fetch(request, env)
//   everything else                              -> static files from PUBLIC_DIR
//
// Env: PORT, DB_PATH, PUBLIC_DIR, OWNER_KEY, KV_BACKEND ("sqlite" default, "memory" for tests).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker from './worker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, '..'));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'wedding.db');

// ---- KV backend ----
let PLANS;
if (process.env.KV_BACKEND === 'memory') {
  const m = new Map();
  PLANS = { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); } };
  console.log('KV backend: memory (non-persistent)');
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const sGet = db.prepare('SELECT value FROM kv WHERE key = ?');
  const sPut = db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const sDel = db.prepare('DELETE FROM kv WHERE key = ?');
  PLANS = {
    get: async k => { const r = sGet.get(k); return r ? r.value : null; },
    put: async (k, v) => { sPut.run(k, v); },
    delete: async k => { sDel.run(k); },
  };
  console.log('KV backend: sqlite at ' + DB_PATH);
}
const env = { OWNER_KEY: process.env.OWNER_KEY || '', PLANS };

// ---- static files ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
const API_PREFIXES = ['/plans', '/codes', '/venues', '/admin'];
const isApiPath = p => API_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'));

function serveStatic(res, urlPath) {
  let rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': path.extname(full) === '.html' ? 'no-cache' : 'public, max-age=3600' });
    res.end(data);
  });
}

http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  if (!isApiPath(urlPath)) return serveStatic(res, req.url);
  // ---- API: hand off to the worker ----
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request('http://internal' + req.url, {
      method: req.method, headers: req.headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
    });
    const r = await worker.fetch(request, env);
    const buf = Buffer.from(await r.arrayBuffer());
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"server error"}');
  }
}).listen(PORT, () => console.log(`TakeaSeat server on :${PORT}  (static: ${PUBLIC_DIR})`));
