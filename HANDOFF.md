# TakeaSeat — Handoff / Operations Guide

> Read this first. It maps the whole system so a new agent (or developer) can pick it up cold.
> **This repo is PUBLIC — never commit secrets here.** Real keys live in `ACCESS.local.md`
> (git-ignored, on Andreas's PC), in the server's env files, and in Andreas's password manager.
> Last updated: 2026-09-20 (roles & access §1b · email §1c · lifecycle §1d · couple phases & season-only §1e).

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

**Pricing on the site (2026-09-20):** venues **season only, 129 €/season + VAT** (unlimited weddings; the 9 €/wedding tier
was dropped — old per-wedding licences still work), couples **19 € one-off incl. VAT** (their planner opens after the 14-day
withdrawal period — §1e). Free public demo: `/lab.html` (up to 8 tables). Numbers live only in `index.html` + `terms.html`. Couples currently sign up by e-mail (the CTA is a mailto);
fulfil in `admin.html` → **Couples (direct)** → create **with their email** (the claim link is mailed to them when mail
is on — §1c; otherwise send the **claim link** yourself, §1b). Never again as a wedding under a
"Direct couples" venue: those weddings are venue-owned, so the admin could open them.

## 1b. Roles & access (2026-09-18) — who can see and change what

| role | how they get in | what they can do |
|---|---|---|
| **Admin** (Andreas) | `OWNER_KEY` in `admin.html` | venues + licences, sell plans to couples (claim links), see **support invitations**. **Cannot open any couple plan** — no API route returns a couple plan, id or key to the owner key. Two admin powers over a couple plan, both visible to the couple: **reset the access link** (lost link) and **erasure**. |
| **Venue** | console key in `venue.html`; per-wedding venue link `#vkey=` | builds its **space once (template)**, decides **what couples may change** (default + per wedding), creates weddings (copied from the template, no guests), full rights on its weddings, can invite support for a wedding. |
| **Couple** | edit link `#key=` (from the venue, or claimed from TakeaSeat) | couple-owned plan: everything, incl. inviting support and making new links. Venue plan: guests, seating, groups, invitations, print — plus whatever the venue allows. |
| **Support** | `#support=` link from the admin's support list, only while the owner's invitation lasts (24 h / 3 d / 7 d) | opens **view-only**, "Ενεργοποίηση επεξεργασίας" to fix things; nothing is stored in the helper's browser; cannot delete, rename, copy, extend, or keep access via sync codes. Every open/save is in the owner's access log. |
| **Viewer** | view link `#view=` | read only. |

- **Server is the authority** (`wedding-sync-worker.js`): reads need a credential (a plan id alone is not enough);
  couple edits on venue plans pass through `enforcePerms` (locked parts are copied back from the stored plan and the
  fixed plan is returned `{enforced, plan}`; an old planner gets a 409 carrying it). The planner only mirrors the locks
  (`can(perm)`, `ACCESS`, body `lock-*` classes) so nothing locked looks editable.
- **Permissions** (couple rights on venue plans): `floor` (size + material), `decor` (the *venue's* items — couples may
  always add and move their own photo booth etc.; items carry `by: venue|couple`), `layout` (table x/y/rot), `tables`
  (add/delete/merge), `seats` (+ `maxSeats` per table), `labels` (table names). **Locks apply only after the venue put
  its layout in** (`rec.layoutAt`: set by a template copy or the venue's first save) — before that the couple arranges
  the space. Default for venues created after 2026-09-18: only guests/seats/seat count; venues that existed before
  keep "all open" until they save their permissions card.
- **Credentials & generations**: every plan has `editKey` (couple), `readKey` (view), and for venue plans `venueKey`.
  Sync-code device links record the key generation (`keyGen` couple / `venueGen` venue): a reset, the couple's "Νέοι
  σύνδεσμοι", or the venue changing its console key retire older device links. A venue changing its console key also
  renews every per-wedding venue link; after that the admin can no longer read the venue key (only reset it).
- **Claim links** (`#claim=<token>`, fragment only): one-time, explicit button in the planner, 30-day TTL, the same
  device may retry for 15 min (lost response), a second device is told when it was used.
- **POST /plans** now needs proof of purchase (owner key, or the edit key of a couple-owned plan): nobody gets a free,
  unmanaged plan from the ☁ panel any more.
- **Migration**: `migrate(env)` runs once at server start (guarded by `meta:schema`): owner/readKey/venueKey/perms for
  every existing plan, code roles, and a **14-day id-only read grace** for plans that existed before (old tabs, old
  view links, the old Hermes). Owners can end it early from ☁.
- **Lost links**: with mail on, couples and venues recover on their own and every new link goes straight to their
  email (§1c). With mail off, «New link…» gives the admin a claim link he *could* open himself before the couple
  (logged as «άνοιξε τον νέο σύνδεσμο που έδωσε η TakeaSeat», every old link/device stops) — visible, not impossible.
- **Hermes after a deploy of this change**: the running `takeaseat_control.py` keeps the old code in memory and a new
  launch exits silently while it runs (single-instance guard). End the running pythonw process, then start it again.
- **Honest limit**: this is enforced by the software (API, consoles, planner). Root on the server can still read the
  SQLite file, because the server itself must read plans (wipe guard, history, lock enforcement). End-to-end
  encryption would be a separate project (lost link = lost plan).
- **Tests**: `node tools/test-api.mjs` (every role, migration, legacy, race guards, email — §1c). The build also
  fails on duplicate dictionary keys (a later key silently overrides the earlier one).

## 1c. Email: customers get their own links and recover on their own (2026-09-18)

Every couple and venue has a **recovery email** (`couple.email` / `venue.email`, index `email:<addr>`). With mail ON
the server e-mails every link and key **straight to the customer**, and the owner API never returns them:
- new couple → the **claim link** goes to the couple's email (admin sees "sent", never the link);
- new venue → a **7-day setup link** (`venue.html#recover=`) where the venue creates its own console key;
- **"forgot my link / key"**: couples at `/seating-planner-el.html#recover` (linked from the home page and from every
  used/expired claim screen), venues from the sign-in screen of `venue.html` → `POST /recover` mails one-hour, one-time
  links (answer is the same whether or not the address exists; 3 mails/hour per address, 20/hour per IP);
- admin **Send link** (unopened: the claim link, renewed if expired; opened: a 7-day recovery link), **New link**
  (reset) and venue **Reset key** all go by mail; a venue's current key keeps working until it uses the mailed link;
- changing the address: the customer does it in **Access & support** (planner) / the key panel (venue console) and
  confirms from the new address (`#verify=`); the old address is always told. The admin can also change it
  (PATCH) — the old address is told and it shows in the couple's access log («άλλαξε το email ανάκτησης»).
- Links always use `PUBLIC_URL` (never the request Host). Mails are plain text in el/en/de (`MAILS` in the worker).

**Turning mail on** (`/opt/takeaseat/server/server.env`, then `docker compose … up -d`): `SMTP_HOST`, `SMTP_PORT`
(465 = TLS, else STARTTLS), `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (e.g. `TakeaSeat <hello@takeaseat.gr>`), optional
`PUBLIC_URL`. The startup log says `mail: SMTP via …` or `mail: off`. Delivery failures are logged (`mail failed to
ab***@…`), not retried — the admin can press Send link again. The sender domain needs SPF + DKIM at Papaki or the
mails land in spam. **With mail OFF** nothing changes: claim links and venue keys are shown in `admin.html` as before.
Dev: `MAIL_LOG=1 node tools/dev.mjs` prints mails to the console with links to the dev server.

The remaining admin power over a couple plan is visible, not impossible: the admin can change a couple's address to
one he controls and press Send link (or reset). The couple's old address is told and both steps are in their log.

## 1d. After the wedding, dates, trash, renewals (2026-09-19)

Owner decisions (Andreas): support 10:00–14:00 & 17:00–21:00, phone/Viber/WhatsApp +30 697 735 5378; after the wedding
the plan is **view-only** and **deleted 7 days later** (admin can change this); venues **renew automatically** unless they
cancel; **no refunds for venues**; deleted weddings are restorable **only by the admin** for 14 days.
- **Wedding date** (`rec.weddingDate`, Athens): venues set it per wedding in the console, couples who bought directly in
  the planner, the admin anywhere. Limits against reusing one paid wedding for another couple: today … +2 years, the first
  date free then 3 changes, never cleared, frozen after the wedding (admin unlimited). Changes are in the access log.
- **Lifecycle** (server computes `life` on every plan GET): `lockAt` = 00:00 Athens the day after the wedding; from then
  every write answers `403 locked` (couple, venue, support alike); `deleteAt` = lockAt + keepDays (default 7). No date →
  fallback 18 months after creation (older plans: 18 months after `meta:lifecycle.since`). Policy = global
  (`meta:settings`, admin "After the wedding") < venue/couple `retention` < plan `retention` (admin "Exceptions" by plan
  id: keep forever / stay editable / extra days; index `retention:index`). **Andreas & Lina** has a plan exception:
  keep forever + stay editable (set after the 2026-09-19 deploy); a private export also lives in
  `C:\Users\andre\Documents\TakeaSeat-archive\` (outside the repo).
- **Hourly sweep** (`sweep()` in the worker, run by server.mjs): lock → keepsake PDF mailed once to couples who bought
  directly (needs mail + PDF) → delete at deleteAt (couple licence keeps name/dates, loses its address) · empty the
  venues' trash after 14 days · renew seasonal licences (same dates next year, `invoiceDue` for the admin) · renewal
  reminder mails 30 and 7 days before (venues with an email).
- **PDF**: `server/pdf.mjs` (pdfkit, DejaVu fonts in the image) — `GET /plans/:id/pdf?mode=floor|keepsake` for stored
  plans (any role that can read, also after the wedding) and stateless `POST /pdf` for the planner (local plans, the lab,
  unsynced edits). 10 PDFs/min per IP.
- **Trash**: a venue's DELETE moves the wedding to `v.trash` (plan gets `deletedAt`, every route answers 410);
  admin.html lists, restores (fresh venue link) or erases now.
- **Admin notes**: `venue.contact` is PUBLIC (shown to that venue's couples); `venue.notes` is private. A couple's
  `contact` is admin-only.
- **Server hardening**: request bodies > 3 MB → 413 before being read; every 500 is logged (method, path with ids
  masked, stack — never bodies or keys); admin erasures/restores are logged.

## 1e. Couple phases, dates, season-only venues, free lab (2026-09-20)

Why: couples (consumers) may withdraw within 14 days of an online purchase; nobody should get free use, and a plan must
not serve other couples' weddings. Owner decisions (Andreas):
- **Direct couples**: the admin sells with a **required wedding date**; the planner opens **after the 14-day withdrawal period (00:00 on day 15 after payment)**
  (`plan.opensAt`, phase `waiting`: read-only + countdown). **Start now** (admin tick, only when the wedding is < 21 days
  away; the couple consents that a withdrawal then costs the days used) skips the wait.
- **Phases** (server `life.phase`, couple role only — venue, support, admin never limited): `names` until 00:00 Athens
  **30 days before the wedding** (guests, groups, invitations, seating on existing tables, chair counts, table labels, the
  couple's own decor; NOT add/delete/merge/move tables or the floor — enforced server-side, the plan comes back
  `{enforced}`; a first upload while nothing is stored keeps only the starting 8 guest tables + head table), then `full`,
  then `locked` from the day after the wedding. GET returns the couple's EFFECTIVE `perms` (phase ∩ venue perms).
- **One date change** for a direct couple; it freezes the plan (`frozen`, `plan.frozenUntil`) until 00:00 Athens 14 days
  before the new date. The admin can move dates without a freeze and unfreeze (`PATCH /admin/couples/:id {unfreeze}`).
- **Venues**: season deal only (the 9€/wedding tier is gone from site and admin; old per-wedding licences still work);
  every wedding needs a date (`missing_date`); venue couples have no waiting phase, same names/full phases; venues keep
  3 date changes; **new couple link** `POST /venues/:id/weddings/:planId/couple-link` (old link + devices stop, logged).
- **New plans start with 8 round tables + the head table**; **lab.html is a free public demo** limited to 8 guest tables;
  the same 8-table cap applies to any plan kept only on a device (no cloudId), except on devices where the owner signed in
  to admin.html (`localStorage.weddingOwnerDevice`, a non-secret flag). A couple's **extra plans** (POST /plans with
  parentId) can only be put online once the main plan is in the `full` phase (`not_open` otherwise).
- **Invitations editor** in the planner (list, members, rename, delete, add/remove/move people, seat all).
- Hermes «νέος γάμος …» must include the date («… στις 12 Σεπτεμβρίου»); it asks for it otherwise.

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
| `server/uptime-check.sh` | 5-min health check (`/health` via Caddy, real TLS) + auto-restart + alerts + daily backup-age/disk checks (deployed as `/opt/takeaseat-uptime.sh`). |
| `server/deploy.sh` | The deploy: weekend guard, backup, build with tests, health wait, automatic rollback (runs on the box). |
| `server/alert.sh` | Shared alert mail helper for the host scripts (deployed as `/opt/takeaseat-alert.sh`). |
| `server/pdf.mjs` | PDF renderer (pdfkit + DejaVu fonts): floor plan and keepsake. `node tools/pdf-sample.mjs <plan.json> <out>` renders samples. |
| `server/ops/` | `Caddyfile.takeaseat` (copy of the live site block + planned www redirect), `cron.d/` (the host cron files), `REBUILD.md` (new server from zero). |
| `.github/workflows/monitor.yml` | External uptime monitor (GitHub Actions, every 10 min) — opens/closes the issue "takeaseat.gr down". |

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
- **Seat editor**: no password — the link *is* the credential, always in the URL `#fragment` (never sent to the
  server or logs): couple `?plan=<id>#key=<editKey>`, venue `?plan=<id>#vkey=<venueKey>` (`&preview=1` = as the couple
  sees it), view-only `?plan=<id>#view=<readKey>`, support `?plan=<id>#support=<key>`, new couple `#claim=<token>`.
  Reading a plan needs one of these (or a linked sync code); the plan id alone is not enough since 2026-09-18.
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
A venue can also self-rotate its key in the 🔑 panel of `venue.html` (old key dies immediately; after that the owner
API returns `key:null` for it — use **Reset key** in `admin.html` for a venue that lost it). **Do not use the DB to open
a couple-owned plan**: the promise to couples is that TakeaSeat only enters by their invitation (§1b).

## 5. Deploy / update

All changes ship the same way — commit here, then deploy on the box with `deploy.sh`:
```bash
# from your PC:
git add -A && git commit -m "..." && git push origin main
# on the box (Monday–Thursday in the season; Fri–Sun needs --force):
ssh -i ~/.ssh/hetzner root@178.104.158.125
bash /opt/takeaseat/server/deploy.sh
```
`deploy.sh` takes a backup, tags the live image `takeaseat-api:prev`, pulls, builds (the build runs
`tools/test-api.mjs` and the stale-planner check — a failure deploys nothing), starts, and waits up to 60 s for
`https://takeaseat.gr/health` `{"ok":true}`. If it never gets healthy it puts `:prev` back, mails an alert and exits 1.
It ends with the startup log (migration / mail / pdf) and a list of host files that differ from the repo.
- **First run** (done 2026-09-19, commit e75b1e8): deploy.sh was not on the box yet, so it ran as
  `git fetch && git show origin/main:server/deploy.sh > /root/deploy-first.sh && REPO_DIR=/opt/takeaseat bash /root/deploy-first.sh --force`.
  The new host scripts + cron files were installed the same day; the previous copies are in `/root/host-backup-20260919/`.
- **Host files** are copies, not deployed by deploy.sh. Install `alert.sh` first (the others call it):
  `install -m 755 server/alert.sh /opt/takeaseat-alert.sh`, then `backup.sh` → `/opt/takeaseat-backup.sh`,
  `uptime-check.sh` → `/opt/takeaseat-uptime.sh`, `offsite-push.sh` → `/opt/offsite-push.sh`, and
  `install -m 644 server/ops/cron.d/* /etc/cron.d/`. Test with `/opt/takeaseat-alert.sh test "install check"` (one real
  mail) and `/opt/takeaseat-uptime.sh; echo $?` (silent, 0). `/opt/offsite-push.sh` also pushes the amelie, edu and elab
  backups — keep those lines when you edit it.
- **Caddy** changes (rare): edit `/opt/edu-admin/Caddyfile`, **back it up**, run `docker exec edu-admin-caddy-1 caddy validate --config /etc/caddy/Caddyfile`, reload, then verify **both** takeaseat and educationproject.gr return 200.
- **Legacy Cloudflare worker** (`wedding-sync`): dormant, no longer used by the app (client `SYNC_URL=""`,
  GitHub Pages redirects to takeaseat.gr). Safe to ignore or delete. Its KV namespace `wedding-plans`
  was already deleted.

## 6. Operations

**Backups (all in `/opt/backups`, cron in `/etc/cron.d/`):**
- `takeaseat-backup` — 03:10 — WAL-safe snapshot → gzip → **age-encrypt** → `takeaseat-*.db.gz.age`, kept at most 14 days.
- `offsite-push` — 03:40 — age-encrypts every backup (edu + elab too, which are otherwise plaintext) and
  `rclone copy`s them to Backblaze **B2 bucket `TakeaSeat/backups`**, 21-day retention. B2 only ever holds ciphertext.
- The **age private key is OFF the box** (Andreas's password manager). Without it, backups can't be decrypted.
- **Restore:** `rclone copy b2:TakeaSeat/backups/<file>.age . && age -d -i <privkey-file> <file>.age > out.gz && gunzip out.gz`
  (or use a local `/opt/backups/*.age`). Verified working.

- **Backups fail loudly**: `takeaseat-backup` and `offsite-push` exit 1 and mail an alert on any failed step; "backup ok"
  / "off-site push ok" in `/var/log/*.log` means it worked. B2 retention is pruned by the script (`B2_PRUNE=1`, needs a
  key with deleteFiles). With a no-delete key: bucket lifecycle rules (20+1 days; amelie 14+1) and `B2_PRUNE=0` in
  `/etc/cron.d/offsite-push` (steps in §8).

**Monitoring**, two layers:
- **On the box** (`takeaseat-uptime`, */5): `/health` through Caddy with real TLS, restart on failure, alerts through the
  edu-admin app's SMTP (hourly while down, once on recovery); once a day it warns if the newest backup is older than
  26 h or the disk is over 85 %.
- **Outside** (GitHub Actions `monitor`, every 10 min): `/health`, valid TLS, certificate > 14 days. On failure it opens
  the issue "takeaseat.gr down" (GitHub emails Andreas) and closes it on recovery. GitHub pauses scheduled workflows
  after 60 days without repository activity — re-enable in Actions → monitor.
- **Rebuild from zero**: `server/ops/REBUILD.md`.

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
5. **Mail sender** (§1c): pick a transactional provider (e.g. Brevo / Postmark, EU) or a Google Workspace mailbox on
   takeaseat.gr, add its SPF + DKIM records at Papaki, put `SMTP_*` + `MAIL_FROM` in `server.env`, and list the
   provider as a sub-processor in `privacy.html` / `dpa.html` (the DPA promises venues notice before a new one).
   Andreas: "we'll buy an email soon".
6. **Couples and the 14-day withdrawal right (decision + lawyer)**: the online planner is a *digital service*, so couples
   keep 14 days to withdraw (pro rata → nearly the full 19€ back). The terms now carry a compliant interim clause.
   Options researched 2026-09-19 (scratch notes, summarised): **A** free planner, 19€ buys the downloadable "export pack"
   (PDF floor plan, keepsake, Excel) — the right ends at the first download with express consent (recommended);
   **B** keep the paid plan as is (compliant, weak); **C** 14-day free trial converting to 19€ (card up front).
   Online sales will also need the new withdrawal button (ν. 5317/2026, art. 3ζα). Needs Andreas's choice + a lawyer.
7. **Renewals need mail**: a season renews automatically only after the 30/7-day reminder mail went out; while mail is
   off (or a venue has no email) the licence is flagged `renewSkipped` in admin.html and must be renewed by hand.
7b. **Season length** for venue licences: not decided yet (renewal = same dates next year). Note: creating weddings is
   blocked before `seasonStart` — revisit when the season is defined (venues book next season's weddings in winter).
8. **Monitoring**: a free GitHub Actions monitor (`.github/workflows/monitor.yml`, every 10 min, opens an issue → email)
   runs until Andreas picks a dedicated service (UptimeRobot / Better Stack) — to discuss.
9. **Backblaze key**: the server's B2 key can delete backups (checked 2026-09-19; bucket `TakeaSeat`, region
   eu-central-003 Amsterdam). Andreas: create a key without `deleteFiles` in the Backblaze console, put it in
   `/root/.config/rclone/rclone.conf` on the box, and move the 21-day retention to a bucket lifecycle rule.
10. **Emergency access**: none yet (Andreas's decision) — revisit before the first busy season.
11. **2FA** is still Andreas's to switch on (Hetzner, Cloudflare, Papaki, GitHub). GitHub Pages was turned off 2026-09-19.

## 7b. Product features added 2026-09-19

- **Planner**: search also finds seated guests («→ table», jumps there); **long tables** (shape `rect`, both long sides);
  **Excel**: export guest → table (CSV, UTF-8 BOM, `;`) and import names from CSV/TSV/paste with preview (groups,
  invitations, tables); print dialog «Εκτύπωση & PDF» with **floor-plan PDF** and, after the wedding, the **keepsake PDF**;
  printed lists carry the plan name, wedding date and print time; wedding date in Access (couples on their own plan);
  after the wedding a calm view-only strip; «Βοήθεια & επικοινωνία» in the ⋯ menu. View links are now truly read-only.
- **Venue console**: wedding date required, grouped/sorted list with search, progress and last change per wedding, PDF
  downloads, locked chips, soft delete + «Διαγραμμένοι γάμοι», licence/renewal toggle, help dialog + legal footer.
- **Admin console**: venue «Edit…» (public contact vs private notes, licence with explicit Unlimited, auto-renew,
  per-venue after-the-wedding override), renewal invoice badges, trash restore/erase, "After the wedding" settings with
  plan exceptions (paste a link), couple wedding dates and overrides.
- **Legal pages** (version 19 Sep 2026): both customer types, the real lifecycle, sub-processors (Hetzner DE, Backblaze
  EU-Central NL), honest access wording, interim couples' withdrawal clause + model form, venue auto-renewal. One
  identity block per page with `[bracket]` placeholders until the company exists. A lawyer review is still pending
  (15 points listed by the drafting agent — see the 2026-09-19 session; the main ones are in §8.6).

## 9. Critical gotchas

- **Deploy with `server/deploy.sh`**, not by hand. It refuses Fri–Sun in the season (use `--force` only when no
  wedding can be affected) and rolls back an unhealthy build.
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
- **Desktop feedback pass (2026-09-13)**: grab the empty floor to pan (mouse; `panState`, a drag never counts as the
  floor click); a name dropped / tapped onto a TABLE takes a free chair next to someone (`freeSeatFor`, `placeInTable`,
  `wireDiscDrop`; touch drags fall back to the disc under the pill); the search box is always shown on PC and sticky while
  the list scrolls; empty chairs paint above neighbouring name pills (z-index 2 vs 1); decor/table handles fade out with a
  0.6 s delay and stay while the item is selected (`.sel`, set in makeDraggable's pointerdown, cleared by a floor click);
  a name that would collide takes the NEAREST free spot around its chair (`placeNear`, stage frame): first it slides
  along the chairs (sideways, into the free space beside the table, up to its own width), only then the nearest spot in
  any direction with outward preferred; empty chairs, the disc and already-placed names are obstacles; each moved name is
  tied to its chair by a dot + thin leader (`seatLeader`). A table with no collision renders exactly as before. Head-table
  names do the same along their row. Andreas rejected two earlier versions (2026-09-14): the radial second-ring stagger
  and a shared outer circle ("use the space next to the table, don't drift toward other tables") — keep names hugging
  their own table. Hovering a name brings it (and its table) to the front.
- **Invitations** (`state.parties` [{id,name}], `guest.partyId`): created while typing names ("Οικ. Παπαδόπουλου:" on its
  own line groups the names below it until a blank line), edited per guest in the guest editor (datalist of existing
  invitations), shown as subsections of the guest list (`.pparty` header: tap = pick the whole party, its grip = place
  menu → table seats everyone, drag it on PC, pencil = rename / empty name = dissolve), `placePartyInTable`, auto-seat keeps
  parties together and joins members already seated, print shows "· invitation" after each name plus an "Προσκλήσεις"
  section with every member's table. `pruneParties` drops empty parties; sanitizePlan validates `partyId`.
  Semantics fixed by review: a party gesture (header tap / grip / drag / drop) seats ONLY `partyUnseated(pid)` — members
  already at a table stay put (the header shows "shown / total" under a filter); one save + one undo step per gesture
  (`placeGuestInSeat(…, quiet)` returns the touched tables); renaming to an existing name merges; dropping a name back on
  its own table is a no-op; `seatNeighbours` knows the head table's row + ends.
- **Letter case** (2026-09-13, Andreas: "turn lower case to upper case across all tables/lists, removing τόνους;
  upper → lower only if possible"): a DISPLAY mode in the Aa menu (`state.nameCase` asis/upper/lower) — the stored
  spelling never changes, so ΚΕΦΑΛΑΙΑ ↔ Πεζά is lossless for anything typed with accents. `upperGreek` drops the tonos
  (keeps dialytika: Ναΐμ → ΝΑΪΜ); `lowerGreek` capitalises ALL-CAPS words and restores the accent only for first names in
  `GREEK_FIRST` (~330 names → `GREEK_FIRST_MAP`); other words stay accent-less (a one-time toast says so). `guestName(id)`
  returns the displayed form, `rawName(id)` the stored one; `commitRow` treats a blurred row equal to either as "no rename".
  `partyName`/party headers/print use `caseName` too.
- **Προσκλητήρια from the sheet** (2026-09-13, Andreas: "pick the last 4 people and create a Προσκλητήριο I can name"):
  gear menu → "Προσκλητήριο…" (`#menuParty`) or the PC footer `#fParty` → `startPartySelect(t)`: every occupied row gets a
  check box (`.fchk`, row click toggles, inputs inert), a bar `#partysel` shows the count and a name field pre-filled with
  the surname most of the picked names share (`suggestPartyName`: majority `surnameStems`, shown in the spelling most of
  them use) or an existing invitation of one of them; Enter/Δημιουργία →
  `makePartyFromSelection` (`ensureParty` merges by name, one save). Escape / another table / unfocus end it. Greek wording
  is now "προσκλητήριο" everywhere (was "πρόσκληση"). Print: ⋯ → Εκτύπωση opens `#printModal` — "Ονόματα ανά τραπέζι"
  (as before) or "Προσκλητήρια ανά τραπέζι" (`buildAndPrint("parties")`: per table one line per invitation with how many of
  its people sit there, singles by name; `state.printMode` remembered without an undo step).
- **Merge by drop** (2026-09-13, Andreas: "drag a table on another should merge them and even increase the seats"):
  `makeDraggable` got `hooks` {move, clear, drop}; `tableHooks()` highlights the table under the dragged centre
  (`mergeTargetFor`: inside the disc, or the head table's rotated rectangle; `.table.mergeto`, `#dragtag.merge`
  "Συγχώνευση με «3»") and on drop puts the table back where it was and asks (`confirmAction`, own skip key
  `MERGE_SKIP_KEY`, title "Συγχώνευση τραπεζιών"). `mergeTables(src,dst)`: `resizeSeats(dst, max(capacity, seated+incoming))`,
  everyone moves over, the source is removed, one save, toast with ↶. `confirmDelete` is now a wrapper of `confirmAction`.
- **Auto-seat v2** (2026-09-13, Andreas: "auto-fill by group and name similarity"): chunks = whole invitations, then
  families (unseated names sharing a surname stem inside one colour group — union-find over `surnameStems`: tokens that
  are not known first names with the Greek ending dropped, ΚΟΤΣΩΝΑΣ/ΚΟΤΣΩΝΑ → ΚΟΤΣΩΝ), then singles; ordered by colour
  group then size; each chunk goes to the table with the best affinity (rest of its invitation +8, same surname +4, own
  group +2 / only strangers −3), ties to the first table with room; a chunk bigger than any free block is split over the
  emptiest tables.
- Review fixes for the four features (15 confirmed): Σοφία wins over Σοφιά (first spelling wins in the map); the merge
  toast key clashed with the guest-import key (now `tTablesMerged`); a merge that would pass 30 seats is refused with a
  toast (the sanitizer clamps capacity at 30 — a bigger table would lose chairs on reload); a name still being typed is
  flushed before a merge; the invitation suggestion uses the stored spelling; the selection survives a second press of
  the button, ticks never steal focus from the name field, and names removed from the table (×, undo, move) drop out of
  the ticks (`partySelIds`); the footer is a real 2×2; the ⋯ "ask again" entry covers merging; auto-seat orders
  stragglers-of-a-seated-invitation → bigger chunks → colour group (group-first fragmented the free blocks);
  `surnameStems` yields at most one stem per guest (last usable non-first-name token, "+ συνοδός" ignored) so shared
  first names cannot chain strangers into one "family"; `surnameToken` prefers the last non-first-name token.
- **Whole-table group** (2026-09-13, Andreas: "choose a table and make everyone sitting there part of a group, like
  Bride's family"): gear menu → "Ομάδα για όλο το τραπέζι…" (full-width `#menuGroup`) and, on PC, the sheet footer
  `#fGroup`. `openTableGroupMenu(t, anc)` reuses `#groupmenu`: one row per group with the count of the table's people
  already in it (row `.on` when all share it), an inline "Νέα ομάδα…" input + ＋ (creates with the next unused colour and
  assigns at once; becomes `activeGroupId` like the manager's Add), "Χωρίς ομάδα", "Διαχείριση ομάδων…".
  `setTableGroup(t, gid)` sets `groupId` on every seated guest — one save = one undo step — and toasts
  "«Οικογένεια νύφης»: όλοι στο «3» (8)". An empty table only toasts. The openers stop propagation (the document
  click-outside closer would otherwise shut the popover on the same click); `reanchorSheetMenus` re-anchors it to the
  sheet ⚙ on phones (`dataset.fromSheet`).
  Review fixes: the openers let the click bubble and the document closer exempts `#fGroup,#menuGroup` (a
  stopPropagation kept the Fill / gear popovers open underneath); creating a group here does NOT move the pool filter
  (`activeGroupId` — everyone in the new group is seated, the list would go empty); the ＋ path checks the table still
  exists; `deleteTable` and `restoreSnapshot` close `#groupmenu`; `editGroup` resets `fromSheet`; sanitizePlan nulls a
  `groupId` that points at no group; the footer button has its own full-width row (the label overflowed a third of the
  footer); focus returns to the footer/⚙ after the gesture so a stray Backspace stays inside the panel guard.
- **Delete key** (2026-09-13, Andreas: "delete tables by choosing and pressing delete, with a warning I can silence"):
  on PC, Delete or Backspace (not while typing, not while a modal is open, no key repeat) removes the thing chosen last —
  a decor item carrying `.feature.hsel` (set on pointerdown; grabbing a table clears it), else the focused table. Every
  delete (gear menu, decor menu, key) goes through `confirmDelete(text, onYes)` → `#delModal` (`.modal.narrow`) with a
  "Να μην ξαναρωτηθώ" checkbox stored in `weddingSeatingPlanner.skipDeleteConfirm`; when set, deletes run at once.
  `deleteTable` / `deleteFeature` save, re-render and toast "Διαγράφηκε «…» — ↶ για αναίρεση"; ↶ brings it back.
  The native `confirm()` is gone from these paths. Phones have no Delete key: the gear-menu path shows the same modal.
  Review fixes: no delete while the tour runs, during a pointer gesture (drag/resize/rotate) or from Backspace inside the
  names panel (Enter on the last row lands on the Fill button); undo/redo pause while any modal is open; a pick lifted from
  the deleted table is dropped; decor is resolved by position (`dataset.fi`, imported files may repeat ids); focusing a
  table by any path clears `.hsel`; the skip flag is per planner (`PBASE`) and ⋯ → Περισσότερα → "Ρώτα ξανά πριν τη
  διαγραφή" appears while it is set; every dismiss path runs the same close (handlers cleared, focus restored, clicks
  inside never reach the click-outside closers).
- **Import modes** (2026-09-13, Andreas built a plan in the lab and wanted only names + seating in Andreas & Lina): the
  import modal has a radio chooser — `new` (old behaviour: separate profile), `appendNames`, `appendAll` (file tables added as
  new tables with their people), `replaceNames` (list replaced, tables emptied, layout kept), `replaceSeating` (file tables paired
  with ours by shape + name, then by order; capacity grows if needed; extras appended; layout kept), `replaceAll`
  (restoreSnapshot + save, so ↶ undoes it). `mergePlanInto` remaps every guest id, matches groups and invitations by name.
  A guest-list file ({importGuests}) still goes to mergeGuestList whatever the mode.
  Review fixes: a confirmed replace opens the wipe window (`wipeAllowedUntil`, like resetPlan) so an emptied list is not
  reverted by the cloud guard; pairing never crosses shapes (a round table cannot land on the head table); appended tables
  step +40/+40 aside from an occupied spot; sanitizePlan drops a guest id that appears in two chairs (first wins) on every
  ingest path; the Load / Choose-file row is sticky on phones; the toast says how many tables were added or enlarged.
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
