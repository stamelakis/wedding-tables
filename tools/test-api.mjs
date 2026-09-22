// API tests for roles & access: the real worker over an in-memory KV with the same atomic update + list the server offers.
//   node tools/test-api.mjs        → prints each check, exits 1 on the first failure
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = await import(pathToFileURL(path.join(root, 'wedding-sync-worker.js')).href);
const worker = mod.default, migrate = mod.migrate;

const m = new Map();
const PLANS = { get: async k => (m.has(k) ? m.get(k) : null), put: async (k, v) => { m.set(k, v); }, delete: async k => { m.delete(k); },
  update: async (k, fn) => { const out = fn(m.has(k) ? m.get(k) : null) || {}; if (out.del) m.delete(k); else if (out.value != null) m.set(k, out.value); return out.result; },
  list: async prefix => [...m.keys()].filter(k => k.startsWith(prefix)) };
const env = { OWNER_KEY: 'owner-test-key', PLANS };
const raw = k => JSON.parse(m.get(k));
const patchRaw = (k, fn) => { const o = raw(k); fn(o); m.set(k, JSON.stringify(o)); };
const NEW = { 'X-Client': '2' };

const athensDay = n => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(Date.now() + n * 86400000));
async function call(method, url, body, headers = {}) {
  // Phase shim for the sections written before phases existed: their plans are edited right away (a wedding 10 days
  // out, "start now"). New tests opt out by passing weddingDate / date / startNow explicitly (undefined = omit).
  if (method === 'POST' && url === '/admin/couples' && body) {
    if (!('weddingDate' in body)) body = { ...body, weddingDate: athensDay(10), startNow: true };
    else if (!('startNow' in body) && body.weddingDate >= athensDay(0) && body.weddingDate < athensDay(21)) body = { ...body, startNow: true };
  }
  if (method === 'POST' && /^\/venues\/[^/]+\/weddings$/.test(url) && body && !('date' in body)) body = { ...body, date: athensDay(10) };
  const r = await worker.fetch(new Request('http://t' + url, { method, headers: { 'Content-Type': 'application/json', ...NEW, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
  let d = null; try { d = await r.json(); } catch (e) {}
  return { status: r.status, d };
}
let n = 0;
function ok(cond, label, extra) { n++; if (!cond) { console.error('✗ ' + label, extra !== undefined ? JSON.stringify(extra).slice(0, 500) : ''); process.exit(1); } console.log('✓ ' + label); }
const OWN = { 'X-Owner-Key': 'owner-test-key' };
const layout = (over = {}) => ({ tables: [{ id: 1, shape: 'round', x: 100, y: 100, label: '1', capacity: 8, seats: Array(8).fill(null) },
  { id: 2, shape: 'round', x: 300, y: 100, label: '2', capacity: 8, seats: Array(8).fill(null) }],
  features: [{ id: 'f1', kind: 'zone', x: 500, y: 500, w: 200, h: 200, label: 'Πίστα' }], stage: { w: 2000, h: 1400 }, stageMaterial: 'grass',
  guests: {}, groups: [{ id: 'grp1', name: 'Νύφη', color: '#e26d8a' }], parties: [], layoutVersion: 5, _uid: 50, ...over });

// ---------- 0. legacy data + the boot migration ----------
m.set('venue:legacyV', JSON.stringify({ id: 'legacyV', name: 'Jockey', contact: '210 000', key: 'legacyV.secretsecretsecret', license: { type: 'seasonal' }, used: 1, active: true,
  weddings: [{ planId: 'legacyPlan000000000000', label: 'Andreas & Lina', createdAt: 1, editKey: 'legacyEditKey' }] }));
m.set('venues:index', JSON.stringify(['legacyV']));
m.set('plan:legacyPlan000000000000', JSON.stringify({ name: 'Andreas & Lina', plan: layout({ guests: { a: { name: 'x' }, b: { name: 'y' } } }), editKey: 'legacyEditKey', updated: 5, venueId: 'legacyV' }));
m.set('plan:orphanPlan0000000000', JSON.stringify({ name: 'Orphan', plan: layout(), editKey: 'orphanKey', updated: 3, venueId: 'goneVenue' }));
m.set('code:legacycodelegacy', JSON.stringify({ plans: [{ id: 'legacyPlan000000000000', name: 'A&L', updated: 5 }] }));
let r0 = await migrate(env);
ok(r0.plans === 2 && r0.venues === 1 && r0.codes === 1, 'boot migration touches every plan, venue and code', r0);
ok((await migrate(env)).skipped === 'done', 'the migration runs once');
const L = raw('plan:legacyPlan000000000000');
ok(L.owner.type === 'venue' && L.venueKey && L.readKey && Object.values(L.perms).filter(x => typeof x === 'boolean').every(Boolean) && L.layoutAt === 5 && L.updated === 5, 'legacy wedding: venue-owned, keys minted, all open, version untouched', L);
ok(raw('plan:orphanPlan0000000000').owner.type === 'couple', 'a plan whose venue is gone belongs to its couple');
ok(raw('code:legacycodelegacy').plans[0].role === 'couple' && raw('code:legacycodelegacy').plans[0].gen === 0, 'legacy device links become couple links of generation 0');
ok(raw('venue:legacyV').weddings[0].venueKey === L.venueKey, 'the venue record mirrors the per-wedding venue key');
let r = await call('GET', '/plans/legacyPlan000000000000');
ok(r.status === 200 && r.d.role === 'viewer' && r.d.legacy && !r.d.readKey, 'grace: an old tab / view link still reads a legacy plan (as viewer, no keys)', r.d);
ok((await call('PUT', '/plans/legacyPlan000000000000', { plan: layout() })).status === 401, 'grace never allows writing without a key');
r = await call('GET', '/plans/legacyPlan000000000000', undefined, { 'X-Edit-Key': 'legacyEditKey' });
ok(r.d.role === 'couple' && r.d.readKey === L.readKey && r.d.legacyOpenUntil > Date.now() && r.d.owner.venueName === 'Jockey' && r.d.owner.venueContact === '210 000' && !('venueId' in r.d.owner), 'legacy couple link: couple, view key, grace date, venue name + contact (never the venue id)', r.d);
ok((await call('GET', '/plans/legacyPlan000000000000', undefined, { 'X-Sync-Code': 'legacycodelegacy' })).d.role === 'couple', 'legacy sync-code devices still read');
ok((await call('GET', '/plans/legacyPlan000000000000', undefined, { 'X-Venue-Key': 'legacyV.secretsecretsecret' })).d.role === 'venue', 'the owning venue key reads it as venue (Hermes path)');
r = await call('PUT', '/plans/legacyPlan000000000000', { plan: layout({ guests: { a: { name: 'x' }, b: { name: 'y' }, c: { name: 'z' } } }), baseUpdated: 5 }, { 'X-Edit-Key': 'legacyEditKey' });
ok(r.status === 200 && !r.d.enforced, 'legacy couple saves as before');
ok((await call('PUT', '/plans/legacyPlan000000000000', { plan: layout(), baseUpdated: 5 }, { 'X-Edit-Key': 'legacyEditKey' })).status === 409, 'optimistic concurrency still refuses a stale save');
ok((await call('POST', '/plans/legacyPlan000000000000/legacy-off', {}, { 'X-Edit-Key': 'legacyEditKey' })).status === 200 && (await call('GET', '/plans/legacyPlan000000000000')).status === 401, 'the owner can end the grace early');
ok((await call('GET', '/health')).d.ok === true, 'keyless health check');

// ---------- 1. new plans need a purchase ----------
ok((await call('POST', '/plans', { name: 'free', plan: layout() })).status === 403, 'nobody gets a free plan without a credential');
let rr = await call('POST', '/plans', { name: 'Μαρία & Νίκος', plan: layout() }, OWN);
ok(rr.status === 200 && rr.d.editKey && rr.d.readKey, 'the admin can create a couple plan directly');
const C = rr.d;
ok((await call('GET', '/plans/' + C.id)).status === 401, 'a new plan: the id alone reads nothing (401)');
ok((await call('GET', '/plans/' + C.id, undefined, { 'X-Edit-Key': 'wrong' })).status === 403, 'a wrong key is refused (403)');
ok((await call('GET', '/plans/' + C.id, undefined, { 'X-View-Key': '' })).status === 401, 'an empty key header is not a credential');
r = await call('GET', '/plans/' + C.id, undefined, { 'X-Edit-Key': C.editKey });
ok(r.d.role === 'couple' && r.d.owner.type === 'couple' && r.d.perms.layout && r.d.readKey === C.readKey, 'couple: full rights, own view key', r.d);
r = await call('GET', '/plans/' + C.id, undefined, { 'X-View-Key': C.readKey });
ok(r.d.role === 'viewer' && !r.d.readKey && r.d.support === undefined && r.d.audit === undefined, 'viewer: no keys, no support info, no log', r.d);
ok((await call('PUT', '/plans/' + C.id, { plan: layout() }, { 'X-View-Key': C.readKey })).status === 403, 'viewer cannot write');
ok((await call('POST', '/plans', { name: 'second', plan: layout(), parentId: C.id }, { 'X-Edit-Key': C.editKey })).status === 200, 'a couple who owns a plan may put another one online');
ok((await call('PUT', '/plans/' + C.id, { plan: { tables: 'x' } }, { 'X-Edit-Key': C.editKey })).status === 422, 'a malformed plan is refused');
r = await call('PUT', '/plans/' + C.id, { plan: layout({ layoutVersion: 1, _uid: 3 }) }, { 'X-Edit-Key': C.editKey });
const cp = raw('plan:' + C.id).plan;
ok(cp.layoutVersion === 5 && cp._uid === 50, 'nobody can turn the layout version or the id counter back');

// ---------- 2. admin sells a plan to a couple — and cannot open it ----------
r = await call('POST', '/admin/couples', { name: 'Ελένη & Γιώργος', contact: 'eg@example.com' }, OWN);
ok(r.status === 200 && r.d.claimToken && !JSON.stringify(r.d.couple).includes('planId'), 'admin creates a couple licence: claim token, no plan id', r.d);
const token = r.d.claimToken, cid = r.d.couple.id;
r = await call('GET', '/admin/couples', undefined, OWN);
const cplan = raw('couple:' + cid).planId, cplanRec = raw('plan:' + cplan);
ok(!JSON.stringify(r.d).includes(cplan) && !JSON.stringify(r.d).includes(cplanRec.editKey) && !JSON.stringify(r.d).includes(cplanRec.readKey), 'admin couple list: no plan id, no key');
ok(r.d.couples[0].pendingClaim && r.d.couples[0].claimToken === token, 'an unused claim link can be copied again');
ok((await call('GET', '/admin/couples', undefined, { 'X-Owner-Key': 'nope' })).status === 403, 'admin routes need the owner key');
ok((await call('POST', '/claim', { token: 'short' })).status === 404, 'a bogus claim token is refused');
r = await call('POST', '/claim', { token, nonce: 'phone-1' }, { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)' });
ok(r.status === 200 && r.d.id === cplan && r.d.editKey && r.d.readKey, 'couple claims: gets id + keys');
const CP = r.d;
r = await call('POST', '/claim', { token, nonce: 'phone-1' });
ok(r.status === 200 && r.d.editKey === CP.editKey, 'the same device can retry within 15 minutes (lost response)');
r = await call('POST', '/claim', { token, nonce: 'other' });
ok(r.status === 410 && r.d.error === 'claim_used' && r.d.at, 'a second device is told when the link was used', r.d);
patchRaw('claim:' + token, o => { o.usedAt -= 20 * 60000; });
ok((await call('POST', '/claim', { token, nonce: 'phone-1' })).status === 410, 'after 15 minutes even the same device cannot reuse it');
r = await call('GET', '/admin/couples', undefined, OWN);
ok(r.d.couples[0].claimedAt && !r.d.couples[0].claimToken, 'admin sees it was claimed, the token is gone');
ok((await call('GET', '/plans/' + cplan, undefined, OWN)).status === 401, 'the owner key does not open a couple plan');
ok((await call('PUT', '/plans/' + CP.id, { plan: layout({ guests: { g1: { name: 'Α' } } }) }, { 'X-Edit-Key': CP.editKey })).status === 200, 'couple saves');
r = await call('GET', '/plans/' + CP.id, undefined, { 'X-Edit-Key': CP.editKey });
ok(r.d.audit.some(e => e.what === 'claim' && e.d === 'iPhone'), 'the log shows the first opening and the device type');
// expired claim links
r = await call('POST', '/admin/couples', { name: 'Late' }, OWN);
patchRaw('claim:' + r.d.claimToken, o => { o.createdAt -= 31 * 86400000; });
ok((await call('POST', '/claim', { token: r.d.claimToken, nonce: 'x' })).d.error === 'claim_expired', 'claim links expire after 30 days');

// ---------- 3. the support invitation ----------
ok((await call('GET', '/admin/support', undefined, OWN)).d.requests.length === 0, 'no invitation → the admin support list is empty');
r = await call('POST', '/plans/' + CP.id + '/support', { hours: 24, message: 'Χάθηκαν ονόματα <b>' }, { 'X-Edit-Key': CP.editKey });
ok(r.status === 200 && r.d.expires > Date.now(), 'couple invites support for 24 h');
r = await call('GET', '/admin/support', undefined, OWN);
ok(r.d.requests.length === 1 && r.d.requests[0].message === 'Χάθηκαν ονόματα <b>' && r.d.requests[0].key && r.d.requests[0].kind === 'couple', 'admin sees the invitation with its key (text is escaped by the console)', r.d);
const SK = r.d.requests[0].key;
r = await call('GET', '/plans/' + CP.id, undefined, { 'X-Support-Key': SK });
ok(r.d.role === 'support' && !r.d.readKey && r.d.supportExpires, 'support opens it (no view key handed out)', r.d);
ok((await call('PUT', '/plans/' + CP.id, { plan: layout({ guests: { g1: { name: 'Α' }, g2: { name: 'Β' } } }), name: '🛟 renamed' }, { 'X-Support-Key': SK })).status === 200, 'support can fix the plan');
ok(raw('plan:' + CP.id).name === 'Ελένη & Γιώργος', 'support never renames the plan');
ok((await call('DELETE', '/plans/' + CP.id, undefined, { 'X-Support-Key': SK })).status === 403, 'support cannot delete it');
ok((await call('POST', '/plans/' + CP.id + '/support', { hours: 168 }, { 'X-Support-Key': SK })).status === 403, 'support cannot extend its own access');
ok((await call('POST', '/plans/' + CP.id + '/rotate', {}, { 'X-Support-Key': SK })).status === 403, 'support cannot take the couple\'s keys');
ok((await call('POST', '/codes/abcdefghijklmnop', { id: CP.id }, { 'X-Edit-Key': SK })).status === 403, 'support cannot keep access through a sync code');
r = await call('GET', '/plans/' + CP.id, undefined, { 'X-Edit-Key': CP.editKey });
ok(r.d.support && r.d.audit.some(a => a.who === 'support' && a.what === 'open') && r.d.audit.some(a => a.who === 'support' && a.what === 'save') && r.d.audit.some(a => a.what === 'invite' && a.h === 24), 'couple sees the open access and what support did', r.d.audit);
ok((await call('DELETE', '/plans/' + CP.id + '/support', undefined, { 'X-Edit-Key': CP.editKey })).status === 200, 'couple ends the access');
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-Support-Key': SK })).status === 403, 'the support key is dead at once');
ok((await call('GET', '/admin/support', undefined, OWN)).d.requests.length === 0, 'and the invitation left the admin list');
await call('POST', '/plans/' + CP.id + '/support', { hours: 1 }, { 'X-Edit-Key': CP.editKey });
const SK2 = raw('plan:' + CP.id).support.key;
ok(SK2 !== SK, 'every invitation gets a new key');
patchRaw('plan:' + CP.id, o => { o.support.expires = Date.now() - 1000; });
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-Support-Key': SK2 })).status === 403, 'an expired invitation stops working by itself');
ok((await call('GET', '/admin/support', undefined, OWN)).d.requests.length === 0, 'expired invitations are not listed');

// ---------- 4. device links retire with every key change ----------
ok((await call('POST', '/codes/couplesphone1234', { id: CP.id }, { 'X-Edit-Key': CP.editKey })).status === 200, 'the couple links a second device with a sync code');
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-Sync-Code': 'couplesphone1234' })).d.role === 'couple', 'that device reads as couple');
r = await call('POST', '/plans/' + CP.id + '/rotate', {}, { 'X-Edit-Key': CP.editKey });
ok(r.status === 200 && r.d.editKey !== CP.editKey && r.d.readKey !== CP.readKey, 'the couple can issue new links themselves');
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-Sync-Code': 'couplesphone1234' })).status === 403, 'older device links stop working with the new links');
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-View-Key': CP.readKey })).status === 403, 'and the old view link too');
const CP2 = { id: CP.id, editKey: r.d.editKey, readKey: r.d.readKey };
await call('POST', '/codes/couplesphone1234', { id: CP.id }, { 'X-Edit-Key': CP2.editKey });
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-Sync-Code': 'couplesphone1234' })).d.role === 'couple', 'relinking with the new key works');
// admin reset (lost link)
r = await call('POST', '/admin/couples/' + cid + '/reset', {}, OWN);
ok(r.status === 200 && r.d.claimToken, 'admin can issue a new claim link for a lost link');
const resetTok = r.d.claimToken;
r = await call('PUT', '/plans/' + CP.id, { plan: layout() }, { 'X-Edit-Key': CP2.editKey });
ok(r.status === 403 && r.d.error === 'key_reset' && r.d.at, 'old devices are told TakeaSeat reset the access', r.d);
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-Sync-Code': 'couplesphone1234' })).status === 403, 'a reset also retires sync-code devices');
ok((await call('GET', '/plans/' + CP.id, undefined, { 'X-View-Key': CP2.readKey })).status === 403, 'and the view link');
r = await call('POST', '/claim', { token: resetTok, nonce: 'n2' });
r = await call('GET', '/plans/' + CP.id, undefined, { 'X-Edit-Key': r.d.editKey });
ok(r.d.audit.some(a => a.who === 'admin' && a.what === 'reset') && r.d.resetAt, 'the reset is in the log the couple sees');

// ---------- 5. a venue: template, locks, weddings ----------
r = await call('POST', '/admin/venues', { name: 'Κτήμα Test', contact: '6900000000', license: { type: 'per_wedding', quota: 10 } }, OWN);
const V = r.d; const VH = { 'X-Venue-Key': V.key };
r = await call('GET', '/admin/venues/' + V.id, undefined, OWN);
ok(r.d.key === V.key && !r.d.keyRotated, 'admin can read a key the venue has not changed yet');
r = await call('POST', '/venues/' + V.id + '/weddings', { label: 'Χωρίς πρότυπο' }, VH);
const W0 = r.d;
ok(!r.d.fromTemplate, 'a wedding before any template starts empty');
r = await call('GET', '/plans/' + W0.planId, undefined, { 'X-Edit-Key': W0.editKey });
ok(r.d.role === 'couple' && Object.values(r.d.perms).filter(x => typeof x === 'boolean').every(Boolean), 'no venue layout yet → the couple may change everything', r.d.perms);
await call('PUT', '/plans/' + W0.planId, { plan: layout() }, { 'X-Edit-Key': W0.editKey });
r = await call('PUT', '/plans/' + W0.planId, { plan: layout({ tables: [{ id: 1, shape: 'round', x: 700, y: 700, label: '1', capacity: 8, seats: Array(8).fill(null) }] }) }, { 'X-Edit-Key': W0.editKey });
ok(r.status === 200 && !r.d.enforced, 'the couple\'s own layout is not "locked" against them');
r = await call('GET', '/plans/' + W0.planId, undefined, { 'X-Edit-Key': W0.venueKey });
ok(r.d.role === 'venue' && r.d.layoutSet === false && r.d.couplePerms.layout === false, 'venue sees the locks it chose, and that they are not active yet', r.d);
await call('PUT', '/plans/' + W0.planId, { plan: r.d.plan }, { 'X-Edit-Key': W0.venueKey });
r = await call('GET', '/plans/' + W0.planId, undefined, { 'X-Edit-Key': W0.editKey });
ok(r.d.perms.layout === false, 'once the venue saves the layout, its locks apply');
ok((await call('GET', '/venues/' + V.id, undefined, VH)).d.weddings.find(w => w.planId === W0.planId).layoutSet === true, 'the console knows the layout is set');
// template
r = await call('POST', '/venues/' + V.id + '/template', { fromPlanId: W0.planId }, VH);
const T = r.d;
ok(r.status === 200 && T.venueKey, 'venue creates its template from one of its weddings');
const tplan = raw('plan:' + T.planId).plan;
ok(tplan.tables.length === 1 && tplan.tables[0].x === 700 && Object.keys(tplan.guests).length === 0 && tplan.features.every(f => f.by === 'venue'), 'the template takes the space and tables, no people; decor marked as the venue\'s');
ok((await call('GET', '/venues/' + V.id, undefined, VH)).d.venue.weddingCount === 1 && raw('venue:' + V.id).used === 1, 'the template is not a wedding and costs no licence credit');
r = await call('PUT', '/plans/' + T.planId, { plan: layout({ guests: { x: { name: 'should not copy' } } }) }, { 'X-Edit-Key': T.venueKey });
ok(r.status === 200, 'venue edits the template in the planner');
r = await call('GET', '/plans/' + T.planId, undefined, { 'X-Edit-Key': T.venueKey });
ok(r.d.role === 'venue' && r.d.template === true && r.d.couplePerms === undefined, 'template opens as venue, marked as template');
ok((await call('POST', '/venues/' + V.id + '/template', { fromPlanId: C.id }, VH)).d.planId === T.planId, 'a second template request returns the existing one (never copies someone else\'s plan)');
r = await call('PUT', '/venues/' + V.id + '/defaults', { perms: { floor: false, decor: false, layout: false, tables: false, seats: true, labels: false, maxSeats: 10 } }, VH);
ok(r.status === 200 && r.d.defaultPerms.labels === false && r.d.defaultPerms.maxSeats === 10, 'venue sets what couples may change, with a seat maximum');
r = await call('POST', '/venues/' + V.id + '/weddings', { label: 'Άννα & Πέτρος' }, VH);
ok(r.status === 200 && r.d.fromTemplate && r.d.editKey && r.d.venueKey, 'a new wedding is created from the template');
const W = r.d;
const wplan = raw('plan:' + W.planId).plan;
ok(wplan.tables.length === 2 && Object.keys(wplan.guests).length === 0 && wplan.tables.every(t => t.seats.every(s => s === null)) && wplan._uid === 50, 'the copy has the space, the tables and the id counter — no people');
r = await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.editKey });
ok(r.d.role === 'couple' && r.d.perms.layout === false && r.d.perms.seats === true && r.d.perms.labels === false && r.d.perms.maxSeats === 10, 'couple link: the venue\'s locks', r.d.perms);
ok(!JSON.stringify(r.d).includes(W.venueKey) && !JSON.stringify(r.d).includes(V.id), 'the couple never receives the venue key or the venue id');
const base = r.d.plan, upd0 = r.d.updated;
const tampered = JSON.parse(JSON.stringify(base));
tampered.tables[0].x = 999; tampered.tables[0].rot = 45; tampered.tables[0].label = 'ΑΛΛΑΓΗ'; tampered.tables[0].capacity = 14; tampered.tables[0].seats = Array(14).fill(null);
tampered.tables[0].seats[0] = 'g1'; tampered.tables[0].seats[12] = 'g2'; tampered.guests = { g1: { name: 'Κώστας' }, g2: { name: 'Ελένη' } };
tampered.tables.splice(1, 1); tampered.tables.push({ id: 99, shape: 'round', x: 1, y: 1, label: 'new', capacity: 8, seats: Array(8).fill(null) });
tampered.features[0].x = 1; tampered.features.push({ id: 'fc', kind: 'prop', x: 10, y: 10, w: 40, h: 40, label: 'Photo booth', by: 'venue' });
tampered.stage = { w: 100, h: 100 }; tampered.stageMaterial = 'sand'; tampered.layoutVersion = 1;
r = await call('PUT', '/plans/' + W.planId, { plan: tampered, baseUpdated: upd0, name: 'hijack' }, { 'X-Edit-Key': W.editKey });
ok(r.status === 200 && r.d.enforced === true && r.d.plan, 'a locked change is enforced by the server and the fixed plan comes back', r.d);
const after = raw('plan:' + W.planId);
const t1 = after.plan.tables.find(t => t.id === 1);
ok(t1.x === 100 && t1.rot === undefined && t1.label === '1', 'position, rotation and name stay the venue\'s', t1);
ok(t1.capacity === 10 && t1.seats.length === 10 && t1.seats[0] === 'g1' && !t1.seats.includes('g2'), 'seats may grow only up to the venue maximum (the 13th chair was cut)', t1);
ok(after.plan.tables.length === 2 && after.plan.tables.some(t => t.id === 2) && !after.plan.tables.some(t => t.id === 99), 'the deleted table came back, the added one was dropped');
const fv = after.plan.features.find(f => f.id === 'f1'), fc = after.plan.features.find(f => f.id === 'fc');
ok(fv && fv.x === 500 && fc && fc.by === 'couple', 'the venue\'s dance floor stays put; the couple\'s own photo booth is theirs (cannot claim to be the venue\'s)', after.plan.features);
ok(after.plan.stage.w === 2000 && after.plan.stageMaterial === 'grass' && after.plan.layoutVersion === 5, 'floor untouched, layout version pinned');
ok(after.name === 'Άννα & Πέτρος' && Object.keys(after.plan.guests).length === 2, 'the couple cannot rename the wedding; the guests are theirs');
const moved = JSON.parse(JSON.stringify(after.plan)); moved.features.find(f => f.id === 'fc').x = 77;
r = await call('PUT', '/plans/' + W.planId, { plan: moved, baseUpdated: after.updated }, { 'X-Edit-Key': W.editKey });
ok(!r.d.enforced && raw('plan:' + W.planId).plan.features.find(f => f.id === 'fc').x === 77, 'the couple moves its own decor freely');
const cur2 = raw('plan:' + W.planId);
const t2 = JSON.parse(JSON.stringify(cur2.plan)); t2.tables[0].x = 5;
r = await call('PUT', '/plans/' + W.planId, { plan: t2, baseUpdated: cur2.updated }, { 'X-Edit-Key': W.editKey, 'X-Client': '1' });
ok(r.status === 409 && r.d.plan && r.d.plan.tables[0].x === 100, 'an old planner gets a 409 carrying the enforced plan, so it adopts it');
ok((await call('PUT', '/plans/' + W.planId, { plan: null, allowWipe: true }, { 'X-Edit-Key': W.editKey })).status === 422, 'nobody can replace a plan with nothing');
ok((await call('DELETE', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.editKey })).status === 403, 'the couple cannot delete a venue wedding');
ok((await call('POST', '/plans/' + W.planId + '/support', { hours: 24 }, { 'X-Edit-Key': W.editKey })).status === 403, 'the couple of a venue wedding cannot invite support (the venue decides)');
ok((await call('POST', '/plans/' + W.planId + '/rotate', {}, { 'X-Edit-Key': W.editKey })).status === 403, 'the couple cannot rotate a venue wedding\'s keys');
// restore cannot undo locks
r = await call('PUT', '/plans/' + W.planId, { plan: layout() }, { 'X-Edit-Key': W.venueKey });
ok(r.status === 200 && !r.d.enforced, 'the venue changes anything');
const cur3 = raw('plan:' + W.planId); patchRaw('plan:' + W.planId, o => { o.plan.tables[0].x = 555; });
const hist = raw('hist:' + W.planId); const oldV = hist[0];
r = await call('POST', '/plans/' + W.planId + '/restore', { updated: oldV.updated }, { 'X-Edit-Key': W.editKey });
ok(r.status === 200 && r.d.plan && raw('plan:' + W.planId).plan.tables.find(t => t.id === 1).x === 555, 'a restore by the couple keeps the venue\'s current layout', r.d);
// per-wedding permissions, applying defaults to all
r = await call('PATCH', '/venues/' + V.id + '/weddings/' + W.planId, { perms: { layout: true } }, VH);
ok(r.status === 200 && r.d.perms.layout === true && r.d.perms.labels === false, 'venue opens one permission for one wedding');
ok((await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.editKey })).d.perms.layout === true, 'the couple gets it at once');
r = await call('PUT', '/venues/' + V.id + '/defaults', { perms: { layout: false }, applyToAll: true }, VH);
ok(r.d.applied === 2 && (await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.editKey })).d.perms.layout === false, 'the default can be applied to every existing wedding');
// venue support + key rotation
r = await call('POST', '/plans/' + W.planId + '/support', { hours: 24, message: 'Βοήθεια' }, VH);
ok(r.status === 200, 'the venue can invite support for one of its weddings');
r = await call('GET', '/venues/' + V.id, undefined, VH);
ok(r.d.weddings.find(w => w.planId === W.planId).supportExpires > Date.now() && r.d.template && r.d.template.planId === T.planId, 'the console shows the open access and the template');
ok((await call('GET', '/admin/support', undefined, OWN)).d.requests.some(q => q.kind === 'venue' && q.venueName === 'Κτήμα Test'), 'admin sees the venue invitation');
r = await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.editKey });
ok(r.d.support && r.d.support.by === 'venue', 'the couple sees that support was let in by the venue');
ok((await call('POST', '/codes/venuedevice12345', { id: W.planId }, { 'X-Edit-Key': W.venueKey })).status === 200 && raw('code:venuedevice12345').plans[0].role === 'venue', 'a venue device links as venue');
r = await call('POST', '/venues/' + V.id + '/rotate', {}, VH);
const VK2 = r.d.key;
ok((await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.venueKey })).status === 403, 'rotating the console key renews every per-wedding venue link');
ok((await call('GET', '/plans/' + W.planId, undefined, { 'X-Sync-Code': 'venuedevice12345' })).status === 403, 'and retires venue device links');
ok((await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W.editKey })).d.role === 'couple', 'couple links keep working');
r = await call('GET', '/venues/' + V.id, undefined, { 'X-Venue-Key': VK2 });
const W2vk = r.d.weddings.find(w => w.planId === W.planId).venueKey;
ok(W2vk !== W.venueKey && (await call('GET', '/plans/' + W.planId, undefined, { 'X-Edit-Key': W2vk })).d.role === 'venue', 'the console hands out the new venue links');
r = await call('GET', '/admin/venues/' + V.id, undefined, OWN);
ok(r.d.key === null && r.d.keyRotated === true, 'after the venue sets its own key, the admin cannot read it');
ok(!JSON.stringify((await call('GET', '/admin/venues', undefined, OWN)).d).includes(W.planId), 'the admin venue list shows no wedding ids');
r = await call('POST', '/admin/venues/' + V.id + '/reset-key', {}, OWN);
ok(r.status === 200 && (await call('GET', '/venues/' + V.id, undefined, { 'X-Venue-Key': VK2 })).status === 403, 'an admin reset gives a new key and the venue notices (its key dies)');
// isolation between tenants
r = await call('POST', '/admin/venues', { name: 'Άλλο κτήμα' }, OWN);
const V2 = r.d;
ok((await call('GET', '/plans/' + W.planId, undefined, { 'X-Venue-Key': V2.key })).status === 403, 'another venue cannot read it');
await call('DELETE', '/venues/' + V2.id + '/weddings/' + W.planId, undefined, { 'X-Venue-Key': V2.key });
ok(m.has('plan:' + W.planId), 'another venue cannot delete it by id');
ok((await call('PATCH', '/venues/' + V2.id + '/weddings/' + W.planId, { perms: { layout: true } }, { 'X-Venue-Key': V2.key })).status === 404, 'another venue cannot change its permissions');
ok((await call('POST', '/venues/' + V2.id + '/template', { fromPlanId: W.planId }, { 'X-Venue-Key': V2.key })).status === 404, 'another venue cannot copy its layout');
ok((await call('GET', '/plans/' + C.id, undefined, { 'X-Venue-Key': V2.key })).status === 403, 'a venue key never opens a couple-owned plan');

