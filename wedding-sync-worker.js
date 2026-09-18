// TakeaSeat API (was the Cloudflare Worker for cloud sync; now runs self-hosted via server/server.mjs over SQLite KV).
// Binding: KV namespace PLANS {get, put, delete, update?, list?}. `update(key, fn)` is the atomic read-modify-write and
// `list(prefix)` the key listing the self-hosted backends offer (server.mjs also runs requests one at a time).
//
// Roles & access (2026-09-18)
// ---------------------------
// Every plan has an OWNER: a couple (bought directly) or a venue (κτήμα). The credential decides the ROLE:
//   X-Edit-Key == editKey   → couple   (couple-owned plan: full control · venue-owned plan: only what rec.perms allows)
//   X-Edit-Key == venueKey  → venue    (venue-owned plans; the per-plan key the venue console opens the planner with)
//   X-Venue-Key == console  → venue    (the owning venue's console key)
//   X-Support-Key           → support  (a time-limited grant the plan's OWNER created — the only way TakeaSeat gets in)
//   X-Sync-Code             → the role recorded when this device linked the plan, valid only for that key generation
//   X-View-Key == readKey   → viewer   (read only)
// Reads need a credential (a plan id alone is not enough; plans that existed before 2026-09-18 keep id-only reads for a
// 14-day grace). The owner key (admin) never opens a plan: the admin console sees licence metadata and the support
// invitations owners chose to send. Admin powers over a couple plan are exactly two, both visible to the couple: reset
// the access link (a lost link) and erasure. Venue locks are enforced HERE (enforcePerms); the planner only mirrors them.
//
// Routes
//   GET    /health
//   POST   /plans                 {name, plan, parentId?}  (owner key, or the edit key of a couple-owned plan)
//   GET    /plans/:id  ·  PUT /plans/:id {name?, plan?, baseUpdated?, allowWipe?}  ·  DELETE /plans/:id
//   GET    /plans/:id/history  ·  POST /plans/:id/restore {updated, allowWipe?}
//   POST   /plans/:id/support {hours, message}  ·  DELETE /plans/:id/support      (the plan's owner)
//   POST   /plans/:id/rotate      (couple of a couple-owned plan: new links, other devices signed out)
//   POST   /plans/:id/legacy-off  (end the 14-day id-only grace early)
//   POST   /claim {token, nonce}  (a couple opens the link TakeaSeat sent — once)
//   GET/POST/DELETE /codes/:code  (device linking; the code is a shared secret)
//   /admin/venues[/:id[/reset-key]] · /admin/couples[/:id[/reset]] · GET /admin/support          (X-Owner-Key)
//   /venues/:id · /rotate · /defaults · /template · /weddings[/:planId]                           (X-Venue-Key)

