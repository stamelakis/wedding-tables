#!/bin/bash
# TakeaSeat deploy — run ON the box, as root:   /opt/takeaseat/server/deploy.sh [--force]
#
#  1. refuses Friday–Sunday (Athens time) during the wedding season unless --force
#  2. takes an encrypted backup (/opt/takeaseat-backup.sh) — no backup, no deploy
#  3. tags the image the live container runs as takeaseat-api:prev
#  4. git pull --ff-only
#  5. docker compose build — the build runs the API tests and the stale-planner check;
#     if they fail, nothing is deployed and the checkout goes back to where it was
#  6. docker compose up -d, then waits up to 60 s for https://takeaseat.gr/health {"ok":true}
#     (through this box's Caddy, real TLS)
#  7. never healthy -> puts :prev back (image + checkout), brings it up, mails an alert, exit 1
#  8. prints the startup log lines (migration / mail / pdf) and host scripts that differ from the repo
#
# Env: SEASON_START=4 SEASON_END=10 (months, inclusive; start > end wraps over New Year),
#      DEPLOY_TZ=Europe/Athens, HEALTH_WAIT=60 (seconds), REPO_DIR (default: the checkout this file is in).
# The uptime cron skips its checks while this runs (shared lock), so it will not restart the
# container in the middle of a deploy.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export GIT_TERMINAL_PROMPT=0

SEASON_START=${SEASON_START:-4}
SEASON_END=${SEASON_END:-10}
DEPLOY_TZ=${DEPLOY_TZ:-Europe/Athens}
HEALTH_WAIT=${HEALTH_WAIT:-60}
CONTAINER=takeaseat-api
IMAGE=takeaseat-api
URL=https://takeaseat.gr/health
BACKUP=/opt/takeaseat-backup.sh
ALERT=/opt/takeaseat-alert.sh
LOCK=/run/lock/takeaseat-deploy.lock

say() { printf '\n== %s\n' "$*"; }

health() {   # prints "ok" or a short reason
  local body code rc err
  err=$(mktemp)
  body=$(curl -sS --max-time 10 --resolve takeaseat.gr:443:127.0.0.1 -w '\n%{http_code}' "$URL" 2>"$err"); rc=$?
  code=$(printf '%s' "$body" | tail -n 1); body=$(printf '%s' "$body" | sed '$d')
  if [ "$rc" -ne 0 ]; then echo "curl exit $rc: $(tr -d '\n' < "$err" | cut -c1-120)"
  elif [ "$code" != 200 ]; then echo "HTTP $code"
  elif ! printf '%s' "$body" | grep -q '"ok":true'; then echo "no \"ok\":true in $(printf '%s' "$body" | cut -c1-120)"
  else echo ok; fi
  rm -f "$err"
}

wait_healthy() {   # waits up to HEALTH_WAIT s; returns 0 when healthy
  local t=0 r=""
  while [ "$t" -lt "$HEALTH_WAIT" ]; do
    sleep 3; t=$((t + 3))
    r=$(health)
    [ "$r" = ok ] && { echo "healthy after ${t} s"; return 0; }
  done
  echo "not healthy after ${HEALTH_WAIT} s: $r"
  return 1
}

in_season() {   # month $1 inside SEASON_START..SEASON_END (inclusive, may wrap)
  if [ "$SEASON_START" -le "$SEASON_END" ]; then [ "$1" -ge "$SEASON_START" ] && [ "$1" -le "$SEASON_END" ]
  else [ "$1" -ge "$SEASON_START" ] || [ "$1" -le "$SEASON_END" ]; fi
}

startup_log() {
  say "startup log of the running container"
  docker logs "$CONTAINER" 2>&1 | head -n 15
}

