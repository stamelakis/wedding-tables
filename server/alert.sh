#!/bin/bash
# Shared alert helper for the TakeaSeat host scripts (uptime, backup, off-site push, deploy).
# Deployed on the host at /opt/takeaseat-alert.sh.
#
#   takeaseat-alert.sh [--every MINUTES KEY] "subject" "body"
#
# --every: send at most once per MINUTES for KEY (stamp file in /var/lib/takeaseat). The stamp is
#          renewed only after a successful send, so a send that failed is retried on the next run.
# The mail goes out through the edu-admin app container's SMTP settings (the same inbox as the
# educationproject.gr alerts), so TakeaSeat needs no mail account of its own for alerts.
# ALERT_DRY_RUN=1 prints the mail instead of sending it (for testing).
# Exit: 0 = sent or suppressed, 1 = could not send (the caller's log still has the message).
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
STATE_DIR=${TAKEASEAT_STATE_DIR:-/var/lib/takeaseat}
EDU_DIR=${EDU_DIR:-/opt/edu-admin}

every=0 key=""
if [ "${1:-}" = "--every" ]; then
  every=${2:?minutes}; key=${3:?key}; shift 3
  case "$every$key" in *[!a-z0-9-]*) echo "alert: bad --every arguments"; exit 1 ;; esac
fi
subject="TakeaSeat: ${1:?subject}"
body="${2:-}

-- $(hostname) $(date -Is)"
stamp="$STATE_DIR/alert-$key.stamp"

if [ "$every" -gt 0 ] && [ -n "$(find "$stamp" -mmin -"$every" 2>/dev/null)" ]; then
  echo "$(date -Is) alert suppressed (same alert sent < $every min ago): $subject"
  exit 0
fi
echo "$(date -Is) ALERT: $subject"

if [ "${ALERT_DRY_RUN:-0}" = 1 ]; then
  printf -- '--- would mail: %s\n%s\n---\n' "$subject" "$body"
  sent=0
else
  # Same mechanism as /opt/edu-admin/uptime-check.sh: nodemailer inside the edu-admin app container.
  (cd "$EDU_DIR" && docker compose exec -T -e TASSUBJ="$subject" -e TASALERT="$body" app node -e '
    const nm = require("nodemailer"); const p = +(process.env.SMTP_PORT || 587);
    nm.createTransport({ host: process.env.SMTP_HOST, port: p, secure: p === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      .sendMail({ from: "TakeaSeat <" + (process.env.FROM_EMAIL || process.env.SMTP_USER) + ">",
        to: process.env.DIGEST_TO || process.env.SMTP_USER, subject: process.env.TASSUBJ, text: process.env.TASALERT })
      .then(function () { console.log("alert sent"); process.exit(0); })
      .catch(function (e) { console.log("alert err", e.code || "", e.responseCode || ""); process.exit(1); });')
  sent=$?
fi

if [ "$sent" -eq 0 ]; then
  if [ "$every" -gt 0 ]; then mkdir -p "$STATE_DIR" && touch "$stamp"; fi
  exit 0
fi
echo "$(date -Is) alert NOT sent (edu-admin mail path failed): $subject"
exit 1
