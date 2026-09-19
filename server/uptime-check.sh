#!/bin/bash
# Every-5-min health check for takeaseat.gr. Deployed on the host at /opt/takeaseat-uptime.sh and
# scheduled via /etc/cron.d/takeaseat-uptime (*/5 * * * *). Alerts go through /opt/takeaseat-alert.sh
# (the edu-admin app's SMTP, same inbox as the edu alerts).
#
# 1. Probes https://takeaseat.gr/health THROUGH the local Caddy (--resolve to 127.0.0.1, real TLS
#    verification — no -k), so vhost + certificate + app are all tested on THIS box, and requires
#    "ok":true in the body.
# 2. On failure: docker restart takeaseat-api, re-check after 15 s, alert. While it stays down: one
#    alert per hour; when it comes back: one "back up" mail.
# 3. At most once a day each: the newest local backup is older than 26 h; the disk that holds the
#    data volume is more than 85 % full.
# Silent when everything is fine. Skipped while server/deploy.sh runs (it holds the deploy lock).
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ALERT=${ALERT:-/opt/takeaseat-alert.sh}
CONTAINER=takeaseat-api
COMPOSE_FILE=/opt/takeaseat/server/docker-compose.yml
URL=https://takeaseat.gr/health
BACKUPS=/opt/backups
DATA_DIR=/var/lib/docker/volumes/takeaseat_tas_data/_data
STATE_DIR=/var/lib/takeaseat
DOWN="$STATE_DIR/down"            # exists while an outage alert is open (holds the time it started)
LOCK=/run/lock/takeaseat-deploy.lock
MAX_BACKUP_AGE_H=26
DISK_MAX_PCT=85

flock -n "$LOCK" true 2>/dev/null || { echo "$(date -Is) deploy in progress — check skipped"; exit 0; }
mkdir -p "$STATE_DIR"
TMP=$(mktemp); trap 'rm -f "$TMP" "$TMP.err"' EXIT

health() {   # prints "ok" or a short reason
  local code rc
  code=$(curl -sS -o "$TMP" -w '%{http_code}' --max-time 15 --resolve takeaseat.gr:443:127.0.0.1 "$URL" 2>"$TMP.err"); rc=$?
  if [ "$rc" -ne 0 ]; then echo "curl exit $rc ($(head -c 160 "$TMP.err" | tr -d '\n'))"; return; fi
  if [ "$code" != 200 ]; then echo "HTTP $code"; return; fi
  if ! grep -q '"ok":true' "$TMP"; then echo "HTTP 200 without \"ok\":true: $(head -c 160 "$TMP" | tr -d '\n')"; return; fi
  echo ok
}

# ---- 1 + 2: is the site up? --------------------------------------------------------------------
R=$(health)
if [ "$R" = ok ]; then
  if [ -e "$DOWN" ]; then
    "$ALERT" "takeaseat.gr is back up" "Health check OK again at $(date -Is). Down since $(cat "$DOWN")." && rm -f "$DOWN"
  fi
else
  echo "$(date -Is) DOWN: $R -> docker restart $CONTAINER"
  if docker restart "$CONTAINER" >/dev/null 2>&1; then RS="docker restart $CONTAINER: done"
  elif docker compose -f "$COMPOSE_FILE" up -d >/dev/null 2>&1; then RS="container was missing; docker compose up -d: done"
  else RS="restart FAILED (docker restart and docker compose up -d both failed)"; fi
  sleep 15
  R2=$(health)
  echo "$(date -Is) after restart: $R2"
  MSG="Health check of $URL (via this box's Caddy) failed: $R
$RS
Re-check 15 s later: $R2
Logs: /var/log/takeaseat-uptime.log · docker logs --tail 50 $CONTAINER"
  if [ "$R2" = ok ]; then
    if [ -e "$DOWN" ]; then
      "$ALERT" "takeaseat.gr is back up (after auto-restart)" "$MSG
Down since $(cat "$DOWN")." && rm -f "$DOWN"
    else
      "$ALERT" --every 60 restarted "takeaseat.gr was down — auto-restart fixed it" "$MSG"
    fi
  elif [ ! -e "$DOWN" ] || [ -n "$(find "$DOWN" -mmin +59 2>/dev/null)" ]; then
    # still down: one mail now, then one per hour until it recovers
    if "$ALERT" "takeaseat.gr DOWN — auto-restart did not help" "$MSG"; then
      if [ -e "$DOWN" ]; then touch "$DOWN"; else date -Is > "$DOWN"; fi
    fi
  fi
fi

# ---- 3: daily checks (the stamp files in $STATE_DIR keep them to one mail a day) --------------------
# shellcheck disable=SC2012  # fixed backup file names, newest first
newest=$(ls -1t "$BACKUPS"/takeaseat-*.db.gz.age 2>/dev/null | head -n 1)
if [ -z "$newest" ]; then
  "$ALERT" --every 1440 backup-age "no local backup found" "There is no $BACKUPS/takeaseat-*.db.gz.age at all. Check /var/log/takeaseat-backup.log and /etc/cron.d/takeaseat-backup."
else
  age_h=$(( ( $(date +%s) - $(stat -c %Y "$newest") ) / 3600 ))
  if [ "$age_h" -ge "$MAX_BACKUP_AGE_H" ]; then
    "$ALERT" --every 1440 backup-age "newest backup is ${age_h} h old" "The newest local backup is $newest (${age_h} h old; the nightly one runs at 03:10 UTC). Check /var/log/takeaseat-backup.log and /etc/cron.d/takeaseat-backup."
  fi
fi

pct=$(df -P "$DATA_DIR" 2>/dev/null | awk 'NR==2 { sub("%", "", $5); print $5 }')
if [ -z "$pct" ]; then
  "$ALERT" --every 1440 disk "cannot read disk usage" "df failed for $DATA_DIR (the takeaseat_tas_data volume)."
elif [ "$pct" -gt "$DISK_MAX_PCT" ]; then
  "$ALERT" --every 1440 disk "disk ${pct} % full" "The disk that holds $DATA_DIR is ${pct} % full (alert above ${DISK_MAX_PCT} %). The server refuses writes when the disk is nearly full.
$(df -h "$DATA_DIR" 2>/dev/null)
Space hogs to check: /opt/backups, docker system df, /var/log."
fi
exit 0
