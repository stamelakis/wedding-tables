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
//   PUT    /plans/:id/amelie {link} · DELETE /plans/:id/amelie · POST /plans/:id/amelie/pull {since?}
//          (the couple's Amelie RSVP link — any role that writes guest names; see "Amelie" below)
//   POST   /claim {token, nonce}  (a couple opens the link TakeaSeat sent — once)
//   POST   /recover {email, lang} · POST /recover/couple {token, nonce} · POST /recover/venue {token, secret?}
//   POST   /verify {token} · POST /plans/:id/email {email} · POST /venues/:id/email {email}
// Lifecycle: every plan has a wedding date (POST /plans/:id/date, venue console, admin). The day after it the plan becomes
// view-only for everyone and N days later (default 7) it is deleted — the admin can change this globally, per venue, per
// couple, per plan. Couples who bought directly get a keepsake PDF by mail. GET /plans/:id/pdf renders floor plan / keepsake.
// Email (env.MAIL, optional): with mail on, every link and key goes straight to the couple's / venue's own email and the
// admin API never returns one; people recover on their own. Without mail, links are shown to the admin as before.
//   GET/POST/DELETE /codes/:code  (device linking; the code is a shared secret)
//   /admin/venues[/:id[/reset-key]] · /admin/couples[/:id[/reset]] · GET /admin/support          (X-Owner-Key)
//   POST /admin/recover {email} · POST /admin/recover/claim {token, nonce}   (public: the owner forgot the admin key)
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

// ---- email ----
const EMAIL_RE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[A-Za-z]{2,}$/;
const normEmail = x => { x = String(x || "").trim().toLowerCase(); return (x.length <= 200 && EMAIL_RE.test(x)) ? x : ""; };
const maskEmail = e => { const [u, d] = String(e || "").split("@"); return d ? (u.slice(0, 2) + "***@" + d) : ""; };
const mailOn = env => !!(env.MAIL && env.MAIL.enabled && typeof env.MAIL.send === "function");
const PLANNER_FILE = { el: "seating-planner-el.html", en: "seating-planner.html", de: "seating-planner-de.html" };
const langOf = l => (typeof l === "string" && Object.prototype.hasOwnProperty.call(PLANNER_FILE, l)) ? l : "el";
const baseUrl = env => String(env.PUBLIC_URL || "https://takeaseat.gr").replace(/\/+$/, "");   // never from the request's Host
const plannerUrl = (env, lang) => baseUrl(env) + "/" + PLANNER_FILE[langOf(lang)];
const RECOVER_TTL = 3600000, SETUP_TTL = 7 * 86400000, VERIFY_TTL = 86400000, TOKEN_RETRY = 15 * 60000;
const MAILS_PER_HOUR = 3, OWNER_MAILS_PER_DAY = 8;   // an admin mailbox should never be usable as a bullhorn
// A JSON object body, or {} (never null / an array / a string).
async function readBody(request) { const b = await request.json().catch(() => null); return (b && typeof b === "object" && !Array.isArray(b)) ? b : {}; }
// Links sent by mail carry the record's link generation (lgen): a new email address, a new key or a newer mailed link
// retires every link sent before it.
const nextGen = o => { o.lgen = (o.lgen || 0) + 1; return o.lgen; };
// ---- wedding date & lifecycle ----
const DAY = 86400000, FALLBACK_DAYS = 548, TRASH_DAYS = 14, DATE_CHANGES = 3, DATE_AHEAD_DAYS = 730, MAX_KEEP_DAYS = 3650;
const DEFAULT_RETENTION = { keepDays: 7, lockAfter: true, keep: false };
// Couple phases: a couple who buys directly waits out the 14-day withdrawal period (the payment day doesn't count, so the
// planner opens at 00:00 on day 15); everyone
// arranges the room only in the last 30 days; a couple's one date change freezes the plan until 14 days before the new date.
const OPEN_DELAY_DAYS = 15, FULL_WINDOW_DAYS = 30, START_NOW_MAX_DAYS = 21, COUPLE_DATE_CHANGES = 1, FREEZE_BEFORE_DAYS = 14;
const NAMES_PERMS = { floor: false, decor: true, layout: false, tables: false, seats: true, labels: true, maxSeats: 0 };   // decor: the couple's own items (venue items follow the venue's permission)
const STARTER_GUEST_TABLES = 8;   // a new plan starts with 8 guest tables + the head table
const andPerms = (p, q) => { const o = {}; for (const k of PERM_KEYS) o[k] = !!(p[k] && q[k]); o.maxSeats = p.maxSeats || 0; return o; };
const ymdOk = s => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && (d => !isNaN(d) && d.toISOString().slice(0, 10) === s)(new Date(s + "T00:00:00Z"));
const addDays = (ymd, n) => new Date(Date.parse(ymd + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);
const addYears = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); const dd = (m === 2 && d === 29) ? 28 : d; return `${y + n}-${String(m).padStart(2, "0")}-${String(dd).padStart(2, "0")}`; };
const todayAthens = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
function athensMidnight(ymd) {   // 00:00 Europe/Athens of that day, in ms (EET/EEST; DST never switches at midnight)
  const utc = Date.parse(ymd + "T00:00:00Z");
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Athens", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })
    .formatToParts(new Date(utc)).filter(x => x.type !== "literal").map(x => [x.type, +x.value]));
  return utc - (Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) - utc);
}
function normRetention(x) {   // {keepDays?, lockAfter?, keep?} — only what was given; null if nothing
  if (!x || typeof x !== "object") return null;
  const o = {};
  if (x.keepDays != null && x.keepDays !== "") { const k = parseInt(x.keepDays, 10); if (Number.isFinite(k)) o.keepDays = Math.max(0, Math.min(MAX_KEEP_DAYS, k)); }
  if (typeof x.lockAfter === "boolean") o.lockAfter = x.lockAfter;
  if (typeof x.keep === "boolean") o.keep = x.keep;
  return Object.keys(o).length ? o : null;
}
function policyOf(settings, ...layers) {   // global settings < venue / couple < plan
  const out = { ...DEFAULT_RETENTION, ...(normRetention(settings && settings.retention) || {}) };
  for (const l of layers) Object.assign(out, normRetention(l) || {});
  return out;
}
async function getSettings(env) { return safeParse(await env.PLANS.get("meta:settings")) || {}; }
async function lifecycleSince(env) {   // plans older than this feature count their fallback from its first day
  const m = safeParse(await env.PLANS.get("meta:lifecycle"));
  if (m && m.since) return m.since;
  const since = Date.now(); await env.PLANS.put("meta:lifecycle", JSON.stringify({ since })); return since;
}
// lockAt = the day after the wedding (Athens). No date yet: 18 months after the plan was made (so a plan is never reused forever).
function lifeOf(rec, pol, since, dateOverride) {
  if (!rec || rec.template) return { weddingDate: null, lockAt: null, deleteAt: null, over: false, locked: false, keep: true, fallback: false, phase: "full", opensAt: null, fullAt: null, frozenUntil: null };
  const wd = ymdOk(rec.weddingDate) ? rec.weddingDate : (ymdOk(dateOverride) ? dateOverride : null);
  const now = Date.now();
  const lockAt = wd ? athensMidnight(addDays(wd, 1)) : (rec.createdAt || since || now) + FALLBACK_DAYS * DAY;
  const over = now >= lockAt, locked = over && !!pol.lockAfter;
  // the couple's phase (venues, support and the admin are never limited by it)
  const opensAt = rec.opensAt || null, frozenUntil = (rec.frozenUntil && rec.frozenUntil > now) ? rec.frozenUntil : null;
  const fullAt = wd ? athensMidnight(addDays(wd, -FULL_WINDOW_DAYS)) : null;
  const phase = locked ? "locked" : over ? "full" : (opensAt && now < opensAt) ? "waiting" : frozenUntil ? "frozen" : (fullAt && now < fullAt) ? "names" : "full";
  return { weddingDate: wd, lockAt, deleteAt: pol.keep ? null : lockAt + pol.keepDays * DAY, over, locked, keep: !!pol.keep, fallback: !wd, phase, opensAt, fullAt, frozenUntil };
}
// What a couple may change right now: the venue's permissions, narrowed by the phase. null = nothing (waiting / frozen).
function couplePerms(a, L) {
  const base = (a.restricted && a.layoutSet) ? a.perms : { ...ALL_OPEN };
  if (L.phase === "waiting" || L.phase === "frozen") return null;
  return L.phase === "names" ? andPerms(base, NAMES_PERMS) : base;
}
// A couple's extra plans (made with parentId) have no life of their own: they follow the licence's main plan — its date,
// its lock, its deletion — so one paid wedding can never become a second one.
async function planLife(env, rec, id, ctx) {
  ctx = ctx || {};
  const settings = ctx.settings || await getSettings(env), since = ctx.since || await lifecycleSince(env);
  const own = ownerOf(rec); let layer = null;
  if (own.type === "venue") { const v = ctx.venue !== undefined ? ctx.venue : safeParse(await env.PLANS.get("venue:" + own.venueId)); layer = v && v.retention; }
  else if (rec.coupleId) {
    const c = ctx.couple !== undefined ? ctx.couple : safeParse(await env.PLANS.get("couple:" + rec.coupleId)); layer = c && c.retention;
    if (c && c.planId && c.planId !== id) {
      const main = c.purgedAt ? null : safeParse(await env.PLANS.get("plan:" + c.planId));
      if (!main) { const now = Date.now(); return { weddingDate: null, lockAt: now, deleteAt: now, over: true, locked: true, keep: false, fallback: false, child: true }; }
      const L = lifeOf({ ...rec, weddingDate: main.weddingDate || null, createdAt: main.createdAt || rec.createdAt, opensAt: main.opensAt || null, frozenUntil: main.frozenUntil || null },
        policyOf(settings, layer, main.retention, rec.retention), since);
      return { ...L, child: true };
    }
  }
  return lifeOf(rec, policyOf(settings, layer, rec.retention), since);
}
// Setting the date: from today up to 2 years ahead, the first time free then 3 changes, never cleared, not after the wedding.
// These limits stop one paid wedding from being reused for others; the admin is not limited.
function applyDate(rec, date, L, byAdmin, maxChanges, freeze) {
  if (date === null && byAdmin) { rec.weddingDate = null; return null; }
  if (!ymdOk(date)) return "bad_date";
  if (!byAdmin) {
    if (L && (L.over || L.locked || L.child)) return L.child ? "unauthorized" : "locked";   // after the wedding the date is frozen, even when the plan stays editable
    const today = todayAthens();
    if (date < today || date > addDays(today, DATE_AHEAD_DAYS)) return "bad_date";
    if (rec.weddingDate && rec.weddingDate !== date) {
      if ((rec.dateChanges || 0) >= (maxChanges || DATE_CHANGES)) return "no_more_changes";
      rec.dateChanges = (rec.dateChanges || 0) + 1;
      if (freeze) { const until = athensMidnight(addDays(date, -FREEZE_BEFORE_DAYS)); rec.frozenUntil = until > Date.now() ? until : null; }   // a couple's change: view-only until 14 days before
    }
  }
  rec.weddingDate = date; return null;
}
const lifeOut = (L, rec, canEdit, maxChanges) => { const max = maxChanges || DATE_CHANGES;
  return { ...L, dateEditable: !!canEdit && !L.over && !L.locked && !L.child && (!rec.weddingDate || (rec.dateChanges || 0) < max),
    dateChangesLeft: Math.max(0, max - (rec.dateChanges || 0)) }; };
