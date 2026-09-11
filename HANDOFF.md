# TakeaSeat — Handoff / Operations Guide

> Read this first. It maps the whole system so a new agent (or developer) can pick it up cold.
> **This repo is PUBLIC — never commit secrets here.** Real keys live in `ACCESS.local.md`
> (git-ignored, on Andreas's PC), in the server's env files, and in Andreas's password manager.
> Last updated: 2026-09-01.

## 1. What this is

**TakeaSeat** is a B2B wedding seating-plan SaaS sold to Greek wedding venues (κτήματα).
A venue creates one plan per couple; the couple opens a private link on their phone and places
their guests at tables. Live at **https://takeaseat.gr**.

- **Marketing home** (Greek; venues first, plus a couples tier): https://takeaseat.gr/ (`index.html`)
- **Seat editor** (the planner, 3 languages): `seating-planner-el.html` (EL), `-de.html` (DE), `seating-planner.html` (EN)
- **Lab / sandbox** (Andreas's experimental copy of the planner — Greek, demo data, its own local storage, no login
  gate, never touches real plans): https://takeaseat.gr/lab.html — reachable from anywhere via the **hidden link on the
  year "2026" in the home-page footer**.
- **Owner console** (Andreas, manages venues + licenses): https://takeaseat.gr/admin.html
- **Venue console** (a κτήμα manages its weddings): https://takeaseat.gr/venue.html
- **Legal**: `/privacy.html`, `/terms.html`, `/dpa.html`

**Pricing on the site (2026-09-08):** venues season **129 €/season** (unlimited weddings), venues per wedding **9 €**,
couples **19 € one-off** (the "expensive" tier — never called that; venues simply get the partner price). All three
numbers live only in the pricing section of `index.html`. Couples currently sign up by e-mail (the CTA is a mailto);
fulfil by creating a wedding for them under a "Direct couples" venue in `admin.html` and sending the couple link.

## 2. Architecture

```
Browser ──HTTPS──> Caddy (edu-admin-caddy-1, owns :80/:443 on the shared box)
                     │  vhost: takeaseat.gr, www.takeaseat.gr
                     ▼
             takeaseat-api  (Docker container, Node 22)
              ├─ serves the static app files (index/planners/consoles/legal)
              └─ same API logic as the Cloudflare worker, over SQLite
                     ▼
             SQLite  /data/wedding.db  (WAL)  — Docker volume takeaseat_tas_data
```

- The API logic is written **once** in `wedding-sync-worker.js` (originally a Cloudflare Worker).
  At Docker build it's copied to `server/worker.mjs`; `server/server.mjs` wraps it with a tiny
  SQLite-backed KV adapter and a static file server. **Edit the API in `wedding-sync-worker.js` only** —
  `worker.mjs` is generated (git-ignored).
- **Data model**: one SQLite table `kv(key TEXT PRIMARY KEY, value TEXT)`, value = JSON. Keys:
  `venue:<id>`, `plan:<id>`, `code:<synccode>`, plus a venue index. Same shape the Cloudflare KV used.
- **Shared server**: the box `178.104.158.125` (Hetzner, Germany) also runs the **LIVE
  educationproject.gr** business (the `edu-admin` stack — Caddy, Next app, Postgres, E-Lab).
  **Do not break edu.** Caddy is shared; takeaseat is just another vhost on it.

## 3. Repository layout

| Path | What |
|---|---|
| `index.html` | Marketing home page (Greek, B2B + couples tier). Footer links to legal pages; the year "2026" is the hidden link to `/lab.html`. |
| `planner.src.html` | **THE planner source.** One file with all three UI languages embedded (`T_ALL`) and `__LANG__` / `__MODE__` / `__TITLE__` placeholders. Edit only this. |
| `tools/build-planner.mjs` | Builds every planner output from the source: 3 language files + 3 `.artifact.html` twins + `lab.html`. `--check` fails if outputs are stale. |
| `tools/dev.mjs` | Local dev server (`node tools/dev.mjs` → http://127.0.0.1:8080, loopback only): the real server over an in-memory KV. |
| `hermes/takeaseat_control.py` | **Hermes voice shim** (Andreas's local voice/watch assistant, `C:\Users\andre\hermes`). Headless local process that registers "TakeaSeat τραπεζολόγιο" and forwards each spoken question to the live API. Config in git-ignored `hermes/.env` (see `.env.example`). Autostarts via the Startup shortcut `TakeaSeatHermes.lnk`. Writes only ever go to venues listed in `TAKEASEAT_OWN_VENUES` — never to a venue we have sold to. |
| `seating-planner.html` / `-de.html` / `-el.html` | **Generated** seat editor — EN / DE / EL. Do not hand-edit. |
| `seating-planner*.artifact.html` | **Generated** claude.ai-artifact twins (the file minus its `<head>/<body>` wrapper). |
| `lab.html` | **Generated** sandbox build (Greek, `MODE=lab`: demo data, storage under `weddingSeatingPlanner.lab.*`, no gate). |
| `admin.html` | Owner console (create/manage venues, licenses). |
| `venue.html` | Venue console (a κτήμα: log in with venue key → create weddings → copy couple links → 🔑 rotate key). |
| `privacy.html` / `terms.html` / `dpa.html` | Legal (GR+EN). Privacy+Terms are publishable; DPA has per-signature blanks. |
| `wedding-sync-worker.js` | **The API logic** (shared by the Cloudflare worker and the self-host server). |
| `server/server.mjs` | Self-host server: SQLite KV adapter + static server + rate limiting + disk guard. |
| `server/Dockerfile` | Builds `takeaseat-api`. Copies the app html + worker.mjs into the image. |
| `server/docker-compose.yml` | Runs the container (hardened: cap_drop ALL, no-new-privileges, mem/pids limits) on the `edu-admin_internal` network. |
| `server/backup.sh` | Nightly local encrypted SQLite backup (deployed as `/opt/takeaseat-backup.sh`). |
| `server/offsite-push.sh` | Nightly off-site push to Backblaze B2, age-encrypted (deployed as `/opt/offsite-push.sh`). |
| `server/uptime-check.sh` | 5-min health check + auto-restart + email alert (deployed as `/opt/takeaseat-uptime.sh`). |

> **Editing rule:** edit `planner.src.html` only, then run `node tools/build-planner.mjs` — it regenerates the three
> language files, their `.artifact.html` twins and `lab.html` in one go. Commit the source **and** the outputs
> (the Docker image copies the outputs). UI strings live in the `T_ALL` dictionary near the top of the script
> (keys must exist in all three languages; missing keys fall back to Greek).

## 4. How to access everything

Actual keys are in **`ACCESS.local.md`** (git-ignored, next to this file on Andreas's PC) and in
Andreas's password manager. Summary of *what exists*:

- **The server**: SSH as root to `178.104.158.125` with the key `~/.ssh/hetzner`.
- **Owner console** `admin.html`: needs the `OWNER_KEY` (also set in `/opt/takeaseat/server/server.env` on the box).
- **Venue console** `venue.html`: needs a venue key `<venueId>.<secret>`. The owner's own venue is **Jockey**.
- **Seat editor**: no password — the couple link *is* the credential (`...?plan=<id>#key=<editKey>`). The
  edit key lives in the URL `#fragment` so it's never sent to the server or logs.
- **Andreas's private quick-access page** (phone-friendly, tap-to-open editor + venue key):
  a private Claude artifact — URL is in `ACCESS.local.md`.
- **Domain/DNS**: takeaseat.gr at **Papaki** (apex + www A-records → the server IP).
- **Email**: `info@takeaseat.gr` is a Papaki **alias → andrewstamelakis@gmail.com** (free, no mailbox).
- **Backblaze B2** (off-site backups), **Cloudflare** (legacy, being retired), **Hetzner** — all Andreas's accounts.

### Recover a lost key from the database
```bash
DB=/var/lib/docker/volumes/takeaseat_tas_data/_data/wedding.db
# a couple's edit key:
sqlite3 "$DB" "select json_extract(value,'\$.editKey') from kv where key='plan:<planId>';"
# a venue key:
sqlite3 "$DB" "select json_extract(value,'\$.key') from kv where key='venue:<venueId>';"
# list everything:
sqlite3 "$DB" "select key from kv;"
```
A venue can also self-rotate its key in the 🔑 panel of `venue.html` (old key dies immediately).

## 5. Deploy / update

All changes ship the same way — commit here, then on the box pull + rebuild:
```bash
# from your PC:
git add -A && git commit -m "..." && git push origin main
# on the box:
ssh -i ~/.ssh/hetzner root@178.104.158.125
cd /opt/takeaseat && git pull --ff-only && docker compose -f server/docker-compose.yml up -d --build
```
- **Client (html) or API (`wedding-sync-worker.js`) or server** changes → the command above rebuilds the image.
- **Host scripts** (`backup.sh`, `offsite-push.sh`, `uptime-check.sh`) are deployed copies at `/opt/*.sh`;
  editing the repo copy does **not** auto-deploy them — copy them to the box if you change them.
- **Caddy** changes (rare): edit `/opt/edu-admin/Caddyfile`, **back it up**, run `docker exec edu-admin-caddy-1 caddy validate --config /etc/caddy/Caddyfile`, reload, then verify **both** takeaseat and educationproject.gr return 200.
- **Legacy Cloudflare worker** (`wedding-sync`): dormant, no longer used by the app (client `SYNC_URL=""`,
  GitHub Pages redirects to takeaseat.gr). Safe to ignore or delete. Its KV namespace `wedding-plans`
  was already deleted.

## 6. Operations

**Backups (all in `/opt/backups`, cron in `/etc/cron.d/`):**
- `takeaseat-backup` — 03:10 — WAL-safe snapshot → gzip → **age-encrypt** → `takeaseat-*.db.gz.age`, 14-day local retention.
- `offsite-push` — 03:40 — age-encrypts every backup (edu + elab too, which are otherwise plaintext) and
  `rclone copy`s them to Backblaze **B2 bucket `TakeaSeat/backups`**, 21-day retention. B2 only ever holds ciphertext.
- The **age private key is OFF the box** (Andreas's password manager). Without it, backups can't be decrypted.
- **Restore:** `rclone copy b2:TakeaSeat/backups/<file>.age . && age -d -i <privkey-file> <file>.age > out.gz && gunzip out.gz`
  (or use a local `/opt/backups/*.age`). Verified working.

**Monitoring:** `takeaseat-uptime` cron (*/5) probes https://takeaseat.gr/; on failure it restarts the
container and emails an alert via the edu-admin app's SMTP (so alerts reach the same inbox as edu — no separate account).

**Database:** SQLite WAL. The main `.db` file can look small/old because recent writes sit in the `-wal`
sidecar until checkpoint — that's normal; reads through sqlite3 or the app see current data. `PRAGMA
integrity_check` should say `ok`. Not exposed to the internet (only the container reaches it).

## 6b. Data-loss incident 2026-09-09 and the protections that followed

At 09:56 (Athens) the live "Andreas & Lina" plan was overwritten with an untouched default plan pushed by an
in-sync Greek-build device (either the ⋯ → "Επαναφορά σχεδίου" confirm, or the old conflict handler that
adopted the server's timestamp without its plan and then overwrote it). Restored at 10:02 from the 03:10
age-encrypted backup (decrypted on the box with the private key fed via stdin and shredded — never on disk).
Protections now in place:
- **Server keeps the last 30 versions of every plan** (`hist:<planId>`, capped at 3 MB) on every PUT;
  `GET /plans/:id/history` and `POST /plans/:id/restore {updated}` (edit key or sync code). In the planner:
  ⋯ → "🕘 Ιστορικό εκδόσεων" → Επαναφορά.
- A 409 conflict now adopts the whole server plan or retries later — never just its timestamp.
- **The server refuses a save that wipes a plan** (≥5 guests → 0) with `422 wipe_refused` unless the body carries
  `allowWipe:true` (the client sets it only for reset / undo / redo). The client has the same guard and, when it
  fires, marks the profile `unsynced` and re-pulls the server copy.
- A cloud-linked profile whose **local copy is missing or unreadable** (`loadError`, shown as a toast) is marked
  `unsynced`: it force-pulls the server plan and cannot push anything until that pull succeeded.
- Resetting a plan that has guests asks twice, the second time with the guest count.
- To restore from a backup by hand: `age -d -i <key-from-stdin> ... | gunzip | sqlite3 → select value from kv
  where key='plan:<id>'` then `PUT /plans/<id>` with `X-Edit-Key` and `baseUpdated` = current `updated`.

## 7. Security posture (done)

CORS locked to `https://takeaseat.gr`; per-IP rate limiting + disk-full guard on writes; strict
CSP + security headers (via Caddy); container hardened; edit keys are fragment-only; deleting a venue
cascade-purges its plans; venues can rotate their own key; backups encrypted at rest and off-site.

## 8. Open items (need Andreas / a decision)

1. **Company + DPA**: Andreas will register the legal company later. Once he has the **ΑΦΜ / legal name /
   address**, fill the `[bracket]` blanks in `dpa.html` (Processor side) — the public Privacy/Terms are
   already done. A lawyer glance is recommended before signing large venues (not blocking).
2. **2FA**: enable two-factor on the **Hetzner** (controls the whole server), **Cloudflare**, and **Papaki** accounts.
3. **Deferred hardening** (skipped as too risky to do unattended on the live shared box): run the
   container as a **non-root** user and move it off the shared `edu-admin_internal` network onto its own.
4. **First real customers**: only Andreas's own wedding (Andreas & Lina, venue Jockey) + test plans exist so far.

## 9. Critical gotchas

- **Public repo → no secrets in git.** `server.env`, `rclone.conf`, the age private key, edit keys — all stay out.
- **Shared box runs the live educationproject.gr business.** Caddy owns 80/443. Back up the Caddyfile and
  `caddy validate` before any reload; confirm edu still serves 200 afterward.
- **`worker.mjs` is generated** from `wedding-sync-worker.js` at build — edit the source, not the copy.
- **Planner outputs are generated**: never hand-edit `seating-planner*.html` or `lab.html` — edit `planner.src.html`
  and rebuild (`node tools/build-planner.mjs`), or the next build silently overwrites your change.
- **Planner UX (2026-09-08 redesign)**: tap/click a table → the canvas glides onto it and a seat list opens (right
  panel on PC, bottom sheet on phone); type a name + Enter for the next seat, with suggestions from unseated guests.
  Floor textures are procedural inline SVGs (no asset files; CSP `img-src data:`). Fonts are system stacks — the CSP
  blocks Google Fonts, so don't add `<link>` fonts without also changing the Caddy CSP.
- **Review pass (2026-09-09)**: a 9-lens adversarial review found 83 issues; the real ones were fixed (uncommitted
  seat-row text leaking into another table, Enter seating an unwanted suggestion, XSS via group ids, unbounded
  capacity from a shared plan, server crash on a malformed URL, mobile sheet/drawer stacking, iOS input zoom, print
  clipping, lab talking to the live cloud — now local-only, and more). The Docker build now refuses stale planner
  outputs (`--check --no-twins`) and the build script enforces i18n completeness across the three dictionaries.
- **Controls (2026-09-09)**: undo/redo (↶ ↷ in the app bar and the phone bar; Ctrl+Z / Ctrl+Y) — one snapshot per
  saved change, per plan; "Aa" view menu on both PC and phone: guest names full / short («Ανδρέας Σ.») / initials
  («Α.Σ.»), name size, table-number size, zoom. `state.nameMode` / `state.tableFontScale` are saved with the plan.
- **Table chooser** (`#tablestrip`, chips with occupancy bars): on PC a 176 px column right of the floor, which the
  seat panel replaces when a table is selected (the right side is always "tables"); on phones it sits under the canvas.
- **Phone overview ⇄ table**: under the canvas sits the table chooser.
  In the overview the canvas is sized to the floor fitted to the screen width (`layoutCanvas`) and the list takes
  the rest; tapping a chip glides onto that table and opens the seat sheet; ✕ on the sheet, "⤢ Όλα", or zooming
  all the way out return to the overview. Zooming in (>1.25× fit) grows the canvas and shrinks the list; ⌄/⌃
  collapses it (remembered per device).
- **Guided tour**: starts automatically on a device's first visit (flag `weddingSeatingPlanner.tour.v1` in
  localStorage) and again from ⋯ → "❓ Οδηγός χρήσης" or the "?" button (PC). Two flows chosen by screen width
  (`tourSteps()`). Since 2026-09-10 the tour is OPT-IN: a first visit shows one centred **welcome card**
  (`startWelcome`/`maybeWelcome`, flag `weddingSeatingPlanner.welcome.v1`; texts `welcomeTitle`, `welcome1..3`, the link
  line only when the profile has a cloudId) with "Ξεκινάω" and "Δείξτε μου τα βήματα" (= the spotlight tour).
  Tour cards: phone = tables list → names sheet → 👥/hold → ⋯ (4); PC = guests → seat panel → floor → ☁ → ⋯ (5).
  One sentence per card, every card has ✕ and "Παράλειψη οδηγού". Two testers found longer versions exhausting —
  do not add cards or sentences. Texts live in `T_ALL.<lang>.tour`. Spotlight = `#tourSpot` box-shadow.
- **Contextual hints** (`HINT_ENTER`, `HINT_HOLD` in localStorage): one line inside the seat sheet ("Γράψτε όνομα,
  Enter → επόμενη θέση.") until the first new name is seated; the hold-to-move toast only fires when a finger tried to
  drag a table and the floor panned instead (never on a tap).
- **Phone keyboard** (`syncKeyboard`/`revealField`, CSS `--kb` + `body.kb`): iOS/Android keep the layout viewport
  full-height under the keyboard, so the fixed bottom sheet used to be painted behind it. We measure the hidden strip
  with `visualViewport`, lift `#focus`/the drawer above it and scroll the active row (and its suggestions) into the
  visible part. Cannot be emulated in DevTools — test on a real phone via lab.html.
- **Less at once (tester feedback 2026-09-10)**: ⋯ menu = 4 rows (share, groups, print, guide) + «Περισσότερα…» with
  captions; phone drawer shows guests first with «Τραπέζια & χώρος» folded (`#toolsSec`, remembered per device);
  seat-sheet footer hidden on phones (Γέμισμα/Άδειασμα live under ⚙ via `openFillMenu`/`clearTableSeats`); search box
  hidden until 8+ unseated; `body.far` (zoom < 0.4, hysteresis 0.5) shows one big number per table at overview zoom;
  empty seats drawn as small chairs; pill bottom bar, borderless app bar. Andreas explicitly wants Aa/undo/zoom in the
  bottom bar — keep them.
- **Icons (2026-09-10)**: one monochrome stroke set lives in an inline SVG sprite at the top of `<body>` (`<symbol id="i-…">`),
  used as `<svg class="ic"><use href="#i-name"/></svg>` in markup or `ICON("name")` in JS. `.ic{pointer-events:none}` keeps every
  click on the button (the popover closers compare `e.target`). Dictionary labels carry NO emoji prefixes any more — a button
  that needs an icon holds `<svg>` + `<span data-t="…">`. Text glyphs that stay: ⋯ Aa − ＋ ? ✕ and the arrows in the layer menu.
  Cloud state: `setCloudDot` writes into `#cloudTxt` (hidden on phones) and toggles `on/err/pending` on `#cloudBtn`.
- **Plan name on phones**: `.planname` (ellipsis) with the native `<select>` laid invisibly on top — a tap still opens the
  phone's picker; `#appbar .spacer` is hidden ≤900px so the name gets the whole middle of the bar.
- **Starter plan**: 1800×1400 stage, 4×3 grid centred (DEFAULT_POSITIONS), dance floor at y 1040 under row 3, head table at
  (900,1290); grass retuned to soft sage (`texGrass`, base #8aa970). Existing plans keep their own geometry.
- **Load-order rule (bug found 2026-09-10)**: `let state = loadPlan(...)` runs at the TOP LEVEL of the script, so every
  `const`/`let` that sanitizePlan / migrateLayout / ensureProfiles touch must be declared ABOVE it (function declarations are
  hoisted, consts are not — a TDZ ReferenceError is swallowed by loadPlan's try/catch and the plan silently becomes the
  default). `isNum` and `FEATURE_KINDS` sat below it since the 2026-09-09 review pass: every LOCAL-ONLY plan (the lab, any
  profile without a cloud id) reloaded blank; cloud-linked profiles survived only through the unsynced → force-pull path.
  Smoke test after touching that area: save a plan, reload, check `loadError===""` in the console.
- **Touch: one gesture per thing** (2026-09-10, Andreas: holding a name opened an edit menu on top of the move). On phones a seated
  name is moved by HOLDING it ~⅓ s and dragging (`seatHold`, same feel as tables: lift, glow, drop on another chair = move/swap);
  a TAP picks it (pick bar: tap a chair · edit · unseat); a long press never opens the guest editor on touch (right-click still
  does with a mouse). Seats are `draggable` only with a mouse (iOS would start a native drag session otherwise).
- **Touch drag you can see** (2026-09-11, Andreas: "my finger hides where I'm dropping"): in `seatHold` the lifted pill floats
  `LIFT`=48 screen px above the finger; the drop target is the chair nearest to the PILL (not the finger) within `REACH`=46 px,
  shown enlarged + ringed (`.seat.snap`), and `#dragtag` at the top says "→ 3 · θέση 5" (green) or "↔ Μαρία" (amber = swap).
  Chair positions are measured once at lift and shifted when the floor edge-pans (finger within 36 px of the canvas edge).
  Gotchas fixed by review: the pill's delta is appended AFTER the seat's own `translate(-50%,-50%) rotate(-rot)` (so it stays
  in stage axes on rotated tables) and that base transform is restored on finish; the source `.table` gets z-index 60 for the
  drag (tables are stacking contexts); the snap enlargement uses the separate CSS `scale` property (an inline transform would
  beat a class rule); chairs under the sheet / pick bar are skipped as targets.
- **Place handle** (2026-09-11, second tester could not guess that names on the floor are interactive and looked for a
  handle in the list): every unseated name in the list and every occupied row of the table sheet carries a grip icon
  (`.grip`, `i-grip`). Click/tap → `openPlaceMenu` (#placemenu): "Διαλέξτε καρέκλα στην κάτοψη" (hands over to the
  existing pick flow) or a table list (free/total) → its seats (taken ones dimmed, the guest's own seat marked ←) →
  `placeGuestInSeat`. On PC the chip is also draggable from the handle. While a name is picked, free chairs pulse green
  and occupied chairs get an amber ring (drop = swap/replace); the picked seat keeps the accent ring (`.seat.picked`).
- **One-time tips** (`showTip`/`checkTips`, `weddingSeatingPlanner.tips`): a small dark card (top-right on phones, over the floor
  on PC) shown once per device at the moment the action becomes useful: first seated name → "hold/drag a name to another chair";
  names added to the list → "tap a name then a chair" / "drag or Auto-seat"; ≥6 guests none grouped → the dot changes the group;
  a table becomes full → the gear changes its seats; ≥20 guests and ≥80 % seated → ⋯ → Print. Never while the tour, a modal or
  another tip is up. Add a tip only when it answers a moment, not as a feature list.
- **Seat sheet**: "‹ Τραπέζια" (back) replaces ✕; each row has a colour dot — on an occupied row it changes that
  guest's group, on an empty row it picks the group new names will join. "⚙ Διαχείριση ομάδων…" (also ⋯ →
  Ομάδες… and the "＋ ομάδα" chip) opens the groups manager: rename inline, palette recolour, delete, add.
- **Touch moving**: on phones a finger on a table or decor PANS the floor; holding still ~⅓ s lifts it (haptic tick +
  glow) and only then does dragging move it. Mouse drags immediately. One-time hint toast explains it.
- **Performance**: textures are rasterised to JPEG bitmaps at load (the SVG noise filters were re-rendered on every
  zoom step); only the touched table(s) re-render on a seat change (`renderTables([ids])`); pinch/wheel zoom sets
  `will-change` on the stage for the gesture; touch devices drop the soft shadows and the dotted paper.
- **Venue console**: weddings can be renamed (✎ → `PATCH /venues/:id/weddings/:planId {label}`, also renames the
  plan) and couple links can be generated in ΕΛ/EN/DE (language select next to "Νέος γάμος").
- **Memory**: if the next agent is Claude Code on Andreas's PC, the memory files (`wedding-tables-app.md`,
  `takeaseat-owner-access.md`) already carry this state and the access links.
