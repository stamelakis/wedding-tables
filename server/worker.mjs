// Cloudflare Worker for the wedding seating planner cloud sync.
// Binding required: KV namespace bound as PLANS (namespace "wedding-plans").
//
// Security model
// --------------
// * Each plan gets a random id (read handle) and editKey (write credential).
// * A "sync code" links a person's devices. The code is a SHARED SECRET (like a
//   password): it grants read + write to every plan registered under it, so the
//   client must use a long, high-entropy code. The code list NEVER exposes editKeys.
// * A write (PUT/DELETE) is authorized by EITHER the plan's editKey (share-link /
//   creator) OR a sync code under which the plan id is registered (X-Sync-Code).
// * Registering a plan under a code requires proving write access to that plan
//   (its editKey), so knowing only a plan id (e.g. from a view-only link) can never
//   be escalated to write access by self-registering under an attacker code.
//
// Routes
//   POST   /plans            {name, plan}                    -> {id, editKey, updated}
//   GET    /plans/:id                                        -> {name, plan, updated}
//   PUT    /plans/:id        {name?, plan?, baseUpdated?}    -> {ok, updated} | 409 {conflict}
//   DELETE /plans/:id                                        -> {ok}
//   GET    /codes/:code                                      -> {plans:[{id, name, updated}]}   (no editKeys)
//   POST   /codes/:code      {id, name, updated}             -> {ok, count}   (needs X-Edit-Key for that plan)
//   DELETE /codes/:code      {id}                            -> {ok}          (unregister one plan)
// Write routes accept auth header X-Edit-Key or X-Sync-Code.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Key, X-Sync-Code, X-Owner-Key, X-Venue-Key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const MAX_PLAN_BYTES = 512 * 1024;   // reject absurd payloads (KV value limit is 25MB; a real plan is a few KB)
const MIN_CODE_LEN = 12;             // sync codes must be long enough not to be guessable

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}
function safeParse(raw) { try { return raw ? JSON.parse(raw) : null; } catch (e) { return null; } }
function tooBig(v) { try { return JSON.stringify(v ?? null).length > MAX_PLAN_BYTES; } catch (e) { return true; } }

