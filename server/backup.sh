#!/bin/bash
# Nightly SQLite backup for TakeaSeat. Deployed on the host at /opt/takeaseat-backup.sh
# and scheduled via /etc/cron.d/takeaseat-backup (03:10 daily). Keeps 14 days.
#
# WAL-safe online ".backup" -> integrity check -> gzip -> age-encrypt to a public key whose
# PRIVATE half lives OFF the box (/opt/takeaseat-backup.pub holds only the public recipient).
# So a leaked backup file is useless without the off-box private key.
#
# Restore:  age -d -i <private-key-file> -o restore.gz backup.db.gz.age && gunzip restore.gz
set -uo pipefail
DB=${DB:-/var/lib/docker/volumes/takeaseat_tas_data/_data/wedding.db}
DEST=${DEST:-/opt/backups}
PUB=${PUB:-/opt/takeaseat-backup.pub}
STAMP=$(date +%Y%m%d-%H%M%S)
TMP="$DEST/takeaseat-$STAMP.db"

mkdir -p "$DEST"
[ -f "$DB" ] || { echo "$(date -Is) DB missing: $DB"; exit 1; }

sqlite3 "$DB" ".backup '$TMP'"
sqlite3 "$TMP" "PRAGMA integrity_check;" | grep -q "^ok$" || { echo "$(date -Is) INTEGRITY FAIL"; rm -f "$TMP"; exit 1; }
gzip -f "$TMP"

if [ -s "$PUB" ]; then
  age -R "$PUB" -o "$TMP.gz.age" "$TMP.gz" && rm -f "$TMP.gz"
  echo "$(date -Is) encrypted backup: $TMP.gz.age ($(du -h "$TMP.gz.age" | cut -f1))"
else
  echo "$(date -Is) WARNING: no public key at $PUB — backup left UNENCRYPTED"
fi

# retention: 14 days
find "$DEST" -name "takeaseat-*.db.gz.age" -mtime +14 -delete
find "$DEST" -name "takeaseat-*.db.gz"     -mtime +14 -delete

# --- OFF-SITE (fill in once you have a target) -----------------------------------------
# Push the newest encrypted backup off the box so a disk loss isn't total. Examples:
#   rclone copy "$DEST" b2:my-bucket/takeaseat --include "takeaseat-*.db.gz.age"
#   scp "$DEST"/takeaseat-*.db.gz.age  u123456@u123456.your-storagebox.de:backups/
# ---------------------------------------------------------------------------------------
