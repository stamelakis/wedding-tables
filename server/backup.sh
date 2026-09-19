#!/bin/bash
# Nightly SQLite backup for TakeaSeat. Deployed on the host at /opt/takeaseat-backup.sh
# and scheduled via /etc/cron.d/takeaseat-backup (03:10 UTC daily). Keeps 14 days.
# server/deploy.sh also runs it before every deploy.
#
# WAL-safe online ".backup" -> integrity check -> gzip -> age-encrypt to a public key whose
# PRIVATE half lives OFF the box (/opt/takeaseat-backup.pub holds only the public recipient).
# So a leaked backup file is useless without the off-box private key.
#
# Fails loudly: any failed step prints "BACKUP FAILED", mails an alert (/opt/takeaseat-alert.sh)
# and exits 1. "backup ok" is printed only when the encrypted file is complete.
# The .age file is written under a .part name and renamed at the end, so the off-site push
# (and a restore) never picks up a half-written backup.
#
# Restore:  age -d -i <private-key-file> -o restore.gz backup.db.gz.age && gunzip restore.gz
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
DB=${DB:-/var/lib/docker/volumes/takeaseat_tas_data/_data/wedding.db}
DEST=${DEST:-/opt/backups}
PUB=${PUB:-/opt/takeaseat-backup.pub}
ALERT=${ALERT:-/opt/takeaseat-alert.sh}
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="$DEST/takeaseat-$STAMP.db"

fail() {
  echo "$(date -Is) BACKUP FAILED: $1"
  rm -f "$TMP" "$TMP.gz" "$TMP.gz.age.part"      # no half-made or plaintext leftovers
  "$ALERT" "backup FAILED" "/opt/takeaseat-backup.sh failed: $1
The live database is untouched. Log: /var/log/takeaseat-backup.log" || true
  exit 1
}

mkdir -p "$DEST" || fail "cannot create $DEST"
[ -f "$DB" ] || fail "DB missing: $DB"

sqlite3 "$DB" ".backup '$TMP'" || fail "sqlite3 .backup failed"
[ -s "$TMP" ] || fail "sqlite3 .backup wrote nothing"
check=$(sqlite3 "$TMP" "PRAGMA integrity_check;" 2>&1)
[ "$check" = ok ] || fail "INTEGRITY FAIL: $(printf '%s' "$check" | head -n 3)"
gzip -f "$TMP" || fail "gzip failed"

if [ -s "$PUB" ]; then
  age -R "$PUB" -o "$TMP.gz.age.part" "$TMP.gz" || fail "age encryption failed"
  mv -f "$TMP.gz.age.part" "$TMP.gz.age" || fail "could not rename $TMP.gz.age.part"
  rm -f "$TMP.gz"
  OUT="$TMP.gz.age"
else
  OUT="$TMP.gz"
fi

# retention: 14 days
find "$DEST" -name "takeaseat-*.db.gz.age" -mtime +13 -delete || fail "retention cleanup (*.db.gz.age) failed"
find "$DEST" -name "takeaseat-*.db.gz"     -mtime +13 -delete || fail "retention cleanup (*.db.gz) failed"

if [ "$OUT" = "$TMP.gz" ]; then
  # The backup exists but is NOT encrypted (and the off-site push only uploads .age files): loud.
  echo "$(date -Is) WARNING: no public key at $PUB — backup left UNENCRYPTED: $OUT"
  "$ALERT" "backup NOT encrypted" "No age public key at $PUB: $OUT was written UNENCRYPTED and will not go off-site.
Put the public recipient (age1...) back into $PUB." || true
  exit 1
fi
echo "$(date -Is) backup ok: $OUT ($(du -h "$OUT" | cut -f1))"

# --- OFF-SITE --------------------------------------------------------------------------
# Handled by /opt/offsite-push.sh (repo: server/offsite-push.sh), a separate cron at
# 03:40 that age-encrypts + rclone-copies every backup in $DEST to Backblaze B2
# (bucket TakeaSeat/backups). Keeps this script focused on the local snapshot.
# ---------------------------------------------------------------------------------------
