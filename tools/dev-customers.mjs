// Local dev server with made-up customers for the «Πελάτες» sheet: one for every stage and every «Θέλουν εμένα» flag.
//   node tools/dev-customers.mjs   →  http://localhost:8080/admin.html   (owner key: dev-owner-key)
//                                  and http://localhost:8080/venue.html (venue key: printed at start, ends in .dev-venue-key)
// Builds a fresh sqlite file in server/data/ (git-ignored) through the real worker — the same calls the API takes —
// moves a few dates into the past (a link sent 4 days ago, a season that ended), then starts tools/dev.mjs on it.
// Every name, number and address below is invented.
// sqlite comes from Node's own node:sqlite (Node 22.13+), not better-sqlite3: that one is a native module, built for
// the server's Linux image and often not for a Windows laptop. server.mjs is pointed at the same small stand-in below.
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB = path.join(root, 'server', 'data', 'dev-customers.db');
fs.mkdirSync(path.dirname(DB), { recursive: true });
for (const f of [DB, DB + '-wal', DB + '-shm']) fs.rmSync(f, { force: true });
// the four calls server.mjs makes of better-sqlite3 (pragma, exec, prepare, and get/run/all on a statement)
const SHIM = 'data:text/javascript,' + encodeURIComponent("import { DatabaseSync } from 'node:sqlite';"
  + "export default class Database { constructor(p) { this.db = new DatabaseSync(p); } pragma(s) { this.db.exec('PRAGMA ' + s); }"
  + " exec(s) { this.db.exec(s); } prepare(s) { return this.db.prepare(s); } close() { this.db.close(); } }");
