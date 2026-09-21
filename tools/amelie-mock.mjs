// A fake Amelie (amelie.gr) for local development — never the real one.
//   node tools/amelie-mock.mjs [port=8090]
//   AMELIE_API_URL=http://127.0.0.1:8090/api/guests node tools/dev.mjs
// Then connect a plan (⋯ → Περισσότερα → Σύνδεση με Amelie…) with one of the links printed below. The worker accepts
// AMELIE_API_URL only on this machine (localhost / 127.0.0.1 / [::1]); production sets none.
//
// The contract (amelie-guests/1):
// POST /api/guests {token, since?, format:"json"}  → the document · {unchanged} when since = version · 404 not_found · 429 Retry-After
// Controls (this machine only — they change what the live link answers next):
// POST /mock/answer {name, count?, attending?}     → a household answers or changes its answer (yes|unknown|ceremony|no);
//                                                    the same name with a smaller count = the household shrank
// POST /mock/remove {name}                          → a household is deleted in Amelie
// POST /mock/revoke                                 → the live link is revoked: from now on it gets 404 not_found
// POST /mock/rotate                                 → a new random live link (the old one is revoked); answers {link}
// POST /mock/busy {times?=1, retryAfter?=120}       → the next `times` calls with a valid link get 429 + Retry-After
// POST /mock/reset                                  → the starting households, the fixed live link live again
// GET  /mock                                        → the current document of the live link
// GET  /mock/calls                                  → every /api/guests call so far: which link, since, the answer's status
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = parseInt(process.argv[2] || process.env.PORT || '8090', 10);
const LINKS = {   // test keys for this mock only — they mean nothing anywhere else
  live: 'mockLive_000000000000000000001',
  gone: 'mockGone_000000000000000000002',       // 404 not_found (revoked)
  busy: 'mockBusy_000000000000000000003',       // 429, Retry-After: 120
  slow: 'mockSlow_000000000000000000004',       // answers after 12 s (TakeaSeat gives up at 8 s)
  redirect: 'mockRedirect_00000000000000005',   // 302 elsewhere (never followed)
  huge: 'mockHuge_000000000000000000006',       // 2 MB body (over the 1 MB cap)
};
const OPTIONS = [{ key: 'all', label: 'Θα είμαι εκεί', attending: 'yes' }, { key: 'maybe', label: 'Ίσως', attending: 'unknown' },
  { key: 'church', label: 'Μόνο στην εκκλησία', attending: 'ceremony' }, { key: 'no', label: 'Δυστυχώς όχι', attending: 'no' }];