// A write is allowed with the plan's editKey, or a sync code the plan is registered under.
async function authorized(request, env, id, rec) {
  const ek = request.headers.get("X-Edit-Key");
  if (ek && ek === rec.editKey) return true;
  const code = (request.headers.get("X-Sync-Code") || "").toLowerCase();
  if (code && code.length >= MIN_CODE_LEN) {
    const idx = safeParse(await env.PLANS.get("code:" + code));
    if (idx && (idx.plans || []).some(p => p.id === id)) return true;
  }
  return false;
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const parts = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "").split("/");
    try {
      // ---------------- plans ----------------
      if (parts[0] === "plans") {
        if (parts.length === 1 && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (tooBig(body.plan)) return json({ error: "plan too large" }, 413);
          const id = rnd(22), editKey = rnd(28);
          const rec = { name: String(body.name || "Untitled").slice(0, 120), plan: body.plan ?? null, editKey, updated: Date.now() };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          return json({ id, editKey, updated: rec.updated });
        }
        if (parts.length === 2 && request.method === "GET") {
          const rec = safeParse(await env.PLANS.get("plan:" + parts[1]));
          if (!rec) return json({ error: "not found" }, 404);
          return json({ name: rec.name, plan: rec.plan, updated: rec.updated });
        }
        if (parts.length === 2 && request.method === "PUT") {
          const rec = safeParse(await env.PLANS.get("plan:" + parts[1]));
          if (!rec) return json({ error: "not found" }, 404);
          if (!(await authorized(request, env, parts[1], rec))) return json({ error: "unauthorized" }, 403);
          const body = await request.json().catch(() => ({}));
          // Optimistic concurrency: refuse to overwrite a copy newer than the one the client last saw.
          if (body.baseUpdated != null && rec.updated && body.baseUpdated < rec.updated) {
            return json({ error: "conflict", updated: rec.updated, name: rec.name, plan: rec.plan }, 409);
          }
          if (body.plan !== undefined) { if (tooBig(body.plan)) return json({ error: "plan too large" }, 413); rec.plan = body.plan; }
          if (body.name) rec.name = String(body.name).slice(0, 120);
          rec.updated = Date.now();
          await env.PLANS.put("plan:" + parts[1], JSON.stringify(rec));
          return json({ ok: true, updated: rec.updated });
        }
        if (parts.length === 2 && request.method === "DELETE") {
          const rec = safeParse(await env.PLANS.get("plan:" + parts[1]));
          if (!rec) return json({ ok: true });                 // already gone
          if (!(await authorized(request, env, parts[1], rec))) return json({ error: "unauthorized" }, 403);
          await env.PLANS.delete("plan:" + parts[1]);
          return json({ ok: true });
        }
      }
      // ---------------- codes (device linking; the code is a shared secret) ----------------
      if (parts[0] === "codes" && parts.length === 2 && parts[1]) {
        const code = parts[1].toLowerCase();
        if (code.length < MIN_CODE_LEN) return json({ error: "code too short" }, 400);
        const key = "code:" + code;
        if (request.method === "GET") {
          const idx = safeParse(await env.PLANS.get(key)) || { plans: [] };
          // Never expose editKeys through the code list — only read handles + labels.
          return json({ plans: (idx.plans || []).map(p => ({ id: p.id, name: p.name, updated: p.updated })) });
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (!body.id) return json({ error: "missing id" }, 400);
          const rec = safeParse(await env.PLANS.get("plan:" + body.id));
          if (!rec) return json({ error: "unknown plan" }, 404);
          const idx = safeParse(await env.PLANS.get(key)) || { plans: [] };
          const already = (idx.plans || []).some(p => p.id === body.id);
          const ek = request.headers.get("X-Edit-Key");
          // Must prove write access to first-register a plan under a code (prevents id -> write escalation).
          if (!already && !(ek && ek === rec.editKey)) return json({ error: "unauthorized" }, 403);
          idx.plans = (idx.plans || []).filter(p => p.id !== body.id);
          idx.plans.push({ id: body.id, name: String(body.name || rec.name || "Untitled").slice(0, 120), updated: body.updated || rec.updated || Date.now() });
          if (idx.plans.length > 200) idx.plans = idx.plans.slice(-200);
          await env.PLANS.put(key, JSON.stringify(idx));
          return json({ ok: true, count: idx.plans.length });
        }
        if (request.method === "DELETE") {
          const body = await request.json().catch(() => ({}));
          const idx = safeParse(await env.PLANS.get(key)) || { plans: [] };
          idx.plans = (idx.plans || []).filter(p => p.id !== (body && body.id));
          await env.PLANS.put(key, JSON.stringify(idx));
          return json({ ok: true });
        }
      }
      // ---------------- admin: venues (owner only) ----------------
      if (parts[0] === "admin" && parts[1] === "venues") {
        if (!env.OWNER_KEY) return json({ error: "admin disabled — set OWNER_KEY" }, 503);
        if ((request.headers.get("X-Owner-Key") || "") !== env.OWNER_KEY) return json({ error: "unauthorized" }, 403);
        if (parts.length === 2 && request.method === "POST") {
          const b = await request.json().catch(() => ({}));
          const id = rnd(10), key = id + "." + rnd(28);
          const v = { id, name: String(b.name || "Venue").slice(0, 120), contact: String(b.contact || "").slice(0, 200),
            key, license: normLicense(b.license), used: 0, weddings: [], active: true, createdAt: Date.now() };
          await env.PLANS.put("venue:" + id, JSON.stringify(v));
          await addVenueIndex(env, id);
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
          return json({ venue: adminVenue(v), key: v.key });
        }
        if (parts.length === 3 && (request.method === "PATCH" || request.method === "PUT")) {
          const v = safeParse(await env.PLANS.get("venue:" + parts[2])); if (!v) return json({ error: "not found" }, 404);
          const b = await request.json().catch(() => ({}));
          if (b.name != null) v.name = String(b.name).slice(0, 120);
          if (b.contact != null) v.contact = String(b.contact).slice(0, 200);
          if (b.active != null) v.active = !!b.active;
          if (b.license) v.license = normLicense(b.license);
          await env.PLANS.put("venue:" + parts[2], JSON.stringify(v));
          return json({ venue: adminVenue(v) });
        }
        if (parts.length === 3 && request.method === "DELETE") {
          await env.PLANS.delete("venue:" + parts[2]);
          await removeVenueIndex(env, parts[2]);
          return json({ ok: true });
        }
      }
      // ---------------- venue console (venue key) ----------------
      if (parts[0] === "venues" && parts[1]) {
        const v = safeParse(await env.PLANS.get("venue:" + parts[1]));
        if (!v) return json({ error: "not found" }, 404);
        if ((request.headers.get("X-Venue-Key") || "") !== v.key) return json({ error: "unauthorized" }, 403);
        if (parts.length === 2 && request.method === "GET") {
          const gate = canCreateWedding(v);
          return json({ venue: publicVenue(v), weddings: v.weddings || [], canCreate: gate.ok, reason: gate.reason });
        }
        if (parts.length === 3 && parts[2] === "weddings" && request.method === "POST") {
          const gate = canCreateWedding(v);
          if (!gate.ok) return json({ error: gate.reason }, 403);
          const b = await request.json().catch(() => ({}));
          const id = rnd(22), editKey = rnd(28);
          const rec = { name: String(b.label || "Wedding").slice(0, 120), plan: b.plan ?? null, editKey, updated: Date.now(), venueId: v.id };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          v.weddings = v.weddings || []; v.weddings.push({ planId: id, label: rec.name, createdAt: rec.updated, editKey });
          v.used = (v.used || 0) + 1;
          await env.PLANS.put("venue:" + v.id, JSON.stringify(v));
          return json({ planId: id, editKey, updated: rec.updated });
        }
        if (parts.length === 4 && parts[2] === "weddings" && request.method === "DELETE") {
          v.weddings = (v.weddings || []).filter(w => w.planId !== parts[3]);
          await env.PLANS.put("venue:" + v.id, JSON.stringify(v));
          await env.PLANS.delete("plan:" + parts[3]);
          return json({ ok: true });
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: "server error" }, 500);      // never leak internal exception text
    }
  },
};

