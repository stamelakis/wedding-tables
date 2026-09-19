#!/usr/bin/env node
// Render sample PDFs from a plan JSON with server/pdf.mjs (needs `npm install` in server/ for pdfkit).
//
//   node tools/pdf-sample.mjs <plan.json> <out.pdf | out-dir> [--mode floor|keepsake|both] [--lang el|en|de]
//                             [--name "Άννα & Νίκος"] [--date 2026-09-19] [--venue "Κτήμα …"]
//
// <plan.json> may be a bare plan or a planner export {name, plan}. With --mode both (the default) two files are written:
// <base>-floor.pdf and <base>-keepsake.pdf. Prints pages, size and render time for each. Keep outputs out of the repo.
import fs from 'node:fs';
import path from 'node:path';
import { renderPlanPdf, pdfFontInfo } from '../server/pdf.mjs';

const args = process.argv.slice(2), pos = [], opt = {};
for (let i = 0; i < args.length; i++) { if (args[i].startsWith('--')) opt[args[i].slice(2)] = args[++i]; else pos.push(args[i]); }
if (pos.length < 2) {
  console.error('usage: node tools/pdf-sample.mjs <plan.json> <out.pdf|out-dir> [--mode floor|keepsake|both] [--lang el|en|de] [--name ...] [--date YYYY-MM-DD] [--venue ...]');
  process.exit(2);
}
const [inFile, out] = pos;
const raw = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const plan = raw && raw.plan && !Array.isArray(raw.tables) ? raw.plan : raw;
const modes = !opt.mode || opt.mode === 'both' ? ['floor', 'keepsake'] : [opt.mode];
const lang = opt.lang || 'el';
const meta = { name: opt.name ?? (raw && typeof raw.name === 'string' ? raw.name : ''), weddingDate: opt.date || null, venueName: opt.venue || '', lang };

const fonts = pdfFontInfo();
console.log('fonts:', JSON.stringify(fonts));
const isDir = !out.toLowerCase().endsWith('.pdf');
if (isDir) fs.mkdirSync(out, { recursive: true });
const base = isDir ? path.join(out, path.basename(inFile).replace(/\.json$/i, '') + '-' + lang) : out.replace(/\.pdf$/i, '');
for (const mode of modes) {
  const file = !isDir && modes.length === 1 ? out : `${base}-${mode}.pdf`;
  const t0 = process.hrtime.bigint();
  const buf = await renderPlanPdf(plan, { ...meta, mode });
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  fs.writeFileSync(file, buf);
  const pages = (buf.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  console.log(`${mode.padEnd(8)} ${file}  pages=${pages}  bytes=${buf.length}  (${(buf.length / 1024).toFixed(1)} KB)  ${ms.toFixed(0)} ms`);
}
