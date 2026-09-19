#!/bin/bash
# Off-site backup push to Backblaze B2 (bucket TakeaSeat/backups). Deployed on the
# host at /opt/offsite-push.sh, scheduled via /etc/cron.d/offsite-push (03:40 UTC daily,
# after the 03:00-03:20 local backups). Credentials live in /root/.config/rclone/rclone.conf
# (b2 remote; NOT in git).
#
# takeaseat and amelie snapshots are already age-encrypted; edu + elab backups hold personal
# data, so they are age-encrypted HERE before upload. Backblaze only ever stores
# ciphertext, decryptable solely with the off-box age private key.
# Idempotent: each dated file is encrypted+uploaded exactly once.
# amelie (another app on this box) was added on the box on 2026-09-18 — keep those lines.
#
# Fails loudly: any failed step is collected, the push goes on with the other files, and at the
# end the script mails an alert (/opt/takeaseat-alert.sh), prints "off-site push FAILED" and
# exits 1. "off-site push ok" is printed only when every step worked.
#
# Retention on B2 (B2_PRUNE=1, the default): amelie-* 15 days, everything 21 days, deleted
# by this script — which needs a B2 key WITH deleteFiles. Once the box has a key without
# deleteFiles, set B2_PRUNE=0 (in /etc/cron.d/offsite-push) and let bucket lifecycle rules
# do the retention instead (HANDOFF.md §6).
#
# Restore: rclone copy "b2:TakeaSeat/backups/<file>.age" . && age -d -i <private-key> <file>.age > out.gz && gunzip out.gz
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
SRC=/opt/backups
PUB=/opt/takeaseat-backup.pub
REMOTE=b2:TakeaSeat/backups
ALERT=${ALERT:-/opt/takeaseat-alert.sh}
B2_PRUNE=${B2_PRUNE:-1}
STAGE=$(mktemp -d)
LOG=$(mktemp)
trap 'rm -rf "$STAGE" "$LOG"' EXIT
ERRORS=""
n=0
err() { echo "$(date -Is) ERROR: $1"; ERRORS="$ERRORS
- $1"; }
finish() {
  if [ -n "$ERRORS" ]; then
    echo "$(date -Is) off-site push FAILED (uploaded $n new file(s))"
    "$ALERT" "off-site backup FAILED" "/opt/offsite-push.sh -> $REMOTE had errors:$ERRORS
Uploaded $n new file(s). Log: /var/log/offsite-push.log" || true
    exit 1
  fi
  echo "$(date -Is) off-site push ok: uploaded $n new file(s) -> $REMOTE"
  exit 0
}
last() { tail -n 3 "$LOG" | tr '\n' ' ' | cut -c1-300; }

[ -s "$PUB" ] || { err "no age pubkey at $PUB"; finish; }
EXISTING=$(rclone lsf "$REMOTE" 2>"$LOG") || { err "rclone lsf $REMOTE failed: $(last)"; finish; }
have() { printf "%s\n" "$EXISTING" | grep -qxF "$1"; }

for f in "$SRC"/takeaseat-*.db.gz.age "$SRC"/amelie-*.db.gz.age; do
  [ -e "$f" ] || continue; b=$(basename "$f"); have "$b" && continue
  cp "$f" "$STAGE/$b" || { err "copy of $b failed"; rm -f "$STAGE/$b"; }
done
for f in "$SRC"/edu-db-*.sql.gz "$SRC"/elab-store-*.json; do
  [ -e "$f" ] || continue; b=$(basename "$f").age; have "$b" && continue
  age -R "$PUB" -o "$STAGE/$b" "$f" || { err "age-encrypting $(basename "$f") failed"; rm -f "$STAGE/$b"; }
done

staged=$(find "$STAGE" -type f | wc -l)
if [ "$staged" -gt 0 ]; then
  if rclone copy "$STAGE" "$REMOTE" --transfers 4 --b2-hard-delete 2>"$LOG"; then n=$staged
  else err "rclone copy of $staged file(s) failed: $(last)"; fi
fi

if [ "$B2_PRUNE" = 1 ]; then
  # rclone delete goes on past a file it cannot delete and exits non-zero at the end;
  # each rule runs even when the other one failed.
  rclone delete "$REMOTE" --include "amelie-*" --min-age 15d --b2-hard-delete 2>"$LOG" \
    || err "B2 retention (amelie-*, 15 days) failed: $(last)"
  rclone delete "$REMOTE" --min-age 21d --b2-hard-delete 2>"$LOG" \
    || err "B2 retention (21 days) failed: $(last)"
fi
finish
