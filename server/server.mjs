// TakeaSeat self-hosted server.
// Reuses the EXACT Cloudflare Worker logic (../wedding-sync-worker.js -> copied to ./worker.mjs in Docker),
// but backs its KV with SQLite on disk and also serves the static app. Same API, same behaviour.
//
//   API paths (/plans, /codes, /venues, /admin, /claim, /recover, /verify, /health) -> worker.fetch(request, env)
//   everything else                              -> static files from PUBLIC_DIR
//
// Env: PORT, DB_PATH, PUBLIC_DIR, OWNER_KEY, KV_BACKEND ("sqlite" default, "memory" for tests).
// Mail (optional): SMTP_HOST, SMTP_PORT (465 = TLS), SMTP_USER, SMTP_PASS, MAIL_FROM, PUBLIC_URL. MAIL_LOG=1 prints mails instead (dev).
// PDF: ./pdf.mjs (pdfkit + an embedded font) renders floor plans and keepsakes; without it the PDF routes answer 503.

import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import worker, { migrate, sweep, mailOutcome } from './worker.mjs';
import { RL_WINDOW, ratePressure } from './rate.mjs';
import { Worker } from 'node:worker_threads';

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
const env = { OWNER_KEY: (process.env.OWNER_KEY || '').trim(), PLANS, PUBLIC_URL: process.env.PUBLIC_URL || 'https://takeaseat.gr' };   // a stray space in server.env would silently make the admin key unusable
// Our own pages (and a developer's localhost). Used only to refuse a cross-site POST to the public signup; everything
// else is already behind a key. www counts as ours, and the site's own origin comes from PUBLIC_URL, never from Host.
const OWN_ORIGIN = (() => { try { const u = new URL(env.PUBLIC_URL); return u.origin.toLowerCase(); } catch (e) { return 'https://takeaseat.gr'; } })();
const originOk = o => { let u; try { u = new URL(o); } catch (e) { return false; }
  const h = u.hostname.toLowerCase(), own = new URL(OWN_ORIGIN).hostname.toLowerCase();
  if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h === '::1') return true;
  return u.origin.toLowerCase() === OWN_ORIGIN || h === own || h === 'www.' + own || 'www.' + h === own; };
