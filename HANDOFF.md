# TakeaSeat — Handoff / Operations Guide

> Read this first. It maps the whole system so a new agent (or developer) can pick it up cold.
> **This repo is PUBLIC — never commit secrets here.** Real keys live in `ACCESS.local.md`
> (git-ignored, on Andreas's PC), in the server's env files, and in Andreas's password manager.
> Last updated: 2026-09-01.

## 1. What this is

**TakeaSeat** is a B2B wedding seating-plan SaaS sold to Greek wedding venues (κτήματα).
A venue creates one plan per couple; the couple opens a private link on their phone and places
their guests at tables. Live at **https://takeaseat.gr**.

- **Marketing home** (Greek, for venues): https://takeaseat.gr/ (`index.html`)
- **Seat editor** (the planner, 3 languages): `seating-planner-el.html` (EL), `-de.html` (DE), `seating-planner.html` (EN)
- **Owner console** (Andreas, manages venues + licenses): https://takeaseat.gr/admin.html
- **Venue console** (a κτήμα manages its weddings): https://takeaseat.gr/venue.html
- **Legal**: `/privacy.html`, `/terms.html`, `/dpa.html`

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
| `index.html` | Marketing home page (Greek, B2B). Footer links to legal pages. |
| `seating-planner.html` / `-de.html` / `-el.html` | The seat editor — EN / DE / EL. Functionally identical; only UI strings differ. |
| `seating-planner*.artifact.html` | claude.ai-artifact build of each planner (the file minus its `<head>/<body>` wrapper). |
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

> **Editing rule:** a change to the planner must be applied to **all three** language files
> **and** their `.artifact.html` twins. Regenerate a twin with the mkartifact helper
> (`node /tmp/mkartifact.mjs write <src.html> <dst.artifact.html>` — recreate the helper if the temp dir was cleared).

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
- **Planner edits × 6**: 3 language files + 3 `.artifact.html` twins must stay in parity.
- **Memory**: if the next agent is Claude Code on Andreas's PC, the memory files (`wedding-tables-app.md`,
  `takeaseat-owner-access.md`) already carry this state and the access links.
