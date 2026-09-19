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
COPY server/server.mjs server/pdf.mjs server/pdf-worker.mjs ./
COPY wedding-sync-worker.js ./worker.mjs
RUN mkdir -p /app/public
COPY index.html seating-planner.html seating-planner-de.html seating-planner-el.html lab.html admin.html venue.html privacy.html terms.html dpa.html /app/public/

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
COPY tools/test-api.mjs ./tools/
RUN ln -s /app/node_modules /t/node_modules \
    && { node tools/test-api.mjs > /t/test.log 2>&1 || { cat /t/test.log; echo "API TESTS FAILED — image not built"; exit 1; }; } \
    && tail -n 1 /t/test.log
# Refuse to ship stale planner outputs: the committed html must match what planner.src.html builds.
COPY planner.src.html /chk/
COPY tools/build-planner.mjs /chk/tools/
RUN cp /app/public/seating-planner*.html /app/public/lab.html /chk/ && cd /chk && node tools/build-planner.mjs --check --no-twins \
    && date -u +%FT%TZ > /t/checks-passed

# ---- the runtime image: "app" + proof that the checks ran ----
FROM app
COPY --from=check /t/checks-passed /app/.checks-passed