registerHooks({ resolve: (spec, ctx, next) => spec === 'better-sqlite3' ? { url: SHIM, shortCircuit: true } : next(spec, ctx) });
const db = new DatabaseSync(DB);
db.exec('CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
const sGet = db.prepare('SELECT value FROM kv WHERE key = ?'), sPut = db.prepare('INSERT INTO kv(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value');
const sDel = db.prepare('DELETE FROM kv WHERE key = ?'), sList = db.prepare('SELECT key FROM kv WHERE key >= ? AND key < ? ORDER BY key');
const PLANS = { get: async k => { const r = sGet.get(k); return r ? r.value : null; }, put: async (k, v) => { sPut.run(k, v); }, delete: async k => { sDel.run(k); },
  update: async (k, fn) => { const r = sGet.get(k); const out = fn(r ? r.value : null) || {}; if (out.del) sDel.run(k); else if (out.value != null) sPut.run(k, out.value); return out.result; },
  list: async prefix => sList.all(prefix, prefix + '￿').map(r => r.key) };

const mod = await import(pathToFileURL(path.join(root, 'wedding-sync-worker.js')).href);
const worker = mod.default;
// Mail "on" only while seeding, so setup and claim links count as sent; the dev server itself runs with mail off.
const env = { OWNER_KEY: 'dev-owner-key', PLANS, PUBLIC_URL: 'http://localhost:8080', MAIL: { enabled: true, from: 'TakeaSeat <hello@takeaseat.gr>', send: () => true } };
await mod.migrate(env);
const OWN = { 'X-Owner-Key': 'dev-owner-key' };
async function call(method, url, body, headers = {}) {
  const r = await worker.fetch(new Request('http://dev' + url, { method, headers: { 'Content-Type': 'application/json', 'X-Client': '2', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  const d = await r.json().catch(() => null);
  if (!r.ok) throw new Error(method + ' ' + url + ' → ' + r.status + ' ' + JSON.stringify(d));
  return d;
}
const raw = k => JSON.parse(sGet.get(k).value);
const patch = (k, fn) => { const o = raw(k); fn(o); sPut.run(k, JSON.stringify(o)); if (k.startsWith('plan:')) sDel.run('meta:archive'); };
const DAY = 86400000, ago = d => Date.now() - d * DAY;
const day = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * DAY));
const table = (id, ids) => ({ id, shape: 'round', x: 200 * id, y: 200, label: String(id), capacity: 10, seats: [...ids, ...Array(10 - ids.length).fill(null)] });
const plan = (guests, tables) => ({ tables, features: [], stage: { w: 2000, h: 1400 }, stageMaterial: 'grass', guests, groups: [], parties: [], layoutVersion: 5, _uid: 99 });
const people = (n, prefix) => Object.fromEntries(Array.from({ length: n }, (_, i) => [prefix + i, { name: 'Καλεσμένος ' + (i + 1) }]));
const venue = async (name, email, extra = {}) => (await call('POST', '/admin/venues', { name, email, license: { type: 'seasonal', seasonStart: day(-30), seasonEnd: day(250) }, ...extra }, OWN)).id;
const couple = async body => { const r = await call('POST', '/admin/couples', body, OWN); return r.couple.id; };

// ---- venues ----
const v1 = await venue('Κτήμα Ελαιώνας', 'info@elaionas.example', { contact: 'τηλ. 697 111 2233 · κα Ρένα' });
patch('venue:' + v1, o => { o.createdAt = ago(5); });                                                          // ⚑ link unopened
const v2 = await venue('Αίθουσα Φεγγαράκι', 'hello@feggaraki.example', { contact: '210 444 5566' });            // link sent today
const v3 = await venue('Κτήμα Πλάτανος', 'platanos@example.gr', { contact: '6945 000 111' });
patch('venue:' + v3, o => { o.createdAt = ago(20); o.keyRotated = true; o.keyPrivate = false; });           // ⚑ no event after 14 days
const v4 = await venue('Κτήμα Αμπέλια', 'ampelia@example.gr', { contact: '2310 888 999' });
patch('venue:' + v4, o => { o.keyRotated = true; o.used = 3; o.license.invoiceDue = true; o.license.renewedAt = ago(2); });   // ⚑ invoice due
const v5 = await venue('Κτήμα Θάλασσα', 'thalassa@example.gr', { contact: '6977 222 333' });
patch('venue:' + v5, o => { o.keyRotated = true; o.used = 4; o.license = { ...o.license, seasonStart: day(-370), seasonEnd: day(-5), autoRenew: true, renewSkipped: day(-5) }; });   // ⚑ renewal skipped
const v6 = await venue('Αίθουσα Παλιά Αποθήκη', 'apothiki@example.gr');
patch('venue:' + v6, o => { o.keyRotated = true; o.used = 2; o.license = { ...o.license, seasonStart: day(-400), seasonEnd: day(-35), autoRenew: false }; });     // archive: did not renew
const v7 = await venue('Κτήμα Κλειστό', 'kleisto@example.gr');
patch('venue:' + v7, o => { o.keyRotated = true; o.active = false; });                                          // archive: inactive
const v8 = await venue('Κτήμα Πεύκα', 'peuka@example.gr', { contact: '6930 555 777' });
patch('venue:' + v8, o => { o.keyRotated = true; o.used = 1; o.selfSignup = true; o.afm = '800000002';
  o.license = { ...o.license, seasonStart: day(-320), seasonEnd: day(45), autoRenew: false };
  o.trial = { startedAt: ago(320), endsAt: Date.now() + 45 * DAY, verifiedAt: ago(320), seasonEnd: day(45), signupId: null }; });   // ⚑ free year ends in 45 days
// a venue at work: two weddings and a baptism, one with a support request
const v9r = await call('POST', '/admin/venues', { name: 'Κτήμα Ροδακινιά', contact: 'Γραμματεία 2410 123 456', license: { type: 'per_wedding', quota: 20 } }, OWN);
const v9 = v9r.id, H9 = { 'X-Venue-Key': v9r.key };
const w1 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Α', date: day(6) }, H9);
const w2 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Β', date: day(25), kind: 'baptism' }, H9);
const w3 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Γ', date: day(70) }, H9);   // link not sent, event far off
const g1 = people(120, 'a'), ids1 = Object.keys(g1);
await call('PUT', '/plans/' + w1.planId, { plan: plan(g1, Array.from({ length: 5 }, (_, i) => table(i + 1, ids1.slice(i * 10, i * 10 + 10)))) }, { 'X-Edit-Key': w1.venueKey });   // 50 of 120 seated
const g2 = people(40, 'b'), ids2 = Object.keys(g2);
await call('PUT', '/plans/' + w2.planId, { plan: plan(g2, Array.from({ length: 4 }, (_, i) => table(i + 1, ids2.slice(i * 10, i * 10 + 10)))) }, { 'X-Edit-Key': w2.venueKey });   // all 40 seated
await call('POST', '/plans/' + w1.planId + '/support', { hours: 48, message: 'Δεν βρίσκω πώς μετακινώ τραπέζι' }, H9);   // ⚑ support

// ---- phase 3: the same venue's own sheet (venue.html), signed in with the key printed at the end ----
// an event at every stage, client cards, a step due today, a past client whose event is gone, and two cards sharing one phone
sPut.run('meta:clienttrack', JSON.stringify({ since: ago(30) }));                                              // links tracked from a month ago
const VK = v9 + '.dev-venue-key'; patch('venue:' + v9, o => { o.key = VK; o.keyRotated = true; }); H9['X-Venue-Key'] = VK;
const W = id => '/venues/' + v9 + '/weddings/' + id;
const inVenue = (id, fn) => patch('venue:' + v9, o => fn(o.weddings.find(x => x.planId === id)));
const client = (id, body) => call('PUT', W(id) + '/client', body, H9);
const opened = id => call('GET', '/plans/' + id, undefined, { 'X-Edit-Key': raw('plan:' + id).editKey });       // the client opens the link
await call('POST', W(w1.planId) + '/sent', {}, H9); await opened(w1.planId);
patch('plan:' + w1.planId, o => { o.clientSavedAt = ago(1); });                                                // Α: in 6 days, 50 of 120 seated
await client(w1.planId, { name: 'Αναστασία Παππά', phone: '6971 234 567', email: 'a.pappa@example.gr',
  notes: 'Μενού Β, 45 € το άτομο. Προκαταβολή 1.000 € δόθηκε.', next: { text: 'Να τους πάρω για τον τελικό αριθμό', due: day(0) } });   // ⚑ step due today
await call('POST', W(w2.planId) + '/sent', {}, H9); await opened(w2.planId);                                    // Β: everyone seated
await client(w2.planId, { name: 'Γιάννης Βλάχος', phone: '6982 223 344' });
const w4 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Γενέθλια Ελένης', date: day(40), kind: 'party' }, H9);
await call('POST', W(w4.planId) + '/sent', {}, H9); inVenue(w4.planId, w => { w.linkAt = ago(9); });            // ⚑ link copied 9 days ago, never opened
await client(w4.planId, { name: 'Ελένη Καρρά', phone: '6933 334 444' });
const w5 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Δ', date: day(120) }, H9);
inVenue(w5.planId, w => { w.createdAt = ago(10); });                                                           // ⚑ made 10 days ago, link never copied
const w6 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Ε', date: day(30) }, H9);
await call('POST', W(w6.planId) + '/sent', {}, H9); await opened(w6.planId);
await client(w6.planId, { name: 'Ελένη Καρρά', phone: '+30 693 333 4444', email: 'eleni.k@example.gr', notes: 'Πολύ ευχαριστημένοι, θα ξανάρθουν.' });
patch('plan:' + w6.planId, o => { o.weddingDate = day(-20); }); inVenue(w6.planId, w => { w.date = day(-20); });   // Ε: over; same phone as Γενέθλια Ελένης
const w7 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Ζ', date: day(150) }, H9);
inVenue(w7.planId, w => { w.createdAt = ago(40); });                                                           // made before tracking began
const w8 = await call('POST', '/venues/' + v9 + '/weddings', { label: 'Οικογένεια Η', date: day(50) }, H9);
await client(w8.planId, { name: 'Στέλιος Μαυρίδης', phone: '6944 556 677', notes: 'Ακύρωσαν — ίσως την άνοιξη.' });
await call('DELETE', W(w8.planId), undefined, H9); await call('DELETE', '/admin/venues/' + v9 + '/trash/' + w8.planId, undefined, OWN);   // a past client: only the card is left
// a signup nobody confirmed (its venue is its row), and one whose venue went missing
await call('POST', '/signup/venue', { name: 'Κτήμα Βελανιδιά', afm: '900000005', email: 'velanidia@example.gr', phone: '6981 234 567', terms: true, lang: 'el' }, { 'X-Real-IP': '203.0.113.9' });
const s1 = raw('afm:900000005');
patch('venue:' + s1.venueId, o => { o.createdAt = ago(4); }); patch('signup:' + s1.signupId, o => { o.createdAt = ago(4); });   // ⚑ link unopened
await call('POST', '/signup/venue', { name: 'Αίθουσα Ορφανή', afm: '700000059', email: 'orfani@example.gr', phone: '2105 556 677', terms: true, lang: 'el' }, { 'X-Real-IP': '203.0.113.10' });
const s2 = raw('afm:700000059');
sDel.run('venue:' + s2.venueId); patch('venues:index', o => { o.splice(o.indexOf(s2.venueId), 1); });

// ---- direct customers ----
const c1 = await couple({ name: 'Μαρία & Νίκος', email: 'maria.nikos@example.gr', contact: '6944 555 666 · τους σύστησε το Κτήμα Πλάτανος', weddingDate: day(9), startNow: true });
// the claim link went by mail: open it the way the couple would, from the token on the couple row
const t1 = raw('couple:' + c1).claimToken, k1 = await call('POST', '/claim', { token: t1, nonce: 'dev' });
const g3 = people(80, 'c'), ids3 = Object.keys(g3);
await call('PUT', '/plans/' + k1.id, { plan: plan(g3, Array.from({ length: 3 }, (_, i) => table(i + 1, ids3.slice(i * 10, i * 10 + 10)))) }, { 'X-Edit-Key': k1.editKey });   // 30 of 80 seated
await call('POST', '/plans/' + k1.id + '/support', { hours: 24, message: 'Βοήθεια με το Excel' }, { 'X-Edit-Key': k1.editKey });   // ⚑ support
const c2 = await couple({ name: 'Ελένη & Γιώργος', email: 'eleni.g@example.gr', contact: '6909 876 543', weddingDate: day(80) });
patch('couple:' + c2, o => { o.claimAt = ago(6); o.createdAt = ago(6); o.paidAt = ago(6); });                 // ⚑ claim link unused
await couple({ name: 'Βάπτιση Αλεξάνδρας', kind: 'baptism', email: 'alexandra.v@example.gr', contact: '6955 101 202', weddingDate: day(35) });
await couple({ name: '40ά γενέθλια Κώστα', kind: 'party', contact: '+44 7700 900456', weddingDate: day(12), startNow: true });
const c5 = await couple({ name: 'Σοφία & Άρης', email: 'sofia.aris@example.gr', weddingDate: day(10), startNow: true });
patch('plan:' + raw('couple:' + c5).planId, o => { o.weddingDate = day(-40); });                               // archive: wedding done

// ---- phase 2: his notes, next steps, timeline, and one customer already forgotten (what the books keep) ----
const C = k => '/admin/customers/' + encodeURIComponent(k);
await call('PUT', C('v:' + v3) + '/next', { text: 'Να τους πάρω για την πρώτη εκδήλωση', due: day(0) }, OWN);   // ⚑ next step due today
await call('POST', C('v:' + v3) + '/timeline', { kind: 'call', text: 'Δεν απάντησαν, ξανά την Πέμπτη' }, OWN);
await call('POST', C('v:' + v3) + '/timeline', { kind: 'offer', text: 'σεζόν 2027, όπως το περσινό' }, OWN);
await call('PUT', C('v:' + v4) + '/notes', { notes: 'Υπεύθυνη: κα Δήμητρα. Τιμολόγιο στην εταιρεία, όχι στο κτήμα.' }, OWN);
await call('PUT', C('c:' + c2) + '/next', { text: 'Να δω αν άνοιξαν τον σύνδεσμο', due: day(3) }, OWN);
await call('POST', C('c:' + c2) + '/timeline', { kind: 'viber', text: 'Τους έστειλα ξανά τον σύνδεσμο' }, OWN);
const c6 = await couple({ name: 'Δέσποινα & Μάριος', email: 'despoina.m@example.gr', weddingDate: day(60) });
await call('POST', C('c:' + c6) + '/forget', {}, OWN);                                                         // books: name and purchase date only

db.close();
console.log('dev-customers: seeded ' + DB);
console.log('dev-customers: venue console «Κτήμα Ροδακινιά» at http://localhost:8080/venue.html, key ' + VK);
process.env.KV_BACKEND = 'sqlite';
process.env.DB_PATH = DB;
await import('./dev.mjs');
