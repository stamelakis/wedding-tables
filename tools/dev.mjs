// Local dev server: the real self-host server (static files + API) over an in-memory KV.
//   node tools/dev.mjs   →  http://localhost:8080
// Refreshes server/worker.mjs from wedding-sync-worker.js first (that's what the Docker build does too).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'wedding-sync-worker.js'), path.join(root, 'server', 'worker.mjs'));
process.env.KV_BACKEND = process.env.KV_BACKEND || 'memory';
process.env.PUBLIC_DIR = root;
process.env.PORT = process.env.PORT || '8080';
process.env.OWNER_KEY = process.env.OWNER_KEY || 'dev-owner-key';
await import('../server/server.mjs');
