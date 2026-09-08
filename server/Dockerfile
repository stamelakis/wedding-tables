# Build context is the REPO ROOT (so we can copy the worker + the app html).
#   docker build -f server/Dockerfile -t takeaseat .
FROM node:22-slim

# better-sqlite3 is a native module — needs a toolchain if no prebuilt binary is available.
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev && npm cache clean --force

# App code: the worker logic (as an ES module) + the server + the static app files.
COPY wedding-sync-worker.js ./worker.mjs
COPY server/server.mjs ./
RUN mkdir -p /app/public
COPY index.html seating-planner.html seating-planner-de.html seating-planner-el.html lab.html admin.html venue.html privacy.html terms.html dpa.html /app/public/

# Refuse to ship stale planner outputs: the committed html must match what planner.src.html builds.
COPY planner.src.html /chk/
COPY tools/build-planner.mjs /chk/tools/
RUN cp /app/public/seating-planner*.html /app/public/lab.html /chk/ && cd /chk && node tools/build-planner.mjs --check --no-twins && rm -rf /chk

ENV PORT=8080 \
    DB_PATH=/data/wedding.db \
    PUBLIC_DIR=/app/public \
    KV_BACKEND=sqlite
VOLUME ["/data"]
EXPOSE 8080
CMD ["node", "server.mjs"]