const PDF_WORDS = { el: ["κάτοψη", "αναμνηστικό"], en: ["floor plan", "keepsake"], de: ["Grundriss", "Erinnerung"] };
const wellFormed = x => (typeof x.toWellFormed === "function" ? x.toWellFormed() : x);
const pdfName = (name, mode, lang) => ([...wellFormed(String(name || "TakeaSeat"))].slice(0, 80).join("").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").trim() || "TakeaSeat")
  + " — " + PDF_WORDS[langOf(lang)][mode === "keepsake" ? 1 : 0] + ".pdf";
function pdfResponse(render, name, mode, lang) {   // render: a Promise of the bytes — consumed after the request left the API queue
  const body = new ReadableStream({ async start(ctrl) { try { ctrl.enqueue(new Uint8Array(await render)); ctrl.close(); } catch (e) { ctrl.error(e); } } });
  return new Response(body, { status: 200, headers: { ...CORS, "Content-Type": "application/pdf", "Cache-Control": "no-store",
    "Content-Disposition": "attachment; filename=\"takeaseat.pdf\"; filename*=UTF-8''" + encodeURIComponent(pdfName(name, mode, lang)) } });
}
function send(env, to, msg) { if (!mailOn(env) || !to) return false; try { return env.MAIL.send({ to, subject: msg.subject, text: msg.text, ...(msg.attachments ? { attachments: msg.attachments } : {}) }) !== false; } catch (e) { return false; } }
// Plain-text emails (names are user text: never HTML). {x} placeholders.
const MAILS = {
  el: {
    claim: ["Το τραπεζολόγιό σας — TakeaSeat", "Γεια σας!\n\nΤο τραπεζολόγιο «{name}» σας περιμένει. Ανοίξτε τον σύνδεσμο στο Chrome ή στο Safari και πατήστε «Άνοιγμα του σχεδίου μου»:\n\n{link}\n\nΟ σύνδεσμος ανοίγει μία φορά και ισχύει 30 ημέρες. Η TakeaSeat δεν ανοίγει το σχέδιό σας χωρίς πρόσκλησή σας — κάθε πρόσβαση καταγράφεται.\nΑν χάσετε τον σύνδεσμο, ζητήστε νέο με αυτό το email: {recover}\n\nTakeaSeat"],
    recover: ["Οι σύνδεσμοί σας — TakeaSeat", "Γεια σας!\n\nΖητήσατε πρόσβαση στο TakeaSeat με αυτό το email:\n\n{items}\n\nΚάθε σύνδεσμος ανοίγει μία φορά. Οι σύνδεσμοι ανάκτησης ισχύουν μία ώρα. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα — τίποτα δεν αλλάζει.\n\nTakeaSeat"],
    itemCouple: "Τραπεζολόγιο «{name}»: {link}", itemClaim: "Τραπεζολόγιο «{name}» (πρώτο άνοιγμα — ισχύει έως {until}): {link}", itemVenue: "Κονσόλα «{name}» — ορίστε νέο κωδικό: {link}",
    relink: ["Ο σύνδεσμός σας — TakeaSeat", "Γεια σας!\n\nΚατόπιν αιτήματός σας, ορίστε σύνδεσμος για να ανοίξετε ξανά το τραπεζολόγιο «{name}» σε αυτή ή σε νέα συσκευή:\n\n{link}\n\nΙσχύει 7 ημέρες και ανοίγει μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.\n\nTakeaSeat"],
    venueReset: ["Νέος κωδικός κονσόλας — TakeaSeat", "Γεια σας,\n\nΟρίστε νέο κωδικό για την κονσόλα «{name}» εδώ (ο σύνδεσμος ισχύει 7 ημέρες και ανοίγει μία φορά):\n\n{link}\n\nΟ τωρινός κωδικός λειτουργεί μέχρι να χρησιμοποιήσετε τον σύνδεσμο. Αν δεν το ζητήσατε εσείς, γράψτε μας στο info@takeaseat.gr.\n\nTakeaSeat"],
    setup: ["Η κονσόλα του κτήματός σας — TakeaSeat", "Καλώς ήρθατε στο TakeaSeat!\n\nΟρίστε τον κωδικό της κονσόλας για το «{name}» εδώ (ο σύνδεσμος ισχύει 7 ημέρες):\n\n{link}\n\nΟ κωδικός δεν εμφανίζεται πουθενά αλλού — ούτε στη διαχείριση της TakeaSeat. Αν τον ξεχάσετε, ζητήστε νέο με αυτό το email από την κονσόλα.\n\nTakeaSeat"],
    verify: ["Επιβεβαίωση email — TakeaSeat", "Γεια σας!\n\nΕπιβεβαιώστε ότι αυτό το email θα χρησιμοποιείται για την ανάκτηση του «{name}» (ο σύνδεσμος ισχύει 24 ώρες):\n\n{link}\n\nΑν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.\n\nTakeaSeat"],
    changed: ["Το email ανάκτησης άλλαξε — TakeaSeat", "Γεια σας,\n\nΤο email ανάκτησης για το «{name}» άλλαξε σε {email} ({by}).\nΑν δεν το περιμένατε, γράψτε μας αμέσως στο info@takeaseat.gr.\n\nTakeaSeat"],
    byOwner: "από εσάς", byAdmin: "από την TakeaSeat, κατόπιν αιτήματος",
    keepsake: ["Το αναμνηστικό του γάμου σας — TakeaSeat", "Συγχαρητήρια!\n\nΣας στέλνουμε, ως μικρό αναμνηστικό, το τραπεζολόγιο του γάμου σας «{name}» ({date}): όλοι όσοι γιόρτασαν μαζί σας και πού κάθισαν. Θα το βρείτε συνημμένο σε PDF.\n\nΤο σχέδιο είναι πλέον μόνο για προβολή και θα διαγραφεί οριστικά στις {until}. Αν θέλετε να το κρατήσετε, αποθηκεύστε το συνημμένο αρχείο.\n\nΣας ευχόμαστε κάθε ευτυχία!\nTakeaSeat"],
    ownerVerify: ["Επιβεβαίωση διεύθυνσης ανάκτησης — TakeaSeat", "Γεια σας,\n\nΑυτή η διεύθυνση ζητήθηκε ως διεύθυνση ανάκτησης για τη διαχείριση του TakeaSeat. Ανοίξτε τον σύνδεσμο για να την επιβεβαιώσετε:\n\n{link}\n\nΜέχρι να την επιβεβαιώσετε δεν ισχύει. Ο σύνδεσμος ισχύει μία ημέρα. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα.\n\nTakeaSeat"],
    ownerRecover: ["Πρόσβαση στη διαχείριση TakeaSeat", "Γεια σας,\n\nΖητήθηκε νέο κλειδί διαχείρισης για το TakeaSeat. Ανοίξτε τον σύνδεσμο και πατήστε το κουμπί για να δημιουργηθεί:\n\n{link}\n\nΟ σύνδεσμος ισχύει μία ώρα και ανοίγει μία φορά. Αν δεν το ζητήσατε εσείς, αγνοήστε αυτό το μήνυμα — δεν αλλάζει τίποτα.\n\nTakeaSeat"],
    ownerNewKey: ["Νέο κλειδί διαχείρισης — TakeaSeat", "Γεια σας,\n\nΔημιουργήθηκε νέο κλειδί διαχείρισης στις {at} μέσω του συνδέσμου ανάκτησης. Το προηγούμενο κλειδί ανάκτησης έπαψε να ισχύει.\n\nΑν δεν το κάνατε εσείς, μπείτε αμέσως στη διαχείριση και ακυρώστε το ή αλλάξτε το κλειδί στον διακομιστή.\n\nTakeaSeat"],
    ownerEmailSet: ["Διεύθυνση ανάκτησης διαχείρισης — TakeaSeat", "Γεια σας,\n\nΑυτή η διεύθυνση ορίστηκε ως διεύθυνση ανάκτησης για τη διαχείριση του TakeaSeat. Από εδώ θα μπορείτε να ζητήσετε νέο κλειδί αν το ξεχάσετε.\n\nTakeaSeat"],
    ownerEmailChanged: ["Η διεύθυνση ανάκτησης άλλαξε — TakeaSeat", "Γεια σας,\n\nΗ διεύθυνση ανάκτησης της διαχείρισης άλλαξε σε {email}. Αν δεν το κάνατε εσείς, ελέγξτε αμέσως τον διακομιστή.\n\nTakeaSeat"],
    renewSoon: ["Η συνδρομή σας ανανεώνεται στις {date} — TakeaSeat", "Γεια σας,\n\nΗ συνδρομή του «{name}» στο TakeaSeat ανανεώνεται αυτόματα στις {date} για την επόμενη σεζόν ({from} – {to}).\n\nΑν δεν θέλετε να ανανεωθεί, απενεργοποιήστε την αυτόματη ανανέωση από την κονσόλα σας έως τότε: {link}\n\nΓια οποιαδήποτε ερώτηση: info@takeaseat.gr · 697 735 5378 (10:00–14:00 και 17:00–21:00).\n\nTakeaSeat"],
    keepsakeKeep: ["Το αναμνηστικό του γάμου σας — TakeaSeat", "Συγχαρητήρια!\n\nΣας στέλνουμε, ως μικρό αναμνηστικό, το τραπεζολόγιο του γάμου σας «{name}» ({date}): όλοι όσοι γιόρτασαν μαζί σας και πού κάθισαν. Θα το βρείτε συνημμένο σε PDF.\n\nΣας ευχόμαστε κάθε ευτυχία!\nTakeaSeat"],
  },
  en: {
    claim: ["Your seating plan — TakeaSeat", "Hello!\n\nYour seating plan “{name}” is ready. Open the link in Chrome or Safari and press “Open my plan”:\n\n{link}\n\nThe link opens once and is valid for 30 days. TakeaSeat never opens your plan without your invitation — every access is logged.\nIf you lose the link, ask for a new one with this email: {recover}\n\nTakeaSeat"],
    recover: ["Your links — TakeaSeat", "Hello!\n\nYou asked for access to TakeaSeat with this email:\n\n{items}\n\nEach link opens once. Recovery links are valid for one hour. If this was not you, ignore this message — nothing changes.\n\nTakeaSeat"],
    itemCouple: "Seating plan “{name}”: {link}", itemClaim: "Seating plan “{name}” (first opening — valid until {until}): {link}", itemVenue: "Console “{name}” — set a new key: {link}",
    relink: ["Your link — TakeaSeat", "Hello!\n\nAs you asked, here is a link to open your seating plan “{name}” again on this or a new device:\n\n{link}\n\nIt is valid for 7 days and opens once. If this was not you, ignore this message.\n\nTakeaSeat"],
    venueReset: ["New console key — TakeaSeat", "Hello,\n\nSet a new key for the console “{name}” here (the link is valid for 7 days and opens once):\n\n{link}\n\nYour current key keeps working until you use the link. If this was not you, write to info@takeaseat.gr.\n\nTakeaSeat"],
    setup: ["Your venue console — TakeaSeat", "Welcome to TakeaSeat!\n\nSet the key of the console for “{name}” here (the link is valid for 7 days):\n\n{link}\n\nThe key is not shown anywhere else — not even in TakeaSeat's own admin. If you forget it, ask for a new one with this email from the console.\n\nTakeaSeat"],
    verify: ["Confirm your email — TakeaSeat", "Hello!\n\nPlease confirm that this email will be used to recover “{name}” (the link is valid for 24 hours):\n\n{link}\n\nIf this was not you, ignore this message.\n\nTakeaSeat"],
    changed: ["Your recovery email changed — TakeaSeat", "Hello,\n\nThe recovery email for “{name}” was changed to {email} ({by}).\nIf you did not expect this, write to info@takeaseat.gr right away.\n\nTakeaSeat"],
    byOwner: "by you", byAdmin: "by TakeaSeat, on request",
    keepsake: ["A keepsake of your wedding — TakeaSeat", "Congratulations!\n\nAs a small keepsake, here is the seating plan of your wedding “{name}” ({date}): everyone who celebrated with you and where they sat. You will find it attached as a PDF.\n\nThe plan is now view-only and will be deleted for good on {until}. If you want to keep it, save the attached file.\n\nWishing you every happiness!\nTakeaSeat"],
    ownerVerify: ["Confirm the recovery address — TakeaSeat", "Hello,\n\nThis address was asked to be the recovery address for the TakeaSeat admin console. Open the link to confirm it:\n\n{link}\n\nUntil you confirm it, it does not count. The link is valid for one day. If this was not you, ignore this message.\n\nTakeaSeat"],
    ownerRecover: ["TakeaSeat admin access", "Hello,\n\nA new admin key was requested for TakeaSeat. Open the link and press the button to create it:\n\n{link}\n\nThe link is valid for one hour and opens once. If this was not you, ignore this message — nothing changes.\n\nTakeaSeat"],
    ownerNewKey: ["New admin key — TakeaSeat", "Hello,\n\nA new admin key was created on {at} through the recovery link. The previous recovery key stopped working.\n\nIf this was not you, open the admin console at once and revoke it, or change the key on the server.\n\nTakeaSeat"],
    ownerEmailSet: ["Admin recovery address — TakeaSeat", "Hello,\n\nThis address is now the recovery address for the TakeaSeat admin console. From here you can ask for a new key if you forget it.\n\nTakeaSeat"],
    ownerEmailChanged: ["The admin recovery address changed — TakeaSeat", "Hello,\n\nThe admin recovery address was changed to {email}. If this was not you, check the server right away.\n\nTakeaSeat"],
    renewSoon: ["Your subscription renews on {date} — TakeaSeat", "Hello,\n\nThe TakeaSeat subscription of “{name}” renews automatically on {date} for the next season ({from} – {to}).\n\nIf you do not want it to renew, turn automatic renewal off in your console before then: {link}\n\nAny questions: info@takeaseat.gr · +30 697 735 5378 (10:00–14:00 and 17:00–21:00, Greek time).\n\nTakeaSeat"],
    keepsakeKeep: ["A keepsake of your wedding — TakeaSeat", "Congratulations!\n\nAs a small keepsake, here is the seating plan of your wedding “{name}” ({date}): everyone who celebrated with you and where they sat. You will find it attached as a PDF.\n\nWishing you every happiness!\nTakeaSeat"],
  },
  de: {
    claim: ["Ihr Sitzplan — TakeaSeat", "Hallo!\n\nIhr Sitzplan „{name}“ ist bereit. Öffnen Sie den Link in Chrome oder Safari und tippen Sie auf „Meinen Plan öffnen“:\n\n{link}\n\nDer Link öffnet einmal und gilt 30 Tage. TakeaSeat öffnet Ihren Plan nie ohne Ihre Einladung — jeder Zugriff wird protokolliert.\nWenn Sie den Link verlieren, fordern Sie mit dieser E-Mail einen neuen an: {recover}\n\nTakeaSeat"],
    recover: ["Ihre Links — TakeaSeat", "Hallo!\n\nSie haben mit dieser E-Mail Zugang zu TakeaSeat angefordert:\n\n{items}\n\nJeder Link öffnet einmal. Wiederherstellungslinks gelten eine Stunde. Wenn Sie das nicht waren, ignorieren Sie diese Nachricht — nichts ändert sich.\n\nTakeaSeat"],
    itemCouple: "Sitzplan „{name}“: {link}", itemClaim: "Sitzplan „{name}“ (erstes Öffnen — gültig bis {until}): {link}", itemVenue: "Konsole „{name}“ — neuen Schlüssel festlegen: {link}",
    relink: ["Ihr Link — TakeaSeat", "Hallo!\n\nWie gewünscht, hier ein Link, um Ihren Sitzplan „{name}“ auf diesem oder einem neuen Gerät wieder zu öffnen:\n\n{link}\n\nEr gilt 7 Tage und öffnet einmal. Wenn Sie das nicht waren, ignorieren Sie diese Nachricht.\n\nTakeaSeat"],
    venueReset: ["Neuer Konsolen-Schlüssel — TakeaSeat", "Hallo,\n\nLegen Sie hier einen neuen Schlüssel für die Konsole „{name}“ fest (der Link gilt 7 Tage und öffnet einmal):\n\n{link}\n\nIhr jetziger Schlüssel funktioniert, bis Sie den Link benutzen. Wenn Sie das nicht waren, schreiben Sie an info@takeaseat.gr.\n\nTakeaSeat"],
    setup: ["Ihre Location-Konsole — TakeaSeat", "Willkommen bei TakeaSeat!\n\nLegen Sie hier den Schlüssel der Konsole für „{name}“ fest (der Link gilt 7 Tage):\n\n{link}\n\nDer Schlüssel wird nirgendwo sonst angezeigt — auch nicht in der Verwaltung von TakeaSeat. Wenn Sie ihn vergessen, fordern Sie in der Konsole mit dieser E-Mail einen neuen an.\n\nTakeaSeat"],
    verify: ["E-Mail bestätigen — TakeaSeat", "Hallo!\n\nBitte bestätigen Sie, dass diese E-Mail zur Wiederherstellung von „{name}“ verwendet wird (der Link gilt 24 Stunden):\n\n{link}\n\nWenn Sie das nicht waren, ignorieren Sie diese Nachricht.\n\nTakeaSeat"],
    changed: ["Ihre Wiederherstellungs-E-Mail wurde geändert — TakeaSeat", "Hallo,\n\nDie Wiederherstellungs-E-Mail für „{name}“ wurde auf {email} geändert ({by}).\nWenn Sie das nicht erwartet haben, schreiben Sie sofort an info@takeaseat.gr.\n\nTakeaSeat"],
    byOwner: "von Ihnen", byAdmin: "von TakeaSeat, auf Anfrage",
    keepsake: ["Eine Erinnerung an Ihre Hochzeit — TakeaSeat", "Herzlichen Glückwunsch!\n\nAls kleine Erinnerung senden wir Ihnen den Sitzplan Ihrer Hochzeit „{name}“ ({date}): alle, die mit Ihnen gefeiert haben, und wo sie saßen. Sie finden ihn als PDF im Anhang.\n\nDer Plan ist jetzt nur noch lesbar und wird am {until} endgültig gelöscht. Wenn Sie ihn behalten möchten, speichern Sie die angehängte Datei.\n\nAlles Glück der Welt!\nTakeaSeat"],
    ownerVerify: ["Wiederherstellungsadresse bestätigen — TakeaSeat", "Hallo,\n\nDiese Adresse wurde als Wiederherstellungsadresse für die TakeaSeat-Verwaltung angefordert. Öffnen Sie den Link, um sie zu bestätigen:\n\n{link}\n\nBis zur Bestätigung gilt sie nicht. Der Link ist einen Tag gültig. Wenn Sie das nicht waren, ignorieren Sie diese Nachricht.\n\nTakeaSeat"],
    ownerRecover: ["TakeaSeat-Verwaltungszugang", "Hallo,\n\nFür TakeaSeat wurde ein neuer Verwaltungsschlüssel angefordert. Öffnen Sie den Link und drücken Sie die Schaltfläche, um ihn zu erstellen:\n\n{link}\n\nDer Link gilt eine Stunde und öffnet einmal. Wenn Sie das nicht waren, ignorieren Sie diese Nachricht — es ändert sich nichts.\n\nTakeaSeat"],
    ownerNewKey: ["Neuer Verwaltungsschlüssel — TakeaSeat", "Hallo,\n\nAm {at} wurde über den Wiederherstellungslink ein neuer Verwaltungsschlüssel erstellt. Der vorherige Wiederherstellungsschlüssel gilt nicht mehr.\n\nWenn Sie das nicht waren, öffnen Sie sofort die Verwaltung und widerrufen Sie ihn, oder ändern Sie den Schlüssel auf dem Server.\n\nTakeaSeat"],
    ownerEmailSet: ["Wiederherstellungsadresse der Verwaltung — TakeaSeat", "Hallo,\n\nDiese Adresse ist jetzt die Wiederherstellungsadresse für die TakeaSeat-Verwaltung. Von hier aus können Sie einen neuen Schlüssel anfordern, wenn Sie ihn vergessen.\n\nTakeaSeat"],
    ownerEmailChanged: ["Die Wiederherstellungsadresse wurde geändert — TakeaSeat", "Hallo,\n\nDie Wiederherstellungsadresse der Verwaltung wurde auf {email} geändert. Wenn Sie das nicht waren, prüfen Sie sofort den Server.\n\nTakeaSeat"],
    renewSoon: ["Ihr Abonnement verlängert sich am {date} — TakeaSeat", "Hallo,\n\nDas TakeaSeat-Abonnement von „{name}“ verlängert sich am {date} automatisch für die nächste Saison ({from} – {to}).\n\nWenn Sie keine Verlängerung wünschen, schalten Sie die automatische Verlängerung vorher in Ihrer Konsole aus: {link}\n\nFragen: info@takeaseat.gr · +30 697 735 5378 (10:00–14:00 und 17:00–21:00, griechische Zeit).\n\nTakeaSeat"],
    keepsakeKeep: ["Eine Erinnerung an Ihre Hochzeit — TakeaSeat", "Herzlichen Glückwunsch!\n\nAls kleine Erinnerung senden wir Ihnen den Sitzplan Ihrer Hochzeit „{name}“ ({date}): alle, die mit Ihnen gefeiert haben, und wo sie saßen. Sie finden ihn als PDF im Anhang.\n\nAlles Glück der Welt!\nTakeaSeat"],
  },
};
const fmtDay = (t, lang) => { try { return new Date(t).toLocaleDateString(langOf(lang) === "de" ? "de-DE" : langOf(lang) === "en" ? "en-GB" : "el-GR", { day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Athens" }); } catch (e) { return new Date(t).toISOString().slice(0, 10); } };
const fill = (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => (v[k] != null ? String(v[k]) : m));
function mailMsg(lang, kind, v) { const L = MAILS[langOf(lang)]; return { subject: fill(L[kind][0], v), text: fill(L[kind][1], v) }; }
async function indexEmail(env, email, kind, id, add) {
  if (!email) return;
  await kvUpdate(env, "email:" + email, ix => { ix = ix || {}; ix.couples = ix.couples || []; ix.venues = ix.venues || []; const k = kind === "venue" ? "venues" : "couples";
    const has = (ix[k] || []).includes(id); if (add === has) return null;
    ix[k] = add ? [...(ix[k] || []), id] : (ix[k] || []).filter(x => x !== id);
    return (ix.couples.length || ix.venues.length) ? ix : { __del: true }; });
}
async function freshClaim(env, c, main, force) {
  const gen = (main && main.keyGen) || 0;
  if (c.claimToken && force) { await env.PLANS.delete("claim:" + c.claimToken); c.claimToken = null; }
  if (c.claimToken) {
    const cl = safeParse(await env.PLANS.get("claim:" + c.claimToken));
    if (cl && cl.usedAt) return null;   // opened meanwhile
    if (cl && Date.now() - (cl.createdAt || 0) < CLAIM_TTL - 86400000 && (cl.gen || 0) === gen) return c.claimToken;
    if (cl) await env.PLANS.delete("claim:" + c.claimToken);
  }
  const token = rnd(32), now = Date.now();
  await env.PLANS.put("claim:" + token, JSON.stringify({ cid: c.id, planId: c.planId, createdAt: now, gen, reset: gen > 0 }));
  await kvUpdate(env, "couple:" + c.id, cp => { if (!cp) return null; cp.claimToken = token; cp.claimAt = now; cp.mailed = false; return cp; });
  c.claimToken = token; c.claimAt = now; c.mailed = false;
  return token;
}
async function mintToken(env, data, ttl) { const t = rnd(32); await env.PLANS.put("tok:" + t, JSON.stringify({ ...data, createdAt: Date.now(), ttl })); return t; }
// One use; the same device (nonce) may retry for 15 minutes when a response got lost.
async function takeToken(env, token, kinds, nonce) {
  token = String(token || ""); if (token.length < 20) return { error: "token_invalid" };
  const r = await kvUpdate(env, "tok:" + token, t => {
    if (!t || !kinds.includes(t.kind)) return { __res: { error: "token_invalid" } };
    if (Date.now() - t.createdAt > t.ttl) return { __res: { error: "token_expired" } };
    if (t.usedAt) return (nonce && t.nonce === nonce && Date.now() - t.usedAt < TOKEN_RETRY) ? { __res: { data: t, again: true } } : { __res: { error: "token_used", at: t.usedAt } };
    t.usedAt = Date.now(); t.nonce = String(nonce || "").slice(0, 64);
    return { __obj: t, __res: { data: t } };
  });
  return r.res || { error: "token_invalid" };
}
async function mailAllowed(env, email, bucket, perDay) {   // at most MAILS_PER_HOUR recovery (or confirmation) mails per address
  const r = await kvUpdate(env, "rlmail:" + bucket + ":" + email, a => { a = (Array.isArray(a) ? a : []).filter(t => Date.now() - t < 3600000);
    if (a.length >= MAILS_PER_HOUR) return { __res: false }; a.push(Date.now()); return { __obj: a, __res: true }; });
  if (!r.res || !perDay) return !!r.res;
  const d = await kvUpdate(env, "rlmailday:" + bucket + ":" + email, a => { a = (Array.isArray(a) ? a : []).filter(t => Date.now() - t < 86400000);
    if (a.length >= perDay) return { __res: false }; a.push(Date.now()); return { __obj: a, __res: true }; });
  return !!d.res;
}
// The admin key: the one in server.env, or a recovery key the owner issued by mail. Only its SHA-256 is stored, so a
// copy of the database never hands anyone the admin console.
async function sha256hex(x) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(x)));
  return [...new Uint8Array(b)].map(v => v.toString(16).padStart(2, "0")).join("");
}
const ownerRec = async env => safeParse(await env.PLANS.get("meta:owner")) || {};
async function ownerOk(request, env) {
  const k = request.headers.get("X-Owner-Key") || "";
  if (!k) return false;
  if (env.OWNER_KEY && eq(k, env.OWNER_KEY)) return true;
  const o = await ownerRec(env);
  return !!o.keyHash && eq(await sha256hex(k), o.keyHash);
}
async function markMailed(env, cid, email) { await kvUpdate(env, "couple:" + cid, cp => { if (!cp) return null; cp.mailed = true; cp.mailedTo = email; return cp; }); }
// Housekeeping (the server runs it hourly): expired one-time links, old rate-limit rows, old claim rows.
export async function sweep(env) {
  const out = { tok: 0, rlmail: 0, claim: 0 };
  if (typeof env.PLANS.list !== "function") return out;
  const now = Date.now();
  for (const k of (await env.PLANS.list("tok:")) || []) {
    const t = safeParse(await env.PLANS.get(k));
    const gone = t && ((t.cid && !(await env.PLANS.get("couple:" + t.cid))) || (t.vid && !(await env.PLANS.get("venue:" + t.vid))));
    if (!t || gone || now - (t.createdAt || 0) > (t.ttl || 0) + TOKEN_RETRY) { await env.PLANS.delete(k); out.tok++; }
  }
  for (const k of (await env.PLANS.list("rlmail:")) || []) {
    const a = safeParse(await env.PLANS.get(k));
    if (!Array.isArray(a) || a.every(x => now - x > 3600000)) { await env.PLANS.delete(k); out.rlmail++; }
  }
  for (const k of (await env.PLANS.list("claim:")) || []) {
    const c = safeParse(await env.PLANS.get(k));
    if (!c || now - (c.createdAt || 0) > CLAIM_TTL + 86400000) { await env.PLANS.delete(k); out.claim++; }
  }
  Object.assign(out, await lifecycleSweep(env, now), await renewSweep(env, now));
  return out;
}
// After the wedding: view only (+ a keepsake PDF by mail to couples who bought directly), deleted keepDays later.
async function lifecycleSweep(env, now) {
  const out = { locked: 0, keepsakes: 0, purged: 0, trash: 0 };
  const settings = await getSettings(env), since = await lifecycleSince(env);
  const venues = new Map(), couples = new Map();
  const cached = async (map, key) => { if (!map.has(key)) map.set(key, safeParse(await env.PLANS.get(key))); return map.get(key); };
  for (const k of (await env.PLANS.list("plan:")) || []) {
    const id = k.slice(5), rec = safeParse(await env.PLANS.get(k)); if (!rec) continue;
    const own = ownerOf(rec);
    if (rec.deletedAt) {   // a venue's trash
      if (now >= (rec.purgeAt || rec.deletedAt + TRASH_DAYS * DAY)) {
        await purgePlan(env, id); out.trash++;
        if (own.type === "venue") await kvUpdate(env, "venue:" + own.venueId, v => { if (!v) return null; v.trash = (v.trash || []).filter(t => t.planId !== id); return v; });
      }
      continue;
    }
    if (rec.template) continue;
    const v = own.type === "venue" ? await cached(venues, "venue:" + own.venueId) : null;
    const c = rec.coupleId ? await cached(couples, "couple:" + rec.coupleId) : null;
    const L = await planLife(env, rec, id, { settings, since, venue: v, couple: c });
    if (!L.over) continue;
    if (L.locked && !rec.lockedAt) {
      await kvUpdate(env, k, cur => { if (!cur) return null; cur.lockedAt = now; cur.support = null; delete cur.amelie; addAudit(cur, "system", "locked"); return cur; });   // a view-only plan never pulls again: the Amelie key goes too
      AMELIE_MEM.delete(id);
      await removeIndex(env, "support:index", id); out.locked++;
      if (own.type === "venue" && rec.support) await mirrorVenueSupport(env, own.venueId, id, null);
    }
    // The keepsake: once, to a couple who bought directly (main plan) — before any deletion; if it could not be made or
    // sent, the plan waits up to 3 more days for another try rather than disappearing without it.
    let holdPurge = false;
    if (!rec.keepsakeSentAt && c && c.planId === id && c.email && mailOn(env) && env.PDF && typeof env.PDF.render === "function"
        && isPlan(rec.plan) && rec.plan.tables.length) {
      let sent = false;
      try {
        const lang = langOf(c.lang), goneSoon = L.deleteAt && now < L.deleteAt;
        const pdf = await env.PDF.render(rec.plan, { name: rec.name, weddingDate: L.weddingDate, venueName: "", mode: "keepsake", lang });
        const msg = mailMsg(lang, goneSoon ? "keepsake" : "keepsakeKeep", { name: rec.name, date: L.weddingDate ? fmtDay(Date.parse(L.weddingDate + "T12:00:00Z"), lang) : "",
          until: goneSoon ? fmtDay(L.deleteAt - 1, lang) : "" });
        sent = send(env, c.email, { ...msg, attachments: [{ filename: pdfName(rec.name, "keepsake", lang), content: pdf, contentType: "application/pdf" }] });
        if (sent) { await kvUpdate(env, k, cur => { if (!cur) return null; cur.keepsakeSentAt = now; return cur; }); out.keepsakes++; }
      } catch (e) { console.error("keepsake failed for a plan: " + ((e && e.message) || e)); }
      if (!sent && L.deleteAt && now < L.deleteAt + 3 * DAY) holdPurge = true;
    }
    if (L.deleteAt && now >= L.deleteAt && !holdPurge) {
      await purgePlan(env, id); out.purged++;
      if (own.type === "venue") await kvUpdate(env, "venue:" + own.venueId, vv => { if (!vv) return null; vv.weddings = (vv.weddings || []).filter(w => w.planId !== id); return vv; });
      else if (c && c.planId === id) {   // the licence keeps its name and dates for the books; every address and the extra plans go
        for (const pid of (c.plans || [])) { const pr = safeParse(await env.PLANS.get("plan:" + pid)); if (pr && pr.coupleId === c.id) { await purgePlan(env, pid); out.purged++; } }
        if (c.claimToken) await env.PLANS.delete("claim:" + c.claimToken);
        await kvUpdate(env, "couple:" + c.id, cp => { if (!cp) return null;
          Object.assign(cp, { purgedAt: now, plans: [], email: "", contact: "", pendingVerify: null, claimToken: null, mailed: false, mailedTo: null, emailVerified: false }); return cp; });
        couples.delete("couple:" + c.id);
        if (c.email) { await indexEmail(env, c.email, "couple", c.id, false); await forgetEmail(env, c.email); }
      } else if (c) await kvUpdate(env, "couple:" + c.id, cp => { if (!cp) return null; cp.plans = (cp.plans || []).filter(x => x !== id); return cp; });
      console.log("lifecycle: deleted a " + own.type + " plan after the wedding");
    }
  }
  if (out.purged || out.trash) {   // device-link rows must not keep the names of plans that no longer exist
    for (const k of (await env.PLANS.list("code:")) || []) {
      const idx = safeParse(await env.PLANS.get(k)); if (!idx || !Array.isArray(idx.plans)) continue;
      const keep = [];
      for (const e of idx.plans) if (e && e.id && await env.PLANS.get("plan:" + e.id)) keep.push(e);
      if (keep.length !== idx.plans.length) await kvUpdate(env, k, cur => { if (!cur || !Array.isArray(cur.plans)) return null; const ids = new Set(keep.map(e => e.id)); cur.plans = cur.plans.filter(e => e && ids.has(e.id)); return cur; });
    }
  }
  return out;
}
// Seasonal licences renew by themselves (same dates, next year) unless the venue turned renewal off; the admin invoices.
// The venue is reminded by mail 30 and 7 days before (it can turn renewal off in its console until then).
function nextSeason(lic) {
  const len = ymdOk(lic.seasonStart) ? (Date.parse(lic.seasonEnd) - Date.parse(lic.seasonStart)) / DAY : 364;
  const years = Math.max(1, Math.ceil((len + 1) / 366));
  return { start: ymdOk(lic.seasonStart) ? addYears(lic.seasonStart, years) : addDays(lic.seasonEnd, 1), end: addYears(lic.seasonEnd, years) };
}
async function renewSweep(env, now) {
  const out = { renewed: 0, reminded: 0 };
  for (const k of (await env.PLANS.list("venue:")) || []) {
    let v = safeParse(await env.PLANS.get(k)), L = v && v.license;
    if (L && ((L.seasonEnd && !ymdOk(L.seasonEnd)) || (L.seasonStart && !ymdOk(L.seasonStart)))) {   // older records: one date format everywhere
      const r0 = await kvUpdate(env, k, cur => { if (!cur || !cur.license) return null; cur.license = { ...cur.license, seasonStart: normYmd(cur.license.seasonStart), seasonEnd: normYmd(cur.license.seasonEnd) }; return cur; });
      v = r0.obj; L = v && v.license;
    }
    if (L && L.type !== "per_wedding" && L.autoRenew !== false && ymdOk(L.seasonEnd) && v.email && mailOn(env) && v.active !== false) {
      const renewAt = Date.parse(L.seasonEnd) + DAY, left = (renewAt - now) / DAY;
      for (const d of [7, 30]) {   // the nearest pending reminder only (a venue created late gets one mail, not two)
        const tag = L.seasonEnd + ":" + d;
        if (left > 0 && left <= d && !(v.renewReminders || {})[tag]) {
          const ns = nextSeason(L), lang = langOf(v.lang);
          const ok = send(env, v.email, mailMsg(lang, "renewSoon", { name: v.name, date: fmtDay(renewAt, lang), from: fmtDay(Date.parse(ns.start + "T12:00:00Z"), lang), to: fmtDay(Date.parse(ns.end + "T12:00:00Z"), lang), link: baseUrl(env) + "/venue.html" }));
          if (ok) { await kvUpdate(env, k, cur => { if (!cur) return null; cur.renewReminders = { ...(cur.renewReminders || {}), [L.seasonEnd + ":7"]: d === 7 ? now : (cur.renewReminders || {})[L.seasonEnd + ":7"], [L.seasonEnd + ":30"]: now }; return cur; }); out.reminded++; }
          break;
        }
      }
    }
    if (!L || L.type === "per_wedding" || L.autoRenew === false || !ymdOk(L.seasonEnd) || now <= Date.parse(L.seasonEnd) + DAY) continue;
    // The terms promise a reminder 30 and 7 days before: no reminder sent (no email, mail off, a season that ended before
    // this feature) or an inactive venue → no automatic renewal; the admin sees the flag and renews by hand if agreed.
    const reminded = !!((v.renewReminders || {})[L.seasonEnd + ":7"] || (v.renewReminders || {})[L.seasonEnd + ":30"]);
    if (!reminded || v.active === false) {
      if (L.renewSkipped !== L.seasonEnd) { await kvUpdate(env, k, cur => { if (!cur || !cur.license) return null; cur.license = { ...cur.license, renewSkipped: cur.license.seasonEnd }; return cur; });
        console.log("licence: venue " + v.id + " season ended without automatic renewal (" + (v.active === false ? "inactive" : "no reminder sent") + ")"); }
      continue;
    }
    const r = await kvUpdate(env, k, cur => { const lic = cur && cur.license; if (!lic || lic.autoRenew === false || !ymdOk(lic.seasonEnd) || now <= Date.parse(lic.seasonEnd) + DAY) return null;
      const { start, end } = nextSeason(lic);
      cur.license = { ...lic, seasonStart: start, seasonEnd: end, renewedAt: now, invoiceDue: true, renewSkipped: null };
      cur.renewals = [...(cur.renewals || []), { at: now, from: start, to: end }].slice(-20);
      return cur; });
    if (r.obj && r.obj.license && r.obj.license.renewedAt === now) { out.renewed++; console.log("licence: venue " + v.id + " renewed automatically to " + r.obj.license.seasonEnd); }
  }
  return out;
}
async function forgetEmail(env, email) { if (email) { await env.PLANS.delete("rlmail:recover:" + email); await env.PLANS.delete("rlmail:verify:" + email); } }
function json(obj, status = 200, extra) {
  return new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...CORS, ...(extra || {}) } });   // never cached: a 410 must not outlive a restore
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