// Amelie (amelie.gr): the worker calls only https://amelie.gr/api/guests. AMELIE_API_URL is for tests / local dev ONLY — a
// mock on this machine (http://127.0.0.1:<port>/api/guests); any other host is refused by the worker. Production sets none.
if (process.env.AMELIE_API_URL) { env.AMELIE_API_URL = process.env.AMELIE_API_URL.trim(); console.log('amelie: AMELIE_API_URL is set — Amelie calls go to a local mock (dev/test only, never in production)'); }
// ---- mail: sent after the response, one at a time (the API answers in the same time whether or not a mail goes out) ----
const MAIL_FROM = process.env.MAIL_FROM || '';
let transport = null;
let smtp = null;   // {host, port, auth, login:'checking'|'ok'|'failed', at, code} — shown in «Διαγνωστικά»; never a password, never an address
if (process.env.SMTP_HOST && MAIL_FROM) {
  try {
    const { default: nodemailer } = await import('nodemailer');
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    transport = nodemailer.createTransport({ host: process.env.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 20000,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || '' } : undefined });
    console.log('mail: SMTP via ' + process.env.SMTP_HOST + ':' + port + ' from ' + MAIL_FROM);
    smtp = { host: process.env.SMTP_HOST, port, auth: !!process.env.SMTP_USER, login: 'checking', at: null, code: '' };
    transport.verify().then(
      () => { smtp.login = 'ok'; smtp.at = Date.now(); console.log('mail: SMTP login ok'); },
      e => { smtp.login = 'failed'; smtp.at = Date.now(); smtp.code = [e.code, e.responseCode].filter(Boolean).join(' ') || 'error';   // never e.message: it quotes the address
             console.error('mail: SMTP check failed: ' + (e.code || '') + ' ' + (e.responseCode || '')); });
  } catch (e) { console.error('mail: SMTP not available', e.message); }
} else if (process.env.MAIL_LOG === '1') {
  transport = { sendMail: async m => console.log('--- mail to ' + m.to + ' — ' + m.subject + '\n' + m.text + (m.attachments ? '\n[attachments: ' + m.attachments.map(a => a.filename + ' ' + (a.content ? a.content.length : 0) + ' bytes').join(', ') + ']' : '') + '\n---') };
  console.log('mail: log only (MAIL_LOG=1)');
} else console.log('mail: off (links are shown to the admin)');
const mailQueue = [];
let mailBusy = false;
const mailStat = { sent: 0, failed: 0, lastOkAt: null, lastError: null };   // shown in admin.html (GET /admin/mail)
const maskAddr = a => String(a || '').replace(/^(.{0,2})[^@]*@/, '$1***@');
// Set once the request queue exists (below): a tagged message's final outcome is written back to the couple / venue
// record through the SAME queue as every request, so it can never interleave with a read-modify-write of its own.
// Without this, «στάλθηκε» on the support card would mean no more than «μπήκε στην ουρά».
let noteMail = null;
const settleMail = (m, ok, code) => { if (m.tag && noteMail) noteMail(m.tag, ok, code); };
async function drainMail() {
  if (mailBusy) return; mailBusy = true;
  while (mailQueue.length) {
    const m = mailQueue.shift();
    try { await transport.sendMail({ from: MAIL_FROM || 'TakeaSeat <noreply@localhost>', to: m.to, subject: m.subject, text: m.text, ...(m.attachments ? { attachments: m.attachments } : {}) }); mailStat.sent++; mailStat.lastOkAt = Date.now(); settleMail(m, true); }
    catch (e) {
      const code = [e.code, e.responseCode, e.command].filter(Boolean).join(' ') || 'error';   // never e.message: SMTP errors quote the address
      const transient = !e.responseCode || (e.responseCode >= 400 && e.responseCode < 500);
      if (transient && !m.retried) { m.retried = true; setTimeout(() => { mailQueue.push(m); drainMail(); }, 60000).unref?.(); }
      else { mailStat.failed++; mailStat.lastError = { at: Date.now(), code, to: maskAddr(m.to) }; settleMail(m, false, code); }   // only a FINAL refusal is written back, never a pending retry
      console.error('mail failed to ' + maskAddr(m.to) + ': ' + code + (m.retried && transient && mailStat.lastError?.to !== maskAddr(m.to) ? ' (retry in 1 min)' : ''));
    }
  }
  mailBusy = false;
}
// ---- PDF (floor plan / keepsake): rendered in a worker thread, one at a time, at most 10 s each, so a heavy or
// hostile plan can never freeze the API. The thread keeps its parsed fonts between renders. ----
const PDF_TIMEOUT = 10000, PDF_QUEUE_MAX = 4;
let pdfWorker = null, pdfSeq = 0, pdfWaiting = 0, pdfChain = Promise.resolve();
const pdfPending = new Map();
function startPdfWorker() {
  const w = new Worker(new URL('./pdf-worker.mjs', import.meta.url));
  w.on('message', m => { const p = pdfPending.get(m.id); if (!p) return; pdfPending.delete(m.id); clearTimeout(p.t); m.ok ? p.res(Buffer.from(m.buf)) : p.rej(new Error(m.error)); });
  const dead = e => { if (pdfWorker === w) pdfWorker = null; for (const [id, p] of pdfPending) if (p.w === w) { clearTimeout(p.t); p.rej(e || new Error('pdf worker stopped')); pdfPending.delete(id); } };
  w.on('error', e => { console.error('pdf: worker error ' + e.message); dead(e); });
  w.on('exit', () => dead());
  w.unref();
  return w;
}
function renderPdf(plan, meta) {
  if (pdfWaiting >= PDF_QUEUE_MAX) return Promise.reject(Object.assign(new Error('pdf busy'), { busy: true }));
  pdfWaiting++;
  const job = () => new Promise((res, rej) => {
    if (!pdfWorker) pdfWorker = startPdfWorker();
    const id = ++pdfSeq, w = pdfWorker;
    const t = setTimeout(() => { pdfPending.delete(id); rej(new Error('pdf timeout')); if (pdfWorker === w) pdfWorker = null; w.terminate(); console.error('pdf: render stopped after ' + PDF_TIMEOUT + ' ms'); }, PDF_TIMEOUT);
    pdfPending.set(id, { res, rej, t, w });
    w.postMessage({ id, plan, meta });
  });
  const p = pdfChain.then(job, job);
  pdfChain = p.catch(() => {}).then(() => { pdfWaiting--; });
  return p;
}
let renderPlanPdf = null;
try {
  await import('./pdf.mjs');   // fails early (and PDF stays off) if pdfkit or the fonts are missing
  renderPlanPdf = renderPdf; env.PDF = { render: renderPdf }; console.log('pdf: on (worker thread)');
  setTimeout(() => renderPdf({ tables: [] }, {}).catch(e => console.error('pdf: warm-up failed: ' + e.message)), 3000).unref?.();   // parse the fonts once, not on the first customer's click
} catch (e) { console.error('pdf: off (' + e.message + ')'); }
if (transport) env.MAIL = { enabled: true, from: MAIL_FROM || '(log)', status: () => ({ ...mailStat, queued: mailQueue.length, mode: smtp ? 'smtp' : 'log', smtp: smtp ? { ...smtp } : null }),
  send: m => { if (mailQueue.length > 500) return false; mailQueue.push(m); setImmediate(drainMail); return true; } };
