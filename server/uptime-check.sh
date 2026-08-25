#!/bin/bash
# Every-5-min health check for takeaseat.gr. Mirrors /opt/edu-admin/uptime-check.sh.
# Deployed on the host at /opt/takeaseat-uptime.sh and scheduled via
# /etc/cron.d/takeaseat-uptime (*/5 * * * *). On failure it restarts the takeaseat
# container, re-checks, then emails an alert by reusing the edu-admin app container's
# SMTP — so this app needs no separate mail account.
apex(){ curl -sk -o /dev/null -w "%{http_code}" --max-time 15 --resolve takeaseat.gr:443:127.0.0.1 https://takeaseat.gr/ 2>/dev/null || echo 000; }
S=$(apex)
[ "$S" = "200" ] && exit 0
echo "$(date -Is) DOWN: takeaseat=$S -> restarting"
cd /opt/takeaseat && docker compose -f server/docker-compose.yml up -d >/dev/null 2>&1
sleep 12
S2=$(apex)
echo "$(date -Is) after restart: takeaseat=$S2"
cd /opt/edu-admin && docker compose exec -T -e TASALERT="TakeaSeat downtime: home=$S | after auto-restart: home=$S2 | $(date -Is)" app node -e 'const nm=require("nodemailer");const p=+(process.env.SMTP_PORT||587);nm.createTransport({host:process.env.SMTP_HOST,port:p,secure:p===465,auth:{user:process.env.SMTP_USER,pass:process.env.SMTP_PASS}}).sendMail({from:"TakeaSeat <"+(process.env.FROM_EMAIL||process.env.SMTP_USER)+">",to:process.env.DIGEST_TO||process.env.SMTP_USER,subject:"TakeaSeat downtime + auto-restart",text:process.env.TASALERT}).then(function(){console.log("alert sent");process.exit(0)}).catch(function(e){console.log("alert err",e.message);process.exit(0)})' || true