const CORS = {
  "Access-Control-Allow-Origin": "https://takeaseat.gr",
  "Vary": "Origin",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Key, X-Sync-Code, X-Owner-Key, X-Venue-Key, X-View-Key, X-Support-Key, X-Client",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const MAX_PLAN_BYTES = 512 * 1024;
const MIN_CODE_LEN = 12;
const SUPPORT_MAX_H = 168, SUPPORT_DEFAULT_H = 72;
const AUDIT_MAX = 50;
const CLAIM_TTL = 30 * 86400000, CLAIM_RETRY = 15 * 60000;
const LEGACY_GRACE = 14 * 86400000;
const SCHEMA = 2;

// ---- couple permissions on venue-owned plans (true = the couple may change it; maxSeats 0 = no limit) ----
const PERM_KEYS = ["floor", "decor", "layout", "tables", "seats", "labels"];
const ALL_OPEN = { floor: true, decor: true, layout: true, tables: true, seats: true, labels: true, maxSeats: 0 };
const VENUE_DEFAULT = { floor: false, decor: false, layout: false, tables: false, seats: true, labels: true, maxSeats: 0 };
function normPerms(p, fallback) {
  const o = {}; for (const k of PERM_KEYS) o[k] = (p && typeof p[k] === "boolean") ? p[k] : fallback[k];
  const m = (p && p.maxSeats != null && Number.isFinite(+p.maxSeats)) ? Math.round(+p.maxSeats) : fallback.maxSeats;
  o.maxSeats = Math.max(0, Math.min(30, m || 0));
  return o;
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function safeParse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function tooBig(v) { try { return JSON.stringify(v ?? null).length > MAX_PLAN_BYTES; } catch (e) { return true; } }
const isPlan = p => !!(p && typeof p === "object" && !Array.isArray(p) && Array.isArray(p.tables));
function eq(a, b) {   // constant-time compare; a missing or empty credential never matches anything
  if (typeof a !== "string" || typeof b !== "string" || !a || !b || a.length !== b.length) return false;
  let r = 0; for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
// Atomic read-modify-write on one key. fn(obj|null) returns: an object (write it) · null/undefined (no change) ·
// {__obj, __res} (write __obj, return __res) · {__res} (no write) · {__del:true, __res?} (delete). → {obj, res}
async function kvUpdate(env, key, fn) {
  const step = raw => {
    const cur = safeParse(raw); const out = fn(cur);
    if (out && out.__del) return { del: true, result: { obj: null, res: out.__res } };
    if (out && "__res" in out && !out.__obj) return { result: { obj: cur, res: out.__res } };
    const obj = out && out.__obj ? out.__obj : out;
    if (obj) return { value: JSON.stringify(obj), result: { obj, res: out && out.__res } };
    return { result: { obj: cur } };
  };
  if (typeof env.PLANS.update === "function") return (await env.PLANS.update(key, step)) || { obj: null };
  const s = step(await env.PLANS.get(key));   // non-atomic fallback (plain KV)
  if (s.del) await env.PLANS.delete(key); else if (s.value != null) await env.PLANS.put(key, s.value);
  return s.result;
}
function ownerOf(rec) {
  if (rec && rec.owner && rec.owner.type === "venue" && rec.owner.venueId) return { type: "venue", venueId: rec.owner.venueId };
  if (rec && rec.owner && rec.owner.type === "couple") return { type: "couple" };
  return (rec && rec.venueId) ? { type: "venue", venueId: rec.venueId } : { type: "couple" };
}
// Access log entries are codes the planner translates: invite(h) · revoke · open · save · restore · reset · claim · rotate.
function addAudit(rec, who, what, throttleMs, extra) {
  const a = Array.isArray(rec.audit) ? rec.audit : [];
  const last = a[a.length - 1];
  if (throttleMs && last && last.who === who && last.what === what && Date.now() - last.t < throttleMs) { last.n = (last.n || 1) + 1; last.last = Date.now(); rec.audit = a; return true; }
  a.push({ t: Date.now(), who, what, ...(extra || {}) }); while (a.length > AUDIT_MAX) a.shift(); rec.audit = a; return true;
}
function supportActive(rec) { return !!(rec && rec.support && typeof rec.support.key === "string" && Date.now() < rec.support.expires); }
function device(request) {   // a coarse device name for the access log — never the full user agent
  const ua = request.headers.get("User-Agent") || "";
  return /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "";
}
// Decor items the venue placed (template copies, venue saves) are the venue's; items the couple adds are the couple's.
const venueItem = (f, ownerIsVenue) => !!f && (f.by === "venue" || (f.by === undefined && ownerIsVenue));

// Who is asking? → {role, full, write, restricted, perms, owner, layoutSet} | null
async function access(request, env, id, rec) {
  const own = ownerOf(rec);
  const mk = role => {
    const restricted = role === "couple" && own.type === "venue";
    const layoutSet = !!rec.layoutAt;
    return { role, owner: own, restricted, layoutSet, write: role !== "viewer",
      full: role === "venue" || role === "support" || (role === "couple" && own.type === "couple"),
      perms: (restricted && layoutSet) ? normPerms(rec.perms, ALL_OPEN) : { ...ALL_OPEN } };
  };
  const ek = request.headers.get("X-Edit-Key") || "";
  if (ek) {
    if (eq(ek, rec.editKey)) return mk("couple");
    if (own.type === "venue" && eq(ek, rec.venueKey)) return mk("venue");
  }
  const vk = request.headers.get("X-Venue-Key") || "";
  if (vk && own.type === "venue") {
    const v = safeParse(await env.PLANS.get("venue:" + own.venueId));
    if (v && eq(vk, v.key)) return mk("venue");
  }
  const sk = request.headers.get("X-Support-Key") || "";
  if (sk && supportActive(rec) && eq(sk, rec.support.key)) return mk("support");
  const code = (request.headers.get("X-Sync-Code") || "").toLowerCase();
  if (code.length >= MIN_CODE_LEN) {
    const idx = safeParse(await env.PLANS.get("code:" + code));
    const e = idx && (idx.plans || []).find(p => p && p.id === id);
    if (e) {
      const role = (e.role === "venue" && own.type === "venue") ? "venue" : "couple";
      const gen = role === "venue" ? (rec.venueGen || 0) : (rec.keyGen || 0);
      if ((e.gen || 0) === gen) return mk(role);   // a reset / new link / venue key change retires older device links
    }
  }
  const rk = request.headers.get("X-View-Key") || "";
  if (rk && eq(rk, rec.readKey)) return mk("viewer");
  return null;
}
const CRED_HEADERS = ["X-Edit-Key", "X-Venue-Key", "X-Support-Key", "X-Sync-Code", "X-View-Key"];
const noCred = request => !CRED_HEADERS.some(h => request.headers.get(h));
function denied(request, rec) {
  if (noCred(request)) return json({ error: "key_required" }, 401);
  if (rec && rec.resetAt && Date.now() - rec.resetAt < 30 * 86400000) return json({ error: "key_reset", at: rec.resetAt }, 403);
  return json({ error: "unauthorized" }, 403);
}

// The couple of a venue plan cannot change what the venue locked: those parts come from the stored plan.
function enforcePerms(cur, next, perms, ownerIsVenue) {
  if (!isPlan(cur) || !isPlan(next)) return next;
  const out = { ...next };
  if (!perms.floor) { out.stage = cur.stage; out.stageMaterial = cur.stageMaterial; }
  const curF = Array.isArray(cur.features) ? cur.features.filter(f => f && typeof f === "object") : [];
  const nextF = Array.isArray(next.features) ? next.features.filter(f => f && typeof f === "object") : [];
  const curVenueIds = new Set(curF.filter(f => venueItem(f, ownerIsVenue)).map(f => String(f.id)));
  if (!perms.decor) {   // the venue's items stay exactly as the venue left them; the couple's own items are theirs
    out.features = curF.filter(f => venueItem(f, ownerIsVenue)).concat(nextF.filter(f => !curVenueIds.has(String(f.id))).map(f => ({ ...f, by: "couple" })));
  } else {
    const curById = new Map(curF.map(f => [String(f.id), f]));
    out.features = nextF.map(f => { const c = curById.get(String(f.id)); return { ...f, by: (c && c.by) ? c.by : (c ? (ownerIsVenue ? "venue" : "couple") : "couple") }; });
  }
  const curTables = cur.tables.filter(t => t && typeof t === "object");
  const byId = new Map(curTables.map(t => [String(t.id), t]));
  let tables = next.tables.filter(t => t && typeof t === "object").map(t => ({ ...t }));
  if (!perms.tables) {   // exactly the venue's tables, in the venue's order; a missing one comes back empty
    const nextById = new Map(tables.map(t => [String(t.id), t]));
    tables = curTables.map(ct => nextById.get(String(ct.id)) || { ...ct, seats: (Array.isArray(ct.seats) ? ct.seats : []).map(() => null) });
    tables.forEach(t => { const ct = byId.get(String(t.id)); if (ct) t.shape = ct.shape; });
  }
  for (const t of tables) {
    const ct = byId.get(String(t.id));
    if (ct) {
      if (!perms.layout) { t.x = ct.x; t.y = ct.y; if (ct.rot === undefined) delete t.rot; else t.rot = ct.rot; }
      if (!perms.labels) t.label = ct.label;
    }
    let cap = Math.min(30, Math.max(1, Math.floor(+t.capacity) || 10));   // the chair count the planner will show
    if (!perms.seats) cap = ct ? ct.capacity : Math.min(cap, 10);          // seat counts locked: a new table gets at most the default
    else if (perms.maxSeats && t.shape !== "head") cap = Math.min(cap, Math.max(perms.maxSeats, ct ? ct.capacity : 0));
    if (cap !== t.capacity) { t.capacity = cap; const s = (Array.isArray(t.seats) ? t.seats : []).slice(0, cap); while (s.length < cap) s.push(null); t.seats = s; }
  }
  out.tables = tables;
  return out;
}
// For every role: an old client can never make everyone's planner rebuild the layout (layoutVersion) or reuse ids (_uid).
const cnt = v => { v = +v; return Number.isSafeInteger(v) && v >= 0 && v <= 1e9 ? v : 0; };
function pinCounters(cur, next) {
  if (!isPlan(next)) return next;
  const c = isPlan(cur) ? cur : {};
  const lv = Math.max(cnt(c.layoutVersion), cnt(next.layoutVersion)), uid = Math.max(cnt(c._uid), cnt(next._uid));
  if (next.layoutVersion === lv && next._uid === uid) return next;
  const out = { ...next }; if (lv) out.layoutVersion = lv; else delete out.layoutVersion; if (uid) out._uid = uid; else delete out._uid; return out;
}
// A venue save: items the venue adds become the venue's; the authorship of existing items is kept.
function stampVenue(cur, next) {
  if (!isPlan(next)) return next;
  const curById = new Map((isPlan(cur) && Array.isArray(cur.features) ? cur.features : []).filter(f => f && typeof f === "object").map(f => [String(f.id), f]));
  return { ...next, features: (Array.isArray(next.features) ? next.features : []).filter(f => f && typeof f === "object").map(f => { const c = curById.get(String(f.id)); return { ...f, by: c && c.by ? c.by : "venue" }; }) };
}
const sameJSON = (a, b) => { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
// "Enforced" means a locked change was reverted — stamping who placed each decor item does not count.
const noBy = p => isPlan(p) ? { ...p, features: (Array.isArray(p.features) ? p.features : []).map(f => { if (!f || typeof f !== "object") return f; const { by, ...rest } = f; return rest; }) } : p;
const LEGACY_HEAD = /^💑\s*(νυφικό τραπέζι|head table|brauttisch)$/i;
const clampLabels = p => isPlan(p) ? { ...p,
  tables: p.tables.map(t => (t && typeof t === "object") ? { ...t, label: (l => (t.shape === "head" && LEGACY_HEAD.test(l)) ? l.replace(/^💑\s*/, "") : l)(String(t.label ?? "").slice(0, 60)) } : t),
  features: (Array.isArray(p.features) ? p.features : []).map(f => (f && typeof f === "object" && f.label != null) ? { ...f, label: String(f.label).slice(0, 80) } : f) } : p;
const reverted = (e, p) => !sameJSON(noBy(clampLabels(e)), noBy(clampLabels(p)));

// A new wedding (or a template made from a wedding) takes the space and the tables — never the people.
const DEFAULT_GROUPS = ["Πλευρά νύφης", "Πλευρά γαμπρού", "Φίλοι", "Οικογένεια"].map((name, i) => ({ id: "grp" + (i + 1), name, color: ["#e26d8a", "#4a90d9", "#3aa657", "#e0a030"][i] }));
function layoutOnly(src, fromWedding) {
  if (!isPlan(src)) return null;
  const p = { guests: {}, parties: [] };
  for (const k of ["stage", "stageMaterial", "groups", "layoutVersion", "seatFontScale", "tableFontScale", "_uid"]) if (src[k] !== undefined) p[k] = JSON.parse(JSON.stringify(src[k]));
  if (fromWedding) p.groups = JSON.parse(JSON.stringify(DEFAULT_GROUPS));   // a couple's own group names never travel to other couples
  p.features = (Array.isArray(src.features) ? src.features : []).filter(f => f && typeof f === "object" && !(fromWedding && f.by === "couple")).map(f => ({ ...JSON.parse(JSON.stringify(f)), by: "venue" }));
  p.tables = src.tables.filter(t => t && typeof t === "object").map(t => ({ ...JSON.parse(JSON.stringify(t)), seats: (Array.isArray(t.seats) ? t.seats : []).map(() => null) }));
  return p;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const parts = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "").split("/");
    const newClient = request.headers.get("X-Client") === "2";
    try {
      if (parts[0] === "health" && parts.length === 1 && request.method === "GET") {
        await env.PLANS.get("meta:schema");
        return json({ ok: true });
      }
      // ---------------- plans ----------------
      if (parts[0] === "plans") {
        if (parts.length === 1 && request.method === "POST") {
          // New couple plans come from a purchase (admin / claim link). A couple who already has one may put more online.
          const body = await request.json().catch(() => ({}));
          if (body.plan != null && !isPlan(body.plan)) return json({ error: "bad_plan" }, 422);
          if (tooBig(body.plan)) return json({ error: "plan too large" }, 413);
          let coupleId = null, ok = !!env.OWNER_KEY && eq(request.headers.get("X-Owner-Key") || "", env.OWNER_KEY);
          if (!ok && body.parentId) {
            const parent = safeParse(await env.PLANS.get("plan:" + String(body.parentId)));
            if (parent && ownerOf(parent).type === "couple" && eq(request.headers.get("X-Edit-Key") || "", parent.editKey)) { ok = true; coupleId = parent.coupleId || null; }
          }
          if (!ok) return json({ error: "not_allowed" }, 403);
          const id = rnd(22), editKey = rnd(28), readKey = rnd(24);
          const rec = { name: String(body.name || "Untitled").slice(0, 120), plan: body.plan ?? null, editKey, readKey, owner: { type: "couple" }, coupleId, keyGen: 0, updated: Date.now() };
          if (coupleId) {   // an extra plan of a couple who bought TakeaSeat: recorded on the licence (erased with it)
            const lic = await kvUpdate(env, "couple:" + coupleId, cp => { if (!cp || cp.deletedAt) return null; cp.plans = [...(cp.plans || []), id]; return cp; });
            if (!lic.obj || lic.obj.deletedAt) return json({ error: "not_allowed" }, 403);
          }
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          return json({ id, editKey, readKey, updated: rec.updated });
        }
        const id = parts[1], key = "plan:" + id;
        if (!id) return json({ error: "not found" }, 404);
        const rec = safeParse(await env.PLANS.get(key));
        if (!rec) return (parts.length === 2 && request.method === "DELETE") ? json({ ok: true }) : json({ error: "not found" }, 404);
        const a = await access(request, env, id, rec);

        if (parts.length === 2 && request.method === "GET") {
          if (!a) {   // plans that existed before the change keep id-only reads for a short grace (old tabs, old view links)
            const noKey = !["X-Edit-Key", "X-Venue-Key", "X-Support-Key", "X-View-Key"].some(h => request.headers.get(h));
            if (noKey && rec.legacyOpenUntil && Date.now() < rec.legacyOpenUntil) return json({ name: rec.name, plan: rec.plan, updated: rec.updated, role: "viewer", legacy: true });
            return denied(request, rec);
          }
          let readKey = rec.readKey;
          if (!readKey && (a.role === "couple" || a.role === "venue")) {   // safety net; the boot migration mints these
            const r = await kvUpdate(env, key, cur => { if (!cur) return null; if (!cur.readKey) cur.readKey = rnd(24); return { __obj: cur, __res: cur.readKey }; });
            readKey = r && r.res;
          }
          const out = { name: rec.name, plan: rec.plan, updated: rec.updated, role: a.role, perms: a.perms, owner: { type: a.owner.type }, template: !!rec.template };
          if (a.owner.type === "venue") {
            const v = safeParse(await env.PLANS.get("venue:" + a.owner.venueId));
            if (v) { out.owner.venueName = v.name; if (a.role === "couple") out.owner.venueContact = v.contact || ""; }
          }
          if (a.role === "couple" || a.role === "venue") { out.readKey = readKey || null; if (rec.legacyOpenUntil > Date.now()) out.legacyOpenUntil = rec.legacyOpenUntil; }
          if (a.role === "venue" && !rec.template) { out.couplePerms = normPerms(rec.perms, ALL_OPEN); out.layoutSet = a.layoutSet; }
          if (a.role === "support") {
            out.supportExpires = rec.support.expires;
            await kvUpdate(env, key, cur => (cur && addAudit(cur, "support", "open", 30 * 60000)) ? cur : null);
          }
          if (a.role !== "viewer") {
            out.support = supportActive(rec) ? { expires: rec.support.expires, by: rec.support.by || "", ...(a.full ? { message: rec.support.message || "" } : {}) } : null;
            out.audit = (rec.audit || []).slice(-20);
            if (rec.resetAt) out.resetAt = rec.resetAt;
          }
          return json(out);
        }
        if (parts.length === 2 && request.method === "PUT") {
          if (!a) return denied(request, rec);
          if (!a.write) return json({ error: "read_only" }, 403);
          const body = await request.json().catch(() => ({}));
          if (body.baseUpdated != null && rec.updated && body.baseUpdated < rec.updated) {
            return json({ error: "conflict", updated: rec.updated, name: rec.name, plan: rec.plan }, 409);
          }
          let plan, enforced = false;
          if (body.plan !== undefined) {
            if (!isPlan(body.plan)) return json({ error: "bad_plan" }, 422);
            if (tooBig(body.plan)) return json({ error: "plan too large" }, 413);
            plan = pinCounters(rec.plan, body.plan);
            const actsForVenue = a.owner.type === "venue" && (a.role === "venue" || a.role === "support");   // on a venue plan only the venue can invite support
            if (actsForVenue) plan = stampVenue(rec.plan, plan);
            else if (a.restricted && a.layoutSet) { const e = enforcePerms(rec.plan, plan, a.perms, true); enforced = reverted(e, plan); plan = e; }
            else if (a.owner.type === "venue") plan = enforcePerms(rec.plan, plan, ALL_OPEN, true);   // keeps the authorship of decor items
            const before = planStats(rec.plan), after = planStats(plan);
            if (before.guests >= 5 && after.guests === 0 && body.allowWipe !== true) {
              return json({ error: "wipe_refused", guests: before.guests, updated: rec.updated }, 422);
            }
          }
          const newName = (body.name && !a.restricted && a.role !== "support") ? String(body.name).slice(0, 120) : null;   // support never renames
          const now = Date.now();
          const r = await kvUpdate(env, key, cur => {
            if (!cur) return { __res: "gone" };
            if (cur.updated !== rec.updated) return { __res: "raced" };
            if (plan !== undefined) { cur.plan = plan; if ((a.role === "venue" || a.role === "support") && !cur.layoutAt && a.owner.type === "venue") cur.layoutAt = now; }
            if (newName) cur.name = newName;
            if (a.role === "support") addAudit(cur, "support", "save", 30 * 60000);
            cur.updated = now;
            return { __obj: cur, __res: "ok" };
          });
          if (r.res === "gone") return json({ error: "not found" }, 404);
          if (r.res === "raced") { const c = safeParse(await env.PLANS.get(key)) || rec; return json({ error: "conflict", updated: c.updated, name: c.name, plan: c.plan }, 409); }
          if (plan !== undefined && rec.plan) await pushHistory(env, id, rec);
          if ((a.role === "venue" || a.role === "support") && a.owner.type === "venue" && plan !== undefined && !rec.layoutAt) await markVenueLayout(env, a.owner.venueId, id);
          if (newName && a.owner.type === "venue" && a.role === "venue") await renameVenueWedding(env, a.owner.venueId, id, newName);
          // An old planner ignores {enforced}; a 409 makes it adopt the whole (enforced) plan.
          if (enforced && !newClient) return json({ error: "conflict", updated: now, name: newName || rec.name, plan }, 409);
          return json({ ok: true, updated: now, ...(enforced ? { enforced: true, plan } : {}) });
        }
        if (parts.length === 2 && request.method === "DELETE") {
          if (!a) return denied(request, rec);
          if (a.owner.type === "venue") return json({ error: "use_console" }, 403);   // a venue's wedding is deleted from the venue console
          if (a.role !== "couple") return json({ error: "unauthorized" }, 403);        // support can't delete a couple's plan
          await purgePlan(env, id, rec);
          if (rec.coupleId) await kvUpdate(env, "couple:" + rec.coupleId, c => { if (!c || c.planId !== id) return null; c.deletedAt = Date.now(); return c; });
          return json({ ok: true });
        }
        if (parts.length === 3 && parts[2] === "history" && request.method === "GET") {
          if (!a) return denied(request, rec);
          if (!a.write) return json({ error: "read_only" }, 403);
          const h = safeParse(await env.PLANS.get("hist:" + id)) || [];
          return json({ versions: h.slice().reverse().map(v => ({ updated: v.updated, name: v.name, ...planStats(v.plan) })) });
        }
        if (parts.length === 3 && parts[2] === "restore" && request.method === "POST") {
          if (!a) return denied(request, rec);
          if (!a.write) return json({ error: "read_only" }, 403);
          const body = await request.json().catch(() => ({}));
          const h = safeParse(await env.PLANS.get("hist:" + id)) || [];
          const v = h.find(x => x.updated === Number(body.updated));
          if (!v || !isPlan(v.plan)) return json({ error: "version not found" }, 404);
          let plan = pinCounters(rec.plan, v.plan), enforced = false;
          if (a.restricted && a.layoutSet) { const e = enforcePerms(rec.plan, plan, a.perms, true); enforced = reverted(e, plan); plan = e; }   // an old version never undoes the venue's locks
          const before = planStats(rec.plan), after = planStats(plan);
          if (before.guests >= 5 && after.guests === 0 && body.allowWipe !== true) return json({ error: "wipe_refused", guests: before.guests }, 422);
          if (rec.plan) await pushHistory(env, id, rec);
          const now = Date.now();
          const r = await kvUpdate(env, key, cur => { if (!cur) return null; cur.plan = plan; if (v.name && !a.restricted && a.role !== "support") cur.name = v.name;
            if (a.role === "support") addAudit(cur, "support", "restore"); cur.updated = now; return cur; });
          return json({ ok: true, updated: now, name: r.obj ? r.obj.name : rec.name, plan, enforced });
        }
        // ---- support invitation: the owner lets TakeaSeat in for a while ----
        if (parts.length === 3 && parts[2] === "support" && (request.method === "POST" || request.method === "DELETE")) {
          if (!a) return denied(request, rec);
          if (!a.full || a.role === "support") return json({ error: "unauthorized" }, 403);
          if (request.method === "POST") {
            const body = await request.json().catch(() => ({}));
            const hours = Math.max(1, Math.min(SUPPORT_MAX_H, parseInt(body.hours, 10) || SUPPORT_DEFAULT_H));
            const grant = { key: rnd(28), expires: Date.now() + hours * 3600000, message: String(body.message || "").slice(0, 500), createdAt: Date.now(), by: a.role };
            await kvUpdate(env, key, cur => { if (!cur) return null; cur.support = grant; addAudit(cur, a.role, "invite", 0, { h: hours }); return cur; });
            await addIndex(env, "support:index", id);
            if (a.owner.type === "venue") await mirrorVenueSupport(env, a.owner.venueId, id, grant.expires);
            return json({ ok: true, expires: grant.expires });
          }
          await kvUpdate(env, key, cur => { if (!cur) return null; if (cur.support) { cur.support = null; addAudit(cur, a.role, "revoke"); } return cur; });
          await removeIndex(env, "support:index", id);
          if (a.owner.type === "venue") await mirrorVenueSupport(env, a.owner.venueId, id, null);
          return json({ ok: true });
        }
        // ---- a couple's own "new links": other devices and old links stop working ----
        if (parts.length === 3 && parts[2] === "rotate" && request.method === "POST") {
          if (!a) return denied(request, rec);
          if (!(a.role === "couple" && a.owner.type === "couple")) return json({ error: "unauthorized" }, 403);
          const r = await kvUpdate(env, key, cur => { if (!cur) return null;
            cur.editKey = rnd(28); cur.readKey = rnd(24); cur.keyGen = (cur.keyGen || 0) + 1; cur.legacyOpenUntil = null; addAudit(cur, "couple", "rotate"); return cur; });
          return json({ ok: true, editKey: r.obj.editKey, readKey: r.obj.readKey });
        }
        if (parts.length === 3 && parts[2] === "legacy-off" && request.method === "POST") {
          if (!a) return denied(request, rec);
          if (!(a.role === "couple" || a.role === "venue")) return json({ error: "unauthorized" }, 403);
          await kvUpdate(env, key, cur => { if (!cur || !cur.legacyOpenUntil) return null; cur.legacyOpenUntil = null; return cur; });
          return json({ ok: true });
        }
      }
      // ---------------- claim: a couple opens the link TakeaSeat sent (once; the same device may retry briefly) ----------------
      if (parts[0] === "claim" && parts.length === 1 && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const token = String(body.token || ""), nonce = String(body.nonce || "").slice(0, 64);
        if (token.length < 20) return json({ error: "claim_invalid" }, 404);
        const r = await kvUpdate(env, "claim:" + token, c => {
          if (!c) return { __res: { error: "claim_invalid" } };
          if (c.usedAt) {
            if (nonce && c.nonce === nonce && Date.now() - c.usedAt < CLAIM_RETRY) return { __res: { again: c } };
            return { __res: { error: "claim_used", at: c.usedAt } };
          }
          if (Date.now() - (c.createdAt || 0) > CLAIM_TTL) return { __res: { error: "claim_expired" } };
          c.usedAt = Date.now(); c.nonce = nonce;
          return { __obj: c, __res: { first: c } };
        });
        const res = r.res || {};
        if (res.error) return json({ error: res.error, at: res.at || null }, res.error === "claim_invalid" ? 404 : 410);
        const c = res.first || res.again;
        const done = await kvUpdate(env, "plan:" + c.planId, cur => { if (!cur) return null;
          if ((cur.keyGen || 0) !== (c.gen || 0)) return { __res: null };   // the keys changed since this link was issued (reset / new links)
          const out = { id: c.planId, editKey: cur.editKey, readKey: cur.readKey, name: cur.name, updated: cur.updated };
          if (res.first) { addAudit(cur, "couple", c.reset ? "claim_reset" : "claim", 0, { d: device(request) }); return { __obj: cur, __res: out }; }
          return { __res: out }; });
        if (!done.res) return json({ error: "claim_used", at: c.usedAt || null }, 410);
        if (res.first && c.cid) await kvUpdate(env, "couple:" + c.cid, cp => { if (!cp) return null; cp.claimedAt = Date.now(); cp.claimToken = null; return cp; });
        return json(done.res);
      }
      // ---------------- codes (device linking; the code is a shared secret) ----------------
      if (parts[0] === "codes" && parts.length === 2 && parts[1]) {
        const code = parts[1].toLowerCase();
        if (code.length < MIN_CODE_LEN) return json({ error: "code too short" }, 400);
        const key = "code:" + code;
        if (request.method === "GET") {
          const idx = safeParse(await env.PLANS.get(key)) || { plans: [] };
          return json({ plans: (idx.plans || []).filter(Boolean).map(p => ({ id: p.id, name: p.name, updated: p.updated })) });   // never keys
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (!body.id) return json({ error: "missing id" }, 400);
          const rec = safeParse(await env.PLANS.get("plan:" + body.id));
          if (!rec) return json({ error: "unknown plan" }, 404);
          const idx = safeParse(await env.PLANS.get(key)) || { plans: [] };
          const prev = (idx.plans || []).find(p => p && p.id === body.id);
          // Only the couple's edit key or the plan's venue key can link a device (never support, view or console keys).
          const ek = request.headers.get("X-Edit-Key") || "";
          let role = null;
          if (eq(ek, rec.editKey)) role = "couple";
          else if (ownerOf(rec).type === "venue" && eq(ek, rec.venueKey)) role = "venue";
          if (role === "couple" && prev && prev.role === "venue" && ownerOf(rec).type === "venue" && (prev.gen || 0) === (rec.venueGen || 0)) role = "venue";
          if (!prev && !role) return json({ error: "unauthorized" }, 403);
          const entry = role
            ? { id: body.id, role, gen: role === "venue" ? (rec.venueGen || 0) : (rec.keyGen || 0) }
            : { id: body.id, role: prev.role || "couple", gen: prev.gen || 0 };   // a keyless refresh never changes role or generation
          entry.name = String(body.name || rec.name || "Untitled").slice(0, 120); entry.updated = body.updated || rec.updated || Date.now();
          const r = await kvUpdate(env, key, ix => { ix = ix || { plans: [] }; ix.plans = (ix.plans || []).filter(p => p && p.id !== body.id); ix.plans.push(entry); if (ix.plans.length > 200) ix.plans = ix.plans.slice(-200); return { __obj: ix, __res: ix.plans.length }; });
          return json({ ok: true, count: r.res });
        }
        if (request.method === "DELETE") {
          const body = await request.json().catch(() => ({}));
          await kvUpdate(env, key, ix => { if (!ix) return null; ix.plans = (ix.plans || []).filter(p => p && p.id !== (body && body.id)); return ix; });
          return json({ ok: true });
        }
      }
      // ---------------- admin (owner key): venues, couples, support invitations — never plan contents ----------------
      if (parts[0] === "admin") {
        if (!env.OWNER_KEY) return json({ error: "admin disabled — set OWNER_KEY" }, 503);
        if (!eq(request.headers.get("X-Owner-Key") || "", env.OWNER_KEY)) return json({ error: "unauthorized" }, 403);
        if (parts[1] === "venues") {
          if (parts.length === 2 && request.method === "POST") {
            const b = await request.json().catch(() => ({}));
            const id = rnd(10), key = id + "." + rnd(28);
            const v = { id, name: String(b.name || "Venue").slice(0, 120), contact: String(b.contact || "").slice(0, 200),
              key, keyRotated: false, license: normLicense(b.license), used: 0, weddings: [], active: true, createdAt: Date.now(), defaultPerms: { ...VENUE_DEFAULT } };
            await env.PLANS.put("venue:" + id, JSON.stringify(v));
            await addIndex(env, "venues:index", id);
            return json({ id, key, venue: adminVenue(v) });
          }
          if (parts.length === 2 && request.method === "GET") {
            const ids = safeParse(await env.PLANS.get("venues:index")) || [];
            const out = [];
            for (const vid of ids) { const v = safeParse(await env.PLANS.get("venue:" + vid)); if (v) out.push(adminVenue(v)); }
            return json({ venues: out });
          }
          if (parts.length === 3 && request.method === "GET") {
            const v = safeParse(await env.PLANS.get("venue:" + parts[2])); if (!v) return json({ error: "not found" }, 404);
            // Once the venue has set its own key, only the venue knows it; the admin can only reset it (the venue notices).
            return json({ venue: adminVenue(v), key: v.keyRotated ? null : v.key, keyRotated: !!v.keyRotated });
          }
          if (parts.length === 4 && parts[3] === "reset-key" && request.method === "POST") {
            const v = safeParse(await env.PLANS.get("venue:" + parts[2])); if (!v) return json({ error: "not found" }, 404);
            const newKey = v.id + "." + rnd(28);
            await rotateVenueCredentials(env, v.id, newKey, false);
            return json({ ok: true, key: newKey });
          }
          if (parts.length === 3 && (request.method === "PATCH" || request.method === "PUT")) {
            const b = await request.json().catch(() => ({}));
            const r = await kvUpdate(env, "venue:" + parts[2], v => { if (!v) return null;
              if (b.name != null) v.name = String(b.name).slice(0, 120);
              if (b.contact != null) v.contact = String(b.contact).slice(0, 200);
              if (b.active != null) v.active = !!b.active;
              if (b.license) v.license = normLicense(b.license);
              return v; });
            if (!r.obj) return json({ error: "not found" }, 404);
            return json({ venue: adminVenue(r.obj) });
          }
          if (parts.length === 3 && request.method === "DELETE") {   // erasure: the venue, its weddings and its template
            const dv = safeParse(await env.PLANS.get("venue:" + parts[2]));
            if (dv) {
              for (const w of (dv.weddings || [])) if (w && w.planId) await purgeVenuePlan(env, dv.id, w.planId);
              if (dv.templateId) await purgeVenuePlan(env, dv.id, dv.templateId);
            }
            await env.PLANS.delete("venue:" + parts[2]);
            await removeIndex(env, "venues:index", parts[2]);
            return json({ ok: true });
          }
        }
        if (parts[1] === "couples") {
          if (parts.length === 2 && request.method === "POST") {   // a couple bought TakeaSeat: a plan only they can open
            const b = await request.json().catch(() => ({}));
            const cid = rnd(10), planId = rnd(22), token = rnd(32);
            const name = String(b.name || "Wedding").slice(0, 120);
            await env.PLANS.put("plan:" + planId, JSON.stringify({ name, plan: null, editKey: rnd(28), readKey: rnd(24), owner: { type: "couple" }, coupleId: cid, keyGen: 0, updated: Date.now(), audit: [] }));
            const c = { id: cid, name, contact: String(b.contact || "").slice(0, 200), createdAt: Date.now(), planId, claimToken: token, claimedAt: null };
            await env.PLANS.put("couple:" + cid, JSON.stringify(c));
            await env.PLANS.put("claim:" + token, JSON.stringify({ cid, planId, createdAt: Date.now(), gen: 0 }));
            await addIndex(env, "couples:index", cid);
            return json({ couple: await adminCouple(env, c), claimToken: token });
          }
          if (parts.length === 2 && request.method === "GET") {
            const ids = safeParse(await env.PLANS.get("couples:index")) || [];
            const out = [];
            for (const cid of ids) { const c = safeParse(await env.PLANS.get("couple:" + cid)); if (c) out.push(await adminCouple(env, c)); }
            return json({ couples: out });
          }
          if (parts.length === 3 && (request.method === "PATCH" || request.method === "PUT")) {
            const b = await request.json().catch(() => ({}));
            const r = await kvUpdate(env, "couple:" + parts[2], c => { if (!c) return null;
              if (b.name != null) c.name = String(b.name).slice(0, 120);
              if (b.contact != null) c.contact = String(b.contact).slice(0, 200);
              return c; });
            if (!r.obj) return json({ error: "not found" }, 404);
            return json({ couple: await adminCouple(env, r.obj) });
          }
          // Lost link: new keys + a new claim link. Every old key, view link and linked device stops working, open
          // support access ends, and the reset is in the access log the couple sees.
          if (parts.length === 4 && parts[3] === "reset" && request.method === "POST") {
            const c = safeParse(await env.PLANS.get("couple:" + parts[2])); if (!c) return json({ error: "not found" }, 404);
            const token = rnd(32), now = Date.now();
            const r = await kvUpdate(env, "plan:" + c.planId, cur => { if (!cur || cur.coupleId !== c.id) return null;
              cur.editKey = rnd(28); cur.readKey = rnd(24); cur.keyGen = (cur.keyGen || 0) + 1; cur.support = null; cur.legacyOpenUntil = null; cur.resetAt = now;
              addAudit(cur, "admin", "reset"); return cur; });
            if (!r.obj || r.obj.resetAt !== now) return json({ error: "plan_gone" }, 410);
            await removeIndex(env, "support:index", c.planId);
            if (c.claimToken) await env.PLANS.delete("claim:" + c.claimToken);
            await env.PLANS.put("claim:" + token, JSON.stringify({ cid: c.id, planId: c.planId, createdAt: now, gen: r.obj.keyGen || 0, reset: true }));
            await kvUpdate(env, "couple:" + c.id, cp => { if (!cp) return null; cp.claimToken = token; cp.claimedAt = null; cp.resetAt = now; return cp; });
            return json({ ok: true, claimToken: token });
          }
          if (parts.length === 3 && request.method === "DELETE") {   // erasure on request
            const c = safeParse(await env.PLANS.get("couple:" + parts[2]));
            if (c) {
              for (const pid of [c.planId, ...(c.plans || [])]) { const pr = safeParse(await env.PLANS.get("plan:" + pid)); if (pr && pr.coupleId === c.id) await purgePlan(env, pid); }
              if (c.claimToken) await env.PLANS.delete("claim:" + c.claimToken);
            }
            await env.PLANS.delete("couple:" + parts[2]);
            await removeIndex(env, "couples:index", parts[2]);
            return json({ ok: true });
          }
        }
        if (parts[1] === "support" && parts.length === 2 && request.method === "GET") {   // invitations owners chose to send
          const ids = safeParse(await env.PLANS.get("support:index")) || [];
          const out = [], dead = [];
          for (const pid of ids) {
            const rec = safeParse(await env.PLANS.get("plan:" + pid));
            if (!supportActive(rec)) { dead.push(pid); continue; }
            const own = ownerOf(rec); let venueName = "";
            if (own.type === "venue") { const v = safeParse(await env.PLANS.get("venue:" + own.venueId)); venueName = v ? v.name : ""; }
            out.push({ planId: pid, key: rec.support.key, name: rec.name, message: rec.support.message || "", expires: rec.support.expires,
              createdAt: rec.support.createdAt, kind: own.type, venueName, template: !!rec.template });
          }
          if (dead.length) await kvUpdate(env, "support:index", cur => Array.isArray(cur) ? cur.filter(x => !dead.includes(x)) : null);
          return json({ requests: out });
        }
        return json({ error: "not found" }, 404);
      }
      // ---------------- venue console (venue key) ----------------
      if (parts[0] === "venues" && parts[1]) {
        const vkey = "venue:" + parts[1];
        const v = safeParse(await env.PLANS.get(vkey));
        if (!v) return json({ error: "not found" }, 404);
        if (!eq(request.headers.get("X-Venue-Key") || "", v.key)) return json({ error: "unauthorized" }, 403);
        const ownPlan = async pid => { const r = safeParse(await env.PLANS.get("plan:" + pid)); const o = ownerOf(r); return (r && o.type === "venue" && o.venueId === v.id) ? r : null; };
        if (parts.length === 2 && request.method === "GET") {
          // Safety net for weddings the boot migration did not see: never overwrites perms or owner.
          let changed = false;
          for (const w of (v.weddings || [])) {
            if (w.venueKey && w.perms) continue;
            const r = await kvUpdate(env, "plan:" + w.planId, cur => { if (!cur) return null; const o = ownerOf(cur); if (o.type !== "venue" || o.venueId !== v.id) return null;
              let dirty = false;
              if (!cur.owner) { cur.owner = { type: "venue", venueId: v.id }; dirty = true; }
              if (!cur.venueKey) { cur.venueKey = rnd(28); dirty = true; }
              if (!cur.readKey) { cur.readKey = rnd(24); dirty = true; }
              if (!cur.perms) { cur.perms = { ...ALL_OPEN }; dirty = true; }
              return dirty ? cur : { __res: true }; });
            if (r.obj && r.obj.venueKey && ownerOf(r.obj).venueId === v.id) { w.venueKey = r.obj.venueKey; w.perms = normPerms(r.obj.perms, ALL_OPEN); w.layoutSet = !!r.obj.layoutAt; changed = true; }
          }
          if (changed) await kvUpdate(env, vkey, cur => { if (!cur) return null; const byId = new Map((v.weddings || []).map(w => [w.planId, w]));
            (cur.weddings || []).forEach(w => { const m = byId.get(w.planId); if (m && m.venueKey) { w.venueKey = m.venueKey; w.perms = m.perms; w.layoutSet = m.layoutSet; } }); return cur; });
          let template = null;
          if (v.templateId) { const t = await ownPlan(v.templateId);
            if (t) template = { planId: v.templateId, venueKey: t.venueKey, updated: t.updated, tables: planStats(t.plan).tables, supportExpires: supportActive(t) ? t.support.expires : null }; }
          const gate = canCreateWedding(v);
          const live = x => (x && x > Date.now()) ? x : null;
          return json({ venue: publicVenue(v), template, defaultPerms: normPerms(v.defaultPerms, ALL_OPEN), canCreate: gate.ok, reason: gate.reason,
            weddings: (v.weddings || []).map(w => ({ planId: w.planId, label: w.label, createdAt: w.createdAt, editKey: w.editKey, venueKey: w.venueKey,
              perms: normPerms(w.perms, ALL_OPEN), layoutSet: w.layoutSet !== false, supportExpires: live(w.supportExpires) })) });
        }
        // The venue sets its OWN key: from then on the admin can't read it, and every per-wedding venue link is renewed.
        if (parts.length === 3 && parts[2] === "rotate" && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const provided = body.secret != null && String(body.secret).trim() !== "";
          let secret = provided ? String(body.secret).replace(/[^A-Za-z0-9]/g, "") : "";
          if (provided && secret.length < 12) return json({ error: "too_short" }, 400);
          if (!provided) secret = rnd(28);
          const newKey = v.id + "." + secret;
          await rotateVenueCredentials(env, v.id, newKey, true);
          return json({ ok: true, key: newKey });
        }
        // What a couple may change in NEW weddings (and, if asked, in every existing one).
        if (parts.length === 3 && parts[2] === "defaults" && (request.method === "PUT" || request.method === "PATCH")) {
          const b = await request.json().catch(() => ({}));
          const perms = normPerms(b.perms, normPerms(v.defaultPerms, ALL_OPEN));
          let applied = 0;
          if (b.applyToAll) for (const w of (v.weddings || [])) {
            const r = await kvUpdate(env, "plan:" + w.planId, rec => { if (!rec) return null; const o = ownerOf(rec); if (o.type !== "venue" || o.venueId !== v.id) return null; rec.perms = perms; return rec; });
            if (r.obj && ownerOf(r.obj).venueId === v.id) applied++;
          }
          await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.defaultPerms = perms; if (b.applyToAll) (cur.weddings || []).forEach(w => { w.perms = perms; }); return cur; });
          return json({ ok: true, defaultPerms: perms, applied });
        }
        // The venue's default space: one template plan (outside the weddings list: never counted, never a couple link).
        if (parts.length === 3 && parts[2] === "template" && request.method === "POST") {
          if (v.templateId) { const t = await ownPlan(v.templateId); if (t) return json({ planId: v.templateId, venueKey: t.venueKey, updated: t.updated }); }
          const b = await request.json().catch(() => ({}));
          let plan = null;
          if (b.fromPlanId) {   // "start from one of my weddings": only a wedding of this venue, and only its space
            const src = (v.weddings || []).some(w => w.planId === b.fromPlanId) ? await ownPlan(b.fromPlanId) : null;
            if (!src) return json({ error: "not found" }, 404);
            plan = layoutOnly(src.plan, true);
          }
          const id = rnd(22);
          const rec = { name: String(b.name || v.name).slice(0, 120), plan, editKey: rnd(28), venueKey: rnd(28), readKey: rnd(24),
            owner: { type: "venue", venueId: v.id }, venueId: v.id, template: true, perms: { ...ALL_OPEN }, keyGen: 0, venueGen: 0, updated: Date.now() };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.templateId = id; return cur; });
          return json({ planId: id, venueKey: rec.venueKey, updated: rec.updated });
        }
        if (parts.length === 3 && parts[2] === "weddings" && request.method === "POST") {
          const gate = canCreateWedding(v);
          if (!gate.ok) return json({ error: gate.reason }, 403);
          const b = await request.json().catch(() => ({}));
          let plan = null;
          if (v.templateId) { const t = await ownPlan(v.templateId); if (t) plan = layoutOnly(t.plan); }
          const id = rnd(22), editKey = rnd(28), venueKey = rnd(28);
          const perms = normPerms(b.perms || v.defaultPerms, ALL_OPEN);
          const now = Date.now();
          // Locks apply once the venue has put its layout in: from the template now, or at the venue's first save.
          const rec = { name: String(b.label || "Wedding").slice(0, 120), plan, editKey, venueKey, readKey: rnd(24),
            owner: { type: "venue", venueId: v.id }, venueId: v.id, perms, layoutAt: plan ? now : null, keyGen: 0, venueGen: 0, updated: now };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          await kvUpdate(env, vkey, cur => { if (!cur) return null;
            cur.weddings = cur.weddings || []; cur.weddings.push({ planId: id, label: rec.name, createdAt: now, editKey, venueKey, perms, layoutSet: !!plan });
            cur.used = (cur.used || 0) + 1; return cur; });
          return json({ planId: id, editKey, venueKey, updated: now, fromTemplate: !!plan });
        }
        // Rename a wedding and/or change what its couple may change.
        if (parts.length === 4 && parts[2] === "weddings" && (request.method === "PATCH" || request.method === "PUT")) {
          const b = await request.json().catch(() => ({}));
          const w = (v.weddings || []).find(x => x.planId === parts[3]);
          if (!w || !(await ownPlan(parts[3]))) return json({ error: "not found" }, 404);
          const label = b.label != null ? String(b.label).trim().slice(0, 120) : null;
          if (b.label != null && !label) return json({ error: "missing label" }, 400);
          const perms = b.perms ? normPerms(b.perms, normPerms(w.perms, ALL_OPEN)) : null;
          await kvUpdate(env, vkey, cur => { if (!cur) return null; const cw = (cur.weddings || []).find(x => x.planId === parts[3]); if (!cw) return null;
            if (label) cw.label = label; if (perms) cw.perms = perms; return cur; });
          await kvUpdate(env, "plan:" + parts[3], rec => { if (!rec) return null;
            if (label) rec.name = label;          // metadata: `updated` stays, so nobody's next save conflicts
            if (perms) rec.perms = perms;
            return rec; });
          return json({ ok: true, label: label || w.label, perms: perms || normPerms(w.perms, ALL_OPEN) });
        }
        if (parts.length === 4 && parts[2] === "weddings" && request.method === "DELETE") {
          const mine = (v.weddings || []).some(w => w.planId === parts[3]);
          await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.weddings = (cur.weddings || []).filter(w => w.planId !== parts[3]); return cur; });
          if (mine) await purgeVenuePlan(env, v.id, parts[3]);   // only its own weddings
          return json({ ok: true });
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);      // never leak internal exception text
    }
  },
};