// One-time data migration for roles & access (idempotent; the nightly backup runs before any deploy that needs it).
try { const r = await migrate(env); console.log('migration: ' + JSON.stringify(r)); }
catch (e) { console.error('migration failed', e); process.exit(1); }   // never serve half-migrated data
// API requests run one at a time: every read-modify-write in the worker sees a consistent store.
let chain = Promise.resolve();
const serial = fn => { const p = chain.then(fn, fn); chain = p.catch(() => {}); return p; };
noteMail = (tag, ok, code) => serial(() => mailOutcome(env, tag, ok, code)).catch(e => console.error('mail outcome not recorded', e));
// Hourly housekeeping: expired one-time links and rate-limit rows (through the same queue as requests).
const runSweep = () => serial(() => sweep(env)).then(r => { if (r.tok || r.rlmail || r.claim || r.find || r.findEnded) console.log('sweep: ' + JSON.stringify(r)); }, e => console.error('sweep failed', e));
setTimeout(runSweep, 60000).unref?.(); setInterval(runSweep, 3600000).unref?.();

// ---- static files ----
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.ico': 'image/x-icon', '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8' };
const API_PREFIXES = ['/plans', '/codes', '/venues', '/admin', '/claim', '/health', '/recover', '/verify', '/pdf', '/find', '/signup'];
// The guest finder's page: never indexed. robots.txt disallows it too; this header is what a crawler that ignores robots.txt
// still gets. Renaming the page means changing this one line and the Disallow in robots.txt.
const NOINDEX = new Set(['/trapezi.html']);
const MAX_BODY = 3 * 1024 * 1024;   // the largest plan is 512 KB of JSON; anything far bigger is refused before it is read
const PDF_LANG = { el: 1, en: 1, de: 1 };
const PDF_WORDS = { el: ['κάτοψη', 'αναμνηστικό'], en: ['floor plan', 'keepsake'], de: ['Grundriss', 'Erinnerung'] };
const wellFormed = x => (typeof x.toWellFormed === 'function' ? x.toWellFormed() : x);
const pdfFileName = (name, mode, lang) => ([...wellFormed(String(name || 'TakeaSeat'))].slice(0, 80).join('').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').trim() || 'TakeaSeat') + ' — ' + PDF_WORDS[lang][mode === 'keepsake' ? 1 : 0] + '.pdf';
const ymd = s => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
const isApiPath = p => API_PREFIXES.some(pre => p === pre || p.startsWith(pre + '/'));
const AMELIE_PULL = /^\/plans\/[^/]+\/amelie\/pull$/;

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
    const robots = NOINDEX.has(rel.toLowerCase()) ? { 'X-Robots-Tag': 'noindex, nofollow, noarchive' } : {};
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { 'ETag': etag, 'Cache-Control': cache, ...robots }); res.end(); return; }   // revalidation → 304, not a 168 KB re-download
    fs.readFile(full, (err, data) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return; }
      res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': cache, 'ETag': etag, ...robots });
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
// Has this IP already paid a findfail slot for THIS unknown token within the hour? The first sighting pays; every
// repeat is free. Keyed on a hash, so no token ever becomes a long-lived key in memory, and bounded by the budget
// itself: once the ten slots are spent the request is refused before it ever gets here.
const findSeen = (failKey, token) => rateOk(failKey + '!' + crypto.createHash('sha256').update(String(token)).digest('base64url').slice(0, 16), 1, 3600000);
setInterval(() => { const now = Date.now();
  for (const [k, arr] of RL) { const w = RL_WINDOW(k); const f = arr.filter(t => now - t < w); if (f.length) RL.set(k, f); else RL.delete(k); }
}, 300000).unref?.();
const STARTED_AT = Date.now();
let PKG_VERSION = '';
try { PKG_VERSION = JSON.parse(fs.readFileSync(path.join(__dirname, 'package.json'), 'utf8')).version || ''; } catch (e) {}
let BUILT_AT = null;   // written by the Docker "check" stage once the API tests and the planner check have passed
try { BUILT_AT = fs.readFileSync(path.join(__dirname, '.checks-passed'), 'utf8').trim() || null; } catch (e) {}
// What the admin console's «Διαγνωστικά» asks the host (the worker itself knows nothing about processes or sockets).
env.HOST_INFO = () => ({
  version: PKG_VERSION, commit: (process.env.GIT_COMMIT || '').trim().slice(0, 40) || null, builtAt: BUILT_AT,
  startedAt: STARTED_AT, uptimeMs: Date.now() - STARTED_AT, node: process.version,
  kv: process.env.KV_BACKEND === 'memory' ? 'memory' : 'sqlite', publicUrl: env.PUBLIC_URL,
  pdf: !!renderPlanPdf, pdfQueue: pdfWaiting, trustProxy: TRUST_ALL ? 'all' : 'private-hop',
  rss: process.memoryUsage().rss, rate: ratePressure(RL),
});
async function diskLow() {
  try { const s = await fs.promises.statfs(path.dirname(DB_PATH)); return (s.bavail * s.bsize) < 300 * 1024 * 1024; }
  catch (e) { return false; }   // fail-open if statfs is unavailable
}
// The identity every rate limit is keyed on, so a forged one hands an attacker a fresh budget for each of them.
// In production the only way in is Caddy, on the internal docker network: it APPENDS the address it sees to
// X-Forwarded-For, so the LAST entry is the real client and anything the client put there itself sits in front of it.
// A connection that did not come through that private hop is somebody talking to the port directly, and its header is
// its own invention: that peer's address is the identity. TRUST_PROXY=all restores blind trust for a deployment whose
// proxy has a public address (a CDN in front of the origin); it must never be set on a port reachable from outside.
const PRIVATE_PEER = /^(::1|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|::ffff:(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)|f[cd][0-9a-f]{2}:|fe80:)/i;
const TRUST_ALL = process.env.TRUST_PROXY === 'all';
const clientIp = req => {
  const peer = (req.socket.remoteAddress || '').trim();
  if (!TRUST_ALL && peer && !PRIVATE_PEER.test(peer)) return peer;   // direct caller: its X-Forwarded-For is worth nothing
  return (req.headers['x-forwarded-for'] || '').split(',').pop().trim() || peer || 'unknown';   // the entry the proxy added
};

