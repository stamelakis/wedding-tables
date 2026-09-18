// TakeaSeat self-hosted server.
// Reuses the EXACT Cloudflare Worker logic (../wedding-sync-worker.js -> copied to ./worker.mjs in Docker),
// but backs its KV with SQLite on disk and also serves the static app. Same API, same behaviour.
//
//   API paths (/plans, /codes, /venues, /admin, /claim, /recover, /verify, /health) -> worker.fetch(request, env)
//   everything else                              -> static files from PUBLIC_DIR
//
// Env: PORT, DB_PATH, PUBLIC_DIR, OWNER_KEY, KV_BACKEND ("sqlite" default, "memory" for tests).
// Mail (optional): SMTP_HOST, SMTP_PORT (465 = TLS), SMTP_USER, SMTP_PASS, MAIL_FROM, PUBLIC_URL. MAIL_LOG=1 prints mails instead (dev).

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { migrate, sweep } from './worker.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '8080', 10);
const PUBLIC_DIR = path.resolve(process.env.PUBLIC_DIR || path.join(__dirname, '..'));
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'data', 'wedding.db');

// ---- KV backend ----
let PLANS;
if (process.env.KV_BACKEND === 'memory') {
  const m = new Map();
  PLANS = { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
    // atomic read-modify-write: fn(current string|null) -> {value?, del?, result?}; runs in one synchronous step
    update: async (k, fn) => { const out = fn(m.has(k) ? m.get(k) : null) || {}; if (out.del) m.delete(k); else if (out.value != null) m.set(k, out.value); return out.result; },
    list: async prefix => [...m.keys()].filter(k => k.startsWith(prefix)) };
  console.log('KV backend: memory (non-persistent)');
} else {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const { default: Database } = await import('better-sqlite3');
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');   // wait instead of failing when the nightly backup holds a lock
  db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  const sGet = db.prepare('SELECT value FROM kv WHERE key = ?');
  const sPut = db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
  const sDel = db.prepare('DELETE FROM kv WHERE key = ?');
  const sList = db.prepare("SELECT key FROM kv WHERE key >= ? AND key < ? ORDER BY key");
  PLANS = {
    get: async k => { const r = sGet.get(k); return r ? r.value : null; },
    put: async (k, v) => { sPut.run(k, v); },
    delete: async k => { sDel.run(k); },
    // atomic read-modify-write (better-sqlite3 is synchronous, so nothing can interleave between the read and the write):
    // fn(current string|null) -> {value?, del?, result?}
    update: async (k, fn) => { const r = sGet.get(k); const out = fn(r ? r.value : null) || {}; if (out.del) sDel.run(k); else if (out.value != null) sPut.run(k, out.value); return out.result; },
    list: async prefix => sList.all(prefix, prefix + '￿').map(r => r.key),
  };
  console.log('KV backend: sqlite at ' + DB_PATH);
}
const env = { OWNER_KEY: process.env.OWNER_KEY || '', PLANS, PUBLIC_URL: process.env.PUBLIC_URL || 'https://takeaseat.gr' };
// ---- mail: sent after the response, one at a time (the API answers in the same time whether or not a mail goes out) ----
const MAIL_FROM = process.env.MAIL_FROM || '';
let transport = null;
if (process.env.SMTP_HOST && MAIL_FROM) {
  try {
    const { default: nodemailer } = await import('nodemailer');
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined });
    console.log('mail: SMTP via ' + process.env.SMTP_HOST + ':' + port + ' from ' + MAIL_FROM);
    transport.verify().then(() => console.log('mail: SMTP login ok'), e => console.error('mail: SMTP check failed: ' + (e.code || '') + ' ' + (e.responseCode || '')));
  } catch (e) { console.error('mail: SMTP not available', e.message); }
} else if (process.env.MAIL_LOG === '1') {
  transport = { sendMail: async m => console.log('--- mail to ' + m.to + ' — ' + m.subject + '\n' + m.text + '\n---') };
  console.log('mail: log only (MAIL_LOG=1)');
} else console.log('mail: off (links are shown to the admin)');
const mailQueue = [];
let mailBusy = false;
const mailStat = { sent: 0, failed: 0, lastOkAt: null, lastError: null };   // shown in admin.html (GET /admin/mail)
const maskAddr = a => String(a || '').replace(/^(.{0,2})[^@]*@/, '$1***@');
async function drainMail() {
  if (mailBusy) return; mailBusy = true;
  while (mailQueue.length) {
    const m = mailQueue.shift();
    try { await transport.sendMail({ from: MAIL_FROM || 'TakeaSeat <noreply@localhost>', to: m.to, subject: m.subject, text: m.text }); mailStat.sent++; mailStat.lastOkAt = Date.now(); }
    catch (e) {
      const code = [e.code, e.responseCode, e.command].filter(Boolean).join(' ') || 'error';   // never e.message: SMTP errors quote the address
      const transient = !e.responseCode || (e.responseCode >= 400 && e.responseCode < 500);
      if (transient && !m.retried) { m.retried = true; setTimeout(() => { mailQueue.push(m); drainMail(); }, 60000).unref?.(); }
      else { mailStat.failed++; mailStat.lastError = { at: Date.now(), code, to: maskAddr(m.to) }; }
      console.error('mail failed to ' + maskAddr(m.to) + ': ' + code + (m.retried && transient && mailStat.lastError?.to !== maskAddr(m.to) ? ' (retry in 1 min)' : ''));
    }
  }
  mailBusy = false;
}
if (transport) env.MAIL = { enabled: true, from: MAIL_FROM || '(log)', status: () => ({ ...mailStat, queued: mailQueue.length }),
  send: m => { if (mailQueue.length > 500) return false; mailQueue.push(m); setImmediate(drainMail); return true; } };
