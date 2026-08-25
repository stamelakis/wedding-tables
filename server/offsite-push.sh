#!/bin/bash
# Off-site backup push to Backblaze B2 (bucket TakeaSeat/backups). Deployed on the
# host at /opt/offsite-push.sh, scheduled via /etc/cron.d/offsite-push (03:40 daily,
# after the 03:00-03:20 local backups). Credentials live in /root/.config/rclone/rclone.conf
# (b2 remote; NOT in git).
#
# takeaseat snapshots are already age-encrypted; edu + elab backups hold personal
# data, so they are age-encrypted HERE before upload. Backblaze only ever stores
# ciphertext, decryptable solely with the off-box age private key.
# Idempotent: each dated file is encrypted+uploaded exactly once.
#
# Restore: rclone copy "b2:TakeaSeat/backups/<file>.age" . && age -d -i <private-key> <file>.age > out.gz && gunzip out.gz
set -uo pipefail
SRC=/opt/backups
PUB=/opt/takeaseat-backup.pub
REMOTE=b2:TakeaSeat/backups
STAGE=$(mktemp -d)
trap "rm -rf \"$STAGE\"" EXIT
[ -s "$PUB" ] || { echo "$(date -Is) ERROR: no age pubkey at $PUB"; exit 1; }
EXISTING=$(rclone lsf "$REMOTE" 2>/dev/null || true)
have(){ printf "%s\n" "$EXISTING" | grep -qxF "$1"; }
for f in "$SRC"/takeaseat-*.db.gz.age; do [ -e "$f" ] || continue; b=$(basename "$f"); have "$b" || cp "$f" "$STAGE/$b"; done
for f in "$SRC"/edu-db-*.sql.gz "$SRC"/elab-store-*.json; do [ -e "$f" ] || continue; b=$(basename "$f").age; have "$b" || age -R "$PUB" -o "$STAGE/$b" "$f"; done
n=$(ls -1 "$STAGE" 2>/dev/null | wc -l)
if [ "$n" -gt 0 ]; then rclone copy "$STAGE" "$REMOTE" --transfers 4 --b2-hard-delete; fi
rclone delete "$REMOTE" --min-age 21d --b2-hard-delete 2>/dev/null || true
echo "$(date -Is) off-site push ok: uploaded $n new file(s) -> $REMOTE"