// ---- one-time data migration at boot (idempotent; guarded by meta:schema). Needs PLANS.list(prefix). ----
export async function migrate(env) {
  if (typeof env.PLANS.list !== "function") return { skipped: "no list()" };
  const meta = safeParse(await env.PLANS.get("meta:schema")) || {};
  if (meta.v >= SCHEMA) return { skipped: "done", v: meta.v };
  const now = Date.now(), stats = { plans: 0, venues: 0, codes: 0 };
  const venueIds = new Set();
  for (const k of await env.PLANS.list("venue:")) venueIds.add(k.slice(6));
  for (const k of await env.PLANS.list("plan:")) {
    await kvUpdate(env, k, rec => {
      if (!rec) return null;
      if (!rec.owner) rec.owner = (rec.venueId && venueIds.has(rec.venueId)) ? { type: "venue", venueId: rec.venueId } : { type: "couple" };   // an orphan (venue gone) belongs to its couple
      if (!rec.readKey) rec.readKey = rnd(24);
      if (rec.keyGen == null) rec.keyGen = 0;
      if (rec.owner.type === "venue") {
        if (!rec.venueKey) rec.venueKey = rnd(28);
        if (!rec.perms) rec.perms = { ...ALL_OPEN };                        // existing couples keep every freedom they had
        if (rec.venueGen == null) rec.venueGen = 0;
        if (rec.layoutAt === undefined) rec.layoutAt = isPlan(rec.plan) ? (rec.updated || now) : null;
      }
      if (rec.legacyOpenUntil === undefined) rec.legacyOpenUntil = now + LEGACY_GRACE;   // old tabs / links keep reading for 14 days
      stats.plans++; return rec;
    });
  }
  for (const vid of venueIds) {
    const v = safeParse(await env.PLANS.get("venue:" + vid)); if (!v) continue;
    for (const w of (v.weddings || [])) {
      const rec = safeParse(await env.PLANS.get("plan:" + w.planId));
      if (rec && ownerOf(rec).type === "venue" && ownerOf(rec).venueId === vid) { w.venueKey = rec.venueKey; w.perms = normPerms(rec.perms, ALL_OPEN); w.layoutSet = !!rec.layoutAt; }
    }
    if (v.keyRotated === undefined) v.keyRotated = false;
    await env.PLANS.put("venue:" + vid, JSON.stringify(v)); stats.venues++;
  }
  for (const k of await env.PLANS.list("code:")) {
    await kvUpdate(env, k, ix => { if (!ix || !Array.isArray(ix.plans)) return null; ix.plans = ix.plans.filter(Boolean).map(p => ({ ...p, role: p.role || "couple", gen: p.gen || 0 })); stats.codes++; return ix; });
  }
  await env.PLANS.put("meta:schema", JSON.stringify({ v: SCHEMA, at: now, stats }));
  return stats;
}

