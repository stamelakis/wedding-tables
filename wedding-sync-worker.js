// Cloudflare Worker for the wedding seating planner cloud sync.
// Binding required: KV namespace bound as PLANS (namespace "wedding-plans").
// Routes:
//   POST /plans            {name, plan}                         -> {id, editKey, updated}
//   GET  /plans/:id                                             -> {name, plan, updated}
//   PUT  /plans/:id        {name?, plan?}  header X-Edit-Key    -> {ok, updated}   (403 on bad key)
//   GET  /codes/:code                                           -> {plans:[{id, editKey, name, updated}]}
//   POST /codes/:code      {id, editKey, name, updated}         -> {ok, count}     (register a plan under a sync code)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, X-Edit-Key",
  "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  "Access-Control-Max-Age": "86400",
};
function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...CORS } });
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const parts = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "").split("/");
    try {
      // ---------- plans ----------
      if (parts[0] === "plans") {
        if (parts.length === 1 && request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          const id = rnd(22), editKey = rnd(28);
          const rec = { name: String(body.name || "Untitled").slice(0, 120), plan: body.plan ?? null, editKey, updated: Date.now() };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          return json({ id, editKey, updated: rec.updated });
        }
        if (parts.length === 2 && request.method === "GET") {
          const raw = await env.PLANS.get("plan:" + parts[1]);
          if (!raw) return json({ error: "not found" }, 404);
          const rec = JSON.parse(raw);
          return json({ name: rec.name, plan: rec.plan, updated: rec.updated });
        }
        if (parts.length === 2 && request.method === "PUT") {
          const raw = await env.PLANS.get("plan:" + parts[1]);
          if (!raw) return json({ error: "not found" }, 404);
          const rec = JSON.parse(raw);
          if (request.headers.get("X-Edit-Key") !== rec.editKey) return json({ error: "bad edit key" }, 403);
          const body = await request.json().catch(() => ({}));
          if (body.plan !== undefined) rec.plan = body.plan;
          if (body.name) rec.name = String(body.name).slice(0, 120);
          rec.updated = Date.now();
          await env.PLANS.put("plan:" + parts[1], JSON.stringify(rec));
          return json({ ok: true, updated: rec.updated });
        }
      }
      // ---------- codes (link a person's devices under one shared code) ----------
      if (parts[0] === "codes" && parts.length === 2 && parts[1]) {
        const key = "code:" + parts[1].toLowerCase();
        if (request.method === "GET") {
          const raw = await env.PLANS.get(key);
          return json({ plans: raw ? (JSON.parse(raw).plans || []) : [] });
        }
        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));
          if (!body.id) return json({ error: "missing id" }, 400);
          const raw = await env.PLANS.get(key);
          const idx = raw ? JSON.parse(raw) : { plans: [] };
          idx.plans = (idx.plans || []).filter(p => p.id !== body.id);
          idx.plans.push({ id: body.id, editKey: body.editKey || "", name: String(body.name || "Untitled").slice(0, 120), updated: body.updated || Date.now() });
          if (idx.plans.length > 200) idx.plans = idx.plans.slice(-200);
          await env.PLANS.put(key, JSON.stringify(idx));
          return json({ ok: true, count: idx.plans.length });
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      return json({ error: String(e) }, 500);
    }
  },
};

function rnd(n) {
  const c = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const a = crypto.getRandomValues(new Uint8Array(n));
  let s = ""; for (let i = 0; i < n; i++) s += c[a[i] % c.length];
  return s;
}