function rnd(n) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const a = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (let i = 0; i < n; i++) s += c[a[i] % c.length];
  return s;
}

// ---- venue helpers ----
function normLicense(l) {
  l = l || {};
  const type = l.type === "per_wedding" ? "per_wedding" : "seasonal";
  return {
    type,
    seasonStart: l.seasonStart || null,          // ISO date string, e.g. "2026-05-01"
    seasonEnd: l.seasonEnd || null,
    quota: Math.max(0, parseInt(l.quota, 10) || 0),   // per_wedding: max weddings that can be created
    cap: Math.max(0, parseInt(l.cap, 10) || 0),       // seasonal: optional cap on concurrent weddings (0 = unlimited)
  };
}
function canCreateWedding(v) {
  if (!v.active) return { ok: false, reason: "inactive" };
  const L = v.license || {};
  if (L.type === "per_wedding") {
    if (L.quota && (v.used || 0) >= L.quota) return { ok: false, reason: "quota_reached" };
    return { ok: true };
  }
  // seasonal — allowed within the season window; optional cap on how many weddings at once
  const now = Date.now();
  if (L.seasonStart && now < Date.parse(L.seasonStart)) return { ok: false, reason: "before_season" };
  if (L.seasonEnd && now > Date.parse(L.seasonEnd) + 86400000) return { ok: false, reason: "after_season" };
  if (L.cap && (v.weddings || []).length >= L.cap) return { ok: false, reason: "cap_reached" };
  return { ok: true };
}
function publicVenue(v) {   // returned to the venue itself (no key)
  return { id: v.id, name: v.name, contact: v.contact, license: v.license, used: v.used || 0,
    active: v.active, createdAt: v.createdAt, weddingCount: (v.weddings || []).length };
}
function adminVenue(v) {     // returned to the owner — strips per-wedding editKeys
  return { ...publicVenue(v), weddings: (v.weddings || []).map(w => ({ planId: w.planId, label: w.label, createdAt: w.createdAt })) };
}
async function addVenueIndex(env, id) {
  const ids = safeParse(await env.PLANS.get("venues:index")) || [];
  if (!ids.includes(id)) { ids.push(id); await env.PLANS.put("venues:index", JSON.stringify(ids)); }
}
async function removeVenueIndex(env, id) {
  const ids = (safeParse(await env.PLANS.get("venues:index")) || []).filter(x => x !== id);
  await env.PLANS.put("venues:index", JSON.stringify(ids));
}
