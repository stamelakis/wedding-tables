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
const lf = s => s.replace(/\r\n?/g, '\n');   // Windows clones with autocrlf must not make every output look stale
const src = lf(fs.readFileSync(path.join(root, 'planner.src.html'), 'utf8'));

// ---- i18n guard: every key must exist in all three dictionaries with the same {placeholders} / shape ----
{
  const a = src.indexOf('const T_ALL='), b = src.indexOf('const T=T_ALL[LANG]');
  const T_ALL = new Function('return (' + src.slice(a + 'const T_ALL='.length, b).trim().replace(/;$/, '') + ')')();
  const sig = v => typeof v === 'string' ? 'ph:' + [...v.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join() : Array.isArray(v) ? 'len:' + v.length : v && typeof v === 'object' ? 'keys:' + Object.keys(v).sort().join() : typeof v;
  const langs = Object.keys(T_ALL); const problems = [];
  const allKeys = new Set(langs.flatMap(l => Object.keys(T_ALL[l])));
  for (const k of allKeys) for (const l of langs) {
    if (!(k in T_ALL[l])) problems.push(`missing ${l}.${k}`);
    else if (sig(T_ALL[l][k]) !== sig(T_ALL.el[k])) problems.push(`shape differs ${l}.${k}: ${sig(T_ALL[l][k])} vs el ${sig(T_ALL.el[k])}`);
  }
  const used = new Set([...src.matchAll(/\btr\("([A-Za-z0-9_]+)"/g)].map(m => m[1]).concat([...src.matchAll(/data-t(?:-title|-ph)?="([A-Za-z0-9_]+)"/g)].map(m => m[1])));
  for (const k of used) if (!(k in T_ALL.el)) problems.push(`used but undefined: ${k}`);
  // Duplicate keys inside one language: the later definition silently wins and the earlier text never shows
  // (happened twice: tMerged, pmFloor). Scan the source text, skipping string literals.
  {
    const txt = src.slice(a + 'const T_ALL='.length, b); const seen = {};
    let depth = 0, lang = null, q = null;
    for (let i = 0; i < txt.length;) {
      const c = txt[i];
      if (q) { if (c === '\\') { i += 2; continue; } if (c === q) q = null; i++; continue; }
      if (c === '"' || c === "'" || c === '`') { q = c; i++; continue; }
      if (c === '{' || c === '[') { depth++; i++; continue; }
      if (c === '}' || c === ']') { depth--; i++; continue; }
      const m = /^([A-Za-z_$][\w$]*)\s*:/.exec(txt.slice(i, i + 80));
      if (m && /[\s,{]/.test(txt[i - 1] || ' ')) {
        if (depth === 1) lang = m[1];
        else if (depth === 2 && lang) { const k = lang + '.' + m[1]; if (seen[k]) problems.push(`duplicate key ${k}`); seen[k] = 1; }
        i += m[0].length; continue;
      }
      i++;
    }
    if (!['el', 'en', 'de'].every(l => Object.keys(seen).some(k => k.startsWith(l + '.')))) problems.push('duplicate-key scan could not read the dictionaries');
  }
  if (problems.length) { console.error('i18n problems:\n  ' + problems.join('\n  ')); process.exit(1); }
}

// ---- undeclared-identifier guard: `name = …` where `name` is never bound anywhere in the file ----
// The planner runs in strict mode, so such an assignment throws a ReferenceError the moment that path is taken — it
// shipped once (invRename kept assigning invRen after the declaration was deleted, killing every rename and merge),
// and neither `node --check` nor the i18n guard sees it. Deliberately coarse: it only asks whether a name is bound
// SOMEWHERE, which is exactly what a leftover assignment after a refactor fails.
{
  const bound = new Set(), problems = [];
  const add = x => { if (/^[A-Za-z_$][\w$]*$/.test(x || '')) bound.add(x); };
  for (const m of src.matchAll(/\b(?:let|const|var|function|class)\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\b(?:let|const|var)\s+([^;\n]{0,400})/g)) {   // further declarators and destructuring, inside the declaration only
    const names = m[1].replace(/\([^()]*\)/g, ' ').replace(/=\s*[^,]*?(?=,|$)/g, ' ');   // drop call arguments, then each initialiser
    for (const id of names.matchAll(/[A-Za-z_$][\w$]*/g)) add(id[0]);
  }
  for (const m of src.matchAll(/\(([^()]{0,300}?)\)\s*(?:=>|\{)/g)) m[1].split(',').forEach(p => add(p.trim().replace(/^\.\.\./, '').split(/[=:\s]/)[0]));   // parameters
  for (const m of src.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) add(m[2]);   // single-parameter arrows
  for (const m of src.matchAll(/\bcatch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // Quoted text, comments and template literals hold plenty of `name=` (a CSS rule, an SVG attribute, charset=utf-8).
  let inBlock = false, inTpl = false;
  const strip = ln => {
    let out = '';
    for (let i = 0; i < ln.length; i++) {
      const c = ln[i], two = ln.slice(i, i + 2);
      if (c === '\\') { i++; continue; }
      if (inBlock) { if (two === '*/') { inBlock = false; i++; } continue; }
      if (inTpl) { if (c === '`') inTpl = false; continue; }
      if (two === '/*') { inBlock = true; i++; continue; }
      if (two === '//' && ln[i - 1] !== ':') break;
      if (c === '`') { inTpl = true; continue; }
      if (c === '"' || c === "'") { const j = ln.indexOf(c, i + 1); if (j < 0) break; i = j; continue; }
      out += c;
    }
    return out;
  };
  const GLOBALS = new Set(['window', 'document', 'location', 'history', 'navigator', 'localStorage', 'sessionStorage', 'console']);
  src.split('\n').map(strip).forEach((ln, i) => {
    for (const m of ln.matchAll(/(?:^|[;{}]|\)\s)\s*([A-Za-z_$][\w$]*)\s*=(?![=>])/g))
      if (!bound.has(m[1]) && !GLOBALS.has(m[1])) problems.push(`planner.src.html:${i + 1}  ${m[1]} is assigned but never declared`);
  });
  if (problems.length) { console.error('undeclared identifiers:\n  ' + problems.join('\n  ')); process.exit(1); }
}

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
  const robots = o.mode === 'lab' ? '<meta name="robots" content="noindex,nofollow">' : '';   // the sandbox must not be indexed
  return src.replaceAll('__LANG__', o.lang).replaceAll('__MODE__', o.mode).replaceAll('__TITLE__', o.title || TITLES[o.lang]).replace('__ROBOTS__\n', robots ? robots + '\n' : '');
}
// Artifact twin: from the first <style> to the closing </script> — no doctype/head/body (the host supplies them).
function twin(html) {
  const a = html.indexOf('<style>');
  const b = html.lastIndexOf('</script>') + '</script>'.length;
  return html.slice(a, b).replace(/<\/style>\s*<\/head>\s*<body>/, '</style>') + '\n';
}

const check = process.argv.includes('--check');
const noTwins = process.argv.includes('--no-twins');   // the Docker image only carries the app files
let stale = 0;
for (const o of OUTPUTS) {
  const outputs = [[o.file, render(o)]];
  if (o.twin && !noTwins) outputs.push([o.twin, twin(render(o))]);
  for (const [file, content] of outputs) {
    const p = path.join(root, file);
    if (check) {
      const cur = fs.existsSync(p) ? lf(fs.readFileSync(p, 'utf8')) : '';
      if (cur !== content) { console.error('STALE: ' + file); stale++; }
    } else {
      fs.writeFileSync(p, content);
      console.log('wrote ' + file + '  (' + (content.length / 1024).toFixed(0) + ' KB)');
    }
  }
}
if (check) { console.log(stale ? `${stale} stale output(s) — run: node tools/build-planner.mjs` : 'all planner outputs up to date'); process.exit(stale ? 1 : 0); }