http.createServer(async (req, res) => {
  const urlPath = req.url.split('?')[0];
  let canon; try { canon = new URL(req.url, 'http://x').pathname.replace(/\/{2,}/g, '/').replace(/\/+$/, '') || '/'; } catch (e) { canon = urlPath; }
  if (!isApiPath(urlPath)) { try { return serveStatic(req, res, req.url); } catch (e) { res.writeHead(500); return res.end('server error'); } }
  const declared = parseInt(req.headers['content-length'] || '0', 10);
  if (declared > MAX_BODY) { res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' }); res.end('{"error":"too_large"}'); req.destroy(); return; }
  // PDF rendering costs CPU: 10 a minute per IP (stored plans and the stateless route together)
  if ((canon === '/pdf' || /^\/plans\/[^/]+\/pdf$/.test(canon)) && req.method !== 'OPTIONS' && !rateOk(clientIp(req) + ':pdf', 10, 60000)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end('{"error":"rate_limited"}'); return;
  }
  // Amelie pulls: 12 a minute per IP (a planner asks once on opening and then every 10–15 minutes; a looping client is
  // stopped here — Amelie itself is already shielded by the worker's one-call-per-plan-per-minute rule)
  const isAmeliePull = req.method === 'POST' && AMELIE_PULL.test(canon);
  if (isAmeliePull && !rateOk(clientIp(req) + ':amelie', 12, 60000)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end('{"error":"amelie_busy","retryAfter":60}'); return;
  }
  // ---- the guest finder (POST /find): the one public, unauthenticated read of guest data, so it is generous to humans and
  // hard on scripts. 300 guests behind the venue's one wifi are ONE IP and they all arrive within the hour, most of them
  // searching more than once, so the per-IP ceiling is a wedding's worth — 400 lookups per 10 minutes — not a phone's: a
  // tighter number locks the room out at guest 41. What actually bounds a valid token is the token's own cap (1,500 a day,
  // kept in the worker so it survives a move back to Cloudflare). The only way to probe for other weddings' finders is an
  // unknown token, and that stays expensive: 10 tries an hour per IP, the slot reserved before the request runs and given
  // back unless the answer was 404 — once per DISTINCT token (see the refund rule at the end of the handler, and why a
  // venue's old printed QR must not be able to spend the room's whole budget). Nothing about the request is logged —
  // not the query, not the answer, not the token.
  const isFind = req.method === 'POST' && canon === '/find';
  let findSlot = null, findStatus = 0, findTok = '';
  if (isFind) {
    const ip = clientIp(req);
    if (!rateOk(ip + ':find', 400, 600000)) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '600' }); res.end('{"error":"busy"}'); return; }
    if (!rateOk(ip + ':findfail', 10, 3600000)) { res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' }); res.end('{"error":"busy"}'); return; }
    const a = RL.get(ip + ':findfail'); findSlot = { key: ip + ':findfail', t: a[a.length - 1] };
  }
  // ---- abuse guards on writes (unauth POST /plans is the disk-fill vector) ----
  // A finder lookup is a POST but not a write — it stores nothing but its own counter — and it has the two stricter
  // limiters above. Left in the shared write budget (120 a minute per IP) the guests arriving at a venue would spend
  // the same budget as the venue's own laptop saving the plan on that wifi, and each would lock the other out.
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS' && !isFind) {
    const ip = clientIp(req);
    const isCreate = req.method === 'POST' && canon === '/plans';
    if (!rateOk(ip + (isCreate ? ':create' : ':write'), isCreate ? 20 : 120, 60000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' }); res.end('{"error":"rate_limited"}'); return;
    }
    // e-mail requests: 20 an hour per IP (each address is also limited to 3 an hour by the worker)
    if ((req.method === 'POST' || req.method === 'PUT') && (canon === '/recover' || canon === '/admin/recover' || canon === '/admin/owner' || canon === '/admin/test/email' || canon === '/signup/venue' || /^\/(plans|venues)\/[^/]+\/email$/.test(canon)) && !rateOk(ip + ':mail', 20, 3600000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' }); res.end('{"error":"rate_limited"}'); return;
    }
    // The venue signup is the one unauthenticated write that creates an account: a burst is stopped here, and the
    // worker keeps the real fence (3 a day per address, in the store, so a restart does not hand out a fresh budget).
    if (canon === '/signup/venue' && !rateOk(ip + ':signup', 5, 3600000)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '3600' }); res.end('{"error":"rate_limited"}'); return;
    }
    // …and it is the one unauthenticated write a FOREIGN page could make a visitor's browser send. A POST with
    // text/plain is a CORS "simple request": no preflight, so the per-IP fence above would be spending the visitor's
    // address instead of the attacker's. Demanding JSON forces a preflight, and the preflight answers with our one
    // fixed Access-Control-Allow-Origin, which no other page passes. A stated foreign Origin is refused outright.
    if (canon === '/signup/venue') {
      const ct = String(req.headers['content-type'] || '').split(';')[0].trim().toLowerCase();
      if (ct !== 'application/json') { res.writeHead(415, { 'Content-Type': 'application/json' }); res.end('{"error":"bad_content_type"}'); return; }
      const org = String(req.headers.origin || '').trim();
      if (org && !originOk(org)) { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end('{"error":"bad_origin"}'); return; }
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
    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > MAX_BODY) { failed = false; res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' }); res.end('{"error":"too_large"}'); req.destroy(); return; } chunks.push(c); }
    const body = chunks.length ? Buffer.concat(chunks) : undefined;
    // Which token a finder lookup used — read for the refund rule at the end of this handler and for nothing else; it is
    // hashed there and never stored, never logged. The worker parses the body again; it is a few hundred bytes.
    if (isFind && body) { try { const fb = JSON.parse(body.toString('utf8')); if (fb && typeof fb.token === 'string') findTok = fb.token.trim().slice(0, 64); } catch (e) {} }
    if (canon === '/pdf') {   // stateless render of the plan the planner sends (local plans, the lab, unsynced edits) — no store access
      failed = false;
      if (req.method !== 'POST') { res.writeHead(405, { 'Content-Type': 'application/json' }); res.end('{"error":"method"}'); return; }
      if (!renderPlanPdf) { res.writeHead(503, { 'Content-Type': 'application/json' }); res.end('{"error":"pdf_off"}'); return; }
      let b = null; try { b = JSON.parse(body ? body.toString('utf8') : 'null'); } catch (e) {}
      let size = Infinity; try { size = JSON.stringify(b && b.plan).length; } catch (e) {}   // absurdly nested JSON → refused, not a crash
      if (!b || typeof b !== 'object' || !b.plan || typeof b.plan !== 'object' || !Array.isArray(b.plan.tables) || size > 600 * 1024) {
        res.writeHead(422, { 'Content-Type': 'application/json' }); res.end('{"error":"bad_plan"}'); return; }
      const mode = b.mode === 'keepsake' ? 'keepsake' : 'floor', lang = PDF_LANG[b.lang] ? b.lang : 'el';
      const name = String(b.name || '').slice(0, 120);
      let pdf;
      const kind = b.kind === 'baptism' ? 'baptism' : 'wedding';   // the planner says what the event is; anything else is a wedding
      try { pdf = await renderPlanPdf(b.plan, { name, weddingDate: ymd(b.weddingDate), venueName: String(b.venueName || '').slice(0, 120), mode, lang, kind, brand: b.brand !== false }); }
      catch (e) { res.writeHead(503, { 'Content-Type': 'application/json', 'Retry-After': '30' }); res.end(e && e.busy ? '{"error":"pdf_busy"}' : '{"error":"pdf_failed"}'); return; }
      res.writeHead(200, { 'Content-Type': 'application/pdf', 'Cache-Control': 'no-store',
        'Content-Disposition': 'attachment; filename="takeaseat.pdf"; filename*=UTF-8\'\'' + encodeURIComponent(pdfFileName(name, mode, lang)) });
      res.end(pdf); return;
    }
    // The worker rate-limits the public signup per address, so the address it reads must be the one WE measured, not
    // one the caller wrote: x-real-ip is overwritten here and cf-connecting-ip (which the worker prefers when it runs
    // on Cloudflare) is dropped, so neither can be forged by anything talking to this server.
    const fwd = { ...req.headers, 'x-real-ip': clientIp(req) };
    delete fwd['cf-connecting-ip'];
    const request = new Request('http://internal' + req.url, {
      method: req.method, headers: fwd,
      body: ['GET', 'HEAD', 'OPTIONS'].includes(req.method) ? undefined : body,
    });
    // An Amelie pull may wait up to 8 s on amelie.gr, so it runs BESIDE the queue — nobody's save waits on Amelie. That is
    // safe because its only writes are single atomic PLANS.update calls (the plan record's Amelie fields, one counter row).
    const r = isAmeliePull ? await worker.fetch(request, env) : await serial(() => worker.fetch(request, env));
    findStatus = r.status;
    // The finder has its own two limiters; a guest scanning outside the window (403 closed) must never spend the shared
    // key-guessing budget — at a wedding every phone on the venue's wifi is the same IP.
    failed = !isFind && (r.status === 401 || r.status === 403 || ((r.status === 404 || r.status === 410) && /^\/(claim|recover\/|verify|admin\/recover)/.test(canon)));
    const buf = Buffer.from(await r.arrayBuffer());
    const headers = {}; r.headers.forEach((v, k) => { headers[k] = v; });
    res.writeHead(r.status, headers);
    res.end(buf);
  } catch (e) {
    console.error('server error ' + req.method + ' ' + canon.replace(/[A-Za-z0-9_-]{16,}/g, '…') + ': ' + ((e && e.stack) || e));   // never bodies or keys (Amelie keys also use _ and -)
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":"server error"}');
  } finally {
    if (!failed) { const a = RL.get(failKey); const i = a ? a.lastIndexOf(slot) : -1; if (i >= 0) a.splice(i, 1); }
    // Only an unknown token (404) keeps its slot — and only the FIRST time this IP meets that particular token. A real
    // lookup, a closed window or a server error gives it back, and so does every repeat of an unknown token.
    // Why: «Νέος κωδικός» in the planner makes every printed QR a 404, and one old poster left standing at the door is
    // scanned by phone after phone on the venue's single wifi address. Charged per attempt, the tenth scan of that one
    // dead code locked every guest after it — including the ones scanning the CORRECT new code — out for an hour, and
    // the page could only tell them to try again later. A script hunting for other weddings' finders tries DIFFERENT
    // tokens, which is what the ten slots are actually for; repeats stay bounded by the 400-per-10-minutes rule above.
    if (findSlot && (findStatus !== 404 || !findSeen(findSlot.key, findTok))) { const a = RL.get(findSlot.key); const i = a ? a.lastIndexOf(findSlot.t) : -1; if (i >= 0) a.splice(i, 1); }
  }
}).listen(PORT, process.env.HOST || '0.0.0.0', () => console.log(`TakeaSeat server on ${process.env.HOST || '0.0.0.0'}:${PORT}  (static: ${PUBLIC_DIR})`));