const parties = new Map();   // normalised name → party
let liveKeys = new Set([LINKS.live]), busy = { times: 0, retryAfter: 120 };
const calls = [];
const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
function answer(name, count = 1, attending = 'yes') {
  const k = norm(name), now = new Date().toISOString(), old = parties.get(k);
  const opt = OPTIONS.find(o => o.attending === attending) || OPTIONS[0];
  parties.set(k, { id: old ? old.id : 'am_' + crypto.randomBytes(8).toString('hex'), name: String(name).slice(0, 80), named: true,
    count: Math.max(1, Math.min(20, count | 0)), choice: opt.key, label: opt.label, attending: opt.attending,
    people: opt.attending === 'yes' || opt.attending === 'unknown' ? Math.max(1, count | 0) : 0, answers: (old ? old.answers : 0) + 1,
    first_at: old ? old.first_at : now, updated_at: now });
}
function reset() {
  parties.clear(); liveKeys = new Set([LINKS.live]); busy = { times: 0, retryAfter: 120 };
  answer('Γιώργος Παπαδόπουλος', 3, 'yes'); answer('Ελένη Κ.', 2, 'unknown'); answer('Νίκος Σ.', 1, 'no');
}
reset();
function doc() {
  const list = [...parties.values()], importGuests = [];
  for (const p of list) {
    const st = p.attending === 'yes' ? 'confirmed' : p.attending === 'unknown' ? 'probable' : 'cut';
    const n = st === 'cut' ? 1 : p.count;
    for (let i = 1; i <= n; i++) importGuests.push({ name: (i === 1 ? p.name : p.name + ' (συνοδός ' + (i - 1) + ')').slice(0, 80), party: p.name, status: st, note: 'Amelie: ' + p.label, srcId: 'amelie:' + p.id + ':' + i });
  }
  const totals = { parties: list.length, answers: list.reduce((s, p) => s + p.answers, 0), people_yes: list.filter(p => p.attending === 'yes').reduce((s, p) => s + p.people, 0),
    people_ceremony: list.filter(p => p.attending === 'ceremony').length, people_unknown: list.filter(p => p.attending === 'unknown').reduce((s, p) => s + p.people, 0), parties_no: list.filter(p => p.attending === 'no').length };
  const version = crypto.createHash('sha256').update(JSON.stringify([list.map(p => [p.id, p.name, p.count, p.attending]), importGuests])).digest('hex').slice(0, 12);
  return { ok: true, format: 'amelie-guests/1', version, generated_at: new Date().toISOString(),
    invitation: { names: { a: 'Μαρία', b: 'Νίκος' }, date: '2027-06-12', status: 'live', rsvp_open: true }, options: OPTIONS, totals, parties: list, importGuests };
}
const send = (res, status, obj, headers = {}) => { res.writeHead(status, { 'Content-Type': 'application/json', ...headers }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
const linkName = t => (Object.entries(LINKS).find(([, v]) => v === t) || [liveKeys.has(t) ? 'live*' : 'unknown'])[0];
http.createServer(async (req, res) => {
  let body = ''; for await (const c of req) { body += c; if (body.length > 65536) return send(res, 413, { ok: false }); }
  let b = {}; try { b = body ? JSON.parse(body) : {}; } catch (e) { return send(res, 400, { ok: false, error: 'bad_json' }); }
  const url = req.url.split('?')[0];
  if (req.method === 'GET' && url === '/mock') return send(res, 200, doc());
  if (req.method === 'GET' && url === '/mock/calls') return send(res, 200, calls);
  if (req.method === 'POST' && url === '/mock/answer') { if (!b.name) return send(res, 400, { ok: false }); answer(b.name, b.count || 1, b.attending || 'yes'); return send(res, 200, doc()); }
  if (req.method === 'POST' && url === '/mock/remove') { parties.delete(norm(b.name)); return send(res, 200, doc()); }
  if (req.method === 'POST' && url === '/mock/revoke') { liveKeys.clear(); return send(res, 200, { ok: true, revoked: true }); }
  if (req.method === 'POST' && url === '/mock/rotate') { const k = crypto.randomBytes(24).toString('base64url'); liveKeys = new Set([k]); return send(res, 200, { ok: true, link: 'https://amelie.gr/g/#' + k }); }
  if (req.method === 'POST' && url === '/mock/busy') { busy = { times: Math.max(0, (b.times ?? 1) | 0), retryAfter: Math.max(1, (b.retryAfter ?? 120) | 0) }; return send(res, 200, { ok: true, busy }); }
  if (req.method === 'POST' && url === '/mock/reset') { reset(); calls.length = 0; return send(res, 200, { ok: true }); }
  if (req.method !== 'POST' || url !== '/api/guests') return send(res, 404, { ok: false, error: 'not_found' });
  const t = String(b.token || ''), call = { at: new Date().toISOString(), link: linkName(t), since: b.since || null, status: 0 };
  calls.push(call);
  const reply = (status, obj, headers) => { call.status = status; console.log(call.at.slice(11, 19) + ' /api/guests ' + call.link + (call.since ? ' since ' + call.since : '') + ' → ' + status + (obj && obj.unchanged ? ' unchanged' : '')); send(res, status, obj, headers); };
  if (t === LINKS.busy) return reply(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': '120' });
  if (t === LINKS.redirect) return reply(302, doc(), { Location: 'https://example.com/' });
  if (t === LINKS.huge) { call.status = 200; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(doc()) + ' '.repeat(2 * 1024 * 1024)); return; }
  if (t === LINKS.slow) { await new Promise(r => setTimeout(r, 12000)); if (res.destroyed) return; }
  if (!liveKeys.has(t) && t !== LINKS.slow) return reply(404, { ok: false, error: 'not_found' });
  if (busy.times > 0) { busy.times--; return reply(429, { ok: false, error: 'rate_limited' }, { 'Retry-After': String(busy.retryAfter) }); }
  const d = doc();
  if (b.since && b.since === d.version) return reply(200, { ok: true, unchanged: true, version: d.version });
  reply(200, d);
}).listen(PORT, '127.0.0.1', () => {
  console.log('fake Amelie on http://127.0.0.1:' + PORT + '/api/guests  (start the server with AMELIE_API_URL=http://127.0.0.1:' + PORT + '/api/guests)');
  for (const [k, v] of Object.entries(LINKS)) console.log('  ' + k.padEnd(9) + 'https://amelie.gr/g/#' + v);
});