// One-time data migration for roles & access (idempotent; the nightly backup runs before any deploy that needs it).
try { const r = await migrate(env); console.log('migration: ' + JSON.stringify(r)); }
catch (e) { console.error('migration failed', e); process.exit(1); }   // never serve half-migrated data
// API requests run one at a time: every read-modify-write in the worker sees a consistent store.
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
// Hourly housekeeping: expired one-time links and rate-limit rows (through the same queue as requests).
const runSweep = () => serial(() => sweep(env)).then(r => { if (r.tok || r.rlmail || r.claim) console.log('sweep: ' + JSON.stringify(r)); }, e => console.error('sweep failed', e));
setTimeout(runSweep, 60000).unref?.(); setInterval(runSweep, 3600000).unref?.();

// ---- static files ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8' };
const API_PREFIXES = ['/plans', '/codes', '/venues', '/admin', '/claim', '/health', '/recover', '/verify'];
const isApiPath = p => API_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'));

function serveStatic(req, res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0].split('#')[0]); }
  catch (e) { res.writeHead(400, { 'Content-Type': 'text/plain' }); res.end('bad request'); return; }   // a malformed %-escape must never crash the process
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.normalize(path.join(PUBLIC_DIR, rel));
  if (full !== PUBLIC_DIR && !full.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); res.end('forbidden'); return; }
  const ext = path.extname(full).toLowerCase();
  // only known app file types, never dotfiles / dot-directories (.git, .env, ACCESS.local.md live next to the app in dev)
  if (!MIME[ext] || rel.split('/').some(s => s.startsWith('.')) || /\.local\./i.test(rel)) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
  fs.stat(full, (serr, st) => {
    if (serr || !st.isFile()) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
    const etag = '"' + st.size + '-' + Math.floor(st.mtimeMs) + '"';
    const cache = ext === '.html' ? 'no-cache' : 'public, max-age=3600';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': cache }); res.end(); return; }   // revalidation → 304, not a 168 KB re-download
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': cache, 'ETag': etag });
      res.end(data);
    });
  });
}
process.on('unhandledRejection', e => console.error('unhandled rejection', e));

// ---- abuse guards: per-IP rate limiting + disk-full protection ----
const RL = new Map();   // key -> [timestamps]
function rateOk(key, limit, windowMs) {
  const now = Date.now();
  const arr = (RL.get(key) || []).filter(t => now - t < windowMs);
  if (arr.length >= limit) { RL.set(key, arr); return false; }
  arr.push(now); RL.set(key, arr); return true;
}
setInterval(() => { const now = Date.now();
  for (const [k, arr] of RL) { const w = k.endsWith(':mail') ? 3600000 : 60000; const f = arr.filter(t => now - t < w); if (f.length) RL.set(k, f); else RL.delete(k); }
}, 300000).unref?.();
async function diskLow() {
  try { const s = await fs.promises.statfs(path.dirname(DB_PATH)); return (s.bavail * s.bsize) < 300 * 1024 * 1024; }
  catch (e) { return false; }   // fail-open if statfs is unavailable
}
const clientIp = req => (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || req.socket.remoteAddress || 'unknown';   // the entry the proxy added

http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  let canon; try { canon = new URL(req.url, 'http://x').pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'; } catch (e) { canon = urlPath; }
  if (!isApiPath(urlPath)) { try { return serveStatic(req, res, req.url); } catch (e) { res.writeHead(500); return res.end('server error'); } }
  // ---- abuse guards on writes (unauth POST /plans is the disk-fill vector) ----
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
    const ip = clientIp(req);
    const isCreate = req.method === 'POST' && canon === '/plans';
    if (!rateOk(ip + (isCreate ? ':create' : ':write'), isCreate ? 20 : 120, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end('{"error":"rate_limited"}'); return;
    }
    // e-mail requests: 20 an hour per IP (each address is also limited to 3 an hour by the worker)
    if (req.method === 'POST' && (canon === '/recover' || /^\/(plans|venues)\/[^/]+\/email$/.test(canon)) && !rateOk(ip + ':mail', 20, 3600000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' }); res.end('{"error":"rate_limited"}'); return;
    }
    if (isCreate && await diskLow()) {
      res.writeHead(507, { 'Content-Type': 'application/json' }); res.end('{"error":"storage_full"}'); return;
    }
  }
  // ---- failed-key guessing: 60 refused requests a minute per IP, any method ----
  // A slot is reserved BEFORE the request runs (so a burst cannot all pass the check) and given back if it did not fail.
  const failKey = clientIp(req) + ':authfail';
  if (!rateOk(failKey, 60, 60000)) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end('{"error":"rate_limited"}'); return; }
  const slot = RL.get(failKey)[RL.get(failKey).length - 1];
  let failed = true;
  // ---- API: hand off to the worker ----
  try {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    const request = new Request('http://internal' + req.url, {
      method: req.method, headers: req.headers,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
    });
    const r = await serial(() => worker.fetch(request, env));
    failed = r.status === 401 || r.status === 403 || ((r.status === 404 || r.status === 410) && /^\/(claim|recover\/|verify)/.test(canon));
    const buf = Buffer.from(await r.arrayBuffer());
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(buf);
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"server error"}');
  } finally {
    if (!failed) { const a = RL.get(failKey); const i = a ? a.lastIndexOf(slot) : -1; if (i >= 0) a.splice(i, 1); }
  }
}).listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`TakeaSeat server on ${process.env.HOST || '0.0.0.0'}:${PORT}  (static: ${PUBLIC_DIR})`));
