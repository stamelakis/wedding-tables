# Build context is the REPO ROOT (so we can copy the worker + the app html).
#   docker build -f server/Dockerfile -t takeaseat .
# Three stages: "app" (the runtime), "check" (API tests + stale-planner check, thrown away) and the
# final image, which copies a marker out of "check" so BuildKit can never skip the checks:
# a failing test or a stale planner output fails the build, and nothing ships.
FROM node:22-slim AS app

# better-sqlite3 is a native module — needs a toolchain if no prebuilt binary is available.
# fonts-dejavu-core + -extra: the PDF renderer (server/pdf.mjs, pdfkit) embeds DejaVu fonts for Greek
# text — Sans/Serif (core), Sans Condensed and Serif Italic (extra) — from /usr/share/fonts/truetype/dejavu/.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
       fonts-dejavu-core fonts-dejavu-extra \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
# Exact dependency tree from the committed lock file (regenerate it with
# `npm install --package-lock-only` in server/ after changing package.json).
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# App code: the server + its PDF renderer + the worker logic (as an ES module) + the static app files.
COPY server/server.mjs server/rate.mjs server/pdf.mjs server/pdf-worker.mjs ./
COPY wedding-sync-worker.js ./worker.mjs
RUN mkdir -p /app/public
# Every marketing page and asset that the sitemap or a canonical points at MUST be in this list, or it 404s in
# production while Search Console has already been told it exists.
# trapezi.html is the guest's finder page: it is NOT in the sitemap (noindex, and it is reached only from the QR's
# fragment), but it still has to ship — a guest at the door scanning the QR is the one request that cannot 404.
COPY index.html plano-trapezion-gamou.html plano-trapezion-vaptisis.html seating-planner.html seating-planner-de.html seating-planner-el.html lab.html admin.html venue.html privacy.html terms.html dpa.html trapezi.html robots.txt sitemap.xml og-takeaseat.png /app/public/

ENV PORT=8080 \
    DB_PATH=/data/wedding.db \
    PUBLIC_DIR=/app/public \
    KV_BACKEND=sqlite
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.mjs"]

# ---- build-time checks (this stage is thrown away) ----
FROM app AS check
WORKDIR /t
# The API tests, laid out as in the repo: tools/test-api.mjs imports ../wedding-sync-worker.js.
# package.json only supplies "type": "module"; node_modules is the app's own tree.
COPY server/package.json ./package.json
COPY wedding-sync-worker.js ./
COPY server/rate.mjs ./server/
COPY server/pdf.mjs ./server/
COPY tools/test-api.mjs ./tools/
# the tests also read three files of the product itself and assert on what is in them
COPY planner.src.html venue.html sitemap.xml ./
COPY tools/build-planner.mjs ./tools/
RUN ln -s /app/node_modules /t/node_modules \
    && { node tools/test-api.mjs > /t/test.log 2>&1 || { cat /t/test.log; echo "API TESTS FAILED — image not built"; exit 1; }; } \
    && tail -n 1 /t/test.log
# Refuse to ship a sitemap that promises a page the image does not have: the baptism landing page was
# committed, listed in the sitemap, and left out of the COPY above — Google would have crawled a 404.
RUN miss=0; for u in $(grep -o '<loc>[^<]*</loc>' /app/public/sitemap.xml | sed 's|</*loc>||g'); do       p=${u#https://takeaseat.gr/}; [ -n "$p" ] || p=index.html;       [ -f "/app/public/$p" ] || { echo "sitemap lists $u but $p is not in the image"; miss=1; };     done; [ "$miss" = 0 ] || { echo "SITEMAP CHECK FAILED — image not built"; exit 1; };     echo "sitemap: every listed page is in the image"
# Refuse to ship stale planner outputs: the committed html must match what planner.src.html builds.
COPY planner.src.html /chk/
COPY tools/build-planner.mjs /chk/tools/
RUN cp /app/public/seating-planner*.html /app/public/lab.html /chk/ && cd /chk && node tools/build-planner.mjs --check --no-twins \
    && date -u +%FT%TZ > /t/checks-passed

# ---- the runtime image: "app" + proof that the checks ran ----
FROM app
COPY --from=check /t/checks-passed /app/.checks-passed
# Which commit is running — deploy.sh passes it; «Διαγνωστικά» in the admin console shows it, so a question on the
# phone ("is my fix live?") has an answer. Last in the file on purpose: it busts no earlier build-cache layer.
ARG GIT_COMMIT=""
ENV GIT_COMMIT=$GIT_COMMIT
