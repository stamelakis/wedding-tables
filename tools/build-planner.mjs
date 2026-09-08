#!/usr/bin/env node
// Builds every planner output from the single source `planner.src.html`:
//   seating-planner-el.html / seating-planner.html (EN) / seating-planner-de.html   — the live app
//   *.artifact.html twins  — claude.ai-artifact builds (the file minus its <head>/<body> wrapper)
//   lab.html               — the sandbox (Greek, separate local storage, no access gate)
//
//   node tools/build-planner.mjs          # write all outputs
//   node tools/build-planner.mjs --check  # exit 1 if any output is stale (CI / pre-commit)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = fs.readFileSync(path.join(root, 'planner.src.html'), 'utf8');

const TITLES = {
  el: 'Οργάνωση Τραπεζιών Γάμου — TakeaSeat',
  en: 'Wedding Seating Planner — TakeaSeat',
  de: 'Hochzeits-Sitzplan — TakeaSeat',
};
const OUTPUTS = [
  { file: 'seating-planner-el.html', lang: 'el', mode: 'app', twin: 'seating-planner-el.artifact.html' },
  { file: 'seating-planner.html',    lang: 'en', mode: 'app', twin: 'seating-planner.artifact.html' },
  { file: 'seating-planner-de.html', lang: 'de', mode: 'app', twin: 'seating-planner-de.artifact.html' },
  { file: 'lab.html',                lang: 'el', mode: 'lab', title: 'TakeaSeat Lab 🧪' },
];

function render(o) {
  return src.replaceAll('__LANG__', o.lang).replaceAll('__MODE__', o.mode).replaceAll('__TITLE__', o.title || TITLES[o.lang]);
}
// Artifact twin: from the first <style> to the closing </script> — no doctype/head/body (the host supplies them).
function twin(html) {
  const a = html.indexOf('<style>');
  const b = html.lastIndexOf('</script>') + '</script>'.length;
  return html.slice(a, b) + '\n';
}

const check = process.argv.includes('--check');
let stale = 0;
for (const o of OUTPUTS) {
  const outputs = [[o.file, render(o)]];
  if (o.twin) outputs.push([o.twin, twin(render(o))]);
  for (const [file, content] of outputs) {
    const p = path.join(root, file);
    if (check) {
      const cur = fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : '';
      if (cur !== content) { console.error('STALE: ' + file); stale++; }
    } else {
      fs.writeFileSync(p, content);
      console.log('wrote ' + file + '  (' + (content.length / 1024).toFixed(0) + ' KB)');
    }
  }
}
if (check) { console.log(stale ? `${stale} stale output(s) — run: node tools/build-planner.mjs` : 'all planner outputs up to date'); process.exit(stale ? 1 : 0); }