// ---- plan version history (key hist:<planId>): the last HIST_MAX versions, oldest first, capped in bytes ----
const HIST_MAX = 30, HIST_BYTES = 3 * 1024 * 1024;
function planStats(p) {
  const tables = (p && Array.isArray(p.tables)) ? p.tables : [];
  const seated = new Set(); tables.forEach(t => (Array.isArray(t && t.seats) ? t.seats : []).forEach(g => { if (g) seated.add(g); }));
  return { tables: tables.length, guests: (p && p.guests && typeof p.guests === "object") ? Object.keys(p.guests).length : 0, seated: seated.size };
}
async function pushHistory(env, id, rec) {
  await kvUpdate(env, "hist:" + id, h => {
    h = Array.isArray(h) ? h : [];
    if (h.length && h[h.length - 1].updated === rec.updated) return null;
    h.push({ updated: rec.updated, name: rec.name, plan: rec.plan });
    while (h.length > HIST_MAX) h.shift();
    let s = JSON.stringify(h);
    while (s.length > HIST_BYTES && h.length > 1) { h.shift(); s = JSON.stringify(h); }
    return h;
  });
}
async function purgePlan(env, id) {
  await env.PLANS.delete("plan:" + id);
  await env.PLANS.delete("hist:" + id);
  await removeIndex(env, "support:index", id);
}
async function purgeVenuePlan(env, venueId, id) {   // only ever deletes a plan that really belongs to that venue
  const rec = safeParse(await env.PLANS.get("plan:" + id)); const o = ownerOf(rec);
  if (rec && o.type === "venue" && o.venueId === venueId) await purgePlan(env, id);
}
// New console key → new per-plan venue keys for every wedding and the template; older venue-role device links retire.
async function rotateVenueCredentials(env, venueId, newKey, byVenue) {
  const v = safeParse(await env.PLANS.get("venue:" + venueId)); if (!v) return;
  const fresh = {};
  for (const pid of (v.weddings || []).map(w => w.planId).concat(v.templateId ? [v.templateId] : [])) {
    const r = await kvUpdate(env, "plan:" + pid, rec => { if (!rec) return null; const o = ownerOf(rec); if (o.type !== "venue" || o.venueId !== venueId) return null;
      rec.venueKey = rnd(28); rec.venueGen = (rec.venueGen || 0) + 1; return { __obj: rec, __res: rec.venueKey }; });
    if (r.res) fresh[pid] = r.res;
  }
  await kvUpdate(env, "venue:" + venueId, cur => { if (!cur) return null;
    cur.key = newKey; cur.keyRotated = !!byVenue; if (!byVenue) cur.keyResetAt = Date.now();
    (cur.weddings || []).forEach(w => { if (fresh[w.planId]) w.venueKey = fresh[w.planId]; }); return cur; });
}
async function markVenueLayout(env, venueId, planId) {
  await kvUpdate(env, "venue:" + venueId, v => { if (!v) return null; const w = (v.weddings || []).find(x => x.planId === planId); if (!w || w.layoutSet) return null; w.layoutSet = true; return v; });
}
async function mirrorVenueSupport(env, venueId, planId, expires) {
  await kvUpdate(env, "venue:" + venueId, v => { if (!v) return null; const w = (v.weddings || []).find(x => x.planId === planId); if (!w) return null; w.supportExpires = expires; return v; });
}
async function renameVenueWedding(env, venueId, planId, name) {
  await kvUpdate(env, "venue:" + venueId, v => { if (!v) return null; const w = (v.weddings || []).find(x => x.planId === planId); if (!w || w.label === name) return null; w.label = name; return v; });
}