// ---- Amelie (amelie.gr digital invitations): the couple's RSVP answers become the plan's guest list ----
// The key of the couple's link (https://amelie.gr/g/#<key>) lives on the plan RECORD as rec.amelie = {key, at, by,
// lastVersion, lastPullAt, dead, retryAt, callAt, ok} — never in the plan JSON (view links read that), never in a
// response, a log line, a URL or an error. Only whether it exists and its state are ever returned (amelieOut).
// The server only fetches: the planner merges (mergeGuestList) and saves through its normal path with baseUpdated. A merge
// here would bump `updated`, and the planner's next 409 would adopt this plan over what the user was typing.
// Amelie's limits: 120 calls/hour per link; FAILED calls (wrong / dead keys) count per IP, 20/hour — and all of TakeaSeat
// is one IP. Hence: a 404 kills the key for good (no call with it ever again), one upstream call per plan per minute
// whoever asks, and calls with a key Amelie never accepted are budgeted (per customer and server-wide, see amelieReserve).
const AMELIE_URL = "https://amelie.gr/api/guests";   // the only address ever called — never one from a request (SSRF)
const AMELIE_LINK = /^https:\/\/amelie\.gr\/g\/#([A-Za-z0-9_-]{22,64})$/, AMELIE_KEY = /^[A-Za-z0-9_-]{22,64}$/, AMELIE_VER = /^[A-Za-z0-9_-]{1,64}$/;
const AMELIE_TIMEOUT = 8000, AMELIE_MAX_BYTES = 1024 * 1024, AMELIE_WINDOW = 60000, HOUR = 3600000;
// Calls with a key Amelie has not accepted yet, per rolling hour (Amelie allows 20 FAILED calls per IP, and all of TakeaSeat
// is one IP): 15 server-wide · 5 per customer — a couple's licence with ALL its plans, a venue with all its weddings, never
// one plan (extra plans are free to make) · a customer who already has one under way only while fewer than 10 are, so the
// last 5 stay for customers who have not tried this hour. A call Amelie ACCEPTS (doc / unchanged) frees its slot at once:
// only failed calls use the budget, as on Amelie's side.
const AMELIE_NEW_PER_HOUR = 15, AMELIE_NEW_SHARED = 10, AMELIE_NEW_PER_TENANT = 5;
// This process's memory of each plan's last upstream call (≤ 60 s): lets several devices share one call and its answer.
const AMELIE_MEM = new Map();   // planId → {gen, callAt, flight: {promise, resolve} | null, res}
const amelieOut = am => (am && am.key) ? { connected: true, at: am.at || null, dead: !!am.dead, lastPullAt: am.lastPullAt || null }
  : { connected: false, at: null, dead: false, lastPullAt: null };