host_script_drift() {   # host copies are NOT deployed by this script — show what differs
  local pair src dst out=""
  for pair in server/backup.sh:/opt/takeaseat-backup.sh server/uptime-check.sh:/opt/takeaseat-uptime.sh \
              server/offsite-push.sh:/opt/offsite-push.sh server/alert.sh:/opt/takeaseat-alert.sh \
              server/ops/cron.d/takeaseat-backup:/etc/cron.d/takeaseat-backup \
              server/ops/cron.d/takeaseat-uptime:/etc/cron.d/takeaseat-uptime \
              server/ops/cron.d/offsite-push:/etc/cron.d/offsite-push; do
    src=${pair%%:*}; dst=${pair#*:}
    [ -f "$src" ] || continue
    cmp -s "$src" "$dst" || out="$out
  $dst differs from the repo: install -m $(case "$dst" in /etc/*) echo 644;; *) echo 755;; esac) $REPO/$src $dst"
  done
  [ -n "$out" ] && { say "host files that differ from the repo (not changed by this deploy)"; echo "${out#?}"; }
  return 0
}

main() {
  local force=0 a
  for a in "$@"; do
    case "$a" in
      --force) force=1 ;;
      -h|--help) sed -n '2,20p' "$0"; return 0 ;;
      *) echo "unknown argument: $a (use --force or --help)"; return 2 ;;
    esac
  done

  # REPO_DIR: only for the very first run, from a copy outside the checkout (HANDOFF §5)
  REPO=${REPO_DIR:-$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)} || return 1
  cd "$REPO" || return 1
  COMPOSE=(docker compose -f "$REPO/server/docker-compose.yml")

  exec 9>"$LOCK"
  flock -n 9 || { echo "another deploy is running (lock $LOCK)"; return 1; }

  # 1. weekend guard
  local dow mon
  dow=$(TZ=$DEPLOY_TZ date +%u); mon=$(TZ=$DEPLOY_TZ date +%-m)
  if [ "$dow" -ge 5 ] && in_season "$mon"; then
    if [ "$force" = 1 ]; then
      echo "WARNING: $(TZ=$DEPLOY_TZ date '+%A %H:%M') in Athens, in the season — deploying anyway (--force)"
    else
      echo "Refusing: it is $(TZ=$DEPLOY_TZ date '+%A %d %b %H:%M') in Athens. Weddings run Friday–Sunday in the season"
      echo "(months $SEASON_START–$SEASON_END). Deploy Monday–Thursday, or pass --force for an urgent fix."
      return 2
    fi
  fi

  if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "Refusing: local changes in $REPO (edit on the PC, push, then deploy):"; git status --short; return 1
  fi

  # 2. backup
  say "backup"
  "$BACKUP" || { echo "backup failed — nothing deployed"; return 1; }
  local backup_file
  # shellcheck disable=SC2012  # fixed backup file names, newest first
  backup_file=$(ls -1t /opt/backups/takeaseat-*.db.gz.age 2>/dev/null | head -n 1)

  # 3. remember the live image
  local cur_img old_prev
  cur_img=$(docker inspect -f '{{.Image}}' "$CONTAINER" 2>/dev/null || docker image inspect -f '{{.Id}}' "$IMAGE:latest" 2>/dev/null || true)
  old_prev=$(docker image inspect -f '{{.Id}}' "$IMAGE:prev" 2>/dev/null || true)
  if [ -n "$cur_img" ]; then
    docker tag "$cur_img" "$IMAGE:prev" || { echo "could not tag $IMAGE:prev — nothing deployed"; return 1; }
    echo "live image ${cur_img:7:12} tagged $IMAGE:prev"
  else
    echo "WARNING: no live image found — there is nothing to roll back to"
  fi

  # 4. pull
  say "git pull"
  local old_rev new_rev
  old_rev=$(git rev-parse HEAD)
  git pull --ff-only || { echo "git pull failed — nothing deployed"; return 1; }
  new_rev=$(git rev-parse HEAD)
  if [ "$old_rev" = "$new_rev" ]; then echo "no new commits — rebuilding $(git log -1 --format='%h %s')"
  else git log --oneline "$old_rev..$new_rev"; fi

  # 5. build (runs the API tests + the stale-planner check)
  say "build"
  if ! "${COMPOSE[@]}" build; then
    git reset -q --hard "$old_rev"
    echo
    echo "BUILD FAILED (see above: a failing API test or stale planner output stops the build)."
    echo "Nothing deployed: the live container still runs the old image; the checkout is back at ${old_rev:0:7}."
    return 1
  fi

  # 6. start + health
  say "start"
  "${COMPOSE[@]}" up -d || echo "docker compose up -d failed"
  if wait_healthy; then
    startup_log
    if [ -n "$old_prev" ] && [ "$old_prev" != "$cur_img" ]; then
      docker image rm "$old_prev" >/dev/null 2>&1 || true   # the previous :prev, now untagged; best effort
    fi
    host_script_drift
    say "deployed ${new_rev:0:7} — https://takeaseat.gr is healthy (pre-deploy backup: ${backup_file:-none})"
    return 0
  fi

  # 7. roll back
  say "NEW VERSION UNHEALTHY — last log lines of the new container"
  docker logs --tail 30 "$CONTAINER" 2>&1
  if [ -z "$cur_img" ]; then
    echo "No previous image to roll back to. Pre-deploy backup: ${backup_file:-none}"
    "$ALERT" "deploy FAILED, no rollback possible" "Deploy of ${new_rev:0:7} is unhealthy and there was no previous image." || true
    return 1
  fi
  say "rolling back to the previous image (${old_rev:0:7})"
  docker tag "$IMAGE:prev" "$IMAGE:latest"
  git reset -q --hard "$old_rev"
  "${COMPOSE[@]}" up -d --no-build --force-recreate
  local result
  if wait_healthy; then result="rolled back to ${old_rev:0:7}, site healthy again"
  else result="rolled back to ${old_rev:0:7}, but the site is STILL NOT HEALTHY — look now"; fi
  startup_log
  echo
  echo "DEPLOY FAILED: ${new_rev:0:7} never became healthy; $result."
  echo "If the new version migrated data before failing, the pre-deploy backup is ${backup_file:-none}."
  "$ALERT" "deploy FAILED and rolled back" "Deploy of ${new_rev:0:7} never answered /health ok within ${HEALTH_WAIT} s.
Result: $result.
Pre-deploy backup: ${backup_file:-none}" || true
  return 1
}

main "$@"
exit $?