function rnd(n) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const out = [];
  while (out.length < n) {   // rejection sampling: no modulo bias
    const a = crypto.getRandomValues(new Uint8Array(n * 2));
    for (const x of a) { if (x < 248) out.push(c[x % 62]); if (out.length === n) break; }
  }
  return out.join("");
}

// ---- venue helpers ----
function normLicense(l) {
  l = l || {};
  const type = l.type === "per_wedding" ? "per_wedding" : "seasonal";
  return {
    type,
    seasonStart: l.seasonStart || null,
    seasonEnd: l.seasonEnd || null,
    quota: Math.max(0, parseInt(l.quota, 10) || 0),
    cap: Math.max(0, parseInt(l.cap, 10) || 0),
  };
}
function canCreateWedding(v) {
  if (!v.active) return { ok: false, reason: "inactive" };
  const L = v.license || {};
  if (L.type === "per_wedding") {
    if (L.quota && (v.used || 0) >= L.quota) return { ok: false, reason: "quota_reached" };
    return { ok: true };
  }
  const now = Date.now();
  if (L.seasonStart && now < Date.parse(L.seasonStart)) return { ok: false, reason: "before_season" };
  if (L.seasonEnd && now > Date.parse(L.seasonEnd) + 86400000) return { ok: false, reason: "after_season" };
  if (L.cap && (v.weddings || []).length >= L.cap) return { ok: false, reason: "cap_reached" };
  return { ok: true };
}
function publicVenue(v) {   // returned to the venue itself (no key)
  return { id: v.id, name: v.name, contact: v.contact, license: v.license, used: v.used || 0,
    active: v.active, createdAt: v.createdAt, weddingCount: (v.weddings || []).length, keyRotated: !!v.keyRotated, hasTemplate: !!v.templateId };
}
function adminVenue(v) {     // returned to the owner — counts only: no plan ids, no keys, no wedding names
  return publicVenue(v);
}
async function adminCouple(env, c) {   // licence metadata only — never the plan id, a key, or anything inside the plan
  const rec = safeParse(await env.PLANS.get("plan:" + c.planId));
  return { id: c.id, name: c.name, contact: c.contact, createdAt: c.createdAt, claimedAt: c.claimedAt || null, resetAt: c.resetAt || null,
    exists: !!rec, deletedAt: c.deletedAt || null, lastEdit: rec ? rec.updated : null, pendingClaim: !!c.claimToken, claimToken: c.claimToken || null,
    support: supportActive(rec) ? { expires: rec.support.expires } : null };
}
async function addIndex(env, key, id) { await kvUpdate(env, key, ids => { ids = Array.isArray(ids) ? ids : []; if (ids.includes(id)) return null; ids.push(id); return ids; }); }
async function removeIndex(env, key, id) { await kvUpdate(env, key, ids => Array.isArray(ids) && ids.includes(id) ? ids.filter(x => x !== id) : null); }
