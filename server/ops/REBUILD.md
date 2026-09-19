# TakeaSeat — new server from zero

For when the box (Hetzner, 178.104.158.125) is lost or has to be replaced. About an hour.
**No secrets in this repo** — you need, from the password manager / `ACCESS.local.md`:
the Hetzner login, the Backblaze B2 account (or an app key that can read `TakeaSeat/backups`),
the **age private key** (`AGE-SECRET-KEY-1…`), the `OWNER_KEY`, and the Papaki login.

The old box also runs educationproject.gr (the `edu-admin` stack, whose Caddy serves TakeaSeat
too) and amelie.gr. This guide rebuilds **TakeaSeat only**, with its own Caddy. If you are
rebuilding the whole shared box, bring edu-admin back first with its own guide, then skip step 7
and paste `Caddyfile.takeaseat` into `/opt/edu-admin/Caddyfile` instead.

## 1. Server
Hetzner Cloud → new server: Ubuntu LTS, x86, 2+ vCPU / 4+ GB (the current box: 4 vCPU, 8 GB,
75 GB disk), location Germany (the privacy policy says EU/Germany), your SSH key, public IPv4.
```bash
ssh root@NEW_IP
apt-get update && apt-get -y upgrade
apt-get install -y ca-certificates curl git sqlite3 age rclone openssl ufw
curl -fsSL https://get.docker.com | sh            # Docker Engine + compose plugin
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw --force enable
```
Leave the clock on UTC (the cron times assume it).

## 2. Code and settings
```bash
git clone https://github.com/stamelakis/wedding-tables.git /opt/takeaseat
install -m 600 /dev/null /opt/takeaseat/server/server.env
nano /opt/takeaseat/server/server.env
```
`server.env` keys (values from the password manager):
- `OWNER_KEY` — required (the admin console key).
- Mail, only if mail was on: `SMTP_HOST`, `SMTP_PORT` (465 = TLS, else STARTTLS), `SMTP_USER`,
  `SMTP_PASS`, `MAIL_FROM` (e.g. `TakeaSeat <hello@takeaseat.gr>`).
- `PUBLIC_URL` — optional, default `https://takeaseat.gr`.

## 3. Restore the latest backup (before the first start)
```bash
rclone config        # new remote named "b2", type b2, the B2 key id + key
rclone lsf b2:TakeaSeat/backups --include 'takeaseat-*' | sort | tail -3
F=takeaseat-YYYYMMDD-HHMMSS.db.gz.age                   # the newest one
rclone copy "b2:TakeaSeat/backups/$F" /root/restore/
docker volume create takeaseat_tas_data
read -rsp 'age secret key: ' K; echo                     # paste AGE-SECRET-KEY-1…, never written to disk
age -d -i <(printf '%s\n' "$K") "/root/restore/$F" | gunzip > /var/lib/docker/volumes/takeaseat_tas_data/_data/wedding.db
age-keygen -y <(printf '%s\n' "$K") > /opt/takeaseat-backup.pub    # the PUBLIC recipient for new backups
unset K
sqlite3 /var/lib/docker/volumes/takeaseat_tas_data/_data/wedding.db 'PRAGMA integrity_check; select count(*) from kv;'
```
`ok` plus a row count = good. If the old box still answers, take a fresh backup there first
(`/opt/takeaseat-backup.sh`) and restore that one instead — the nightly one can be up to a day old.

## 4. Network name
The compose file joins the external network `edu-admin_internal` (the shared Caddy's network).
On a TakeaSeat-only box create it once, with the same name, so the compose file stays unchanged:
```bash
docker network create edu-admin_internal
```

## 5. Build and start
```bash
cd /opt/takeaseat && docker compose -f server/docker-compose.yml up -d --build
docker logs takeaseat-api        # "KV backend: sqlite", "migration: …", "mail: …", "TakeaSeat server on 0.0.0.0:8080"
```
The build runs the API tests; a failure stops it (nothing starts).

## 6. DNS at Papaki
Papaki → takeaseat.gr → DNS: change the **A record of `takeaseat.gr`** to NEW_IP (`www` is a CNAME to
the apex, it follows). No AAAA record today — do not add one unless the server has IPv6 working.
Leave the MX / mail-forwarding (`info@` alias) and any SPF/DKIM TXT records alone.
Check: `dig +short takeaseat.gr @1.1.1.1` → NEW_IP (minutes to a few hours).

## 7. Caddy (HTTPS)
```bash
mkdir -p /opt/caddy
{ printf '{\n\temail andrewstamelakis@gmail.com\n}\n\n'; cat /opt/takeaseat/server/ops/Caddyfile.takeaseat; } > /opt/caddy/Caddyfile
docker run -d --name caddy --restart unless-stopped --network edu-admin_internal \
  -p 80:80 -p 443:443 -p 443:443/udp \
  -v /opt/caddy/Caddyfile:/etc/caddy/Caddyfile:ro -v caddy_data:/data -v caddy_config:/config caddy:2
docker logs -f caddy             # wait for "certificate obtained successfully" for both names (needs step 6)
```
Later changes: edit `/opt/caddy/Caddyfile`, `docker exec caddy caddy validate --config /etc/caddy/Caddyfile`,
then `docker exec caddy caddy reload --config /etc/caddy/Caddyfile`.

## 8. Host scripts and cron
```bash
cd /opt/takeaseat
install -m 755 server/backup.sh       /opt/takeaseat-backup.sh
install -m 755 server/uptime-check.sh /opt/takeaseat-uptime.sh
install -m 755 server/offsite-push.sh /opt/offsite-push.sh
install -m 755 server/alert.sh        /opt/takeaseat-alert.sh
install -m 644 server/ops/cron.d/takeaseat-backup server/ops/cron.d/takeaseat-uptime server/ops/cron.d/offsite-push /etc/cron.d/
```
Alerts are mailed through the edu-admin app container. **On a TakeaSeat-only box there is no such
container**: alerts are only written to `/var/log/takeaseat-*.log` until `server/alert.sh` gets
another mail path — the GitHub monitor (`.github/workflows/monitor.yml`) still mails you when the
site is down. The off-site push also looks for edu/amelie backups; none there is fine.

## 9. Verify
```bash
curl -s https://takeaseat.gr/health                   # {"ok":true,...}
curl -sI https://www.takeaseat.gr/ | head -3          # 301 -> https://takeaseat.gr/
/opt/takeaseat-backup.sh                              # "... backup ok: /opt/backups/takeaseat-….db.gz.age"
/opt/offsite-push.sh                                  # "... off-site push ok: uploaded 1 new file(s)"
ALERT_DRY_RUN=1 /opt/takeaseat-alert.sh test "rebuild check"
/opt/takeaseat-uptime.sh; echo $?                     # silent, 0
```
Then in a browser: `https://takeaseat.gr/admin.html` with the owner key (venues and couples are
listed), open one venue in `venue.html`, open a plan link. GitHub → Actions → **monitor** → Run
workflow: green, and any open "takeaseat.gr down" issue closes.

## 10. Afterwards
- Update the IP in `HANDOFF.md` §2/§4 and in `ACCESS.local.md`; new SSH host key on your PC.
- Hetzner: turn off (do not delete yet) the old server; delete it after a week without surprises.
- Deploys from now on: `/opt/takeaseat/server/deploy.sh` (HANDOFF §5).
