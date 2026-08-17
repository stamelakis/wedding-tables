#!/bin/bash
# Nightly SQLite backup for TakeaSeat. Deployed on the host at /opt/takeaseat-backup.sh
# and scheduled via /etc/cron.d/takeaseat-backup (03:10 daily). Keeps 14 days.
#
# Uses SQLite's online ".backup" (WAL-aware) so it is a consistent snapshot even while
# the app is writing — never a plain file copy of a live WAL database.
set -uo pipefail
DB=${DB:-/var/lib/docker/volumes/takeaseat_tas_data/_data/wedding.db}
DEST=${DEST:-/opt/backups}
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DEST/takeaseat-$STAMP.db"

mkdir -p "$DEST"
[ -f "$DB" ] || { echo "$(date -Is) DB not found: $DB"; exit 1; }

sqlite3 "$DB" ".backup '$OUT'"

if sqlite3 "$OUT" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  gzip -f "$OUT"
  echo "$(date -Is) backup ok: $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"
else
  echo "$(date -Is) INTEGRITY CHECK FAILED for $OUT"; rm -f "$OUT"; exit 1
fi

# retention: keep 14 days
find "$DEST" -name "takeaseat-*.db.gz" -mtime +14 -delete
