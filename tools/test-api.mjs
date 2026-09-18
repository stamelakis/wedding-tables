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

async function call(method, url, body, headers = {}) {
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
console.log(`\nall ${n} checks passed`);