// ---------- 6. sync-code roles ----------
r = await call('POST', '/codes/couplecodecouple', { id: W.planId }, { 'X-Edit-Key': W.editKey });
ok(raw('code:couplecodecouple').plans[0].role === 'couple', 'a couple device links as couple');
await call('POST', '/codes/couplecodecouple', { id: W.planId, name: 'x' });
ok(raw('code:couplecodecouple').plans[0].role === 'couple', 'a keyless refresh never upgrades the role');
r = await call('GET', '/plans/' + W.planId, undefined, { 'X-Sync-Code': 'couplecodecouple' });
ok(r.d.role === 'couple' && r.d.perms.labels === false, 'code auth keeps the couple restricted');

// ---------- 6b. review fixes ----------
{ // a used claim link's retry never outlives a reset
  const c2 = (await call('POST', '/admin/couples', { name: 'Retry' }, OWN)).d;
  const k1 = (await call('POST', '/claim', { token: c2.claimToken, nonce: 'devX' })).d;
  await call('POST', '/admin/couples/' + c2.couple.id + '/reset', {}, OWN);
  ok((await call('POST', '/claim', { token: c2.claimToken, nonce: 'devX' })).status === 410, 'after a reset, the old link\'s retry gives nothing');
  const cid2 = c2.couple.id; const tok2 = raw('couple:' + cid2).claimToken;
  const k2 = (await call('POST', '/claim', { token: tok2, nonce: 'real' })).d;
  const lg = (await call('GET', '/plans/' + k2.id, undefined, { 'X-Edit-Key': k2.editKey })).d.audit;
  ok(lg.some(e => e.what === 'claim_reset'), 'opening a reset link is labelled as such in the couple\'s log');
  // extra plans are erased with the licence and refused after it
  const child = (await call('POST', '/plans', { name: 'child', plan: layout({ guests: { g: { name: 'Γιαγιά' } } }), parentId: k2.id }, { 'X-Edit-Key': k2.editKey })).d;
  ok(child.id && raw('couple:' + cid2).plans.includes(child.id), 'an extra plan is recorded on the couple\'s licence');
  await call('DELETE', '/admin/couples/' + cid2, undefined, OWN);
  ok(!m.has('plan:' + child.id) && !m.has('plan:' + k2.id), 'erasure removes the extra plans too');
}
{ // a room grown to the LEFT/UP moves every item: when part of that is refused, all of it is (never a half-shifted plan)
  const V5 = (await call('POST', '/admin/venues', { name: 'V5' }, OWN)).d, H5 = { 'X-Venue-Key': V5.key };
  const W5 = (await call('POST', '/venues/' + V5.id + '/weddings', { label: 'W5' }, H5)).d;
  const room = () => ({ ...layout(), tables: [1, 2, 3].map(i => ({ id: i, shape: 'round', x: 100.25 * i + 0.13, y: 300.7, label: String(i), capacity: 8, seats: Array(8).fill(null) })),
    features: [{ id: 'fa', kind: 'zone', x: 378.18, y: 1554, w: 2167, h: 296, label: 'Wood' }, { id: 'fb', kind: 'prop', x: 41, y: 1554, w: 100, h: 60, label: 'WC' }] });
  const setRoom = async perms => { await call('PUT', '/plans/' + W5.planId, { plan: room() }, { 'X-Edit-Key': W5.venueKey });
    await call('PATCH', '/venues/' + V5.id + '/weddings/' + W5.planId, { perms }, H5);
    return (await call('GET', '/plans/' + W5.planId, undefined, { 'X-Edit-Key': W5.editKey })).d; };
  const shifted = (p, dx, dy, dw, dh) => { const q = JSON.parse(JSON.stringify(p)); q.tables.forEach(t => { t.x += dx; t.y += dy; }); q.features.forEach(f => { f.x += dx; f.y += dy; }); q.stage = { ...q.stage, w: q.stage.w + dw, h: q.stage.h + dh }; return q; };
  const same = (s, p) => s.stage.w === p.stage.w && s.stage.h === p.stage.h && s.tables.every((t, i) => t.x === p.tables[i].x && t.y === p.tables[i].y) && s.features.every((f, i) => f.x === p.features[i].x && f.y === p.features[i].y);
  const pos = s => [s.stage, s.tables.map(t => [t.x, t.y]), s.features.map(f => [f.x, f.y])];
  let g = await setRoom({ floor: true, decor: true, layout: false, tables: true, seats: true, labels: true });
  let pr = await call('PUT', '/plans/' + W5.planId, { plan: shifted(g.plan, 140, 0, 140, 0), baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  let st = raw('plan:' + W5.planId).plan;
  ok(pr.d.enforced && same(st, room()), 'room grown left while tables are locked: refused as a whole — the room, every table and the decor exactly as they were', pos(st));
  g = await setRoom({ floor: true, decor: false, layout: true, tables: true, seats: true, labels: true });
  pr = await call('PUT', '/plans/' + W5.planId, { plan: shifted(g.plan, 0, 90, 0, 90), baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  st = raw('plan:' + W5.planId).plan;
  ok(pr.d.enforced && same(st, room()), 'room grown up while the venue\'s decor is locked: tables back too, the room as it was', pos(st));
  g = await setRoom({ floor: true, decor: true, layout: false, tables: true, seats: true, labels: true });
  pr = await call('PUT', '/plans/' + W5.planId, { plan: shifted(g.plan, 140, 0, 200, 0), baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  st = raw('plan:' + W5.planId).plan;
  ok(st.stage.w === 2060 && same({ ...st, stage: room().stage }, room()), 'grown left 140 and right 60 in one save, tables locked: the right side stays (the floor is open), the left shift goes', pos(st));
  g = await setRoom({ floor: false, decor: true, layout: true, tables: true, seats: true, labels: true });
  pr = await call('PUT', '/plans/' + W5.planId, { plan: shifted(g.plan, 140, 60, 140, 60), baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  st = raw('plan:' + W5.planId).plan;
  ok(pr.d.enforced && same(st, room()), 'floor locked, everything else open: the room stays and so do the items (not shifted against it)', pos(st));
  g = await setRoom({ floor: true, decor: true, layout: true, tables: true, seats: true, labels: true });
  pr = await call('PUT', '/plans/' + W5.planId, { plan: shifted(g.plan, 140, 60, 140, 60), baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  st = raw('plan:' + W5.planId).plan;
  ok(!pr.d.enforced && st.stage.w === 2140 && st.tables[0].x === 100.25 + 0.13 + 140 && st.features[0].x === 378.18 + 140, 'with every right the growth to the left/up is kept as sent', pos(st));
  g = await setRoom({ floor: true, decor: true, layout: false, tables: true, seats: true, labels: true });
  const one = JSON.parse(JSON.stringify(g.plan)); one.tables[1].x += 50; one.features[1].x += 30; one.stage = { ...one.stage, w: one.stage.w + 300 };
  pr = await call('PUT', '/plans/' + W5.planId, { plan: one, baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  st = raw('plan:' + W5.planId).plan;
  ok(st.stage.w === 2300 && st.tables[1].x === room().tables[1].x && st.features[1].x === 41 + 30 && st.features[0].x === 378.18, 'no shift: a table move is refused alone, the decor move and the room grown right are kept', pos(st));
  const add = shifted(g.plan, 0, 75, 0, 75); add.tables.push({ id: 9, shape: 'round', x: 500, y: 40, label: '9', capacity: 8, seats: Array(8).fill(null) }); add.tables[0].seats[0] = 'gz'; add.guests = { gz: { name: 'Ζωή' } };
  g = await setRoom({ floor: true, decor: true, layout: false, tables: true, seats: true, labels: true });
  pr = await call('PUT', '/plans/' + W5.planId, { plan: add, baseUpdated: g.updated }, { 'X-Edit-Key': W5.editKey });
  st = raw('plan:' + W5.planId).plan;
  ok(same({ ...st, tables: st.tables.slice(0, 3) }, room()) && st.tables[3].id === 9 && st.tables[3].y === 40 - 75 && st.tables[0].seats[0] === 'gz', 'a table added in the same save keeps its place in the room as it was; names and seats stay', pos(st));
}
{ // capacity coercion, poisoned counters, label normalisation, support acting for the venue, the venue's message
  const V3 = (await call('POST', '/admin/venues', { name: 'V3' }, OWN)).d, H3 = { 'X-Venue-Key': V3.key };
  const T3 = (await call('POST', '/venues/' + V3.id + '/template', {}, H3)).d;
  const longName = 'Τραπέζι με ένα πολύ πολύ μακρύ όνομα που ξεπερνά τους εξήντα χαρακτήρες σίγουρα';
  const lay = layout(); lay.tables[0].label = longName;
  await call('PUT', '/plans/' + T3.planId, { plan: lay }, { 'X-Edit-Key': T3.venueKey });
  await call('PUT', '/venues/' + V3.id + '/defaults', { perms: { floor: false, decor: false, layout: false, tables: false, seats: true, labels: false, maxSeats: 8 } }, H3);
  const W3 = (await call('POST', '/venues/' + V3.id + '/weddings', { label: 'W3' }, H3)).d;
  let g = (await call('GET', '/plans/' + W3.planId, undefined, { 'X-Edit-Key': W3.editKey })).d;
  const shown = JSON.parse(JSON.stringify(g.plan)); shown.tables[0].label = longName.slice(0, 60); shown.guests = { a: { name: 'A' } };
  let pr = await call('PUT', '/plans/' + W3.planId, { plan: shown, baseUpdated: g.updated }, { 'X-Edit-Key': W3.editKey });
  ok(pr.status === 200 && !pr.d.enforced, 'a label the planner trimmed is not reported as a locked change');
  g = (await call('GET', '/plans/' + W3.planId, undefined, { 'X-Edit-Key': W3.editKey })).d;
  const zero = JSON.parse(JSON.stringify(g.plan)); zero.tables[0].capacity = 0; zero.tables[0].seats = Array(10).fill(null).map((x, i) => 'g' + i);
  pr = await call('PUT', '/plans/' + W3.planId, { plan: zero, baseUpdated: g.updated }, { 'X-Edit-Key': W3.editKey });
  const t0c = raw('plan:' + W3.planId).plan.tables[0];
  ok(t0c.capacity === 8 && t0c.seats.length === 8, 'capacity 0 cannot sneak past the seat maximum', t0c);
  g = (await call('GET', '/plans/' + W3.planId, undefined, { 'X-Edit-Key': W3.editKey })).d;
  const poison = JSON.parse(JSON.stringify(g.plan)); poison._uid = 2 ** 53;
  await call('PUT', '/plans/' + W3.planId, { plan: poison, baseUpdated: g.updated }, { 'X-Edit-Key': W3.editKey });
  ok(raw('plan:' + W3.planId).plan._uid === 50, 'an absurd id counter is ignored');
  await call('POST', '/plans/' + W3.planId + '/support', { hours: 24, message: 'μόνο για την υποστήριξη' }, H3);
  g = (await call('GET', '/plans/' + W3.planId, undefined, { 'X-Edit-Key': W3.editKey })).d;
  ok(g.support && g.support.message === undefined, 'the couple does not see the venue\'s message to support');
  const SK3 = raw('plan:' + W3.planId).support.key;
  const sp = JSON.parse(JSON.stringify(g.plan)); sp.features.push({ id: 'cake', kind: 'prop', x: 1, y: 1, w: 10, h: 10, label: 'Τούρτα' });
  await call('PUT', '/plans/' + W3.planId, { plan: sp, baseUpdated: g.updated }, { 'X-Support-Key': SK3 });
  ok(raw('plan:' + W3.planId).plan.features.find(f => f.id === 'cake').by === 'venue', 'support let in by the venue places items for the venue');
  // a couple-key refresh never downgrades a venue device link
  await call('POST', '/codes/venuedev99999999', { id: W3.planId }, { 'X-Edit-Key': W3.venueKey });
  await call('POST', '/codes/venuedev99999999', { id: W3.planId }, { 'X-Edit-Key': W3.editKey });
  ok((await call('GET', '/plans/' + W3.planId, undefined, { 'X-Sync-Code': 'venuedev99999999' })).d.role === 'venue', 'a venue device link stays venue when a couple key refreshes it');
  // template from a wedding drops the couple's group names and own decor
  const withCouple = JSON.parse(JSON.stringify(raw('plan:' + W3.planId).plan)); withCouple.groups = [{ id: 'grp1', name: 'Θείοι της Μαρίας', color: '#e26d8a' }]; withCouple.features.push({ id: 'pb', kind: 'prop', x: 5, y: 5, w: 5, h: 5, label: 'Photo booth', by: 'couple' });
  patchRaw('plan:' + W3.planId, o => { o.plan = withCouple; });
  const V4 = (await call('POST', '/admin/venues', { name: 'V4' }, OWN)).d, H4 = { 'X-Venue-Key': V4.key };
  const W4 = (await call('POST', '/venues/' + V4.id + '/weddings', { label: 'W4' }, H4)).d;
  patchRaw('plan:' + W4.planId, o => { o.plan = withCouple; });
  const T4 = (await call('POST', '/venues/' + V4.id + '/template', { fromPlanId: W4.planId }, H4)).d;
  const tp = raw('plan:' + T4.planId).plan;
  ok(!tp.groups.some(x => /Μαρίας/.test(x.name)) && !tp.features.some(f => f.id === 'pb'), 'a template made from a wedding carries no couple group names and no couple decor');
}
{ // grace: a device with a sync code still gets the legacy read
  m.set('plan:legacyTwo0000000000', JSON.stringify({ name: 'L2', plan: layout(), editKey: 'l2', readKey: 'rk2', updated: 1, owner: { type: 'couple' }, legacyOpenUntil: Date.now() + 1e6 }));
  ok((await call('GET', '/plans/legacyTwo0000000000', undefined, { 'X-Sync-Code': 'someothercode9999' })).d.legacy === true, 'the grace read ignores an unrelated sync code');
}

// ---------- 7. erasure ----------
r = await call('DELETE', '/admin/couples/' + cid, undefined, OWN);
ok(r.status === 200 && !m.has('plan:' + cplan) && !m.has('couple:' + cid), 'admin erasure deletes the couple plan and licence');
r = await call('DELETE', '/plans/' + C.id, undefined, { 'X-Edit-Key': C.editKey });
ok(r.status === 200 && !m.has('plan:' + C.id), 'a couple can delete its own plan');
r = await call('DELETE', '/admin/venues/' + V.id, undefined, OWN);
ok(!m.has('plan:' + W.planId) && !m.has('plan:' + T.planId) && !m.has('venue:' + V.id), 'deleting a venue erases its weddings and its template');

// ---------- 8. email: links and keys go to the customer, never through the admin ----------
{
  ok((await call('POST', '/recover', { email: 'a@b.gr' })).status === 503 && (await call('GET', '/admin/mail', undefined, OWN)).d.enabled === false, 'without mail: recovery answers mail_off, admin sees mail off');
  const noMail = (await call('POST', '/admin/couples', { name: 'NoMail', email: 'nm@example.com' }, OWN)).d;
  ok(noMail.claimToken && noMail.mailed === false, 'without mail the admin still gets the claim link (today\'s flow)');
  const sent = [];
  env.MAIL = { enabled: true, from: 'TakeaSeat <hello@takeaseat.gr>', send: msg => { sent.push(msg); return true; } };
  env.PUBLIC_URL = 'https://takeaseat.gr';
  const last = () => sent[sent.length - 1];
  const tok = (msg, kind) => { const x = new RegExp('#' + kind + '=([A-Za-z0-9]+)').exec(msg.text); return x && x[1]; };
  ok((await call('GET', '/admin/mail', undefined, OWN)).d.enabled === true, 'admin sees mail on');
  ok((await call('POST', '/admin/couples', { name: 'X', email: 'not an email' }, OWN)).status === 400, 'a malformed address is refused');

  // couple: the claim link goes by mail only
  let r = await call('POST', '/admin/couples', { name: 'Νίκος & Ελένη', email: ' Couple@Example.COM ', lang: 'en' }, OWN);
  const cp = r.d.couple;
  ok(r.status === 200 && r.d.mailed === true && !r.d.claimToken && !cp.claimToken && cp.pendingClaim && cp.email === 'couple@example.com', 'with mail: the claim link is e-mailed and never returned to the admin', r.d);
  ok(last().to === 'couple@example.com' && last().text.includes('https://takeaseat.gr/seating-planner.html#claim=') && last().text.includes('Νίκος & Ελένη'), 'the mail carries the claim link on the public URL, in the couple\'s language', last());
  ok(!(await call('GET', '/admin/couples', undefined, OWN)).d.couples.some(c => c.claimToken && c.id === cp.id), 'the admin list never shows a mailed claim link');
  const claimT = tok(last(), 'claim');
  r = await call('POST', '/claim', { token: claimT, nonce: 'n1' });
  const cPlan = r.d.id, cKey = r.d.editKey;
  ok(r.status === 200 && cKey && raw('couple:' + cp.id).emailVerified === true, 'the couple opens the mailed link; that proves the address');
  ok(raw('email:couple@example.com').couples.includes(cp.id), 'the address is indexed for recovery');

  // self-service recovery
  let before = sent.length;
  r = await call('POST', '/recover', { email: 'nobody@example.com' });
  ok(r.status === 200 && sent.length === before, 'recovery answers the same for an unknown address and sends nothing');
  ok((await call('POST', '/recover', { email: 'bad' })).status === 400, 'recovery refuses a malformed address');
  r = await call('POST', '/recover', { email: 'COUPLE@example.com', lang: 'el' });
  ok(r.status === 200 && sent.length === before + 1 && last().to === 'couple@example.com' && last().text.includes('#recover=') && last().subject.includes('σύνδεσμοί'), 'a known address gets one mail with a recovery link', last());
  const recT = tok(last(), 'recover');
  r = await call('POST', '/recover/couple', { token: recT, nonce: 'dev1' });
  ok(r.status === 200 && r.d.plans.length === 1 && r.d.plans[0].id === cPlan && r.d.plans[0].editKey === cKey && r.d.plans[0].readKey, 'the recovery link gives the couple its keys back', r.d);
  ok(raw('plan:' + cPlan).audit.some(e => e.what === 'recover'), 'recovery shows in the couple\'s access log');
  ok((await call('POST', '/recover/couple', { token: recT, nonce: 'dev1' })).status === 200, 'the same device may retry a lost answer');
  ok((await call('POST', '/recover/couple', { token: recT, nonce: 'other' })).status === 410, 'a recovery link opens once');
  ok((await call('POST', '/recover/couple', { token: 'x'.repeat(32) })).status === 404, 'an unknown recovery link is refused');
  before = sent.length;
  for (let i = 0; i < 4; i++) await call('POST', '/recover', { email: 'couple@example.com' });
  ok(sent.length === before + 2, 'at most 3 recovery mails an hour per address', sent.length - before);
  m.delete('rlmail:recover:couple@example.com');
  await call('POST', '/recover', { email: 'couple@example.com' });
  const staleT = tok(last(), 'recover');
  const rot = (await call('POST', '/plans/' + cPlan + '/rotate', {}, { 'X-Edit-Key': cKey })).d;
  ok((await call('POST', '/recover/couple', { token: staleT, nonce: 'z' })).status === 410, 'a recovery link sent before "new links" no longer works');
  m.delete('rlmail:recover:couple@example.com');
  await call('POST', '/recover', { email: 'couple@example.com' });
  const oldT = tok(last(), 'recover'); patchRaw('tok:' + oldT, o => { o.createdAt -= 2 * 3600000; });
  r = await call('POST', '/recover/couple', { token: oldT, nonce: 'z' });
  ok(r.status === 410 && r.d.error === 'token_expired', 'a recovery link expires after an hour');

  // the couple changes its own recovery email (confirmed by mail; the old address is told)
  const CK = { 'X-Edit-Key': rot.editKey };
  r = await call('GET', '/plans/' + cPlan, undefined, CK);
  ok(r.d.email === 'couple@example.com' && r.d.mail === true, 'the couple sees its recovery email');
  ok(!('email' in (await call('GET', '/plans/' + cPlan, undefined, { 'X-View-Key': rot.readKey })).d), 'a view link never sees the email');
  ok((await call('POST', '/plans/' + cPlan + '/email', { email: 'x@example.com' }, { 'X-View-Key': rot.readKey })).status === 403, 'a viewer cannot change the email');
  r = await call('POST', '/plans/' + cPlan + '/email', { email: 'New@Example.com', lang: 'el' }, CK);
  ok(r.status === 200 && r.d.pending === 'ne***@example.com' && last().to === 'new@example.com' && last().text.includes('seating-planner-el.html#verify='), 'a new address gets a confirmation link', r.d);
  ok(raw('couple:' + cp.id).email === 'couple@example.com', 'nothing changes until the new address confirms');
  const verT = tok(last(), 'verify'); before = sent.length;
  r = await call('POST', '/verify', { token: verT, nonce: 'v' });
  ok(r.status === 200 && raw('couple:' + cp.id).email === 'new@example.com' && !m.has('email:couple@example.com') && raw('email:new@example.com').couples.includes(cp.id), 'confirmed: the new address replaces the old one in the index');
  ok(sent.length === before + 1 && sent[before].to === 'couple@example.com' && sent[before].text.includes('ne***@example.com'), 'the old address is told about the change');
  ok(raw('plan:' + cPlan).audit.some(e => e.what === 'email' && e.who === 'couple'), 'the change shows in the access log');
  ok((await call('POST', '/verify', { token: verT, nonce: 'other' })).status === 410, 'a confirmation link works once');

  // admin changes the address (lost mailbox): visible to the couple
  before = sent.length;
  r = await call('PATCH', '/admin/couples/' + cp.id, { email: 'third@example.com' }, OWN);
  ok(r.status === 200 && sent[before].to === 'new@example.com' && sent[before].text.includes('TakeaSeat'), 'an admin change of address is mailed to the old address');
  ok(raw('plan:' + cPlan).audit.some(e => e.what === 'email' && e.who === 'admin'), 'and logged in the couple\'s access log');
  r = await call('POST', '/admin/couples/' + cp.id + '/send', {}, OWN);
  ok(r.status === 200 && r.d.mailed && !JSON.stringify(r.d).includes('#') && last().to === 'third@example.com' && tok(last(), 'recover'), 'admin "send link" e-mails a recovery link to an opened plan — the admin never sees it', r.d);

  // an unopened link that expired is replaced when sent again
  const c2 = (await call('POST', '/admin/couples', { name: 'Late', email: 'late@example.com' }, OWN)).d.couple;
  const t1 = tok(last(), 'claim'); patchRaw('claim:' + t1, o => { o.createdAt -= 40 * 86400000; });
  r = await call('POST', '/admin/couples/' + c2.id + '/send', {}, OWN);
  const t2 = tok(last(), 'claim');
  ok(r.d.mailed && t2 && t2 !== t1 && !m.has('claim:' + t1) && (await call('POST', '/claim', { token: t2, nonce: 'q' })).status === 200, 'an expired claim link is replaced by a fresh one when sent again');
  const c3 = (await call('POST', '/admin/couples', { name: 'Unopened', email: 'unopened@example.com' }, OWN)).d.couple;
  const t3 = tok(last(), 'claim');
  await call('POST', '/recover', { email: 'unopened@example.com' });
  ok(tok(last(), 'claim') === t3, 'recovery for a plan not opened yet re-sends its claim link');

  // admin reset with mail: new link to the couple only
  r = await call('POST', '/admin/couples/' + cp.id + '/reset', {}, OWN);
  ok(r.status === 200 && r.d.mailed && !r.d.claimToken && last().to === 'third@example.com', 'a reset mails the new link to the couple, not to the admin', r.d);
  ok((await call('GET', '/plans/' + cPlan, undefined, CK)).status === 403 && (await call('POST', '/claim', { token: tok(last(), 'claim'), nonce: 'r' })).status === 200, 'the old keys stop; the mailed link opens the plan');

  // venues: the venue sets its own key from the mailed link
  r = await call('POST', '/admin/venues', { name: 'Κτήμα Email', email: 'venue@example.com', lang: 'el' }, OWN);
  const VE = r.d;
  ok(r.status === 200 && VE.mailed && !VE.key && VE.venue.email === 'venue@example.com', 'with mail: a new venue gets a setup link by mail, the admin gets no key', r.d);
  ok(last().to === 'venue@example.com' && last().text.includes('https://takeaseat.gr/venue.html#recover='), 'the setup mail links to the console');
  ok((await call('GET', '/admin/venues/' + VE.id, undefined, OWN)).d.key === null, 'the admin cannot read the venue key');
  const setT = tok(last(), 'recover');
  ok((await call('POST', '/recover/venue', { token: setT, nonce: 'vv', secret: 'short' })).status === 400 && raw('tok:' + setT).usedAt === undefined, 'a too-short chosen key is refused without using up the link');
  r = await call('POST', '/recover/venue', { token: setT, nonce: 'vv' });
  const VK = r.d.key;
  ok(r.status === 200 && VK && VK.startsWith(VE.id + '.') && (await call('GET', '/venues/' + VE.id, undefined, { 'X-Venue-Key': VK })).status === 200, 'the venue sets its key and signs in', r.d);
  ok((await call('POST', '/recover/venue', { token: setT, nonce: 'vv' })).d.key === VK, 'the same device gets the same key if the answer was lost');
  ok((await call('POST', '/recover/venue', { token: setT, nonce: 'other' })).status === 410, 'anyone else: the setup link is used');
  r = await call('GET', '/venues/' + VE.id, undefined, { 'X-Venue-Key': VK });
  ok(r.d.venue.email === 'venue@example.com' && r.d.venue.mail === true && r.d.venue.keyRotated === true, 'the console shows its recovery email and that its key is private', r.d.venue);
  // forgot the key
  await call('POST', '/recover', { email: 'venue@example.com' });
  const vRec = tok(last(), 'recover');
  ok(last().text.includes('venue.html#recover=') && (await call('GET', '/venues/' + VE.id, undefined, { 'X-Venue-Key': VK })).status === 200, 'a recovery request never locks out the current key');
  const VK2 = (await call('POST', '/recover/venue', { token: vRec, nonce: 'w' })).d.key;
  ok(VK2 && VK2 !== VK && (await call('GET', '/venues/' + VE.id, undefined, { 'X-Venue-Key': VK })).status === 403, 'a recovered venue key replaces the old one');
  // admin "reset key" with mail: a link to the venue, nothing to the admin
  r = await call('POST', '/admin/venues/' + VE.id + '/reset-key', {}, OWN);
  ok(r.d.mailed && !r.d.key && (await call('GET', '/venues/' + VE.id, undefined, { 'X-Venue-Key': VK2 })).status === 200, 'admin reset-key mails a link; the current key keeps working until it is used', r.d);
  // the venue changes its email
  r = await call('POST', '/venues/' + VE.id + '/email', { email: 'office@example.com' }, { 'X-Venue-Key': VK2 });
  ok(r.status === 200 && last().to === 'office@example.com' && last().text.includes('venue.html#verify='), 'the venue changes its email with a confirmation link');
  before = sent.length;
  ok((await call('POST', '/verify', { token: tok(last(), 'verify') })).status === 200 && raw('venue:' + VE.id).email === 'office@example.com' && sent[before].to === 'venue@example.com', 'confirmed; the old address is told');
  ok((await call('POST', '/venues/' + VE.id + '/email', { email: 'x@example.com' }, { 'X-Venue-Key': 'nope' })).status === 403, 'only the venue can change its email');

  // erasure clears the index
  await call('DELETE', '/admin/couples/' + c3.id, undefined, OWN);
  await call('DELETE', '/admin/venues/' + VE.id, undefined, OWN);
  ok(!m.has('email:unopened@example.com') && !m.has('email:office@example.com'), 'erasure removes the addresses from the recovery index');
  ok(sent.every(x => x.text.startsWith('http') === false && /https:\/\/takeaseat\.gr\//.test(x.text) || /TakeaSeat/.test(x.text)), 'every mail is plain text from the public site');

  // ---- review fixes ----
  { // only the newest confirmation link counts (a typo'd address cannot confirm later)
    const k = (await call('POST', '/admin/couples', { name: 'Typo', email: 'typo-owner@example.com' }, OWN)).d.couple;
    const e = (await call('POST', '/claim', { token: tok(last(), 'claim'), nonce: 't' })).d, H = { 'X-Edit-Key': e.editKey };
    await call('POST', '/plans/' + e.id + '/email', { email: 'typo@exampel.com' }, H); const T1 = tok(last(), 'verify');
    await call('POST', '/plans/' + e.id + '/email', { email: 'right@example.com' }, H); const T2 = tok(last(), 'verify');
    ok((await call('POST', '/verify', { token: T1, nonce: 'a' })).status === 410 && raw('couple:' + k.id).email === 'typo-owner@example.com', 'an older confirmation link is dead once a newer one was sent');
    ok((await call('POST', '/verify', { token: T2, nonce: 'b' })).status === 200 && raw('couple:' + k.id).email === 'right@example.com', 'the newest one confirms');
    // a recovery link sent to the old address dies with the change
    m.delete('rlmail:recover:right@example.com');
    await call('POST', '/recover', { email: 'right@example.com' }); const R1 = tok(last(), 'recover');
    await call('PATCH', '/admin/couples/' + k.id, { email: 'fourth@example.com' }, OWN);
    ok((await call('POST', '/recover/couple', { token: R1, nonce: 'x' })).status === 410, 'a recovery link sent to the old address stops when the address changes');
    // an extra plan's key never reaches the licence's email
    const extra = (await call('POST', '/plans', { name: 'extra', plan: layout(), parentId: e.id }, H)).d;
    const XH = { 'X-Edit-Key': extra.editKey };
    ok(!('email' in (await call('GET', '/plans/' + extra.id, undefined, XH)).d) && (await call('POST', '/plans/' + extra.id + '/email', { email: 'x@example.com' }, XH)).status === 403, 'an extra plan\'s key neither sees nor changes the recovery email');
  }
  { // an admin address change stops an unopened link and sends a fresh one to the new address
    const k = (await call('POST', '/admin/couples', { name: 'Moved', email: 'moved-old@example.com' }, OWN)).d.couple;
    const oldT = tok(last(), 'claim');
    const pr = await call('PATCH', '/admin/couples/' + k.id, { email: 'moved-new@example.com' }, OWN);
    const newT = tok(last(), 'claim');
    ok(pr.d.mailed === true && last().to === 'moved-new@example.com' && newT && newT !== oldT && !m.has('claim:' + oldT) && !pr.d.couple.claimToken, 'the old first-opening link stops; a new one goes to the new address', pr.d);
    ok((await call('POST', '/claim', { token: newT, nonce: 'n' })).status === 200 && raw('couple:' + k.id).emailVerified === true, 'opening it proves the new address');
  }
  { // the verified mark only lands on the address the link went to
    const k = (await call('POST', '/admin/couples', { name: 'Mark', email: 'mark-a@example.com' }, OWN)).d.couple;
    const t1 = tok(last(), 'claim');
    patchRaw('couple:' + k.id, o => { o.email = 'mark-b@example.com'; });   // changed without the admin route (old data)
    await call('POST', '/claim', { token: t1, nonce: 'n' });
    ok(raw('couple:' + k.id).emailVerified !== true, 'a link mailed to another address does not verify the current one');
  }
  { // /recover mailing a first-opening link hides it from the admin; the issue date is shown
    const k = (await call('POST', '/admin/couples', { name: 'Hidden' }, OWN)).d.couple;   // no email: the admin sees the link
    await call('PATCH', '/admin/couples/' + k.id, { email: 'hidden@example.com' }, OWN);
    await call('POST', '/recover', { email: 'hidden@example.com' });
    const row = (await call('GET', '/admin/couples', undefined, OWN)).d.couples.find(x => x.id === k.id);
    ok(row && !row.claimToken && row.claimIssuedAt && last().text.includes('#claim='), 'a claim link that went by mail is hidden from the admin list; the list has the issue date', row);
  }
  { // venue: links sent before an address change / key change die; a replay never hands out a later key
    const V = (await call('POST', '/admin/venues', { name: 'Gen', email: 'gen-old@example.com' }, OWN)).d;
    const setup = tok(last(), 'recover');
    const K1 = (await call('POST', '/recover/venue', { token: setup, nonce: 'n1' })).d.key, H1 = { 'X-Venue-Key': K1 };
    const rs = await call('POST', '/admin/venues/' + V.id + '/reset-key', {}, OWN); const oldLink = tok(last(), 'recover');
    ok(rs.d.mailed && last().subject.includes('κωδικός'), 'a key reset mail says what it is');
    await call('POST', '/venues/' + V.id + '/email', { email: 'gen-new@example.com' }, H1);
    await call('POST', '/verify', { token: tok(last(), 'verify') });
    ok((await call('POST', '/recover/venue', { token: oldLink, nonce: 'z' })).status === 410 && (await call('GET', '/venues/' + V.id, undefined, H1)).status === 200, 'a key link sent to the old address stops when the address changes');
    const K3 = (await call('POST', '/venues/' + V.id + '/rotate', {}, H1)).d.key;
    const rep = await call('POST', '/recover/venue', { token: setup, nonce: 'n1' });
    ok(rep.status === 410 && !JSON.stringify(rep.d).includes(K3), 'replaying a used link after a key change never returns the new key');
    ok((await call('GET', '/venues/' + V.id, undefined, { 'X-Venue-Key': K3 })).status === 200, 'the venue\'s own new key works');
    const rk = await call('POST', '/admin/venues/' + V.id + '/reset-key', {}, OWN);
    delete env.MAIL;
    const rk2 = await call('POST', '/admin/venues/' + V.id + '/reset-key', {}, OWN);
    ok(rk.d.mailed && rk2.d.key && (await call('GET', '/admin/venues/' + V.id, undefined, OWN)).d.key === rk2.d.key, 'without mail, an admin reset makes the key admin-known again (not "private")');
    env.MAIL = { enabled: true, from: 'x', send: () => false };
    ok((await call('POST', '/admin/venues/' + V.id + '/reset-key', {}, OWN)).status === 503 && (await call('GET', '/venues/' + V.id, undefined, { 'X-Venue-Key': rk2.d.key })).status === 200, 'a mail that cannot go out is reported (503) and the key is not changed silently');
    env.MAIL = { enabled: true, from: 'TakeaSeat <hello@takeaseat.gr>', send: msg => { sent.push(msg); return true; } };
  }
  { // odd input never 500s and never tells which addresses exist
    ok((await call('POST', '/recover', { email: 'couple@example.com', lang: 'constructor' })).status === 200, 'a hostile language code is ignored');
    const nb = await worker.fetch(new Request('http://t/recover', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'null' }), env);
    ok(nb.status === 400, 'a null body is a bad request, not a crash');
    ok((await call('POST', '/verify', null)).status === 404 && (await call('POST', '/recover/venue', [])).status === 404, 'null / array bodies are refused cleanly');
    ok((await call('GET', '/health')).d.mail === true, 'health says whether mail is on');
  }
  { // housekeeping
    const tk = 'tok:' + 'e'.repeat(32); m.set(tk, JSON.stringify({ kind: 'venue-recover', vid: 'nope', createdAt: 1, ttl: 1 }));
    m.set('rlmail:recover:old@example.com', JSON.stringify([1]));
    const sw = await mod.sweep(env);
    ok(!m.has(tk) && !m.has('rlmail:recover:old@example.com') && sw.tok >= 1, 'the sweep removes expired links and old rate-limit rows', sw);
  }
  delete env.MAIL;
}

// ---------- 9. after the wedding: view only, keepsake, deletion; dates can't be gamed; trash; renewals ----------
{
  const tz = d => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Athens', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const today = tz(new Date()), day = n => tz(new Date(Date.now() + n * 86400000));
  const sent = [];
  env.MAIL = { enabled: true, from: 'x', send: m => { sent.push(m); return true; } };
  const V9 = (await call('POST', '/admin/venues', { name: 'Life', license: { type: 'seasonal' } }, OWN)).d, HV = { 'X-Venue-Key': V9.key };
  ok((await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Past', date: day(-3) }, HV)).status === 400, 'a new wedding cannot be dated in the past');
  ok((await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Far', date: day(900) }, HV)).status === 400 && raw('venue:' + V9.id).used === 0, 'nor more than two years ahead — and a refused wedding is not counted');
  let r = await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Γάμος Α', date: day(30) }, HV);
  const WA = r.d;
  ok(r.status === 200 && raw('plan:' + WA.planId).weddingDate === day(30) && raw('plan:' + WA.planId).createdAt, 'a wedding is created with its date');
  let con = (await call('GET', '/venues/' + V9.id, undefined, HV)).d;
  let row = con.weddings.find(w => w.planId === WA.planId);
  ok(row.date === day(30) && row.stats && row.life && row.life.locked === false && row.life.deleteAt > row.life.lockAt && row.dateChangesLeft === 3, 'the console shows date, progress and lifecycle', row);
  // date changes are limited (a paid wedding is not reused for the next couple)
  for (let i = 1; i <= 3; i++) ok((await call('PATCH', '/venues/' + V9.id + '/weddings/' + WA.planId, { date: day(30 + i) }, HV)).status === 200, 'date change ' + i + ' of 3');
  r = await call('PATCH', '/venues/' + V9.id + '/weddings/' + WA.planId, { date: day(60) }, HV);
  ok(r.status === 403 && r.d.error === 'no_more_changes', 'a fourth change is refused');
  ok((await call('PATCH', '/venues/' + V9.id + '/weddings/' + WA.planId, { date: null }, HV)).status === 400, 'a date cannot be removed');
  ok(raw('plan:' + WA.planId).audit.filter(e => e.what === 'date').length === 3 && raw('venue:' + V9.id).weddings[0].date === day(33), 'changes are logged and mirrored in the console list');
  // the couple of a venue wedding does not set the date; a couple who bought directly does
  ok((await call('POST', '/plans/' + WA.planId + '/date', { date: day(40) }, { 'X-Edit-Key': WA.editKey })).status === 403, 'a venue couple cannot move the date');
  const K9 = (await call('POST', '/admin/couples', { name: 'Direct', email: 'd9@example.com', weddingDate: day(20) }, OWN)).d.couple;
  const C9 = (await call('POST', '/claim', { token: raw('couple:' + K9.id).claimToken, nonce: 'n' })).d, HC = { 'X-Edit-Key': C9.editKey };
  r = await call('GET', '/plans/' + C9.id, undefined, HC);
  ok(r.d.life && r.d.life.weddingDate === day(20) && r.d.life.dateEditable === true && r.d.life.locked === false, 'the couple sees its date and may change it', r.d.life);
  ok((await call('POST', '/plans/' + C9.id + '/date', { date: day(21) }, HC)).d.life.weddingDate === day(21), 'the couple moves its date');
  ok((await call('POST', '/plans/' + C9.id + '/date', { date: day(22) }, { 'X-View-Key': C9.readKey })).status === 403, 'a viewer cannot');
  ok((await call('GET', '/plans/' + C9.id, undefined, { 'X-View-Key': C9.readKey })).d.life.dateEditable === false, 'a viewer sees the date, not editable');
  // after the wedding: view only for everyone
  patchRaw('plan:' + C9.id, o => { o.weddingDate = day(-2); o.plan = layout({ guests: { g1: { name: 'Α' }, g2: { name: 'Β' } } }); o.plan.tables[0].seats[0] = 'g1'; });
  r = await call('GET', '/plans/' + C9.id, undefined, HC);
  ok(r.status === 200 && r.d.life.locked && !r.d.life.dateEditable, 'the day after the wedding the plan reads as locked', r.d.life);
  r = await call('PUT', '/plans/' + C9.id, { plan: layout(), baseUpdated: raw('plan:' + C9.id).updated }, HC);
  ok(r.status === 403 && r.d.error === 'locked' && r.d.life, 'and refuses every save');
  ok((await call('POST', '/plans/' + C9.id + '/date', { date: day(5) }, HC)).status === 403, 'the date cannot be moved to reopen it');
  // PDF
  ok((await call('GET', '/plans/' + C9.id + '/pdf?mode=keepsake', undefined, HC)).d.error === 'pdf_off', 'without the renderer: pdf_off');
  const renders = [];
  env.PDF = { render: async (plan, meta) => { renders.push(meta); return new TextEncoder().encode('%PDF-1.4 fake'); } };
  let pr = await worker.fetch(new Request('http://t/plans/' + C9.id + '/pdf?mode=keepsake&lang=en', { headers: { ...NEW, 'X-View-Key': C9.readKey } }), env);
  ok(pr.status === 200 && pr.headers.get('Content-Type') === 'application/pdf' && /keepsake\.pdf/.test(decodeURIComponent(pr.headers.get('Content-Disposition'))) && renders[0].mode === 'keepsake' && renders[0].weddingDate === day(-2), 'the keepsake PDF downloads, also for viewers and after the wedding');
  ok((await worker.fetch(new Request('http://t/plans/' + C9.id + '/pdf', { headers: NEW }), env)).status === 401, 'not without a key');
  // housekeeping: lock, keepsake mail once, deletion after the retention days
  let sw = await mod.sweep(env);
  const ks = sent.filter(m => m.to === 'd9@example.com' && m.attachments);
  ok(sw.locked >= 1 && sw.keepsakes === 1 && ks.length === 1 && ks[0].attachments[0].filename.endsWith('.pdf') && /Συγχαρητήρια/.test(ks[0].text) && raw('plan:' + C9.id).keepsakeSentAt, 'the sweep locks it and mails the keepsake with the PDF attached', sw);
  sw = await mod.sweep(env);
  ok(sw.keepsakes === 0 && sent.filter(m => m.attachments).length === 1, 'the keepsake goes once');
  patchRaw('plan:' + C9.id, o => { o.weddingDate = day(-9); });
  sw = await mod.sweep(env);
  ok(!m.has('plan:' + C9.id) && raw('couple:' + K9.id).purgedAt && !raw('couple:' + K9.id).email && !m.has('email:d9@example.com'), '7 days after the wedding the plan is deleted and the address forgotten', sw);
  // the admin's exceptions: keep forever / stay editable (the owner's own wedding), per venue, global
  const WB = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Δικός μας', date: day(10) }, HV)).d;
  patchRaw('plan:' + WB.planId, o => { o.weddingDate = day(-30); });
  r = await call('PUT', '/admin/plans/' + WB.planId + '/retention', { keep: true, lockAfter: false }, OWN);
  ok(r.status === 200 && r.d.life.keep && !r.d.life.locked && r.d.life.deleteAt === null, 'a plan exception: kept and editable', r.d);
  await mod.sweep(env);
  ok(m.has('plan:' + WB.planId) && (await call('PUT', '/plans/' + WB.planId, { plan: layout() }, { 'X-Edit-Key': WB.venueKey })).status === 200, 'the excepted plan survives the sweep and still saves');
  ok((await call('GET', '/admin/settings', undefined, OWN)).d.planExceptions.some(x => x.planId === WB.planId && x.keep), 'the admin sees the exception list');
  await call('PATCH', '/admin/venues/' + V9.id, { retention: { keepDays: 30 } }, OWN);
  const WC = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Γ', date: day(1) }, HV)).d;
  patchRaw('plan:' + WC.planId, o => { o.weddingDate = day(-10); });
  await mod.sweep(env);
  ok(m.has('plan:' + WC.planId), 'a venue with 30 days keeps its weddings longer');
  await call('PUT', '/admin/settings', { retention: { keepDays: 3 } }, OWN);
  ok((await call('GET', '/admin/settings', undefined, OWN)).d.retention.keepDays === 3, 'the global default is editable');
  await call('PATCH', '/admin/venues/' + V9.id, { retention: null }, OWN);
  await mod.sweep(env);
  ok(!m.has('plan:' + WC.planId) && !raw('venue:' + V9.id).weddings.some(w => w.planId === WC.planId), 'back on the (shorter) global default it is deleted and leaves the list');
  await call('PUT', '/admin/settings', { retention: { keepDays: 7 } }, OWN);
  // trash: the venue deletes, only the admin restores (14 days)
  const WD = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Σβήστηκε', date: day(50) }, HV)).d;
  r = await call('DELETE', '/venues/' + V9.id + '/weddings/' + WD.planId, undefined, HV);
  ok(r.status === 200 && r.d.purgeAt && (await call('GET', '/plans/' + WD.planId, undefined, { 'X-Edit-Key': WD.editKey })).status === 410, 'a deleted wedding is gone for everyone');
  con = (await call('GET', '/venues/' + V9.id, undefined, HV)).d;
  ok(!con.weddings.some(w => w.planId === WD.planId) && con.trash.some(t => t.label === 'Σβήστηκε' && !t.planId), 'the console lists it as deleted (no way to restore it there)');
  const tr = (await call('GET', '/admin/venues/' + V9.id + '/trash', undefined, OWN)).d.trash;
  ok(tr.length === 1 && tr[0].planId === WD.planId, 'the admin sees it');
  ok((await call('POST', '/admin/venues/' + V9.id + '/trash/' + WD.planId + '/restore', {}, OWN)).status === 200, 'the admin restores it');
  ok((await call('GET', '/plans/' + WD.planId, undefined, { 'X-Edit-Key': WD.editKey })).status === 200 && (await call('GET', '/plans/' + WD.planId, undefined, { 'X-Edit-Key': WD.venueKey })).status === 403
    && (await call('GET', '/venues/' + V9.id, undefined, HV)).d.weddings.some(w => w.planId === WD.planId), 'restored: back in the console, couple link works, the old venue link is renewed');
  await call('DELETE', '/venues/' + V9.id + '/weddings/' + WD.planId, undefined, HV);
  patchRaw('plan:' + WD.planId, o => { o.purgeAt = Date.now() - 1; });
  sw = await mod.sweep(env);
  ok(!m.has('plan:' + WD.planId) && !(raw('venue:' + V9.id).trash || []).length && sw.trash === 1, 'after 14 days the trash is emptied');
  // licences: renew automatically unless the venue stops it; the admin marks the invoice
  const VR = (await call('POST', '/admin/venues', { name: 'Renew', license: { type: 'seasonal', seasonStart: '2025-04-01', seasonEnd: '2025-10-31' } }, OWN)).d;
  sw = await mod.sweep(env);
  let lic = raw('venue:' + VR.id).license;
  ok(sw.renewed === 0 && lic.seasonEnd === '2025-10-31' && lic.renewSkipped === '2025-10-31' && !lic.invoiceDue, 'a season that ended without a reminder is NOT renewed — it is flagged for the admin', lic);
  const VX = (await call('POST', '/admin/venues', { name: 'Off', license: { type: 'seasonal', seasonStart: '2025-04-01', seasonEnd: '2025-10-31' } }, OWN)).d;
  patchRaw('venue:' + VX.id, o => { o.active = false; o.renewReminders = { '2025-10-31:7': 1 }; });
  await mod.sweep(env);
  ok(raw('venue:' + VX.id).license.seasonEnd === '2025-10-31' && !raw('venue:' + VX.id).license.invoiceDue, 'an inactive venue never renews');
  patchRaw('venue:' + VR.id, o => { o.renewReminders = { '2025-10-31:7': Date.now() }; });   // the 7-day reminder went out
  sw = await mod.sweep(env);
  lic = raw('venue:' + VR.id).license;
  ok(sw.renewed === 1 && lic.seasonStart === '2026-04-01' && lic.seasonEnd === '2026-10-31' && lic.invoiceDue === true && lic.renewedAt && !lic.renewSkipped, 'after a reminder, a season renews automatically to the same dates next year', lic);
  ok((await mod.sweep(env)).renewed === 0, 'one renewal, no catching up year after year');
  const VL = (await call('POST', '/admin/venues', { name: 'Legacy', license: { type: 'seasonal' } }, OWN)).d;
  patchRaw('venue:' + VL.id, o => { o.license.seasonEnd = '2026-10-31T00:00:00.000Z'; o.license.seasonStart = 'April 1, 2026'; });
  await mod.sweep(env);
  ok(raw('venue:' + VL.id).license.seasonEnd === '2026-10-31' && raw('venue:' + VL.id).license.seasonStart === '2026-04-01', 'older licence date formats are normalised');
  ok((await call('GET', '/venues/' + VR.id, undefined, { 'X-Venue-Key': VR.key })).d.venue.license.invoiceDue === undefined, 'the venue never sees the invoice flag');
  await call('PATCH', '/admin/venues/' + VR.id, { license: { ...lic, invoiceDue: true, seasonEnd: '2026-10-30' } }, OWN);
  ok(raw('venue:' + VR.id).license.invoiceDue === true && raw('venue:' + VR.id).license.renewedAt === lic.renewedAt, 'editing the licence keeps the renewal bookkeeping');
  ok((await call('POST', '/admin/venues/' + VR.id + '/invoiced', {}, OWN)).d.venue.license.invoiceDue === false, 'the admin marks the renewal invoiced');
  ok((await call('POST', '/venues/' + VR.id + '/renewal', { autoRenew: false }, { 'X-Venue-Key': VR.key })).d.license.autoRenew === false, 'the venue turns renewal off');
  patchRaw('venue:' + VR.id, o => { o.license.seasonEnd = '2025-10-31'; o.license.seasonStart = '2025-04-01'; });
  ok((await mod.sweep(env)).renewed === 0, 'and then nothing renews');
  // review fixes: extra plans follow the main plan; dates frozen after the wedding; restore guard; purge hygiene
  {
    const K = (await call('POST', '/admin/couples', { name: 'Extra', email: 'x9@example.com', weddingDate: day(20) }, OWN)).d.couple;
    ok((await call('POST', '/admin/couples', { name: 'Past', weddingDate: day(-3) }, OWN)).d.error === 'past_date', 'a new couple cannot start with a past date');
    const M = (await call('POST', '/claim', { token: raw('couple:' + K.id).claimToken, nonce: 'n' })).d, HM = { 'X-Edit-Key': M.editKey };
    const X = (await call('POST', '/plans', { name: 'extra', plan: layout(), parentId: M.id }, HM)).d, HX = { 'X-Edit-Key': X.editKey };
    r = await call('GET', '/plans/' + X.id, undefined, HX);
    ok(r.d.life.weddingDate === day(20) && r.d.life.dateEditable === false && r.d.life.child, 'an extra plan follows the main date and cannot set its own', r.d.life);
    ok((await call('POST', '/plans/' + X.id + '/date', { date: day(300) }, HX)).status === 403, 'its date route is refused');
    patchRaw('plan:' + M.id, o => { o.weddingDate = day(-2); o.plan = layout(); });
    ok((await call('PUT', '/plans/' + X.id, { plan: layout(), baseUpdated: raw('plan:' + X.id).updated }, HX)).status === 403, 'after the wedding the extra plan is locked too');
    ok((await call('POST', '/plans', { name: 'more', plan: layout(), parentId: X.id }, HX)).d.error === 'wedding_over', 'and no new plans can be made from it');
    patchRaw('plan:' + M.id, o => { o.weddingDate = day(-9); });
    await mod.sweep(env);
    const cp9 = raw('couple:' + K.id);
    ok(!m.has('plan:' + M.id) && !m.has('plan:' + X.id) && cp9.purgedAt && !JSON.stringify(cp9).includes('x9@example.com') && !cp9.plans.length, 'the main plan takes its extra plans with it; no trace of the address remains', cp9);
    // stays-editable policy still freezes the date
    const WE = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Edit', date: day(15) }, HV)).d;
    await call('PUT', '/admin/plans/' + WE.planId + '/retention', { lockAfter: false }, OWN);
    patchRaw('plan:' + WE.planId, o => { o.weddingDate = day(-3); });
    ok((await call('PATCH', '/venues/' + V9.id + '/weddings/' + WE.planId, { date: day(200) }, HV)).d.error === 'locked', 'after the wedding the date is frozen even when the plan stays editable');
    // a finished wedding cannot be restored into an immediate deletion
    const WR = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Old', date: day(15) }, HV)).d;
    await call('DELETE', '/venues/' + V9.id + '/weddings/' + WR.planId, undefined, HV);
    patchRaw('plan:' + WR.planId, o => { o.weddingDate = day(-20); });
    r = await call('POST', '/admin/venues/' + V9.id + '/trash/' + WR.planId + '/restore', {}, OWN);
    ok(r.status === 409 && r.d.error === 'past_retention' && r.d.deleteAt, 'restoring a wedding past its deletion date is refused with the reason', r.d);
    await call('PUT', '/admin/plans/' + WR.planId + '/retention', { keep: true }, OWN);
    ok((await call('POST', '/admin/venues/' + V9.id + '/trash/' + WR.planId + '/restore', {}, OWN)).status === 200, 'with a keep exception it can be restored');
    // venue can't rename or change perms of a locked wedding
    const WLk = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Lk', date: day(15) }, HV)).d;
    patchRaw('plan:' + WLk.planId, o => { o.weddingDate = day(-2); });
    ok((await call('PATCH', '/venues/' + V9.id + '/weddings/' + WLk.planId, { label: 'New' }, HV)).d.error === 'locked', 'a finished wedding cannot be renamed');
    // old pages keep long tables long
    const WS = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Shape', date: day(15) }, HV)).d;
    const withRect = layout(); withRect.tables[1].shape = 'rect';
    await call('PUT', '/plans/' + WS.planId, { plan: withRect, baseUpdated: raw('plan:' + WS.planId).updated }, { 'X-Edit-Key': WS.venueKey });
    const asRound = layout(); asRound.tables[1].shape = 'round';
    await call('PUT', '/plans/' + WS.planId, { plan: asRound, baseUpdated: raw('plan:' + WS.planId).updated }, { 'X-Edit-Key': WS.venueKey });
    ok(raw('plan:' + WS.planId).plan.tables[1].shape === 'rect', 'a page opened before the update cannot turn a long table round');
  }
  // ---- phases: opens 14 days after payment, names until 30 days before, one date change + freeze, new couple link ----
  {
    ok((await call('POST', '/admin/couples', { name: 'NoDate', weddingDate: undefined }, OWN)).d.error === 'missing_date', 'a couple is sold with a wedding date');
    ok((await call('POST', '/venues/' + V9.id + '/weddings', { label: 'NoDate', date: undefined }, HV)).d.error === 'missing_date', 'a venue wedding needs a date');
    ok((await call('POST', '/admin/couples', { name: 'Early', weddingDate: day(60), startNow: true }, OWN)).d.error === 'start_now_too_early', '"start now" only for a wedding less than 3 weeks away');
    const P = (await call('POST', '/admin/couples', { name: 'Phases', weddingDate: day(60), startNow: false }, OWN)).d.couple;
    ok(P.life.phase === 'waiting' && P.life.opensAt > Date.now() + 13 * 86400000 && P.startNow === false, 'the admin sees the planner opening 14 days after payment', P.life);
    const PC = (await call('POST', '/claim', { token: raw('couple:' + P.id).claimToken, nonce: 'n' })).d, HP = { 'X-Edit-Key': PC.editKey };
    r = await call('GET', '/plans/' + PC.id, undefined, HP);
    ok(r.d.life.phase === 'waiting' && r.d.perms.tables === false && r.d.perms.seats === false, 'while waiting the couple sees the plan but can change nothing', r.d.perms);
    r = await call('PUT', '/plans/' + PC.id, { plan: layout(), baseUpdated: raw('plan:' + PC.id).updated }, HP);
    ok(r.status === 403 && r.d.error === 'not_open' && r.d.life.opensAt, 'saving before the opening is refused with the date');
    ok((await call('POST', '/plans/' + PC.id + '/date', { date: day(70) }, HP)).d.error === 'not_open', 'the date cannot change before the opening either');
    patchRaw('plan:' + PC.id, o => { o.opensAt = Date.now() - 1000; o.plan = layout(); });
    r = await call('GET', '/plans/' + PC.id, undefined, HP);
    ok(r.d.life.phase === 'names' && r.d.perms.tables === false && r.d.perms.layout === false && r.d.perms.floor === false && r.d.perms.seats === true && r.d.life.fullAt, 'names phase: guests and seating yes, the room no', r.d.perms);
    const more = layout(); more.tables.push({ id: 9, shape: 'round', x: 900, y: 900, label: '9', capacity: 8, seats: Array(8).fill(null) }); more.tables[0].x = 777;
    more.guests = { gA: { name: 'Α' } }; more.tables[1].seats[0] = 'gA'; more.tables[1].capacity = 10; more.tables[1].seats = [...more.tables[1].seats, null, null];
    r = await call('PUT', '/plans/' + PC.id, { plan: more, baseUpdated: raw('plan:' + PC.id).updated }, HP);
    const saved = raw('plan:' + PC.id).plan;
    ok(r.d.enforced && saved.tables.length === 2 && saved.tables[0].x === 100 && saved.tables[1].seats[0] === 'gA' && saved.tables[1].capacity === 10, 'a new table or a moved table is undone; names and chair counts stay', saved.tables.map(t => [t.id, t.x, t.capacity]));
    // one date change, then view-only until 14 days before the new date
    r = await call('GET', '/plans/' + PC.id, undefined, HP);
    ok(r.d.life.dateChangesLeft === 1 && r.d.life.dateEditable, 'a couple has one date change');
    r = await call('POST', '/plans/' + PC.id + '/date', { date: day(90) }, HP);
    ok(r.status === 200 && r.d.life.phase === 'frozen' && r.d.life.frozenUntil > Date.now() + 70 * 86400000 && r.d.life.dateChangesLeft === 0, 'after the change the plan freezes until 14 days before the new date', r.d.life);
    ok((await call('PUT', '/plans/' + PC.id, { plan: saved, baseUpdated: raw('plan:' + PC.id).updated }, HP)).d.error === 'not_open', 'frozen: no saves');
    await call('PATCH', '/admin/couples/' + P.id, { unfreeze: true }, OWN);
    r = await call('GET', '/plans/' + PC.id, undefined, HP);
    ok(r.d.life.phase === 'names' && r.d.life.dateEditable === false, 'the admin can unfreeze; no second change for the couple');
    await call('PATCH', '/admin/couples/' + P.id, { weddingDate: day(20) }, OWN);
    r = await call('GET', '/plans/' + PC.id, undefined, HP);
    ok(r.d.life.phase === 'full' && r.d.perms.tables === true && !r.d.life.frozenUntil, 'an admin date change never freezes; 30 days before, the full editor', r.d.life.phase);
    // venue couples: no waiting, names until 30 days before; the venue itself is never limited
    const VW = (await call('POST', '/venues/' + V9.id + '/weddings', { label: 'Phased', date: day(60) }, HV)).d;
    r = await call('GET', '/plans/' + VW.planId, undefined, { 'X-Edit-Key': VW.editKey });
    ok(r.d.life.phase === 'names' && r.d.perms.tables === false, 'a venue couple starts in the names phase at once');
    ok((await call('PUT', '/plans/' + VW.planId, { plan: layout(), baseUpdated: raw('plan:' + VW.planId).updated }, { 'X-Edit-Key': VW.venueKey })).status === 200
      && (await call('GET', '/venues/' + V9.id, undefined, HV)).d.weddings.find(w => w.planId === VW.planId).life.fullAt, 'the venue edits freely and sees when the couple gets the room');
    // a new couple link (leaked link)
    r = await call('POST', '/venues/' + V9.id + '/weddings/' + VW.planId + '/couple-link', {}, HV);
    ok(r.status === 200 && r.d.editKey && r.d.editKey !== VW.editKey && (await call('GET', '/plans/' + VW.planId, undefined, { 'X-Edit-Key': VW.editKey })).status === 403
      && (await call('GET', '/plans/' + VW.planId, undefined, { 'X-Edit-Key': r.d.editKey })).status === 200 && raw('plan:' + VW.planId).audit.some(e => e.what === 'rotate' && e.who === 'venue'), 'the venue issues a new couple link; the old one stops; it is logged');
    ok((await call('POST', '/venues/' + V9.id + '/weddings/' + VW.planId + '/couple-link', {}, { 'X-Venue-Key': 'nope' })).status === 403, 'only the venue can');
    // review fixes: no extra plans before the room opens; the first upload keeps the starting room; admin changes unfreeze
    const Q = (await call('POST', '/admin/couples', { name: 'Loophole', weddingDate: day(60), startNow: false }, OWN)).d.couple;
    const QC = (await call('POST', '/claim', { token: raw('couple:' + Q.id).claimToken, nonce: 'n' })).d, HQ = { 'X-Edit-Key': QC.editKey };
    const big = n => { const p = layout(); p.tables = Array.from({ length: n }, (_, i) => ({ id: i + 1, shape: 'round', x: 100 + i * 10, y: 100, label: String(i + 1), capacity: 8, seats: Array(8).fill(null) })); return p; };
    ok((await call('POST', '/plans', { name: 'extra', plan: big(30), parentId: QC.id }, HQ)).d.error === 'not_open', 'no extra plan while waiting');
    patchRaw('plan:' + QC.id, o => { o.opensAt = Date.now() - 1000; });
    ok((await call('POST', '/plans', { name: 'extra', plan: big(30), parentId: QC.id }, HQ)).d.error === 'not_open', 'nor in the names phase');
    const firstUp = big(40); firstUp.tables.push({ id: 99, shape: 'head', x: 900, y: 1200, label: 'H', capacity: 4, seats: Array(4).fill(null) });
    r = await call('PUT', '/plans/' + QC.id, { plan: firstUp, baseUpdated: raw('plan:' + QC.id).updated }, HQ);
    ok(r.d.enforced && raw('plan:' + QC.id).plan.tables.length === 9 && raw('plan:' + QC.id).plan.tables.some(t => t.shape === 'head'), 'a first upload in the names phase keeps only the starting 8 tables + head table', raw('plan:' + QC.id).plan.tables.length);
    const dec = JSON.parse(JSON.stringify(raw('plan:' + QC.id).plan)); dec.features = [{ id: 'f9', kind: 'prop', x: 400, y: 400, w: 80, h: 80, label: 'Photo booth' }];
    r = await call('PUT', '/plans/' + QC.id, { plan: dec, baseUpdated: raw('plan:' + QC.id).updated }, HQ);
    ok(!r.d.enforced && raw('plan:' + QC.id).plan.features.some(f => f.id === 'f9'), 'decor stays open in the names phase (owner decision)');
    await call('POST', '/plans/' + QC.id + '/date', { date: day(80) }, HQ);
    ok(raw('plan:' + QC.id).frozenUntil, 'the couple\'s change froze it');
    await call('PATCH', '/admin/couples/' + Q.id, { weddingDate: day(40) }, OWN);
    ok(!raw('plan:' + QC.id).frozenUntil && (await call('GET', '/plans/' + QC.id, undefined, HQ)).d.life.phase === 'names', 'an admin date change lifts the freeze');
    ok((await call('POST', '/admin/couples', { name: 'Late', weddingDate: day(10), startNow: false }, OWN)).d.error === 'never_opens', 'a plan that would open only after the wedding is not sold without "start now"');
  }
  // renewal reminders: 30 and 7 days before, once each
  const VM = (await call('POST', '/admin/venues', { name: 'Remind', license: { type: 'seasonal', seasonStart: day(-200), seasonEnd: day(20) } }, OWN)).d;
  patchRaw('venue:' + VM.id, o => { o.email = 'remind@example.com'; });
  let before9 = sent.length;
  await mod.sweep(env);
  ok(sent.length === before9 + 1 && sent[before9].to === 'remind@example.com' && /ανανεώνεται αυτόματα/.test(sent[before9].text) && /venue\.html/.test(sent[before9].text), 'the venue is reminded 30 days before the renewal');
  await mod.sweep(env);
  ok(sent.length === before9 + 1, 'once');
  patchRaw('venue:' + VM.id, o => { o.license.seasonEnd = day(5); });
  await mod.sweep(env);
  ok(sent.length === before9 + 2 && /ανανεώνεται/.test(sent[before9 + 1].subject), 'and again 7 days before');
  await call('POST', '/venues/' + VM.id + '/renewal', { autoRenew: false }, { 'X-Venue-Key': VM.key });
  patchRaw('venue:' + VM.id, o => { o.license.seasonEnd = day(25); o.renewReminders = {}; });
  await mod.sweep(env);
  ok(sent.length === before9 + 2, 'no reminder when renewal is off');
  // private admin notes never reach the venue or its couples
  await call('PATCH', '/admin/venues/' + V9.id, { notes: 'paid cash', contact: '210 1234567' }, OWN);
  const vv = (await call('GET', '/venues/' + V9.id, undefined, HV)).d.venue, cpv = (await call('GET', '/plans/' + WB.planId, undefined, { 'X-Edit-Key': WB.editKey })).d;
  ok(!JSON.stringify(vv).includes('paid cash') && !JSON.stringify(cpv).includes('paid cash') && cpv.owner.venueContact === '210 1234567'
    && (await call('GET', '/admin/venues', undefined, OWN)).d.venues.find(x => x.id === V9.id).notes === 'paid cash', 'admin notes stay private; the public contact reaches the couples');
  delete env.PDF; delete env.MAIL;
}
// ---------- 10. the owner forgot the admin key: recovery by mail, the key itself never stored ----------
{
  const sent = [];
  ok((await call('POST', '/admin/recover', { email: 'a@b.gr' })).status === 503, 'without mail there is no admin recovery');
  env.MAIL = { enabled: true, from: 'x', send: x => { sent.push(x); return true; } };
  const last = () => sent[sent.length - 1];
  const tokOf = re => re.exec(last().text)[1];
  const RECOVER = /#recover=([A-Za-z0-9]+)/, CONFIRM = /#verify=([A-Za-z0-9]+)/;
  const setAddress = async (email, lang) => {   // an address counts only once it is confirmed from the address itself
    const put = await call('PUT', '/admin/owner', { email, lang }, OWN);
    if (put.status !== 200) return put;
    return call('POST', '/verify', { token: tokOf(CONFIRM), nonce: 'v' });
  };
  const freshLink = async email => {   // the limits are per address, and the tests burn through them on purpose
    m.delete('rlmail:owner:' + email); m.delete('rlmailday:owner:' + email);
    await call('POST', '/admin/recover', { email });
    return tokOf(RECOVER);
  };
  ok((await call('GET', '/admin/owner', undefined, OWN)).d.email === '', 'no recovery address at first');
  r = await call('PUT', '/admin/owner', { email: 'Owner@Example.com', lang: 'el' }, OWN);
  ok(r.status === 200 && r.d.email === '' && r.d.pending === 'owner@example.com' && last().to === 'owner@example.com' && CONFIRM.test(last().text),
    'a new recovery address is pending, not live, until it is confirmed', r.d);
  let before = sent.length;
  ok((await call('POST', '/admin/recover', { email: 'owner@example.com' })).status === 200 && sent.length === before,
    'an address that was never confirmed cannot ask for an admin key');
  r = await call('POST', '/verify', { token: tokOf(CONFIRM), nonce: 'v' });
  ok(r.status === 200 && (await call('GET', '/admin/owner', undefined, OWN)).d.emailVerified === true, 'the confirmation link makes it the recovery address');
  ok((await call('PUT', '/admin/owner', { email: 'nope' }, OWN)).status === 400, 'a malformed address is refused');
  ok((await call('GET', '/admin/owner', undefined, { 'X-Owner-Key': 'wrong' })).status === 403, 'only the admin sees it');
  before = sent.length;
  ok((await call('POST', '/admin/recover', { email: 'someone@else.com' })).status === 200 && sent.length === before, 'a wrong address gets the same answer and no mail');
  ok((await call('POST', '/admin/recover', { email: 'owner@example.com' })).status === 200 && sent.length === before + 1 && RECOVER.test(last().text), 'the right address gets the link');
  const tokA = tokOf(RECOVER);
  await call('POST', '/admin/recover', { email: 'owner@example.com' });   // a second link, while the first is still in flight
  const tokB = tokOf(RECOVER);
  ok((await call('POST', '/admin/recover/claim', { token: 'x'.repeat(32), nonce: 'n' })).status === 404, 'an unknown link is refused');
  before = sent.length;
  r = await call('POST', '/admin/recover/claim', { token: tokB, nonce: 'dev' }, {});
  const key1 = r.d.key;
  ok(r.status === 200 && key1 && key1.length >= 32 && sent.length === before + 1 && /Νέο κλειδί/.test(last().subject), 'the link issues a new admin key and says so by mail');
  ok(!JSON.stringify(raw('meta:owner')).includes(key1) && raw('meta:owner').keyHash.length === 64, 'only the hash of the key is stored');
  ok((await call('GET', '/admin/venues', undefined, { 'X-Owner-Key': key1 })).status === 200, 'the mailed key opens the admin console');
  ok((await call('GET', '/admin/venues', undefined, OWN)).status === 200, 'the server.env key keeps working');
  ok((await call('POST', '/admin/recover/claim', { token: tokB, nonce: 'dev' })).status === 410
    && (await call('GET', '/admin/venues', undefined, { 'X-Owner-Key': key1 })).status === 200,
    'the same link, same device, never makes a second key');   // the retry path: it must not replace the key he already filed away
  ok((await call('POST', '/admin/recover/claim', { token: tokA, nonce: 'z' })).status === 410
    && (await call('GET', '/admin/venues', undefined, { 'X-Owner-Key': key1 })).status === 200,
    'an older link still in flight cannot replace it either');
  // changing the address retires the links sent to the old one, and tells it
  const tokC = await freshLink('owner@example.com');
  m.delete('rlmail:ownerset:owner2@example.com');
  await setAddress('owner2@example.com');
  ok((await call('POST', '/admin/recover/claim', { token: tokC, nonce: 'd3' })).status === 410, 'a link sent to the old address stops when the address changes');
  ok(sent.filter(x => x.to === 'owner@example.com').some(x => /άλλαξε/.test(x.subject)), 'the old address is told about the change');
  ok((await call('PATCH', '/admin/owner', { lang: 'en' }, OWN)).d.email === 'owner2@example.com', 'a PATCH with only a language keeps the address');
  // the mail limits: 3 an hour and 8 a day for the same address
  m.delete('rlmail:owner:owner2@example.com'); m.delete('rlmailday:owner:owner2@example.com');
  const links = () => sent.filter(x => x.to === 'owner2@example.com' && RECOVER.test(x.text)).length;
  before = links();
  for (let i = 0; i < 5; i++) await call('POST', '/admin/recover', { email: 'owner2@example.com' });
  ok(links() - before === 3, 'at most 3 recovery mails an hour', links() - before);
  for (let round = 0; round < 3; round++) { m.delete('rlmail:owner:owner2@example.com'); for (let i = 0; i < 3; i++) await call('POST', '/admin/recover', { email: 'owner2@example.com' }); }
  ok(links() - before === 8, 'and at most 8 a day, however the hours are spread', links() - before);
  // revoking
  const key2 = (await call('POST', '/admin/recover/claim', { token: await freshLink('owner2@example.com'), nonce: 'd4' })).d.key;
  ok((await call('DELETE', '/admin/owner/key', undefined, OWN)).d.hasRecoveryKey === false
    && (await call('GET', '/admin/venues', undefined, { 'X-Owner-Key': key2 })).status === 403, 'the admin can revoke the mailed key');
  const key3 = (await call('POST', '/admin/recover/claim', { token: await freshLink('owner2@example.com'), nonce: 'd5' })).d.key;
  ok((await call('DELETE', '/admin/owner/key', undefined, { 'X-Owner-Key': key3 })).status === 409, 'the mailed key cannot throw itself away');
  const savedOwner = env.OWNER_KEY; env.OWNER_KEY = '';
  ok((await call('GET', '/admin/venues', undefined, { 'X-Owner-Key': key3 })).status === 200, 'without a server key the mailed key still opens the console');
  ok((await call('DELETE', '/admin/owner/key', undefined, { 'X-Owner-Key': key3 })).status === 409, 'it refuses to revoke the only way in');
  env.OWNER_KEY = savedOwner;
  // the sender going down must not strand a link that is already in his mailbox
  const tokD = await freshLink('owner2@example.com');
  delete env.MAIL;
  ok((await call('POST', '/admin/recover', { email: 'owner2@example.com' })).status === 503, 'with the sender off no new link is issued');
  r = await call('POST', '/admin/recover/claim', { token: tokD, nonce: 'd6' });
  ok(r.status === 200 && r.d.key && (await call('GET', '/admin/venues', undefined, { 'X-Owner-Key': r.d.key })).status === 200, 'but a link already sent still opens the console');
  ok((await call('PUT', '/admin/owner', { email: '' }, OWN)).d.email === '', 'the address can be removed without a confirmation');
  ok((await call('PUT', '/admin/owner', { email: 'x@y.gr' }, OWN)).status === 503, 'and a new one cannot be set while the sender is off — it could not be confirmed');
}
// ---------- 11. Amelie: the couple's RSVP link — connect, pull (the server only fetches), disconnect ----------
// A fake Amelie is injected (env.AMELIE_FETCH); the real network is switched off for the whole section.
{
  const realFetch = globalThis.fetch; let netCalls = 0;
  globalThis.fetch = async () => { netCalls++; throw new Error('no real network in tests'); };
  const logs = [], orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => { logs.push(a.map(x => (x && x.stack) || String(x)).join(' ')); orig[k](...a); };
  const bodies = [];   // every response body of this section, as sent
  async function acall(method, url, body, headers = {}) {
    const r = await worker.fetch(new Request('http://t' + url, { method, headers: { 'Content-Type': 'application/json', ...NEW, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), env);
    const text = await r.text(); bodies.push(text);
    let d = null; try { d = JSON.parse(text); } catch (e) {}
    return { status: r.status, d, h: r.headers };
  }
  const KEYS = [], newKey = () => { const k = 'k_' + crypto.randomUUID().replace(/-/g, '') + '-Z'; KEYS.push(k); return k; };
  const guestsOf = (n, pad = '') => Array.from({ length: n }, (_, i) => ({ name: (i ? 'Γιώργος Π. (συνοδός ' + i + ')' : 'Γιώργος Π.') + pad, party: 'Γιώργος Π.', status: 'confirmed', note: 'Amelie: Θα είμαι εκεί', srcId: 'amelie:am_0123456789abcdef:' + (i + 1) }));
  const mkDoc = (version, n, pad) => ({ ok: true, format: 'amelie-guests/1', version, generated_at: '2026-09-22T10:00:00Z',
    invitation: { names: { a: 'Μαρία', b: 'Νίκος' }, date: '2027-06-12', status: 'live', rsvp_open: true },
    options: [{ key: 'all', label: 'Θα είμαι εκεί', attending: 'yes' }],
    totals: { parties: 1, answers: 1, people_yes: n, people_ceremony: 0, people_unknown: 0, parties_no: 0 },
    parties: [{ id: 'am_0123456789abcdef', name: 'Γιώργος Π.', named: true, count: n, choice: 'all', label: 'Θα είμαι εκεί', attending: 'yes', people: n, answers: 1, first_at: '2026-09-20T10:00:00Z', updated_at: '2026-09-21T10:00:00Z' }],
    importGuests: guestsOf(n, pad) });
  const jres = (obj, status = 200, headers = {}) => new Response(typeof obj === 'string' ? obj : JSON.stringify(obj), { status, headers: { 'Content-Type': 'application/json', ...headers } });
  const amelie = new Map();   // the fake Amelie's links: key → document
  const liveAmelie = (url, init) => { const b = JSON.parse(init.body), d = amelie.get(b.token);
    if (!d) return jres({ ok: false, error: 'not_found' }, 404);
    return (b.since && b.since === d.version) ? jres({ ok: true, unchanged: true, version: d.version }) : jres(d); };
  const up = { calls: [], handler: null };
  env.AMELIE_FETCH = async (url, init) => { up.calls.push({ url, init, body: JSON.parse(init.body) }); return (up.handler || liveAmelie)(url, init); };
  const upN = () => up.calls.length;
  const pastWindow = id => patchRaw('plan:' + id, o => { if (o.amelie && o.amelie.callAt) o.amelie.callAt -= 61000; });   // the minute since the last call has passed
  const pull = (id, h, since) => acall('POST', '/plans/' + id + '/amelie/pull', since === undefined ? {} : { since }, h);
  const connect = (id, h, link) => acall('PUT', '/plans/' + id + '/amelie', { link }, h);
  m.delete('meta:amelie-new');

  const P = (await acall('POST', '/plans', { name: 'Amelie', plan: layout({ guests: { g1: { name: 'Χάρτινο' } } }) }, OWN)).d;
  const HP = { 'X-Edit-Key': P.editKey }, HV = { 'X-View-Key': P.readKey };
  let r = await acall('GET', '/plans/' + P.id, undefined, HP);
  ok(r.d.amelie && r.d.amelie.connected === false && r.d.amelie.dead === false && r.d.amelie.lastPullAt === null, 'amelie: a writer sees «not connected»', r.d.amelie);
  ok(!('amelie' in (await acall('GET', '/plans/' + P.id, undefined, HV)).d), 'amelie: a viewer is not even told whether a link exists');
  r = await pull(P.id, HP);
  ok(r.status === 412 && r.d.error === 'not_connected' && upN() === 0, 'amelie: a pull without a link → 412, nobody called');

  // ---- the link: only amelie.gr/g/#<key> or the bare key; junk is refused before anything happens ----
  const K1 = newKey(), good = 'https://amelie.gr/g/#' + K1;
  const junk = ['', '   ', 'hello', K1.slice(0, 21), K1 + 'x'.repeat(40), 'http://amelie.gr/g/#' + K1, 'https://amelie.gr/g/' + K1, 'https://amelie.gr/g/#' + K1 + '?x=1',
    'https://amelie.gr/g/#' + K1 + '/', 'https://amelie.gr.evil.example/g/#' + K1, 'https://evil.example/g/#' + K1, 'https://evil.example/?u=https://amelie.gr/g/#' + K1,
    'HTTPS://AMELIE.GR/g/#' + K1, 'https://amelie.gr/g/#' + K1.replace('_', ' '), 'https://amelie.gr/api/guests', 'javascript:alert(1)', 'https://user@amelie.gr/g/#' + K1,
    'https://amelie.gr:444/g/#' + K1, 'https://amelie.gr/g/#' + K1 + '#more', K1 + '\n' + K1, 'https://amelie.gr/g/#' + K1.slice(0, 20) + '%41%41', '<' + K1 + '>', 'k'.repeat(250), 12345, null, true, { link: good }, [good]];
  let bad = 0;
  for (const link of junk) { r = await connect(P.id, HP, link); if (r.status === 400 && r.d.error === 'bad_link') bad++; else ok(false, 'amelie: junk refused — ' + JSON.stringify(link), r); }
  ok(bad === junk.length && (await acall('PUT', '/plans/' + P.id + '/amelie', {}, HP)).status === 400, 'amelie: every junk link (' + junk.length + ' kinds, and none at all) → 400 bad_link');
  ok(upN() === 0 && !raw('plan:' + P.id).amelie, 'amelie: … with no call to Amelie and nothing stored');
  // who may connect: whoever writes guest names — never a view link, a missing or wrong key, a retired device link
  ok((await connect(P.id, HV, good)).status === 403, 'amelie: a view link cannot connect (403)');
  ok((await connect(P.id, {}, good)).status === 401 && (await connect(P.id, { 'X-Edit-Key': 'wrong' }, good)).status === 403, 'amelie: no key → 401, a wrong key → 403');
  await acall('POST', '/codes/ameliedevicecode1', { id: P.id }, HP);
  const HS = { 'X-Sync-Code': 'ameliedevicecode1' };
  m.set('code:amelieretiredcode', JSON.stringify({ plans: [{ id: P.id, role: 'couple', gen: 1, name: 'x', updated: 1 }] }));   // linked before a key reset
  const HSold = { 'X-Sync-Code': 'amelieretiredcode' };
  ok((await connect(P.id, HSold, good)).status === 403 && (await pull(P.id, HSold)).status === 403 && (await acall('DELETE', '/plans/' + P.id + '/amelie', undefined, HSold)).status === 403, 'amelie: a device link from before a key reset → 403 everywhere');
  ok(!raw('plan:' + P.id).amelie && upN() === 0, 'amelie: still nothing stored, nobody called');

  // ---- connect ----
  const upd0 = raw('plan:' + P.id).updated, plan0 = JSON.stringify(raw('plan:' + P.id).plan);
  r = await connect(P.id, HP, '  ' + good + '\n');
  ok(r.status === 200 && r.d.amelie.connected === true && r.d.amelie.dead === false && r.d.amelie.lastPullAt === null && r.d.amelie.at > 0 && Object.keys(r.d.amelie).sort().join() === 'at,connected,dead,lastPullAt', 'amelie: the couple connects (a pasted link with spaces around it)', r.d);
  ok(raw('plan:' + P.id).amelie.key === K1 && raw('plan:' + P.id).amelie.by === 'couple' && upN() === 0, 'amelie: the key is kept on the plan record — connecting calls nobody');
  ok(raw('plan:' + P.id).updated === upd0 && JSON.stringify(raw('plan:' + P.id).plan) === plan0, 'amelie: connecting is not a change to the plan (updated and plan JSON untouched)');
  r = await acall('GET', '/plans/' + P.id, undefined, HP);
  ok(r.d.amelie.connected === true && r.d.audit.some(e => e.what === 'amelie' && e.who === 'couple'), 'amelie: GET says connected, and the access log shows who connected it');
  ok(!('amelie' in (await acall('GET', '/plans/' + P.id, undefined, HV)).d), 'amelie: still nothing for the viewer');
  ok((await connect(P.id, HP, K1)).status === 200 && raw('plan:' + P.id).amelie.key === K1, 'amelie: the bare key is accepted too');

  // ---- pull: the document, from the one constant address ----
  amelie.set(K1, mkDoc('aaaaaaaaaaa1', 3));
  r = await pull(P.id, HP);
  const c0 = up.calls[0];
  ok(r.status === 200 && r.d.doc && r.d.doc.format === 'amelie-guests/1' && r.d.doc.version === 'aaaaaaaaaaa1' && r.d.doc.importGuests.length === 3 && r.d.doc.importGuests[2].srcId === 'amelie:am_0123456789abcdef:3', 'amelie: pull → {doc} for the planner to merge', r.d);
  ok(upN() === 1 && c0.url === 'https://amelie.gr/api/guests' && c0.init.method === 'POST' && c0.init.redirect === 'manual' && c0.init.signal && c0.init.headers['Content-Type'] === 'application/json'
    && c0.body.token === K1 && c0.body.format === 'json' && !('since' in c0.body) && Object.keys(c0.body).length === 2, 'amelie: one call to the constant address — POST JSON {token, format}, redirects off, a deadline', { url: c0.url, body: Object.keys(c0.body) });
  ok(raw('plan:' + P.id).updated === upd0 && JSON.stringify(raw('plan:' + P.id).plan) === plan0, 'amelie: the server never merges — updated and the plan JSON stay as they were');
  const am1 = raw('plan:' + P.id).amelie;
  ok(am1.lastVersion === 'aaaaaaaaaaa1' && am1.lastPullAt > 0 && am1.ok === true && !am1.dead, 'amelie: the server remembers the version Amelie confirmed');
  ok((await acall('GET', '/plans/' + P.id, undefined, HP)).d.amelie.lastPullAt === am1.lastPullAt, 'amelie: GET shows when it was last pulled');
  // the planner's own save right after a pull is not a conflict
  r = await acall('PUT', '/plans/' + P.id, { plan: layout({ guests: { g1: { name: 'Χάρτινο' }, g2: { name: 'Γιώργος Π.', srcId: 'amelie:am_0123456789abcdef:1' } } }), baseUpdated: upd0 }, HP);
  ok(r.status === 200, 'amelie: the planner saves its merge with baseUpdated — no 409 caused by the pull', r.d);
  const upd1 = r.d.updated;

  // ---- one upstream call per plan per minute, however many devices ask ----
  r = await pull(P.id, HS, 'aaaaaaaaaaa1');
  ok(r.status === 200 && r.d.unchanged === true && r.d.version === 'aaaaaaaaaaa1' && upN() === 1, 'amelie: a second device inside the minute, up to date → «unchanged» from the server, Amelie not asked');
  r = await pull(P.id, HS, 'older0000000');
  ok(r.status === 200 && r.d.doc && r.d.doc.version === 'aaaaaaaaaaa1' && upN() === 1, 'amelie: a device with an older version gets the list the server just fetched — still one call');
  pastWindow(P.id);
  amelie.set(K1, mkDoc('bbbbbbbbbbb2', 4));
  let release = null; up.handler = (url, init) => new Promise(res => { release = () => res(liveAmelie(url, init)); });
  let n0 = upN();
  const many = [pull(P.id, HP, 'aaaaaaaaaaa1'), pull(P.id, HS, 'aaaaaaaaaaa1'), pull(P.id, HP), pull(P.id, HS, 'aaaaaaaaaaa1'), pull(P.id, HP, 'aaaaaaaaaaa1')];
  await new Promise(res => setTimeout(res, 30));
  ok(upN() === n0 + 1 && typeof release === 'function', 'amelie: five devices at once, Amelie slow → asked exactly once', upN() - n0);
  release(); up.handler = null;
  const got = await Promise.all(many);
  ok(got.every(x => x.status === 200 && x.d.doc && x.d.doc.version === 'bbbbbbbbbbb2' && x.d.doc.importGuests.length === 4) && upN() === n0 + 1, 'amelie: … and all five get the new list from that one call', got.map(x => x.status));
  pastWindow(P.id);
  r = await pull(P.id, HP, 'bbbbbbbbbbb2');
  ok(r.status === 200 && r.d.unchanged === true && upN() === n0 + 2 && up.calls.at(-1).body.since === 'bbbbbbbbbbb2', 'amelie: a minute later Amelie is asked again, with since — and says «unchanged»');
  // inside the minute with nothing in this process's memory (another process, a restart): only what the record knows
  patchRaw('plan:' + P.id, o => { o.amelie.callAt = Date.now() - 1000; });
  n0 = upN();
  r = await pull(P.id, HP, 'bbbbbbbbbbb2');
  ok(r.status === 200 && r.d.unchanged === true && upN() === n0, 'amelie: inside the minute, no memory → «unchanged» for an up-to-date device');
  r = await pull(P.id, HP, 'zzzzzzzzzzzz');
  ok(r.status === 429 && r.d.error === 'amelie_busy' && r.d.retryAfter >= 55 && r.d.retryAfter <= 60 && r.h.get('Retry-After') === String(r.d.retryAfter) && upN() === n0, 'amelie: … otherwise «wait N s» (body + Retry-After) — never a second call inside the minute', r.d);
  pastWindow(P.id);
  for (const since of ['../../etc', 'a b', 'x'.repeat(65), 42, { $gt: '' }]) { await pull(P.id, HP, since); pastWindow(P.id); }
  ok(upN() === n0 + 5 && up.calls.slice(-5).every(c => !('since' in c.body)), 'amelie: a malformed since is never forwarded');

  // ---- only the fields of amelie-guests/1 reach the browser ----
  const extra = mkDoc('ccccccccccc3', 2);
  Object.assign(extra, { diet: 'vegan', wishes: 'Να ζήσετε!' }); Object.assign(extra.importGuests[0], { allergy: 'nuts', email: 'guest@example.com', status: 'confirmed', note: 'Amelie: Θα είμαι εκεί' });
  extra.parties[0].phone = '6977000000'; extra.invitation.secret = 'hidden'; extra.importGuests.push('junk', null, [1], { name: 5, srcId: 'amelie:am_x:9' });
  amelie.set(K1, extra);
  r = await pull(P.id, HP, 'bbbbbbbbbbb2');
  const ds = JSON.stringify(r.d && r.d.doc);
  ok(r.status === 200 && r.d.doc.version === 'ccccccccccc3' && !/vegan|Να ζήσετε|nuts|guest@example|6977000000|hidden/.test(ds) && r.d.doc.importGuests.length === 3
    && Object.keys(r.d.doc.importGuests[0]).sort().join() === 'name,note,party,srcId,status' && !('name' in r.d.doc.importGuests[2]) && r.d.doc.invitation.names.a === 'Μαρία', 'amelie: unknown fields (diet, wishes, e-mail, phone) and non-objects are dropped — only amelie-guests/1 fields pass', r.d && r.d.doc);
  // a list just under 1 MB passes; one just over does not
  pastWindow(P.id);
  const nearly = mkDoc('ddddddddddd4', 3000, ' '.repeat(150)), nearlyBytes = Buffer.byteLength(JSON.stringify(nearly));
  ok(nearlyBytes > 1000000 && nearlyBytes < 1048576, 'amelie: (test data: a document of ' + nearlyBytes + ' bytes, just under 1 MiB)');
  amelie.set(K1, nearly);
  r = await pull(P.id, HP, 'ccccccccccc3');
  ok(r.status === 200 && r.d.doc.importGuests.length === 3000, 'amelie: a big list under 1 MB comes through (the cap counts bytes)');

  // ---- every way Amelie can fail → 502 amelie_unreachable, nothing marked, the link keeps working ----
  const failWith = async (label, handler, extraCheck) => {
    pastWindow(P.id); up.handler = handler; const n1 = upN(), t0 = Date.now();
    const x = await pull(P.id, HP, 'ddddddddddd4'); up.handler = null;
    const am = raw('plan:' + P.id).amelie;
    ok(x.status === 502 && x.d.error === 'amelie_unreachable' && upN() === n1 + 1 && !am.dead && !am.retryAt && am.ok && (!extraCheck || extraCheck(Date.now() - t0)), 'amelie: ' + label + ' → 502 amelie_unreachable, the link stays connected', x.d);
  };
  // (the failing answers below carry a perfectly good document wherever they can: only the rule under test may refuse them)
  const goodDoc = JSON.stringify(mkDoc('eeeeeeeeeee5', 1));
  for (const s of [301, 302, 303, 307, 308]) await failWith('a ' + s + ' redirect (never followed)', () => new Response(goodDoc, { status: s, headers: { Location: 'https://evil.example/steal', 'Content-Type': 'application/json' } }));
  for (const s of [500, 502, 503, 400, 401, 403, 201, 204]) await failWith('HTTP ' + s, () => new Response(s === 204 ? null : goodDoc, { status: s }));
  await failWith('an HTML 404 (not Amelie\'s own «not_found»)', () => new Response('<html>404</html>', { status: 404, headers: { 'Content-Type': 'text/html' } }));
  await failWith('a 404 with some other error', () => jres({ ok: false, error: 'maintenance' }, 404));
  await failWith('bad JSON', () => new Response('{"ok":true, "format": "amelie-guests/1", ', { status: 200 }));
  await failWith('an empty body', () => new Response(null, { status: 200 }));
  await failWith('JSON that is not amelie-guests/1', () => jres({ ok: true, hello: 'world' }));
  await failWith('a document without a list', () => jres({ ...mkDoc('eeeeeeeeeee5', 1), importGuests: 'nope' }));
  await failWith('a document with a bad version', () => jres({ ...mkDoc('eeeeeeeeeee5', 1), version: 'v 1/../2' }));
  await failWith('the network failing', () => { throw new TypeError('fetch failed'); });
  // a valid document followed by whitespace (still valid JSON), streamed in 64 KB chunks
  const bigBody = (bytes, headers = {}) => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(goodDoc)); for (let left = bytes; left > 0; left -= 65536) c.enqueue(new Uint8Array(Math.min(65536, left)).fill(32)); c.close(); } }), { status: 200, headers });
  ok(JSON.parse(new TextDecoder().decode(new Uint8Array(await bigBody(1100000).arrayBuffer()))).version === 'eeeeeeeeeee5', 'amelie: (test data: the oversized bodies are valid JSON — only the byte cap can refuse them)');
  await failWith('a body over 1 MB, no Content-Length', () => bigBody(1100000));
  await failWith('a body over 1 MB that claims Content-Length: 100', () => bigBody(2000000, { 'Content-Length': '100' }));
  await failWith('a declared Content-Length over 1 MB', () => new Response(goodDoc, { status: 200, headers: { 'Content-Length': '5000000' } }));
  await failWith('valid JSON over 1 MB', () => jres(mkDoc('eeeeeeeeeee5', 4000, ' '.repeat(150))));
  env.AMELIE_TIMEOUT_MS = 150;
  await failWith('no answer at all (timeout)', (url, init) => new Promise((res, rej) => init.signal.addEventListener('abort', () => rej(new Error('aborted')))), ms => ms < 2000);
  await failWith('an answer that ignores the abort (timeout)', () => new Promise(() => {}), ms => ms < 2000);
  await failWith('headers, then a body that never ends (timeout)', () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('{"ok":')); } }), { status: 200 }), ms => ms < 2000);
  delete env.AMELIE_TIMEOUT_MS;
  ok(logs.some(l => /amelie: pull failed \(timeout\)/.test(l)) && logs.some(l => /amelie: pull failed \(redirect\)/.test(l)) && logs.some(l => /amelie: pull failed \(too large\)/.test(l)), 'amelie: each failure is logged by kind');
  // a failure inside the minute is not retried: the next device hears the same, Amelie is not asked
  n0 = upN();
  r = await pull(P.id, HS, 'somethingold');
  ok(r.status === 502 && upN() === n0, 'amelie: right after a failure another device gets 502 from the server — no second call');
  r = await pull(P.id, HS, 'ddddddddddd4');
  ok(r.status === 200 && r.d.unchanged === true && upN() === n0, 'amelie: … and an up-to-date device just hears «unchanged»');

  // ---- 429 from Amelie: Retry-After is honoured ----
  pastWindow(P.id);
  up.handler = () => jres({ ok: false, error: 'rate_limited' }, 429, { 'Retry-After': '120' });
  r = await pull(P.id, HP, 'ddddddddddd4'); up.handler = null;
  const ra = raw('plan:' + P.id).amelie.retryAt;
  ok(r.status === 429 && r.d.error === 'amelie_busy' && r.d.retryAfter === 120 && r.h.get('Retry-After') === '120' && ra > Date.now() + 115000 && ra <= Date.now() + 120000, 'amelie: Amelie says 429 Retry-After 120 → 429 amelie_busy, retryAfter 120, stored', r.d);
  n0 = upN();
  pastWindow(P.id);
  r = await pull(P.id, HP, 'ddddddddddd4');
  ok(r.status === 429 && r.d.retryAfter > 100 && r.d.retryAfter <= 120 && upN() === n0, 'amelie: until then every pull is answered by the server — Amelie is not asked', r.d);
  r = await pull(P.id, HS);
  ok(r.status === 429 && upN() === n0, 'amelie: from any device');
  patchRaw('plan:' + P.id, o => { o.amelie.retryAt = Date.now() - 1; });
  r = await pull(P.id, HP, 'ddddddddddd4');
  ok(r.status === 200 && r.d.unchanged === true && upN() === n0 + 1 && !raw('plan:' + P.id).amelie.retryAt, 'amelie: once the time is up Amelie is asked again');
  const retryCase = async (h, lo, hi, label) => { pastWindow(P.id); up.handler = () => new Response('', { status: 429, headers: h }); const x = await pull(P.id, HP, 'ddddddddddd4'); up.handler = null;
    ok(x.status === 429 && x.d.retryAfter >= lo && x.d.retryAfter <= hi, 'amelie: ' + label, x.d); patchRaw('plan:' + P.id, o => { o.amelie.retryAt = null; }); };
  await retryCase({ 'Retry-After': new Date(Date.now() + 90000).toUTCString() }, 85, 91, 'Retry-After as an HTTP date');
  await retryCase({}, 60, 60, 'no Retry-After → wait 60 s');
  await retryCase({ 'Retry-After': '99999999' }, 86400, 86400, 'an absurd Retry-After is capped at one day');
  await retryCase({ 'Retry-After': 'soon' }, 60, 60, 'an unreadable Retry-After → 60 s');

  // ---- 404 not_found: the link is dead — marked, and never asked about again ----
  pastWindow(P.id);
  amelie.delete(K1);   // the couple rotated / revoked the link on Amelie
  const planBeforeGone = JSON.stringify(raw('plan:' + P.id).plan);
  r = await pull(P.id, HP, 'ddddddddddd4');
  ok(r.status === 404 && r.d.error === 'amelie_gone' && raw('plan:' + P.id).amelie.dead === true, 'amelie: Amelie says not_found → 404 amelie_gone, the link is marked dead', r.d);
  ok(JSON.stringify(raw('plan:' + P.id).plan) === planBeforeGone && raw('plan:' + P.id).updated === upd1, 'amelie: everyone already imported stays — the plan is untouched');
  n0 = upN();
  for (let i = 0; i < 4; i++) { pastWindow(P.id); patchRaw('plan:' + P.id, o => { o.amelie.callAt = 1; }); r = await pull(P.id, i % 2 ? HS : HP, 'ddddddddddd4'); if (r.status !== 404 || r.d.error !== 'amelie_gone') ok(false, 'amelie: dead stays dead', r); }
  ok(upN() === n0, 'amelie: however often and from whichever device, a dead link never reaches Amelie again');
  r = await acall('GET', '/plans/' + P.id, undefined, HP);
  ok(r.d.amelie.connected === true && r.d.amelie.dead === true, 'amelie: GET shows the link as expired', r.d.amelie);
  r = await connect(P.id, HP, good);
  ok(r.status === 200 && r.d.amelie.dead === true && (await pull(P.id, HP)).status === 404 && upN() === n0, 'amelie: pasting the SAME dead link again keeps it dead — still no call');
  const K2 = newKey(); amelie.set(K2, mkDoc('fffffffffff6', 2));
  r = await connect(P.id, HP, 'https://amelie.gr/g/#' + K2);
  const am2 = raw('plan:' + P.id).amelie;
  ok(r.status === 200 && r.d.amelie.dead === false && r.d.amelie.lastPullAt === null && am2.key === K2 && am2.lastVersion === null && !am2.dead && !am2.ok && !am2.callAt, 'amelie: a NEW link clears dead / lastVersion');
  r = await pull(P.id, HP, 'ddddddddddd4');
  ok(r.status === 200 && r.d.doc.version === 'fffffffffff6' && upN() === n0 + 1 && up.calls.at(-1).body.token === K2, 'amelie: … and the new link is pulled at once');
  // a link replaced / removed while Amelie is still answering about the old one
  const slow = answer => { release = null; up.handler = (url, init) => new Promise(res => { release = () => res(answer(url, init)); }); };
  const tick = () => new Promise(res => setTimeout(res, 30));
  pastWindow(P.id); slow(() => jres({ ok: false, error: 'not_found' }, 404));
  let inflight = pull(P.id, HP, 'fffffffffff6'), coalesced; await tick();
  coalesced = pull(P.id, HS, 'fffffffffff6'); await tick();
  const K2b = newKey(); amelie.set(K2b, mkDoc('fffffffffff7', 2));
  ok((await connect(P.id, HP, K2b)).status === 200, 'amelie: (a new link is pasted while Amelie is still answering about the old one)');
  release(); up.handler = null; r = await inflight; const r2 = await coalesced;
  ok(r.status === 429 && r.d.retryAfter === 1 && r2.status === 429 && raw('plan:' + P.id).amelie.key === K2b && !raw('plan:' + P.id).amelie.dead, 'amelie: the old link\'s «not_found» never lands on the new one — the devices are told to ask again at once', [r.d, r2.d]);
  n0 = upN();
  r = await pull(P.id, HP, 'fffffffffff6');
  ok(r.status === 200 && r.d.doc.version === 'fffffffffff7' && upN() === n0 + 1 && up.calls.at(-1).body.token === K2b, 'amelie: … and asking again pulls the new link straight away');
  pastWindow(P.id); slow(liveAmelie);
  inflight = pull(P.id, HP, 'aaaaaaaaaaa1'); await tick();
  ok((await acall('DELETE', '/plans/' + P.id + '/amelie', undefined, HP)).status === 200, 'amelie: (disconnected while Amelie is answering)');
  release(); up.handler = null; r = await inflight;
  ok(r.status === 412 && r.d.error === 'not_connected' && !raw('plan:' + P.id).amelie, 'amelie: … → 412 not_connected, and nothing is written back', r.d);
  await connect(P.id, HP, K2b);

  // ---- read-only phases: 409 not_writable, nobody called; a disconnect is always allowed ----
  const phase = async (label, patch, H, unpatch) => {
    patchRaw('plan:' + P.id, patch); pastWindow(P.id); const n1 = upN();
    const x = await pull(P.id, H, 'fffffffffff6'), y = await connect(P.id, H, 'https://amelie.gr/g/#' + K2), g = await acall('GET', '/plans/' + P.id, undefined, H);
    ok(x.status === 409 && x.d.error === 'not_writable' && y.status === 409 && y.d.error === 'not_writable' && upN() === n1 && g.d.amelie && g.d.amelie.connected, 'amelie: ' + label + ' → pull and connect 409 not_writable, no call (GET still shows the link)', [x.d, y.d]);
    patchRaw('plan:' + P.id, unpatch);
  };
  await phase('waiting out the withdrawal period', o => { o.opensAt = Date.now() + 86400000; }, HP, o => { delete o.opensAt; });
  await phase('frozen after a date change', o => { o.frozenUntil = Date.now() + 86400000; }, HP, o => { delete o.frozenUntil; });
  await phase('after the wedding (locked)', o => { o.weddingDate = athensDay(-2); }, HP, o => { delete o.weddingDate; });
  pastWindow(P.id);
  ok((await pull(P.id, HP, 'fffffffffff6')).status === 200, 'amelie: open again → pulls again');

  // ---- roles on a venue wedding: the venue, its console, the couple (names phase), support ----
  const VA = (await acall('POST', '/admin/venues', { name: 'Amelie Κτήμα', license: { type: 'per_wedding', quota: 5 } }, OWN)).d, HVC = { 'X-Venue-Key': VA.key };
  const WV = (await acall('POST', '/venues/' + VA.id + '/weddings', { label: 'Amelie γάμος', date: athensDay(60) }, HVC)).d;
  const K3 = newKey(); amelie.set(K3, mkDoc('aaaa0000bbb1', 2));
  ok((await acall('GET', '/plans/' + WV.planId, undefined, { 'X-Edit-Key': WV.editKey })).d.life.phase === 'names', 'amelie: (a venue wedding 60 days out: the couple is in the names phase)');
  r = await connect(WV.planId, { 'X-Edit-Key': WV.venueKey }, 'https://amelie.gr/g/#' + K3);
  ok(r.status === 200 && raw('plan:' + WV.planId).amelie.by === 'venue', 'amelie: the venue can connect its couple\'s link');
  ok((await pull(WV.planId, { 'X-Edit-Key': WV.editKey })).status === 200, 'amelie: the couple of a venue wedding pulls in the names phase (guest names are theirs)');
  pastWindow(WV.planId);
  ok((await pull(WV.planId, HVC, 'aaaa0000bbb1')).d.unchanged === true, 'amelie: the venue console key pulls too');
  ok((await pull(WV.planId, { 'X-View-Key': raw('plan:' + WV.planId).readKey })).status === 403, 'amelie: the wedding\'s view link cannot');
  ok(!('amelie' in (await acall('GET', '/plans/' + WV.planId, undefined, { 'X-View-Key': raw('plan:' + WV.planId).readKey })).d), 'amelie: and does not see the status');
  await acall('POST', '/plans/' + WV.planId + '/support', { hours: 1 }, { 'X-Edit-Key': WV.venueKey });
  const HSUP = { 'X-Support-Key': raw('plan:' + WV.planId).support.key };
  pastWindow(WV.planId);
  ok((await pull(WV.planId, HSUP, 'aaaa0000bbb1')).status === 200 && (await acall('GET', '/plans/' + WV.planId, undefined, HSUP)).d.amelie.connected, 'amelie: support pulls while its grant is open');
  patchRaw('plan:' + WV.planId, o => { o.support.expires = Date.now() - 1; });
  ok((await pull(WV.planId, HSUP)).status === 403 && (await connect(WV.planId, HSUP, 'https://amelie.gr/g/#' + K3)).status === 403, 'amelie: an expired grant cannot');
  patchRaw('plan:' + WV.planId, o => { o.weddingDate = athensDay(-3); });
  pastWindow(WV.planId);
  ok((await pull(WV.planId, HVC)).status === 409 && (await pull(WV.planId, { 'X-Edit-Key': WV.venueKey })).status === 409, 'amelie: a locked venue wedding → 409 for the venue as well');
  ok((await acall('DELETE', '/plans/' + WV.planId + '/amelie', undefined, HVC)).status === 200 && !raw('plan:' + WV.planId).amelie, 'amelie: but the venue can still disconnect it');
  const TV = (await acall('POST', '/venues/' + VA.id + '/template', {}, HVC)).d;
  ok((await connect(TV.planId, { 'X-Edit-Key': TV.venueKey }, 'https://amelie.gr/g/#' + K3)).status === 409 && !('amelie' in (await acall('GET', '/plans/' + TV.planId, undefined, { 'X-Edit-Key': TV.venueKey })).d), 'amelie: a venue template never gets a link (no guests there) — and GET offers none');

  // ---- keys Amelie never accepted are budgeted: 5 an hour per CUSTOMER (never per plan), 15 for the whole server, the last
  // 5 kept for customers who have not tried this hour; a call Amelie accepts frees its slot ----
  m.delete('meta:amelie-new');
  const slots = () => { const o = m.has('meta:amelie-new') ? JSON.parse(m.get('meta:amelie-new')) : {}; return { o, all: Object.values(o).flat().length }; };
  const P3 = (await acall('POST', '/plans', { name: 'Typo', plan: layout() }, OWN)).d, H3 = { 'X-Edit-Key': P3.editKey };
  await connect(P3.id, H3, newKey());
  up.handler = () => jres({ ok: false }, 503);
  n0 = upN();
  for (let i = 0; i < 5; i++) { r = await pull(P3.id, H3); pastWindow(P3.id); }
  ok(r.status === 502 && upN() === n0 + 5 && slots().all === 5 && slots().o['p:' + P3.id].length === 5, 'amelie: a link Amelie never accepted: its failed calls are counted for the customer (and server-wide)', slots().o);
  r = await pull(P3.id, H3);
  ok(r.status === 429 && r.d.error === 'amelie_busy' && r.d.retryAfter > 3500 && upN() === n0 + 5, 'amelie: the 6th in an hour is refused here — Amelie\'s failed-call budget is everyone\'s', r.d);
  await acall('DELETE', '/plans/' + P3.id + '/amelie', undefined, H3); await connect(P3.id, H3, newKey());
  ok((await pull(P3.id, H3)).status === 429 && upN() === n0 + 5, 'amelie: disconnecting and pasting another link does not reset it');
  // the review's attack: extra plans (parentId) used to bring a fresh 5 each — now they share the customer's
  const X1 = (await acall('POST', '/plans', { name: 'Extra 1', plan: layout(), parentId: P3.id }, H3)).d;
  const X2 = (await acall('POST', '/plans', { name: 'Extra 2', plan: layout(), parentId: X1.id }, { 'X-Edit-Key': X1.editKey })).d;
  ok(X1.editKey && X2.editKey && raw('plan:' + X1.id).rootId === P3.id && raw('plan:' + X2.id).rootId === P3.id, 'amelie: (a plan without a licence record: its extra plans, and theirs, remember the first plan)');
  for (const X of [X1, X2]) {
    const HX = { 'X-Edit-Key': X.editKey };
    for (let i = 0; i < 5; i++) { await connect(X.id, HX, newKey()); r = await pull(X.id, HX); if (r.status !== 429) ok(false, 'amelie: an extra plan must not bring a fresh budget', r); }
  }
  ok(upN() === n0 + 5 && slots().all === 5, 'amelie: 10 junk links on two extra plans of the same customer → refused here, Amelie not called once', slots().all);
  // a different customer's real link still goes through, and its accepted call gives the slot back
  const P4 = (await acall('POST', '/plans', { name: 'Fresh', plan: layout() }, OWN)).d, H4 = { 'X-Edit-Key': P4.editKey }, K4 = newKey();
  amelie.set(K4, mkDoc('abcabcabcabc', 1)); up.handler = null;
  await connect(P4.id, H4, K4);
  r = await pull(P4.id, H4);
  ok(r.status === 200 && r.d.doc.version === 'abcabcabcabc' && upN() === n0 + 6 && raw('plan:' + P4.id).amelie.ok === true, 'amelie: another customer\'s new link goes through (the attacker only used its own 5)', r.d);
  ok(slots().all === 5 && !slots().o['p:' + P4.id], 'amelie: … and Amelie accepted it, so it does not count — only failed calls use the budget');
  // the last 5 of the 15 are for customers who have not tried this hour
  const fill = (k, t) => { const o = slots().o; o[k] = [...(o[k] || []), ...Array.from({ length: t }, (_, i) => [Date.now() - 1000 * (i + 1), 'x' + k + i])]; m.set('meta:amelie-new', JSON.stringify(o)); };
  fill('v:someVenue', 4); fill('c:someCouple', 1);   // 10 under way
  const P5 = (await acall('POST', '/plans', { name: 'Five', plan: layout() }, OWN)).d, H5 = { 'X-Edit-Key': P5.editKey };
  await connect(P5.id, H5, newKey()); up.handler = () => jres({ ok: false, error: 'not_found' }, 404);
  r = await pull(P5.id, H5);
  ok(r.status === 404 && upN() === n0 + 7 && slots().all === 11, 'amelie: at 10 under way, a customer who has not tried this hour still gets a call', r.d);
  await connect(P5.id, H5, newKey()); pastWindow(P5.id);
  r = await pull(P5.id, H5);
  ok(r.status === 429 && upN() === n0 + 7, 'amelie: … but its second try waits: a customer with one under way only while fewer than 10 are', r.d);
  for (const k of ['c:a', 'c:b', 'c:c', 'c:d']) fill(k, 1);   // 15 under way now
  const P6 = (await acall('POST', '/plans', { name: 'Six', plan: layout() }, OWN)).d, H6 = { 'X-Edit-Key': P6.editKey }, K6 = newKey();
  amelie.set(K6, mkDoc('abcabcabc666', 1)); up.handler = null;
  await connect(P6.id, H6, K6);
  r = await pull(P6.id, H6);
  ok(r.status === 429 && r.d.retryAfter > 3000 && upN() === n0 + 7, 'amelie: 15 not-yet-accepted calls server-wide in an hour → even a first try waits (Amelie allows 20 failed per IP)', r.d);
  pastWindow(P.id);
  ok((await pull(P.id, HP, 'fffffffffff6')).status === 200 && upN() === n0 + 8, 'amelie: a link Amelie already accepted is never held back by that');
  m.delete('meta:amelie-new'); pastWindow(P6.id);
  r = await pull(P6.id, H6);
  ok(r.status === 200 && r.d.doc.version === 'abcabcabc666' && raw('plan:' + P6.id).amelie.ok === true && slots().all === 0, 'amelie: once the hour frees up the new link goes through, is marked accepted and leaves no slot behind');

  // ---- new keys after a leak: a link connected with the OLD couple key goes with it ----
  const lic = (await acall('POST', '/admin/couples', { name: 'Leak', weddingDate: athensDay(10), startNow: true }, OWN)).d;
  const LC = (await acall('POST', '/claim', { token: lic.claimToken, nonce: 'leak-1' })).d, HL = { 'X-Edit-Key': LC.editKey }, KL = newKey();
  amelie.set(KL, mkDoc('1eak1eak1eak', 1));
  ok((await connect(LC.id, HL, KL)).status === 200 && raw('plan:' + LC.id).amelie.by === 'couple', 'amelie: (someone holding the couple\'s leaked key connects an invitation)');
  r = await acall('POST', '/admin/couples/' + lic.couple.id + '/reset', {}, OWN);
  const afterReset = raw('plan:' + LC.id);
  ok(r.status === 200 && !afterReset.amelie && afterReset.audit.some(e => e.who === 'admin' && e.what === 'amelie_off'), 'amelie: the admin\'s «new keys» reset drops that link too, and the access log says so', afterReset.audit);
  const LC2 = (await acall('POST', '/claim', { token: r.d.claimToken, nonce: 'leak-2' })).d, HL2 = { 'X-Edit-Key': LC2.editKey };
  n0 = upN();
  r = await pull(LC.id, HL2);
  ok(r.status === 412 && upN() === n0 && (await acall('GET', '/plans/' + LC.id, undefined, HL2)).d.amelie.connected === false, 'amelie: the couple\'s new key finds nothing connected — nobody\'s guests come in', r.d);
  await connect(LC.id, HL2, KL);
  r = await acall('POST', '/plans/' + LC.id + '/rotate', {}, HL2);
  ok(r.status === 200 && !raw('plan:' + LC.id).amelie && raw('plan:' + LC.id).audit.at(-1).what === 'amelie_off', 'amelie: the couple\'s own «new links» drop a link connected with a couple key', raw('plan:' + LC.id).audit.slice(-2));
  const WV2 = (await acall('POST', '/venues/' + VA.id + '/weddings', { label: 'Amelie γάμος 2', date: athensDay(60) }, HVC)).d;
  await connect(WV2.planId, { 'X-Edit-Key': WV2.editKey }, KL);
  r = await acall('POST', '/venues/' + VA.id + '/weddings/' + WV2.planId + '/couple-link', {}, HVC);
  ok(r.status === 200 && !raw('plan:' + WV2.planId).amelie && raw('plan:' + WV2.planId).audit.some(e => e.who === 'venue' && e.what === 'amelie_off'), 'amelie: the venue\'s new couple link drops a link the couple connected');
  await connect(WV2.planId, HVC, KL);
  r = await acall('POST', '/venues/' + VA.id + '/weddings/' + WV2.planId + '/couple-link', {}, HVC);
  ok(r.status === 200 && raw('plan:' + WV2.planId).amelie && raw('plan:' + WV2.planId).amelie.by === 'venue', 'amelie: … but not one the venue connected itself (the old couple key never had it)');

  // ---- AMELIE_API_URL (dev / tests only): a mock on this machine, never anywhere else ----
  pastWindow(P4.id); n0 = upN();
  env.AMELIE_API_URL = 'https://evil.example/api/guests';
  r = await pull(P4.id, H4);
  ok(r.status === 502 && upN() === n0, 'amelie: an AMELIE_API_URL that is not this machine → refused, nothing sent anywhere');
  pastWindow(P4.id);
  env.AMELIE_API_URL = 'http://127.0.0.1:8099/api/guests';
  r = await pull(P4.id, H4);
  ok(r.status === 200 && upN() === n0 + 1 && up.calls.at(-1).url === 'http://127.0.0.1:8099/api/guests', 'amelie: a local mock address is used');
  delete env.AMELIE_API_URL;

  // ---- disconnect ----
  ok((await acall('DELETE', '/plans/' + P4.id + '/amelie', undefined, { 'X-View-Key': P4.readKey })).status === 403 && (await acall('DELETE', '/plans/' + P4.id + '/amelie')).status === 401 && raw('plan:' + P4.id).amelie, 'amelie: a viewer (or nobody) cannot disconnect');
  r = await acall('DELETE', '/plans/' + P4.id + '/amelie', undefined, H4);
  ok(r.status === 200 && r.d.amelie.connected === false && !raw('plan:' + P4.id).amelie, 'amelie: DELETE forgets the key → {amelie:{connected:false}}', r.d);
  ok((await acall('GET', '/plans/' + P4.id, undefined, H4)).d.amelie.connected === false && raw('plan:' + P4.id).audit.some(e => e.what === 'amelie_off'), 'amelie: GET says not connected; the log shows the disconnect');
  pastWindow(P4.id); n0 = upN();
  ok((await pull(P4.id, H4)).status === 412 && upN() === n0, 'amelie: after it, a pull → 412 not_connected, nobody called');
  ok((await acall('DELETE', '/plans/' + P4.id + '/amelie', undefined, H4)).status === 200, 'amelie: disconnecting twice is fine');

  // ---- the lock forgets the key (nothing pulls a view-only plan) ----
  patchRaw('plan:' + P.id, o => { o.weddingDate = athensDay(-2); });
  await mod.sweep(env);
  ok(raw('plan:' + P.id).lockedAt && !raw('plan:' + P.id).amelie, 'amelie: when the plan locks after the wedding the Amelie key is dropped');

  // ---- the key never leaves the plan record: not in any answer, log line, plan JSON, history or other row ----
  ok(netCalls === 0, 'amelie: no real network was touched');
  const leaks = [];
  for (const K of KEYS) {
    bodies.forEach((b, i) => { if (b.includes(K)) leaks.push('response #' + i); });
    logs.forEach(l => { if (l.includes(K)) leaks.push('log: ' + l.slice(0, 80)); });
    for (const [k, v] of m) if (v.includes(K)) { const o = JSON.parse(v); if (!k.startsWith('plan:') || !o.amelie || o.amelie.key !== K || JSON.stringify({ ...o, amelie: null }).includes(K)) leaks.push('row ' + k); }
  }
  ok(KEYS.length >= 6 && bodies.length > 100 && leaks.length === 0, 'amelie: no key in any of ' + bodies.length + ' responses, ' + logs.length + ' log lines, or any stored row but its own plan record\'s amelie.key', leaks);
  for (const k of Object.keys(orig)) console[k] = orig[k];
  globalThis.fetch = realFetch; delete env.AMELIE_FETCH;
}
console.log(`\nall ${n} checks passed`);