// New keys because a key leaked (the admin's reset, the couple's own new links, the venue's new couple link): an Amelie link
// connected with the OLD key (by === role; null = whoever) may be the leaker's own invitation, which would keep feeding names
// into the list — it goes too, and the access log says so. A link the venue connected survives the couple's new keys.
function amelieDropFor(rec, role, who) {
  if (!rec.amelie || (role && rec.amelie.by !== role)) return false;
  delete rec.amelie; addAudit(rec, who, "amelie_off"); return true;
}
function amelieKeyOf(link) {   // the pasted link (or the bare key) → the key, or null
  if (typeof link !== "string" || link.length > 200) return null;
  const s = link.trim(), m = AMELIE_LINK.exec(s);
  return m ? m[1] : (AMELIE_KEY.test(s) ? s : null);
}
function amelieUrl(env) {   // tests / local dev only: AMELIE_API_URL may point at a mock ON THIS MACHINE; production sets none
  if (!env.AMELIE_API_URL) return AMELIE_URL;
  try { const u = new URL(env.AMELIE_API_URL); if (/^https?:$/.test(u.protocol) && ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)) return u.href; } catch (e) {}
  return null;   // anything else fails closed: a stray setting can never send a key somewhere else
}
// Whose budget a not-yet-accepted key uses: the customer's, never just the plan's.
function amelieTenant(rec, id) {
  const o = ownerOf(rec);
  if (o.type === "venue") return "v:" + o.venueId;
  if (rec.coupleId) return "c:" + rec.coupleId;
  return "p:" + (rec.rootId || id);   // a couple plan without a licence record: its extra plans (rootId) count with it
}
// The budget row meta:amelie-new = {tenant: [[time, slotId], …]}, only the last hour kept. Never holds a key.
function amelieSlots(o, now) {
  const out = Object.create(null);
  if (o && typeof o === "object" && !Array.isArray(o)) for (const k of Object.keys(o)) {
    const l = (Array.isArray(o[k]) ? o[k] : []).filter(e => Array.isArray(e) && typeof e[0] === "number" && now - e[0] < HOUR);
    if (l.length) out[k] = l;
  }
  return out;
}
const amSlotWait = (list, limit, now) => { const ts = list.map(e => e[0]).sort((a, b) => a - b); return amSecs(ts[Math.max(0, ts.length - limit)] + HOUR - now); };   // until one too many has aged out
// One atomic step: take a slot for this customer → {slot} | {wait: seconds}.
async function amelieReserve(env, tenant, now) {
  const slot = rnd(12);
  const r = await kvUpdate(env, "meta:amelie-new", cur => {
    const s = amelieSlots(cur, now), mine = s[tenant] || [], all = Object.values(s).flat();
    if (mine.length >= AMELIE_NEW_PER_TENANT) return { __res: { wait: amSlotWait(mine, AMELIE_NEW_PER_TENANT, now) } };
    const cap = mine.length ? AMELIE_NEW_SHARED : AMELIE_NEW_PER_HOUR;
    if (all.length >= cap) return { __res: { wait: amSlotWait(all, cap, now) } };
    s[tenant] = [...mine, [now, slot]];
    return { __obj: s, __res: { slot } };
  });
  return (r && r.res) || { wait: 60 };
}
async function amelieRelease(env, tenant, slot) {   // Amelie accepted the key: that call was not a failed one
  await kvUpdate(env, "meta:amelie-new", cur => {
    const s = amelieSlots(cur, Date.now());
    if (s[tenant]) { s[tenant] = s[tenant].filter(e => e[1] !== slot); if (!s[tenant].length) delete s[tenant]; }
    return { __obj: s };
  });
}
// The same rule as a guest-name save (PUT /plans/:id): nobody after the lock, the couple not while waiting / frozen.
async function amelieWritable(env, rec, id, a) {
  if (rec.template) return false;   // a venue's default space never has guests
  const L = await planLife(env, rec, id);
  return !L.locked && !(a.role === "couple" && couplePerms(a, L) === null);
}
// Only the fields of amelie-guests/1 reach the browser — nothing Amelie might add one day (never health data).
const amPrim = (v, strOnly) => typeof v === "string" ? v.slice(0, 500) : (!strOnly && ((typeof v === "number" && Number.isFinite(v)) || typeof v === "boolean")) ? v : undefined;
function amPick(o, keys, strOnly) { const out = {}; if (o && typeof o === "object" && !Array.isArray(o)) for (const k of keys) { const v = amPrim(o[k], strOnly); if (v !== undefined) out[k] = v; } return out; }
const amObjs = a => (Array.isArray(a) ? a : []).filter(x => x && typeof x === "object" && !Array.isArray(x));
function amelieDoc(d) {
  if (!d || typeof d !== "object" || Array.isArray(d) || d.format !== "amelie-guests/1" || typeof d.version !== "string" || !AMELIE_VER.test(d.version) || !Array.isArray(d.importGuests)) return null;
  const inv = (d.invitation && typeof d.invitation === "object") ? d.invitation : {};
  return { ok: true, format: d.format, version: d.version, generated_at: amPrim(d.generated_at, true) ?? null,
    invitation: { names: amPick(inv.names, ["a", "b"], true), ...amPick(inv, ["date", "status", "rsvp_open"]) },
    options: amObjs(d.options).map(o => amPick(o, ["key", "label", "attending"], true)),
    totals: amPick(d.totals, ["parties", "answers", "people_yes", "people_ceremony", "people_unknown", "parties_no"]),
    parties: amObjs(d.parties).map(p => amPick(p, ["id", "name", "named", "count", "choice", "label", "attending", "people", "answers", "first_at", "updated_at"])),
    importGuests: amObjs(d.importGuests).map(g => amPick(g, ["name", "party", "status", "note", "srcId"], true)) };
}
function retryAfterSecs(h) {   // Retry-After: seconds or an HTTP date → 1 s … 1 day (60 s when missing or unreadable)
  const s = String(h == null ? "" : h).trim();
  let n = /^\d+$/.test(s) ? parseInt(s, 10) : Math.ceil((Date.parse(s) - Date.now()) / 1000);
  if (!Number.isFinite(n)) n = 60;
  return Math.max(1, Math.min(86400, n));
}
// One call to Amelie → {kind: "doc", doc} | {kind: "unchanged", version} | {kind: "gone"} | {kind: "busy", retryAfter} |
// {kind: "fail", why}. No redirects, ~8 s for everything (headers AND body), the body counted as it streams and cut at 1 MB.
async function amelieCall(env, key, since) {
  const url = amelieUrl(env);
  if (!url) return { kind: "fail", why: "AMELIE_API_URL is not on this machine" };
  const go = typeof env.AMELIE_FETCH === "function" ? env.AMELIE_FETCH : fetch;   // AMELIE_FETCH: the tests' fake Amelie
  const ctrl = new AbortController(); let timer = null, reader = null;
  const readCapped = async r => {   // Content-Length is only a hint; the count is what decides
    if (+(r.headers.get("content-length") || 0) > AMELIE_MAX_BYTES) return null;
    if (!r.body) return "";
    reader = r.body.getReader(); const chunks = []; let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; n += value.byteLength; if (n > AMELIE_MAX_BYTES) return null; chunks.push(value); }
    const all = new Uint8Array(n); let o = 0; for (const c of chunks) { all.set(c, o); o += c.byteLength; }
    return new TextDecoder().decode(all);
  };
  const work = (async () => {
    let r;
    try {
      r = await go(url, { method: "POST", redirect: "manual", signal: ctrl.signal,
        headers: { "Content-Type": "application/json", "Accept": "application/json", "User-Agent": "TakeaSeat (+https://takeaseat.gr)" },
        body: JSON.stringify(since ? { token: key, since, format: "json" } : { token: key, format: "json" }) });
    } catch (e) { return { kind: "fail", why: ctrl.signal.aborted ? "timeout" : "network" }; }
    try {
      if (r.type === "opaqueredirect" || (r.status >= 300 && r.status < 400)) return { kind: "fail", why: "redirect" };
      if (r.status === 429) return { kind: "busy", retryAfter: retryAfterSecs(r.headers.get("retry-after")) };
      if (r.status !== 200 && r.status !== 404) return { kind: "fail", why: "status " + r.status };
      const text = await readCapped(r);
      if (text === null) return { kind: "fail", why: "too large" };
      let b; try { b = JSON.parse(text); } catch (e) { b = undefined; }
      // 404 counts only as Amelie's own answer: a misrouted deploy's HTML 404 must never kill every connected plan
      if (r.status === 404) return (b && b.error === "not_found") ? { kind: "gone" } : { kind: "fail", why: "status 404" };
      if (b === undefined) return { kind: "fail", why: "bad json" };
      if (b && b.unchanged === true && typeof b.version === "string" && AMELIE_VER.test(b.version)) return { kind: "unchanged", version: b.version };
      const doc = amelieDoc(b);
      return doc ? { kind: "doc", doc } : { kind: "fail", why: "not amelie-guests/1" };
    } catch (e) { return { kind: "fail", why: ctrl.signal.aborted ? "timeout" : "read" }; }
  })();
  const timeout = new Promise(res => { timer = setTimeout(() => res({ kind: "fail", why: "timeout" }), +env.AMELIE_TIMEOUT_MS || AMELIE_TIMEOUT); });
  try { return await Promise.race([work, timeout]); }
  finally { clearTimeout(timer); ctrl.abort(); if (reader) reader.cancel().catch(() => {}); }
}
const amSecs = ms => Math.max(1, Math.ceil(ms / 1000));
const amelieBusy = s => json({ error: "amelie_busy", retryAfter: s }, 429, { "Retry-After": String(s) });
function amelieReply(res, since) {
  if (res.kind === "doc") return (since && since === res.doc.version) ? json({ unchanged: true, version: since }) : json({ doc: res.doc });
  if (res.kind === "unchanged") return json({ unchanged: true, version: res.version });
  if (res.kind === "gone") return json({ error: "amelie_gone" }, 404);
  if (res.kind === "busy") return amelieBusy(res.retryAfter);
  if (res.kind === "none") return json({ error: "not_connected" }, 412);
  return json({ error: "amelie_unreachable" }, 502);
}
// Inside the minute after an upstream call: answer from what the server knows, never from Amelie.
async function amelieFromWindow(id, am, since) {
  const mem = AMELIE_MEM.get(id);
  const res = (mem && mem.gen === am.at && mem.callAt === am.callAt) ? (mem.flight ? await mem.flight.promise : mem.res) : null;   // a call still running: wait for its answer
  if (res && (res.kind === "doc" || res.kind === "gone" || res.kind === "busy" || res.kind === "none")) return amelieReply(res, since);
  const known = (res && res.kind === "unchanged") ? res.version : am.lastVersion;   // the newest version Amelie confirmed
  if (since && since === known) return json({ unchanged: true, version: since });
  if (res && res.kind === "fail") return json({ error: "amelie_unreachable" }, 502);   // Amelie just failed — not asked again this minute
  return amelieBusy(amSecs(am.callAt + AMELIE_WINDOW - Date.now()));   // this device needs the list, which only a new call brings
}
async function ameliePull(env, id, since) {
  const now = Date.now();
  for (const [k, e] of AMELIE_MEM) if (!e.flight && (now - e.callAt >= AMELIE_WINDOW || AMELIE_MEM.size > 500)) AMELIE_MEM.delete(k);
  // Decide and reserve in one atomic step: whoever gets here first in a minute calls Amelie; everyone else is answered.
  const r = await kvUpdate(env, "plan:" + id, cur => {
    const am = cur && cur.amelie;
    if (!am || !am.key) return { __res: { out: "not_connected" } };
    if (am.dead) return { __res: { out: "gone" } };
    if (am.retryAt && now < am.retryAt) return { __res: { out: "busy", s: amSecs(am.retryAt - now) } };
    if (am.callAt && now - am.callAt < AMELIE_WINDOW) return { __res: { out: "window", am } };
    am.callAt = now;
    let resolve; const flight = { promise: new Promise(ok => { resolve = ok; }), resolve: v => resolve(v) };
    AMELIE_MEM.set(id, { gen: am.at, callAt: now, flight, res: null });
    return { __obj: cur, __res: { out: "call", key: am.key, ok: !!am.ok, flight, tenant: amelieTenant(cur, id) } };
  });
  const d = (r && r.res) || { out: "not_connected" };
  if (d.out === "not_connected") return json({ error: "not_connected" }, 412);
  if (d.out === "gone") return json({ error: "amelie_gone" }, 404);
  if (d.out === "busy") return amelieBusy(d.s);
  if (d.out === "window") return amelieFromWindow(id, d.am, since);
  let got = { kind: "fail", why: "error" }, res = got, held = null;
  try {
    if (!d.ok) {   // Amelie has never accepted this key: it may be a typo or long dead — it needs a slot of the hourly budget
      held = await amelieReserve(env, d.tenant, now);
      if (held.wait) { res = got = { kind: "busy", retryAfter: held.wait, budget: true }; held = null; }   // not asked; told when to try again
    }
    if (!got.budget) {
      res = got = await amelieCall(env, d.key, since);
      if (held && (got.kind === "doc" || got.kind === "unchanged")) { const h = held; held = null; await amelieRelease(env, d.tenant, h.slot); }
      const w = await kvUpdate(env, "plan:" + id, cur => {
        const am = cur && cur.amelie;
        if (!am || !am.key) return { __res: "removed" };
        if (am.key !== d.key) return { __res: "replaced" };   // nothing Amelie said about the old link may land on the new one
        const t = Date.now();
        if (got.kind === "doc" || got.kind === "unchanged") { am.ok = true; am.lastPullAt = t; am.lastVersion = got.kind === "doc" ? got.doc.version : got.version; am.retryAt = null; }
        else if (got.kind === "gone") { am.dead = true; am.deadAt = t; }
        else if (got.kind === "busy") am.retryAt = t + got.retryAfter * 1000;
        else return { __res: "ok" };
        return { __obj: cur, __res: "ok" };   // `updated` never moves: this is not a change to the plan
      });
      // Disconnected while Amelie answered → not connected; a new link pasted meanwhile → "ask again now" (it has its own minute).
      if (w && w.res === "removed") res = { kind: "none" }; else if (w && w.res === "replaced") res = { kind: "busy", retryAfter: 1 };
    }
  } catch (e) { console.error("amelie: pull error " + ((e && e.name) || "")); }
  finally {
    const mem = AMELIE_MEM.get(id);
    if (mem && mem.flight === d.flight) { mem.flight = null; mem.res = res; }
    d.flight.resolve(res);
  }
  if (got.budget) console.log("amelie: a link Amelie has not accepted yet waits for the hourly budget (" + got.retryAfter + " s)");
  else if (got.kind === "fail") console.error("amelie: pull failed (" + got.why + ")");
  else if (got.kind === "gone") console.log("amelie: a link was revoked on Amelie" + (res === got ? " — marked, never called again" : ""));
  else if (got.kind === "busy") console.log("amelie: Amelie asked to wait " + got.retryAfter + " s");
  return amelieReply(res, since);
}

export default {
  async fetch(request, env) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    const parts = new URL(request.url).pathname.replace(/^\/+|\/+$/g, "").split("/");
    const newClient = request.headers.get("X-Client") === "2";
    try {
      if (parts[0] === "health" && parts.length === 1 && request.method === "GET") {
        await env.PLANS.get("meta:schema");
        return json({ ok: true, mail: mailOn(env) });
      }
      // ---------------- plans ----------------
      if (parts[0] === "plans") {
        if (parts.length === 1 && request.method === "POST") {
          // New couple plans come from a purchase (admin / claim link). A couple who already has one may put more online.
          const body = await request.json().catch(() => ({}));
          if (body.plan != null && !isPlan(body.plan)) return json({ error: "bad_plan" }, 422);
          if (tooBig(body.plan)) return json({ error: "plan too large" }, 413);
          let coupleId = null, rootId = null, ok = await ownerOk(request, env);
          if (!ok && body.parentId) {
            const parent = safeParse(await env.PLANS.get("plan:" + String(body.parentId)));
            if (parent && ownerOf(parent).type === "couple" && eq(request.headers.get("X-Edit-Key") || "", parent.editKey)) {
              const PL = await planLife(env, parent, String(body.parentId));
              if (PL.over) return json({ error: "wedding_over" }, 403);   // no new plans after the wedding
              if (PL.phase !== "full") return json({ error: "not_open", life: lifeOut(PL, parent, false) }, 403);   // extra plans only once the room is open
              ok = true; coupleId = parent.coupleId || null;
              if (!coupleId) rootId = parent.rootId || String(body.parentId);   // no licence record: the first plan stands for the customer (Amelie's budget)
            }
          }
          if (!ok) return json({ error: "not_allowed" }, 403);
          const id = rnd(22), editKey = rnd(28), readKey = rnd(24);
          const rec = { name: String(body.name || "Untitled").slice(0, 120), plan: body.plan ?? null, editKey, readKey, owner: { type: "couple" }, coupleId, ...(rootId ? { rootId } : {}), keyGen: 0, createdAt: Date.now(), updated: Date.now() };
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
        if (rec.deletedAt) return json({ error: "deleted" }, 410);   // in the venue's trash: only the admin can bring it back
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
          if (a.role === "couple" && a.owner.type === "couple" && rec.coupleId) {   // the couple's own recovery email
            const c = safeParse(await env.PLANS.get("couple:" + rec.coupleId));
            if (c && c.planId === id) { out.email = c.email || null; out.mail = mailOn(env); }
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
            if (!rec.template) out.amelie = amelieOut(rec.amelie);   // whether a link is connected and its state — never the key
          }
          const L = await planLife(env, rec, id), directCouple = a.role === "couple" && a.owner.type === "couple";
          out.life = lifeOut(L, rec, directCouple || a.role === "venue", directCouple ? COUPLE_DATE_CHANGES : DATE_CHANGES);   // never for extra plans
          if (a.role === "couple") { const cp = couplePerms(a, L); out.perms = cp || andPerms(a.perms, { floor: false, decor: false, layout: false, tables: false, seats: false, labels: false }); }
          return json(out);
        }
        if (parts.length === 2 && request.method === "PUT") {
          if (!a) return denied(request, rec);
          if (!a.write) return json({ error: "read_only" }, 403);
          const PL = await planLife(env, rec, id);
          if (PL.locked) return json({ error: "locked", life: lifeOut(PL, rec, false) }, 403);   // after the wedding: view only
          const phasePerms = a.role === "couple" ? couplePerms(a, PL) : undefined;
          if (phasePerms === null) return json({ error: "not_open", life: lifeOut(PL, rec, false) }, 403);   // not yet open / frozen after a date change
          const body = await request.json().catch(() => ({}));
          if (body.baseUpdated != null && rec.updated && body.baseUpdated < rec.updated) {
            return json({ error: "conflict", updated: rec.updated, name: rec.name, plan: rec.plan }, 409);
          }
          let plan, enforced = false;
          if (body.plan !== undefined) {
            if (!isPlan(body.plan)) return json({ error: "bad_plan" }, 422);
            if (tooBig(body.plan)) return json({ error: "plan too large" }, 413);
            plan = pinCounters(rec.plan, body.plan);
            if (rec.plan && Array.isArray(rec.plan.tables)) {
              const longs = new Set(rec.plan.tables.filter(t => t && t.shape === "rect").map(t => String(t.id)));
              if (longs.size) plan.tables.forEach(t => { if (t && t.shape === "round" && longs.has(String(t.id))) t.shape = "rect"; });
            }
            const actsForVenue = a.owner.type === "venue" && (a.role === "venue" || a.role === "support");   // on a venue plan only the venue can invite support
            if (actsForVenue) plan = stampVenue(rec.plan, plan);
            else if (phasePerms && PL.phase === "names" && !isPlan(rec.plan)) {   // first upload: the starting room, no more
              let guestT = 0, headT = 0;
              const keep = plan.tables.filter(t => { if (t && t.shape === "head") return ++headT <= 1; return ++guestT <= STARTER_GUEST_TABLES; });
              if (keep.length !== plan.tables.length) { plan = { ...plan, tables: keep }; enforced = true; }
            }
            else if (phasePerms && PL.phase === "names") { const e = enforcePerms(rec.plan, plan, phasePerms, a.owner.type === "venue"); enforced = reverted(e, plan); plan = e; }   // the room opens 30 days before
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
          const RL = await planLife(env, rec, id);
          if (RL.locked) return json({ error: "locked", life: lifeOut(RL, rec, false) }, 403);
          const rPerms = a.role === "couple" ? couplePerms(a, RL) : undefined;
          if (rPerms === null) return json({ error: "not_open", life: lifeOut(RL, rec, false) }, 403);
          const body = await request.json().catch(() => ({}));
          const h = safeParse(await env.PLANS.get("hist:" + id)) || [];
          const v = h.find(x => x.updated === Number(body.updated));
          if (!v || !isPlan(v.plan)) return json({ error: "version not found" }, 404);
          let plan = pinCounters(rec.plan, v.plan), enforced = false;
          if (rPerms && RL.phase === "names") { const e = enforcePerms(rec.plan, plan, rPerms, a.owner.type === "venue"); enforced = reverted(e, plan); plan = e; }
          else if (a.restricted && a.layoutSet) { const e = enforcePerms(rec.plan, plan, a.perms, true); enforced = reverted(e, plan); plan = e; }   // an old version never undoes the venue's locks
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
            cur.editKey = rnd(28); cur.readKey = rnd(24); cur.keyGen = (cur.keyGen || 0) + 1; cur.legacyOpenUntil = null; addAudit(cur, "couple", "rotate");
            amelieDropFor(cur, "couple", "couple"); return cur; });
          AMELIE_MEM.delete(id);
          return json({ ok: true, editKey: r.obj.editKey, readKey: r.obj.readKey });
        }
        if (parts.length === 3 && parts[2] === "email" && request.method === "POST") {   // the couple changes its recovery email (confirmed by mail)
          if (!a) return denied(request, rec);
          if (!(a.role === "couple" && a.owner.type === "couple" && rec.coupleId)) return json({ error: "unauthorized" }, 403);
          const c = safeParse(await env.PLANS.get("couple:" + rec.coupleId));
          if (!c || c.planId !== id) return json({ error: "unauthorized" }, 403);   // the licence's main plan only
          if (!mailOn(env)) return json({ error: "mail_off" }, 503);
          const b = await readBody(request);
          const email = normEmail(b.email); if (!email) return json({ error: "bad_email" }, 400);
          if (!(await mailAllowed(env, email, "verify"))) return json({ error: "rate_limited" }, 429);
          const t = await mintToken(env, { kind: "verify-couple", cid: c.id, email }, VERIFY_TTL);
          await kvUpdate(env, "couple:" + c.id, cp => { if (!cp) return null; cp.pendingVerify = t; return cp; });
          if (!send(env, email, mailMsg(b.lang || c.lang, "verify", { name: c.name, link: plannerUrl(env, b.lang || c.lang) + "#verify=" + t }))) return json({ error: "mail_failed" }, 503);
          return json({ ok: true, pending: maskEmail(email) });
        }
        if (parts.length === 3 && parts[2] === "date" && request.method === "POST") {   // the wedding date: the couple on its own plan, the venue on its wedding
          if (!a) return denied(request, rec);
          if (!((a.role === "couple" && a.owner.type === "couple") || (a.role === "venue" && !rec.template))) return json({ error: "unauthorized" }, 403);
          const b = await readBody(request);
          const L = await planLife(env, rec, id);
          if (L.child) return json({ error: "unauthorized" }, 403);   // an extra plan follows the main plan's date
          const direct = a.role === "couple";   // a couple who bought directly: one change, then view-only until 14 days before
          if (direct && (L.phase === "waiting" || L.phase === "frozen")) return json({ error: "not_open", life: lifeOut(L, rec, false) }, 403);
          let err = null;
          const r = await kvUpdate(env, key, cur => { if (!cur) return null; const before = cur.weddingDate || null; err = applyDate(cur, b.date, L, false, direct ? COUPLE_DATE_CHANGES : DATE_CHANGES, direct);
            if (err) return { __res: null };
            if (before !== cur.weddingDate) addAudit(cur, a.role, "date", 0, { d: cur.weddingDate });
            return cur; });
          if (err) return json({ error: err }, err === "bad_date" ? 400 : 403);
          if (!r.obj) return json({ error: "not found" }, 404);
          if (a.owner.type === "venue") await kvUpdate(env, "venue:" + a.owner.venueId, v => { if (!v) return null; const w = (v.weddings || []).find(x => x.planId === id); if (!w || w.date === r.obj.weddingDate) return null; w.date = r.obj.weddingDate; return v; });
          return json({ ok: true, life: lifeOut(await planLife(env, r.obj, id), r.obj, true, direct ? COUPLE_DATE_CHANGES : DATE_CHANGES) });
        }
        if (parts.length === 3 && parts[2] === "pdf" && request.method === "GET") {   // floor plan / keepsake — also after the wedding
          if (!a) return denied(request, rec);
          if (!env.PDF || typeof env.PDF.render !== "function") return json({ error: "pdf_off" }, 503);
          const q = new URL(request.url).searchParams;
          const mode = q.get("mode") === "keepsake" ? "keepsake" : "floor", lang = langOf(q.get("lang"));
          const L = await planLife(env, rec, id);
          let venueName = "";
          if (a.owner.type === "venue") { const v = safeParse(await env.PLANS.get("venue:" + a.owner.venueId)); venueName = v ? v.name : ""; }
          const render = env.PDF.render(isPlan(rec.plan) ? rec.plan : { tables: [] }, { name: rec.name, weddingDate: L.weddingDate, venueName, mode, lang });
          render.catch(() => {});   // failures surface while the body streams (the server answers 500)
          return pdfResponse(render, rec.name, mode, lang);
        }
        if (parts.length === 3 && parts[2] === "legacy-off" && request.method === "POST") {
          if (!a) return denied(request, rec);
          if (!(a.role === "couple" || a.role === "venue")) return json({ error: "unauthorized" }, 403);
          await kvUpdate(env, key, cur => { if (!cur || !cur.legacyOpenUntil) return null; cur.legacyOpenUntil = null; return cur; });
          return json({ ok: true });
        }
        // ---- Amelie: connect / disconnect the couple's RSVP link, and fetch its answers for the planner to merge ----
        // Whoever may write guest names (couple, venue, support with an open grant); a view link never. `updated` never moves.
        if (parts[2] === "amelie" && ((parts.length === 3 && (request.method === "PUT" || request.method === "DELETE")) || (parts.length === 4 && parts[3] === "pull" && request.method === "POST"))) {
          if (!a) return denied(request, rec);
          if (!a.write) return json({ error: "read_only" }, 403);
          if (request.method === "DELETE") {   // forgetting the key is always allowed, even after the lock
            await kvUpdate(env, key, cur => { if (!cur || !cur.amelie) return null; delete cur.amelie; addAudit(cur, a.role, "amelie_off"); return cur; });
            AMELIE_MEM.delete(id);
            return json({ amelie: amelieOut(null) });
          }
          if (parts.length === 4) {
            if (!rec.amelie || !rec.amelie.key) return json({ error: "not_connected" }, 412);
            if (rec.amelie.dead) return json({ error: "amelie_gone" }, 404);   // never asked again with this key
            if (!(await amelieWritable(env, rec, id, a))) return json({ error: "not_writable" }, 409);
            const b = await readBody(request);
            return ameliePull(env, id, (typeof b.since === "string" && AMELIE_VER.test(b.since)) ? b.since : null);   // any other `since` is simply not sent
          }
          if (!(await amelieWritable(env, rec, id, a))) return json({ error: "not_writable" }, 409);
          const b = await readBody(request);
          const k = amelieKeyOf(b.link);
          if (!k) return json({ error: "bad_link" }, 400);   // checked here, before anything is stored or anyone is called
          const r = await kvUpdate(env, key, cur => { if (!cur) return null; const old = cur.amelie, now = Date.now();
            // The same key again keeps what Amelie said about it (a dead key stays dead: pasting it again costs no failed call).
            cur.amelie = (old && old.key === k) ? { ...old, at: now, by: a.role }
              : { key: k, at: now, by: a.role, lastVersion: null, lastPullAt: null, dead: false, retryAt: null, callAt: null, ok: false };
            addAudit(cur, a.role, "amelie"); return cur; });
          AMELIE_MEM.delete(id);
          if (!r.obj) return json({ error: "not found" }, 404);
          return json({ amelie: amelieOut(r.obj.amelie) });
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
        if (res.first && c.cid) await kvUpdate(env, "couple:" + c.cid, cp => { if (!cp) return null; cp.claimedAt = Date.now(); cp.claimToken = null; if (cp.mailed && cp.mailedTo && cp.mailedTo === cp.email) cp.emailVerified = true; return cp; });
        return json(done.res);
      }
      // ---------------- email: self-service recovery and verified changes ----------------
      if (parts[0] === "recover" && parts.length === 1 && request.method === "POST") {
        if (!mailOn(env)) return json({ error: "mail_off" }, 503);
        const b = await readBody(request);
        const email = normEmail(b.email); if (!email) return json({ error: "bad_email" }, 400);
        const lang = langOf(b.lang);
        const ix = safeParse(await env.PLANS.get("email:" + email));
        if (ix && await mailAllowed(env, email, "recover")) {   // the answer is the same whether or not the address is ours
          const items = [];
          for (const cid of (ix.couples || [])) {
            const c = safeParse(await env.PLANS.get("couple:" + cid)); if (!c || c.email !== email) continue;
            const main = safeParse(await env.PLANS.get("plan:" + c.planId)); if (!main || main.coupleId !== c.id) continue;
            const cl = c.lang || lang;
            const ct = c.claimToken ? await freshClaim(env, c, main) : null;
            if (ct) { items.push(fill(MAILS[lang].itemClaim, { name: c.name, until: fmtDay((c.claimAt || c.resetAt || c.createdAt) + CLAIM_TTL, lang), link: plannerUrl(env, cl) + "#claim=" + ct }));
              await markMailed(env, c.id, email); }
            else { const t = await mintToken(env, { kind: "couple-recover", cid: c.id, gen: main.keyGen || 0, lg: c.lgen || 0, email }, RECOVER_TTL);
              items.push(fill(MAILS[lang].itemCouple, { name: c.name, link: plannerUrl(env, cl) + "#recover=" + t })); }
          }
          for (const vid of (ix.venues || [])) {
            const v = safeParse(await env.PLANS.get("venue:" + vid)); if (!v || v.email !== email) continue;
            const t = await mintToken(env, { kind: "venue-recover", vid: v.id, lg: v.lgen || 0, email }, RECOVER_TTL);
            items.push(fill(MAILS[lang].itemVenue, { name: v.name, link: baseUrl(env) + "/venue.html#recover=" + t }));
          }
          if (items.length) send(env, email, mailMsg(lang, "recover", { items: items.join("\n\n") }));
        }
        return json({ ok: true });
      }
      if (parts[0] === "recover" && parts[1] === "couple" && parts.length === 2 && request.method === "POST") {
        const b = await readBody(request);
        const t = await takeToken(env, b.token, ["couple-recover"], b.nonce);
        if (t.error) return json({ error: t.error, at: t.at || null }, t.error === "token_invalid" ? 404 : 410);
        const c = safeParse(await env.PLANS.get("couple:" + t.data.cid)); if (!c) return json({ error: "token_invalid" }, 404);
        if ((c.lgen || 0) !== (t.data.lg || 0)) return json({ error: "token_used" }, 410);   // the address changed after this link was sent
        const plans = [];
        for (const pid of [c.planId, ...(c.plans || [])]) {
          const r = await kvUpdate(env, "plan:" + pid, cur => { if (!cur || cur.coupleId !== c.id) return null;
            if (pid === c.planId && (cur.keyGen || 0) !== (t.data.gen || 0)) return { __res: "stale" };   // keys changed since the mail was sent
            const out = { id: pid, editKey: cur.editKey, readKey: cur.readKey, name: cur.name, updated: cur.updated };
            if (!t.again) { addAudit(cur, "couple", "recover", 0, { d: device(request) }); return { __obj: cur, __res: out }; }
            return { __res: out }; });
          if (r.res === "stale") return json({ error: "token_used" }, 410);
          if (r.res) plans.push(r.res);
        }
        return json({ plans });
      }
      if (parts[0] === "recover" && parts[1] === "venue" && parts.length === 2 && request.method === "POST") {
        const b = await readBody(request);
        const provided = b.secret != null && String(b.secret).trim() !== "";
        let secret = provided ? String(b.secret).replace(/[^A-Za-z0-9]/g, "") : "";
        if (provided && secret.length < 12) return json({ error: "too_short" }, 400);   // checked before the link is used up
        const t = await takeToken(env, b.token, ["venue-recover", "venue-setup"], b.nonce);
        if (t.error) return json({ error: t.error, at: t.at || null }, t.error === "token_invalid" ? 404 : 410);
        const v = safeParse(await env.PLANS.get("venue:" + t.data.vid)); if (!v) return json({ error: "token_invalid" }, 404);
        const mark = String(b.token).slice(0, 16);
        if (t.again) return v.keyTok === mark ? json({ ok: true, key: v.key, venueId: v.id }) : json({ error: "token_used" }, 410);
        if ((v.lgen || 0) !== (t.data.lg || 0)) return json({ error: "token_used" }, 410);   // a newer key, address or link retired this one
        if (!provided) secret = rnd(28);
        const newKey = v.id + "." + secret;
        await rotateVenueCredentials(env, v.id, newKey, true);
        await kvUpdate(env, "venue:" + v.id, cur => { if (!cur) return null; if (t.data.email && t.data.email === cur.email) cur.emailVerified = true; cur.keyPrivate = true; cur.keyTok = mark; return cur; });
        return json({ ok: true, key: newKey, venueId: v.id });
      }
      if (parts[0] === "verify" && parts.length === 1 && request.method === "POST") {
        const b = await readBody(request);
        const t = await takeToken(env, b.token, ["verify-couple", "verify-venue", "verify-owner"], b.nonce);
        if (t.error) return json({ error: t.error }, t.error === "token_invalid" ? 404 : 410);
        if (t.again) return json({ ok: true, email: t.data.email });
        const email = normEmail(t.data.email); if (!email) return json({ error: "token_invalid" }, 404);
        if (t.data.kind === "verify-owner") {   // the address becomes the way back into the admin console only from here
          const tk = String(b.token);
          const r = await kvUpdate(env, "meta:owner", cur => { cur = cur || {}; if (cur.pendingVerify !== tk) return { __res: null };
            const old = cur.email || "";
            return { __obj: { ...cur, email, emailVerified: true, pendingVerify: null, pendingEmail: "", lgen: (cur.lgen || 0) + 1 }, __res: old }; });
          if (r.res === null) return json({ error: "token_used" }, 410);   // a newer confirmation link replaced this one
          const lang = langOf(r.obj && r.obj.lang);
          if (r.res && r.res !== email) send(env, r.res, mailMsg(lang, "ownerEmailChanged", { email: maskEmail(email) }));
          else send(env, email, mailMsg(lang, "ownerEmailSet", {}));
          console.log("admin: the recovery address was confirmed");
          return json({ ok: true, email });
        }
        if (t.data.kind === "verify-couple") {
          const tk = String(b.token);
          const r = await kvUpdate(env, "couple:" + t.data.cid, c => { if (!c) return null; if (c.pendingVerify !== tk) return { __res: null };
            const old = c.email || ""; c.email = email; c.emailVerified = true; c.pendingVerify = null; if (old !== email) nextGen(c); return { __obj: c, __res: old }; });
          if (!r.obj) return json({ error: "token_invalid" }, 404);
          if (r.res === null) return json({ error: "token_used" }, 410);   // a newer confirmation link replaced this one
          const old = r.res; await indexEmail(env, old, "couple", t.data.cid, false); await indexEmail(env, email, "couple", t.data.cid, true);
          await kvUpdate(env, "plan:" + r.obj.planId, cur => { if (!cur) return null; addAudit(cur, "couple", "email"); return cur; });
          if (old && old !== email) send(env, old, mailMsg(r.obj.lang, "changed", { name: r.obj.name, email: maskEmail(email), by: MAILS[langOf(r.obj.lang)].byOwner }));
          return json({ ok: true, email });
        }
        const tk = String(b.token);
        const r = await kvUpdate(env, "venue:" + t.data.vid, v => { if (!v) return null; if (v.pendingVerify !== tk) return { __res: null };
          const old = v.email || ""; v.email = email; v.emailVerified = true; v.pendingVerify = null; if (old !== email) nextGen(v); return { __obj: v, __res: old }; });
        if (!r.obj) return json({ error: "token_invalid" }, 404);
        if (r.res === null) return json({ error: "token_used" }, 410);
        const old = r.res; await indexEmail(env, old, "venue", t.data.vid, false); await indexEmail(env, email, "venue", t.data.vid, true);
        if (old && old !== email) send(env, old, mailMsg(r.obj.lang, "changed", { name: r.obj.name, email: maskEmail(email), by: MAILS[langOf(r.obj.lang)].byOwner }));
        return json({ ok: true, email });
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
        // Public — the owner forgot the admin key. The answer never says whether an address is the right one.
        if (parts[1] === "recover" && request.method === "POST" && (parts.length === 2 || (parts.length === 3 && parts[2] === "claim"))) {
          if (parts.length === 2 && !mailOn(env)) return json({ error: "mail_off" }, 503);   // a link already in a mailbox stays usable
          const b = await readBody(request);
          const o = await ownerRec(env);
          if (parts.length === 2) {
            const email = normEmail(b.email); if (!email) return json({ error: "bad_email" }, 400);
            if (o.email && o.emailVerified && email === o.email && await mailAllowed(env, email, "owner", OWNER_MAILS_PER_DAY)) {
              const t = await mintToken(env, { kind: "owner-recover", lg: o.lgen || 0, email }, RECOVER_TTL);
              send(env, email, mailMsg(o.lang, "ownerRecover", { link: baseUrl(env) + "/admin.html#recover=" + t }));
              console.log("admin: recovery link sent to the owner's address");
            }
            return json({ ok: true });
          }
          const t = await takeToken(env, b.token, ["owner-recover"], b.nonce);   // one link, one key
          if (t.error) return json({ error: t.error }, t.error === "token_invalid" ? 404 : 410);
          if (t.again) return json({ error: "token_used" }, 410);   // the key for this link was already made and mailed: never mint a second one
          if (!o.email || o.email !== t.data.email || (o.lgen || 0) !== (t.data.lg || 0)) return json({ error: "token_used" }, 410);   // the address changed after the link was sent
          const key = rnd(40), hash = await sha256hex(key), now = Date.now();
          // Retires any earlier recovery key AND every link still in flight — the key he has just filed away is the only one.
          await kvUpdate(env, "meta:owner", cur => { cur = cur || {}; return { ...cur, keyHash: hash, keyAt: now, lgen: (cur.lgen || 0) + 1 }; });
          send(env, o.email, mailMsg(o.lang, "ownerNewKey", { at: fmtDay(now, o.lang) }));
          console.log("admin: a new admin key was issued through the recovery link");
          return json({ ok: true, key });
        }
        const dbKey = !!(await ownerRec(env)).keyHash;
        if (!env.OWNER_KEY && !dbKey) return json({ error: "admin disabled — set OWNER_KEY" }, 503);
        if (!(await ownerOk(request, env))) return json({ error: "unauthorized" }, 403);
        // The owner's recovery address — the only way back into the admin console without opening the server.
        if (parts[1] === "owner" && parts.length === 2 && (request.method === "GET" || request.method === "PUT" || request.method === "PATCH")) {
          const o = await ownerRec(env);
          const state = x => ({ email: x.email || "", emailVerified: !!x.emailVerified, pending: x.pendingEmail || "", lang: langOf(x.lang), hasRecoveryKey: !!x.keyHash, keyAt: x.keyAt || null, mail: mailOn(env) });
          if (request.method === "GET") return json(state(o));
          const b = await readBody(request);
          const hasEmail = Object.prototype.hasOwnProperty.call(b, "email");
          if (request.method === "PUT" && !hasEmail) return json({ error: "bad_email" }, 400);
          if (!hasEmail) {   // PATCH without an address touches nothing but the language of the mails
            const r = await kvUpdate(env, "meta:owner", cur => { cur = cur || {}; return { ...cur, lang: langOf(b.lang || cur.lang) }; });
            return json({ ok: true, ...state(r.obj) });
          }
          const email = (b.email === "" || b.email === null) ? "" : normEmail(b.email);
          if (b.email !== "" && b.email !== null && !email) return json({ error: "bad_email" }, 400);
          if (!email) {   // removing the address needs no confirmation — it takes nothing away from anyone
            const r = await kvUpdate(env, "meta:owner", cur => { cur = cur || {}; const old = cur.email || "";
              return { __obj: { ...cur, email: "", emailVerified: false, pendingVerify: null, pendingEmail: "", lang: langOf(b.lang || cur.lang), lgen: (cur.lgen || 0) + 1 }, __res: old }; });   // links already sent stop
            if (r.res) send(env, r.res, mailMsg(r.obj.lang, "ownerEmailChanged", { email: "\u2014" }));
            console.log("admin: recovery address removed");
            return json({ ok: true, ...state(r.obj) });
          }
          // A new address counts only once it is confirmed FROM that address: one typo must never become the only way in,
          // and a stranger who reaches this console once must not be able to keep it. Same rule as couples and venues.
          if (!mailOn(env)) return json({ error: "mail_off" }, 503);
          if (!(await mailAllowed(env, email, "ownerset", OWNER_MAILS_PER_DAY))) return json({ error: "rate_limited" }, 429);
          const lang = langOf(b.lang || o.lang);
          const tok = await mintToken(env, { kind: "verify-owner", email }, VERIFY_TTL);
          if (!send(env, email, mailMsg(lang, "ownerVerify", { link: baseUrl(env) + "/admin.html#verify=" + tok }))) return json({ error: "mail_failed" }, 503);
          const r = await kvUpdate(env, "meta:owner", cur => { cur = cur || {}; return { ...cur, lang, pendingVerify: tok, pendingEmail: email }; });   // the live address does not change yet
          console.log("admin: a confirmation link was sent to a new recovery address");
          return json({ ok: true, ...state(r.obj) });
        }
        if (parts[1] === "owner" && parts[2] === "key" && parts.length === 3 && request.method === "DELETE") {
          // "There is another way in" means the env key AUTHENTICATES, not merely that it is set: a key that no longer
          // matches (a stray space in server.env, a rotated file nobody reloaded) would leave nothing behind.
          if (!env.OWNER_KEY || !eq(request.headers.get("X-Owner-Key") || "", env.OWNER_KEY)) return json({ error: "would_lock_out" }, 409);
          const r = await kvUpdate(env, "meta:owner", cur => { if (!cur) return null; return { ...cur, keyHash: null, keyAt: null, lgen: (cur.lgen || 0) + 1 }; });
          console.log("admin: the mailed admin key was revoked");
          return json({ ok: true, hasRecoveryKey: false });
        }
        if (parts[1] === "mail" && parts.length === 2 && request.method === "GET") {
          const st = (mailOn(env) && typeof env.MAIL.status === "function") ? env.MAIL.status() : {};
          return json({ enabled: mailOn(env), from: mailOn(env) ? String(env.MAIL.from || "") : "", ...st });
        }
        if (parts[1] === "settings" && parts.length === 2) {   // what happens after a wedding, for everyone (overridable below)
          if (request.method === "GET") {
            const st = await getSettings(env), ids = safeParse(await env.PLANS.get("retention:index")) || [];
            const ex = [];
            for (const pid of ids) { const r = safeParse(await env.PLANS.get("plan:" + pid)); if (r && r.retention) ex.push({ planId: pid, ...r.retention, weddingDate: r.weddingDate || null, owner: ownerOf(r).type }); }
            const pol = policyOf(st);
            return json({ retention: { keepDays: pol.keepDays, lockAfter: pol.lockAfter }, planExceptions: ex });
          }
          if (request.method === "PUT" || request.method === "PATCH") {
            const ret = normRetention((await readBody(request)).retention) || {};
            const r = await kvUpdate(env, "meta:settings", st => { st = st || {}; const pol = policyOf(st);
              st.retention = { keepDays: ret.keepDays ?? pol.keepDays, lockAfter: ret.lockAfter ?? pol.lockAfter }; return st; });
            console.log("admin: lifecycle settings " + JSON.stringify(r.obj.retention));
            return json({ ok: true, retention: r.obj.retention });
          }
        }
        if (parts[1] === "plans" && parts.length === 4 && parts[3] === "retention" && (request.method === "PUT" || request.method === "DELETE")) {
          const pid = parts[2], ret = request.method === "PUT" ? normRetention(await readBody(request)) : null;
          if (request.method === "PUT" && !ret) return json({ error: "bad_request" }, 400);
          const r = await kvUpdate(env, "plan:" + pid, rec => { if (!rec) return null; if (ret) rec.retention = ret; else delete rec.retention; return rec; });
          if (!r.obj) return json({ error: "not found" }, 404);
          if (ret) await addIndex(env, "retention:index", pid); else await removeIndex(env, "retention:index", pid);
          console.log("admin: plan exception " + (ret ? JSON.stringify(ret) : "removed") + " for " + pid);
          const L = await planLife(env, r.obj, pid);
          return json({ ok: true, life: { weddingDate: L.weddingDate, lockAt: L.lockAt, deleteAt: L.deleteAt, locked: L.locked, keep: L.keep } });
        }
        if (parts[1] === "venues") {
          if (parts.length === 2 && request.method === "POST") {
            const b = await readBody(request);
            const id = rnd(10), key = id + "." + rnd(28), email = normEmail(b.email), lang = langOf(b.lang);
            if (b.email && !email) return json({ error: "bad_email" }, 400);
            const v = { id, name: String(b.name || "Venue").slice(0, 120), contact: String(b.contact || "").slice(0, 200), notes: String(b.notes || "").slice(0, 1000), email, lang,
              key, keyRotated: false, license: normLicense(b.license), used: 0, weddings: [], active: true, createdAt: Date.now(), defaultPerms: { ...VENUE_DEFAULT } };
            // With mail and an address, the venue sets its own key from the e-mailed link: the admin never sees one.
            let mailed = false;
            if (email && mailOn(env)) {
              v.keyPrivate = true;
              const t = await mintToken(env, { kind: "venue-setup", vid: id, lg: 0, email }, SETUP_TTL);
              mailed = send(env, email, mailMsg(lang, "setup", { name: v.name, link: baseUrl(env) + "/venue.html#recover=" + t }));
              if (!mailed) v.keyPrivate = false;
            }
            await env.PLANS.put("venue:" + id, JSON.stringify(v));
            await addIndex(env, "venues:index", id);
            await indexEmail(env, email, "venue", id, true);
            return json(mailed ? { id, venue: adminVenue(v), mailed: true } : { id, key, venue: adminVenue(v), mailed: false });
          }
          if (parts.length === 2 && request.method === "GET") {
            const ids = safeParse(await env.PLANS.get("venues:index")) || [];
            const out = [];
            for (const vid of ids) { const v = safeParse(await env.PLANS.get("venue:" + vid)); if (v) out.push(adminVenue(v)); }
            return json({ venues: out });
          }
          if (parts.length === 3 && request.method === "GET") {
            const v = safeParse(await env.PLANS.get("venue:" + parts[2])); if (!v) return json({ error: "not found" }, 404);
            // Once the venue has its own key (set from an e-mailed link or changed in the console), only the venue knows it.
            const hidden = !!(v.keyRotated || v.keyPrivate);
            return json({ venue: adminVenue(v), key: hidden ? null : v.key, keyRotated: hidden });
          }
          if (parts.length === 4 && parts[3] === "reset-key" && request.method === "POST") {
            const v = safeParse(await env.PLANS.get("venue:" + parts[2])); if (!v) return json({ error: "not found" }, 404);
            if (v.email && mailOn(env)) {   // the venue gets a link to set a new key; its current key keeps working until then
              const g = await kvUpdate(env, "venue:" + v.id, cur => { if (!cur) return null; return { __obj: cur, __res: nextGen(cur) }; });   // older mailed links retire
              const t = await mintToken(env, { kind: "venue-recover", vid: v.id, lg: g.res, email: v.email }, SETUP_TTL);
              if (!send(env, v.email, mailMsg(v.lang, "venueReset", { name: v.name, link: baseUrl(env) + "/venue.html#recover=" + t }))) return json({ error: "mail_failed" }, 503);
              return json({ ok: true, mailed: true, to: maskEmail(v.email) });
            }
            const newKey = v.id + "." + rnd(28);
            await rotateVenueCredentials(env, v.id, newKey, false);
            return json({ ok: true, key: newKey, mailed: false });
          }
          if (parts.length === 4 && parts[3] === "invoiced" && request.method === "POST") {   // the renewal invoice was sent
            const r = await kvUpdate(env, "venue:" + parts[2], v => { if (!v) return null; v.license = { ...normLicense(v.license, v.license), invoiceDue: false }; return v; });
            if (!r.obj) return json({ error: "not found" }, 404);
            return json({ venue: adminVenue(r.obj) });
          }
          if (parts[3] === "trash" && parts.length >= 4) {   // weddings a venue deleted: 14 days, restored only here
            const v = safeParse(await env.PLANS.get("venue:" + parts[2])); if (!v) return json({ error: "not found" }, 404);
            if (parts.length === 4 && request.method === "GET")
              return json({ trash: (v.trash || []).map(t => ({ planId: t.planId, label: t.label, deletedAt: t.deletedAt, purgeAt: t.purgeAt, date: t.date || null })) });
            const t = (v.trash || []).find(x => x.planId === parts[4]);
            if (parts.length === 6 && parts[5] === "restore" && request.method === "POST") {
              if (!t) return json({ error: "not found" }, 404);
              const tp = safeParse(await env.PLANS.get("plan:" + t.planId));
              if (tp) { const L = await planLife(env, tp, t.planId, { venue: v }); if (L.deleteAt && L.deleteAt <= Date.now() + 3600000) return json({ error: "past_retention", deleteAt: L.deleteAt }, 409); }
              const r = await kvUpdate(env, "plan:" + t.planId, rec => { if (!rec || !rec.deletedAt) return null; const o = ownerOf(rec); if (o.type !== "venue" || o.venueId !== v.id) return null;
                delete rec.deletedAt; delete rec.purgeAt; rec.venueKey = rnd(28); rec.venueGen = (rec.venueGen || 0) + 1; return rec; });   // fresh venue link: the console key may have changed meanwhile
              if (!r.obj || r.obj.deletedAt || ownerOf(r.obj).venueId !== v.id) return json({ error: "gone" }, 410);
              await kvUpdate(env, "venue:" + v.id, cur => { if (!cur) return null; cur.trash = (cur.trash || []).filter(x => x.planId !== t.planId);
                cur.weddings = [...(cur.weddings || []), { planId: t.planId, label: r.obj.name || t.label, createdAt: r.obj.createdAt || t.deletedAt, editKey: r.obj.editKey,
                  venueKey: r.obj.venueKey, perms: normPerms(r.obj.perms, ALL_OPEN), layoutSet: !!r.obj.layoutAt, date: r.obj.weddingDate || null }]; return cur; });
              console.log("admin: restored wedding " + t.planId + " of venue " + v.id);
              return json({ ok: true });
            }
            if (parts.length === 5 && request.method === "DELETE") {   // erase now (e.g. an erasure request)
              if (t) await purgeVenuePlan(env, v.id, t.planId);
              await kvUpdate(env, "venue:" + v.id, cur => { if (!cur) return null; cur.trash = (cur.trash || []).filter(x => x.planId !== parts[4]); return cur; });
              console.log("admin: erased deleted wedding " + parts[4] + " of venue " + v.id);
              return json({ ok: true });
            }
            return json({ error: "not found" }, 404);
          }
          if (parts.length === 3 && (request.method === "PATCH" || request.method === "PUT")) {
            const b = await readBody(request);
            const email = b.email != null ? normEmail(b.email) : null;
            if (b.email != null && String(b.email).trim() && !email) return json({ error: "bad_email" }, 400);
            const r = await kvUpdate(env, "venue:" + parts[2], v => { if (!v) return null; const old = v.email || "";
              if (b.name != null) v.name = String(b.name).slice(0, 120);
              if (b.contact != null) v.contact = String(b.contact).slice(0, 200);   // PUBLIC: shown to this venue's couples
              if (b.notes != null) v.notes = String(b.notes).slice(0, 1000);        // private: admin only
              if (b.retention !== undefined) { const ret = normRetention(b.retention); if (ret) v.retention = ret; else delete v.retention; }
              if (b.active != null) v.active = !!b.active;
              if (b.license) v.license = normLicense(b.license, v.license);
              if (b.lang != null) v.lang = langOf(b.lang);
              if (email != null && email !== old) { v.email = email; v.emailVerified = false; v.pendingVerify = null; nextGen(v); }   // links sent to the old address retire
              return { __obj: v, __res: old }; });
            if (!r.obj) return json({ error: "not found" }, 404);
            if (email != null && email !== r.res) {
              await indexEmail(env, r.res, "venue", r.obj.id, false); await indexEmail(env, email, "venue", r.obj.id, true);
              if (r.res) send(env, r.res, mailMsg(r.obj.lang, "changed", { name: r.obj.name, email: maskEmail(email) || "—", by: MAILS[langOf(r.obj.lang)].byAdmin }));
            }
            return json({ venue: adminVenue(r.obj) });
          }
          if (parts.length === 3 && request.method === "DELETE") {   // erasure: the venue, its weddings and its template
            const dv = safeParse(await env.PLANS.get("venue:" + parts[2]));
            if (dv) {
              for (const w of (dv.weddings || [])) if (w && w.planId) await purgeVenuePlan(env, dv.id, w.planId);
              if (dv.templateId) await purgeVenuePlan(env, dv.id, dv.templateId);
              for (const t of (dv.trash || [])) if (t && t.planId) await purgeVenuePlan(env, dv.id, t.planId);
              console.log("admin: erased venue " + dv.id);
              await indexEmail(env, dv.email, "venue", dv.id, false); await forgetEmail(env, dv.email);
            }
            await env.PLANS.delete("venue:" + parts[2]);
            await removeIndex(env, "venues:index", parts[2]);
            return json({ ok: true });
          }
        }
        if (parts[1] === "couples") {
          // With mail and an address the claim link goes straight to the couple: the admin never sees it.
          const mailClaim = (c, token) => send(env, c.email, mailMsg(c.lang, "claim", { name: c.name, link: plannerUrl(env, c.lang) + "#claim=" + token, recover: plannerUrl(env, c.lang) + "#recover" }));
          if (parts.length === 2 && request.method === "POST") {   // a couple bought TakeaSeat: a plan only they can open
            const b = await readBody(request);
            const email = normEmail(b.email), lang = langOf(b.lang);
            if (b.email && !email) return json({ error: "bad_email" }, 400);
            if (!b.weddingDate) return json({ error: "missing_date" }, 400);
            if (!ymdOk(b.weddingDate)) return json({ error: "bad_date" }, 400);
            if (b.weddingDate < todayAthens() && b.allowPast !== true) return json({ error: "past_date" }, 400);
            // The planner opens 14 days after payment (the couple's withdrawal period); "start now" only for a wedding < 21 days away.
            const startNow = b.startNow === true;
            if (startNow && b.weddingDate >= addDays(todayAthens(), START_NOW_MAX_DAYS)) return json({ error: "start_now_too_early" }, 400);
            const paidAt = Date.now(), opensAt = startNow ? null : athensMidnight(addDays(todayAthens(), OPEN_DELAY_DAYS));
            if (opensAt && opensAt >= athensMidnight(b.weddingDate)) return json({ error: "never_opens" }, 400);   // it would open only after the wedding: "start now" or check the date
            const cid = rnd(10), planId = rnd(22), token = rnd(32);
            const name = String(b.name || "Wedding").slice(0, 120);
            await env.PLANS.put("plan:" + planId, JSON.stringify({ name, plan: null, editKey: rnd(28), readKey: rnd(24), owner: { type: "couple" }, coupleId: cid, keyGen: 0,
              weddingDate: b.weddingDate, opensAt, createdAt: paidAt, updated: paidAt, audit: [] }));
            const c = { id: cid, name, contact: String(b.contact || "").slice(0, 200), email, lang, createdAt: paidAt, paidAt, startNow, claimAt: paidAt, planId, claimToken: token, claimedAt: null };
            const cret = normRetention(b.retention); if (cret) c.retention = cret;
            const mailed = !!(email && mailOn(env)) && mailClaim(c, token);
            c.mailed = mailed; if (mailed) c.mailedTo = email;
            await env.PLANS.put("couple:" + cid, JSON.stringify(c));
            await env.PLANS.put("claim:" + token, JSON.stringify({ cid, planId, createdAt: Date.now(), gen: 0 }));
            await addIndex(env, "couples:index", cid);
            await indexEmail(env, email, "couple", cid, true);
            return json(mailed ? { couple: await adminCouple(env, c), mailed: true } : { couple: await adminCouple(env, c), claimToken: token, mailed: false });
          }
          if (parts.length === 2 && request.method === "GET") {
            const ids = safeParse(await env.PLANS.get("couples:index")) || [];
            const out = [];
            for (const cid of ids) { const c = safeParse(await env.PLANS.get("couple:" + cid)); if (c) out.push(await adminCouple(env, c)); }
            return json({ couples: out });
          }
          if (parts.length === 3 && (request.method === "PATCH" || request.method === "PUT")) {
            const b = await readBody(request);
            const email = b.email != null ? normEmail(b.email) : null;
            if (b.email != null && String(b.email).trim() && !email) return json({ error: "bad_email" }, 400);
            if (b.weddingDate !== undefined && b.weddingDate !== null && b.weddingDate !== "" && !ymdOk(b.weddingDate)) return json({ error: "bad_date" }, 400);
            if (b.weddingDate !== undefined || b.unfreeze === true) {   // the admin may set any date (or clear it) — it never freezes; and may unfreeze
              const cc = safeParse(await env.PLANS.get("couple:" + parts[2]));
              if (cc) await kvUpdate(env, "plan:" + cc.planId, rec => { if (!rec || rec.coupleId !== cc.id) return null; let dirty = false;
                if (b.weddingDate !== undefined) { const before = rec.weddingDate || null; applyDate(rec, b.weddingDate || null, null, true);
                  if (before !== rec.weddingDate) { addAudit(rec, "admin", "date", 0, { d: rec.weddingDate }); if (rec.frozenUntil) rec.frozenUntil = null; dirty = true; } }
                if (b.unfreeze === true && rec.frozenUntil) { rec.frozenUntil = null; addAudit(rec, "admin", "unfreeze"); dirty = true; }
                return dirty ? rec : null; });
            }
            const r = await kvUpdate(env, "couple:" + parts[2], c => { if (!c) return null; const old = c.email || "";
              if (b.name != null) c.name = String(b.name).slice(0, 120);
              if (b.contact != null) c.contact = String(b.contact).slice(0, 200);
              if (b.lang != null) c.lang = langOf(b.lang);
              if (b.retention !== undefined) { const ret = normRetention(b.retention); if (ret) c.retention = ret; else delete c.retention; }
              if (email != null && email !== old) { c.email = email; c.emailVerified = false; c.pendingVerify = null; nextGen(c); }   // links sent to the old address retire
              return { __obj: c, __res: old }; });
            if (!r.obj) return json({ error: "not found" }, 404);
            let c = r.obj, mailed = null;
            if (email != null && email !== r.res) {   // changing a couple's address is visible to them: old address told, access log entry
              await indexEmail(env, r.res, "couple", c.id, false); await indexEmail(env, email, "couple", c.id, true);
              if (r.res) send(env, r.res, mailMsg(c.lang, "changed", { name: c.name, email: maskEmail(email) || "—", by: MAILS[langOf(c.lang)].byAdmin }));
              await kvUpdate(env, "plan:" + c.planId, cur => { if (!cur || cur.coupleId !== c.id) return null; addAudit(cur, "admin", "email"); return cur; });
              if (c.claimToken) {   // a first-opening link that went to the old address stops; a new one goes to the new address
                const main = safeParse(await env.PLANS.get("plan:" + c.planId));
                const ct = await freshClaim(env, c, main, true);
                mailed = !!(email && mailOn(env)) && mailClaim(c, ct);
                if (mailed) await markMailed(env, c.id, email);
                c = safeParse(await env.PLANS.get("couple:" + c.id)) || c;
              }
            }
            return json({ couple: await adminCouple(env, c), mailed });
          }
          // Send the couple its link again (not opened yet) or a recovery link (already opened) — by mail, never to the admin.
          if (parts.length === 4 && parts[3] === "send" && request.method === "POST") {
            const c = safeParse(await env.PLANS.get("couple:" + parts[2])); if (!c) return json({ error: "not found" }, 404);
            if (!c.email || !mailOn(env)) return json({ error: "mail_off" }, 503);
            const main = safeParse(await env.PLANS.get("plan:" + c.planId)); if (!main || main.coupleId !== c.id) return json({ error: "plan_gone" }, 410);
            const ct = c.claimToken ? await freshClaim(env, c, main) : null;
            if (ct) { if (!mailClaim(c, ct)) return json({ error: "mail_failed" }, 503); await markMailed(env, c.id, c.email); return json({ ok: true, mailed: true, to: maskEmail(c.email) }); }
            const t = await mintToken(env, { kind: "couple-recover", cid: c.id, gen: main.keyGen || 0, lg: c.lgen || 0, email: c.email }, SETUP_TTL);
            if (!send(env, c.email, mailMsg(c.lang, "relink", { name: c.name, link: plannerUrl(env, c.lang) + "#recover=" + t }))) return json({ error: "mail_failed" }, 503);
            return json({ ok: true, mailed: true, to: maskEmail(c.email) });
          }
          // New keys (a leaked link the couple cannot fix themselves): every old key, view link and linked device stops
          // working, open support access ends; the new link goes to the couple's email (to the admin only without mail).
          if (parts.length === 4 && parts[3] === "reset" && request.method === "POST") {
            const c = safeParse(await env.PLANS.get("couple:" + parts[2])); if (!c) return json({ error: "not found" }, 404);
            const token = rnd(32), now = Date.now();
            const r = await kvUpdate(env, "plan:" + c.planId, cur => { if (!cur || cur.coupleId !== c.id) return null;
              cur.editKey = rnd(28); cur.readKey = rnd(24); cur.keyGen = (cur.keyGen || 0) + 1; cur.support = null; cur.legacyOpenUntil = null; cur.resetAt = now;
              addAudit(cur, "admin", "reset"); amelieDropFor(cur, null, "admin"); return cur; });   // whoever held the old key may have connected an invitation of their own
            if (!r.obj || r.obj.resetAt !== now) return json({ error: "plan_gone" }, 410);
            AMELIE_MEM.delete(c.planId);
            await removeIndex(env, "support:index", c.planId);
            if (c.claimToken) await env.PLANS.delete("claim:" + c.claimToken);
            await env.PLANS.put("claim:" + token, JSON.stringify({ cid: c.id, planId: c.planId, createdAt: now, gen: r.obj.keyGen || 0, reset: true }));
            const mailed = !!(c.email && mailOn(env)) && mailClaim(c, token);
            await kvUpdate(env, "couple:" + c.id, cp => { if (!cp) return null; cp.claimToken = token; cp.claimedAt = null; cp.resetAt = now; cp.claimAt = now; cp.mailed = mailed; cp.mailedTo = mailed ? c.email : null; nextGen(cp); return cp; });
            return json(mailed ? { ok: true, mailed: true, to: maskEmail(c.email) } : { ok: true, claimToken: token, mailed: false });
          }
          if (parts.length === 3 && request.method === "DELETE") {   // erasure on request
            const c = safeParse(await env.PLANS.get("couple:" + parts[2]));
            if (c) {
              console.log("admin: erased couple " + c.id);
              for (const pid of [c.planId, ...(c.plans || [])]) { const pr = safeParse(await env.PLANS.get("plan:" + pid)); if (pr && pr.coupleId === c.id) await purgePlan(env, pid); }
              if (c.claimToken) await env.PLANS.delete("claim:" + c.claimToken);
              await indexEmail(env, c.email, "couple", c.id, false); await forgetEmail(env, c.email);
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
          const settings = await getSettings(env), since = await lifecycleSince(env), rows = [];
          for (const w of (v.weddings || [])) {   // date, progress and lifecycle of each wedding
            const p = await ownPlan(w.planId);
            const L = p ? lifeOf(p, policyOf(settings, v.retention, p.retention), since) : null;
            rows.push({ planId: w.planId, label: w.label, createdAt: w.createdAt, editKey: w.editKey, venueKey: w.venueKey,
              perms: normPerms(w.perms, ALL_OPEN), layoutSet: w.layoutSet !== false, supportExpires: live(w.supportExpires),
              date: p ? (p.weddingDate || null) : (w.date || null), updated: p ? p.updated : null, stats: p ? planStats(p.plan) : null,
              life: L ? { lockAt: L.lockAt, deleteAt: L.deleteAt, over: L.over, locked: L.locked, keep: L.keep, fallback: L.fallback, phase: L.phase, fullAt: L.fullAt } : null,
              dateChangesLeft: p ? Math.max(0, DATE_CHANGES - (p.dateChanges || 0)) : 0 });
          }
          return json({ venue: { ...publicVenue(v), email: v.email || "", emailVerified: !!v.emailVerified, mail: mailOn(env) }, template, defaultPerms: normPerms(v.defaultPerms, ALL_OPEN), canCreate: gate.ok, reason: gate.reason,
            weddings: rows, trash: (v.trash || []).map(t => ({ label: t.label, deletedAt: t.deletedAt, purgeAt: t.purgeAt, date: t.date || null })) });
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
        if (parts.length === 3 && parts[2] === "email" && request.method === "POST") {   // the venue changes its recovery email (confirmed by mail)
          if (!mailOn(env)) return json({ error: "mail_off" }, 503);
          const b = await readBody(request);
          const email = normEmail(b.email); if (!email) return json({ error: "bad_email" }, 400);
          if (!(await mailAllowed(env, email, "verify"))) return json({ error: "rate_limited" }, 429);
          const t = await mintToken(env, { kind: "verify-venue", vid: v.id, email }, VERIFY_TTL);
          await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.pendingVerify = t; return cur; });
          if (!send(env, email, mailMsg(b.lang || v.lang, "verify", { name: v.name, link: baseUrl(env) + "/venue.html#verify=" + t }))) return json({ error: "mail_failed" }, 503);
          return json({ ok: true, pending: maskEmail(email) });
        }
        if (parts.length === 3 && parts[2] === "renewal" && request.method === "POST") {   // the venue stops (or restarts) the automatic renewal
          const b = await readBody(request);
          if (typeof b.autoRenew !== "boolean") return json({ error: "bad_request" }, 400);
          const r = await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.license = { ...normLicense(cur.license, cur.license), autoRenew: b.autoRenew }; return cur; });
          console.log("venue " + v.id + ": auto-renewal " + (b.autoRenew ? "on" : "off"));
          return json({ ok: true, license: publicLicense(r.obj.license) });
        }
        // What a couple may change in NEW weddings (and, if asked, in every existing one).
        if (parts.length === 3 && parts[2] === "defaults" && (request.method === "PUT" || request.method === "PATCH")) {
          const b = await readBody(request);
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
          const b = await readBody(request);
          let plan = null;
          if (b.fromPlanId) {   // "start from one of my weddings": only a wedding of this venue, and only its space
            const src = (v.weddings || []).some(w => w.planId === b.fromPlanId) ? await ownPlan(b.fromPlanId) : null;
            if (!src) return json({ error: "not found" }, 404);
            plan = layoutOnly(src.plan, true);
          }
          const id = rnd(22);
          const rec = { name: String(b.name || v.name).slice(0, 120), plan, editKey: rnd(28), venueKey: rnd(28), readKey: rnd(24),
            owner: { type: "venue", venueId: v.id }, venueId: v.id, template: true, perms: { ...ALL_OPEN }, keyGen: 0, venueGen: 0, createdAt: Date.now(), updated: Date.now() };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.templateId = id; return cur; });
          return json({ planId: id, venueKey: rec.venueKey, updated: rec.updated });
        }
        if (parts.length === 3 && parts[2] === "weddings" && request.method === "POST") {
          const gate = canCreateWedding(v);
          if (!gate.ok) return json({ error: gate.reason }, 403);
          const b = await readBody(request);
          const dated = {};
          if (b.date == null || b.date === "") return json({ error: "missing_date" }, 400);   // the date drives the couple's phases and the lifecycle
          { const e = applyDate(dated, b.date, null, false); if (e) return json({ error: e }, 400); }   // checked before a wedding is counted
          let plan = null;
          if (v.templateId) { const t = await ownPlan(v.templateId); if (t) plan = layoutOnly(t.plan); }
          const id = rnd(22), editKey = rnd(28), venueKey = rnd(28);
          const perms = normPerms(b.perms || v.defaultPerms, ALL_OPEN);
          const now = Date.now();
          // Locks apply once the venue has put its layout in: from the template now, or at the venue's first save.
          const rec = { name: String(b.label || "Wedding").slice(0, 120), plan, editKey, venueKey, readKey: rnd(24),
            owner: { type: "venue", venueId: v.id }, venueId: v.id, perms, layoutAt: plan ? now : null, keyGen: 0, venueGen: 0, weddingDate: dated.weddingDate || null, createdAt: now, updated: now };
          await env.PLANS.put("plan:" + id, JSON.stringify(rec));
          await kvUpdate(env, vkey, cur => { if (!cur) return null;
            cur.weddings = cur.weddings || []; cur.weddings.push({ planId: id, label: rec.name, createdAt: now, editKey, venueKey, perms, layoutSet: !!plan, date: rec.weddingDate });
            cur.used = (cur.used || 0) + 1; return cur; });
          return json({ planId: id, editKey, venueKey, updated: now, fromTemplate: !!plan });
        }
        // Rename a wedding and/or change what its couple may change.
        if (parts.length === 4 && parts[2] === "weddings" && (request.method === "PATCH" || request.method === "PUT")) {
          const b = await readBody(request);
          const w = (v.weddings || []).find(x => x.planId === parts[3]);
          const wp = w ? await ownPlan(parts[3]) : null;
          if (!w || !wp) return json({ error: "not found" }, 404);
          if ((b.label != null || b.perms) && (await planLife(env, wp, parts[3], { venue: v })).locked) return json({ error: "locked" }, 403);
          const label = b.label != null ? String(b.label).trim().slice(0, 120) : null;
          if (b.label != null && !label) return json({ error: "missing label" }, 400);
          const perms = b.perms ? normPerms(b.perms, normPerms(w.perms, ALL_OPEN)) : null;
          let date = null;
          if (b.date !== undefined) {   // same limits as everywhere: a wedding date is not a way to reuse a paid wedding
            const p = await ownPlan(parts[3]), L = await planLife(env, p, parts[3], { venue: v });
            let err = null;
            const r = await kvUpdate(env, "plan:" + parts[3], rec => { if (!rec) return null; const before = rec.weddingDate || null; err = applyDate(rec, b.date, L, false);
              if (err) return { __res: null }; if (before === rec.weddingDate) return { __res: null }; addAudit(rec, "venue", "date", 0, { d: rec.weddingDate }); return rec; });
            if (err) return json({ error: err }, err === "bad_date" ? 400 : 403);
            date = (r.obj && r.obj.weddingDate) || null;
          }
          await kvUpdate(env, vkey, cur => { if (!cur) return null; const cw = (cur.weddings || []).find(x => x.planId === parts[3]); if (!cw) return null;
            if (label) cw.label = label; if (perms) cw.perms = perms; if (date) cw.date = date; return cur; });
          await kvUpdate(env, "plan:" + parts[3], rec => { if (!rec) return null;
            if (label) rec.name = label;          // metadata: `updated` stays, so nobody's next save conflicts
            if (perms) rec.perms = perms;
            return rec; });
          return json({ ok: true, label: label || w.label, perms: perms || normPerms(w.perms, ALL_OPEN), date: date || w.date || null });
        }
        if (parts.length === 5 && parts[2] === "weddings" && parts[4] === "couple-link" && request.method === "POST") {   // a leaked couple link: new keys, the old link and its devices stop
          const w = (v.weddings || []).find(x => x.planId === parts[3]);
          const wp = w ? await ownPlan(parts[3]) : null;
          if (!w || !wp) return json({ error: "not found" }, 404);
          if ((await planLife(env, wp, parts[3], { venue: v })).locked) return json({ error: "locked" }, 403);
          const r = await kvUpdate(env, "plan:" + parts[3], rec => { if (!rec) return null;
            rec.editKey = rnd(28); rec.readKey = rnd(24); rec.keyGen = (rec.keyGen || 0) + 1; rec.legacyOpenUntil = null; addAudit(rec, "venue", "rotate");
            amelieDropFor(rec, "couple", "venue"); return rec; });
          AMELIE_MEM.delete(parts[3]);
          await kvUpdate(env, vkey, cur => { if (!cur) return null; const cw = (cur.weddings || []).find(x => x.planId === parts[3]); if (!cw) return null; cw.editKey = r.obj.editKey; return cur; });
          console.log("venue " + v.id + ": new couple link for " + parts[3]);
          return json({ ok: true, editKey: r.obj.editKey, readKey: r.obj.readKey });
        }
        if (parts.length === 4 && parts[2] === "weddings" && request.method === "DELETE") {   // into the trash for 14 days (only TakeaSeat restores)
          const w = (v.weddings || []).find(x => x.planId === parts[3]);
          if (!w) return json({ ok: true });
          const p = await ownPlan(parts[3]), now = Date.now(), purgeAt = now + TRASH_DAYS * DAY;
          if (p) {
            await kvUpdate(env, "plan:" + parts[3], rec => { if (!rec) return null; rec.deletedAt = now; rec.purgeAt = purgeAt; rec.support = null; return rec; });
            await removeIndex(env, "support:index", parts[3]);
          }
          await kvUpdate(env, vkey, cur => { if (!cur) return null; cur.weddings = (cur.weddings || []).filter(x => x.planId !== parts[3]);
            if (p) cur.trash = [...(cur.trash || []), { planId: parts[3], label: w.label, deletedAt: now, purgeAt, date: p.weddingDate || null }];
            return cur; });
          console.log("venue " + v.id + ": wedding " + parts[3] + " moved to the trash");
          return json({ ok: true, purgeAt: p ? purgeAt : null });
        }
      }
      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error("api error " + request.method + " " + new URL(request.url).pathname.replace(/[A-Za-z0-9_-]{16,}/g, "…") + ": " + ((e && e.stack) || e));
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
    cur.key = newKey; cur.keyRotated = !!byVenue; if (!byVenue) { cur.keyResetAt = Date.now(); delete cur.keyPrivate; }
    delete cur.keyTok; nextGen(cur);
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
// A licence date as YYYY-MM-DD (Athens); older records may hold other date strings.
const normYmd = s => { if (!s) return null; if (ymdOk(s)) return s; const t = Date.parse(s); return isNaN(t) ? null : new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Athens", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t)); };
function normLicense(l, prev) {   // renewal bookkeeping (renewedAt, invoiceDue, renewSkipped) only ever comes from the stored licence
  l = l || {}; prev = prev || {};
  const type = l.type === "per_wedding" ? "per_wedding" : "seasonal";
  const seasonEnd = normYmd(l.seasonEnd);
  return {
    type,
    seasonStart: normYmd(l.seasonStart),
    seasonEnd,
    renewSkipped: (prev.renewSkipped && prev.renewSkipped === seasonEnd) ? prev.renewSkipped : null,
    quota: Math.max(0, parseInt(l.quota, 10) || 0),
    cap: Math.max(0, parseInt(l.cap, 10) || 0),
    autoRenew: typeof l.autoRenew === "boolean" ? l.autoRenew : (typeof prev.autoRenew === "boolean" ? prev.autoRenew : true),
    renewedAt: prev.renewedAt || null,
    invoiceDue: !!prev.invoiceDue,
  };
}
const publicLicense = l => { if (!l) return l; const { invoiceDue, ...rest } = l; return { autoRenew: true, ...rest, seasonStart: normYmd(l.seasonStart), seasonEnd: normYmd(l.seasonEnd) }; };
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
  return { id: v.id, name: v.name, contact: v.contact, license: publicLicense(v.license), used: v.used || 0,
    active: v.active, createdAt: v.createdAt, weddingCount: (v.weddings || []).length, keyRotated: !!(v.keyRotated || v.keyPrivate), hasTemplate: !!v.templateId };
}
function adminVenue(v) {     // returned to the owner — counts only: no plan ids, no keys, no wedding names
  return { ...publicVenue(v), email: v.email || "", emailVerified: !!v.emailVerified, lang: v.lang || "el", notes: v.notes || "", retention: v.retention || null,
    license: v.license ? { autoRenew: true, ...v.license } : v.license, trashCount: (v.trash || []).length, renewals: (v.renewals || []).slice(-5) };
}
async function adminCouple(env, c) {   // licence metadata only — never the plan id, a key, or anything inside the plan
  const rec = safeParse(await env.PLANS.get("plan:" + c.planId));
  return { id: c.id, name: c.name, contact: c.contact, email: c.email || "", emailVerified: !!c.emailVerified, lang: c.lang || "el", mailed: !!c.mailed,
    createdAt: c.createdAt, claimedAt: c.claimedAt || null, resetAt: c.resetAt || null,
    exists: !!rec, deletedAt: c.deletedAt || null, lastEdit: rec ? rec.updated : null, pendingClaim: !!c.claimToken,
    claimToken: (c.claimToken && !c.mailed) ? c.claimToken : null,   // a link that went by mail is never shown to the admin
    claimIssuedAt: c.claimToken ? (c.claimAt || c.resetAt || c.createdAt) : null,
    support: supportActive(rec) ? { expires: rec.support.expires } : null,
    weddingDate: rec ? (rec.weddingDate || null) : null, retention: c.retention || null, keepsakeSentAt: rec ? (rec.keepsakeSentAt || null) : null, purgedAt: c.purgedAt || null,
    life: rec ? (L => ({ lockAt: L.lockAt, deleteAt: L.deleteAt, over: L.over, locked: L.locked, keep: L.keep, fallback: L.fallback,
      phase: L.phase, opensAt: L.opensAt, fullAt: L.fullAt, frozenUntil: L.frozenUntil }))(await planLife(env, rec, c.planId, { couple: c })) : null,
    startNow: !!c.startNow, paidAt: c.paidAt || c.createdAt };
}
async function addIndex(env, key, id) { await kvUpdate(env, key, ids => { ids = Array.isArray(ids) ? ids : []; if (ids.includes(id)) return null; ids.push(id); return ids; }); }
async function removeIndex(env, key, id) { await kvUpdate(env, key, ids => Array.isArray(ids) && ids.includes(id) ? ids.filter(x => x !== id) : null); }
