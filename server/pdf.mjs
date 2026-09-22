// TakeaSeat — server-side PDF of a seating plan (pdfkit, embedded TrueType font with Greek glyphs).
//
//   import { renderPlanPdf } from './pdf.mjs';
//   const buf = await renderPlanPdf(plan, { name, weddingDate:'2026-09-19'|null, venueName, mode:'floor'|'keepsake', lang:'el'|'en'|'de' });
//
// mode "floor":    one landscape page with the whole floor (A4, A3 for big plans): tables to scale in their shape and rotation,
//                  guest names radiating from each seat, decor, title + date. When the names would be too small to read, the
//                  plan shows seat numbers and a per-table name list follows. Guests without a seat are listed in a small box.
// mode "keepsake": a cover (couple, date, venue, a warm line, a miniature of the night), the floor plan, "who sat where"
//                  (a card per table) and an alphabetical index. Cancelled and unseated guests are left out.
//
// The plan is untrusted (a client may POST anything): it is copied into a clean, capped model first; only its TEXT reaches the
// PDF (never markup, images, links or fonts), colours are clamped to hex, numbers to sane ranges, and bad items are skipped.
//
// Fonts (first that exists): PDF_FONT_REGULAR / PDF_FONT_BOLD · DejaVu Sans (Debian: fonts-dejavu-core) · Segoe UI · Arial.
// Optional: a serif for titles (PDF_FONT_SERIF[_BOLD|_ITALIC] · DejaVu Serif · Palatino Linotype · Georgia; else the sans) and a
// condensed face for names on the floor plan (PDF_FONT_NARROW · DejaVu Sans Condensed (fonts-dejavu-extra) · Arial Narrow;
// PDF_FONT_NARROW=none turns it off — the sans is then set 87% wide for those names).

import fs from 'node:fs';
import PDFDocument from 'pdfkit';

// ---------------------------------------------------------------- limits
const MAX_TABLES = 200, MAX_GUESTS = 2000, MAX_FEATURES = 300, MAX_GROUPS = 200, MAX_SEATS = 30;
const COORD_MIN = -25000, COORD_MAX = 25000;   // the room grows to 20000 from any side; a side shrunk afterwards can leave items far out on the left/top (negative), still on the plan

// ---------------------------------------------------------------- palette (index.html :root)
const C = {
  ink: '#2b2330', text: '#2e2620', soft: '#5f574d', faint: '#93897c', line: '#e7ded4', paper: '#f7f4f1', card: '#fffdfb',
  accent: '#7d5a8c', accentInk: '#5c3f68', gold: '#b58a3c', goldSoft: '#cdb07a', goldLine: '#d9c49c', chairEmpty: '#cbbfae',
};
const MATERIAL = {   // [stage tint, zone fill, zone edge, zone label]
  grass:    ['#f5f8f0', '#e7efdc', '#c9d8b5', '#5a6e45'],
  parquet:  ['#fbf6ef', '#f1e3cf', '#dcc4a2', '#7f5a33'],
  wood:     ['#faf4ec', '#eedfca', '#d8c0a0', '#77522f'],
  stone:    ['#f7f6f3', '#ebe8e2', '#d3cec5', '#6a645b'],
  tile:     ['#f8f7f4', '#eeece7', '#d6d2ca', '#6a645b'],
  marble:   ['#f9f8f6', '#f2f0ec', '#d8d3cb', '#6a645b'],
  sand:     ['#fcf8ee', '#f4ebd3', '#e0cfa4', '#86703c'],
  water:    ['#f2f7fc', '#dfeaf6', '#b7cde6', '#3d6690'],
  carpet:   ['#fbf2f3', '#f3dfe2', '#dcb6bc', '#86303c'],
  concrete: ['#f6f6f4', '#e8e7e3', '#cfcdc7', '#66645e'],
};
const GROUP_FALLBACK = '#9a8c7d';

// ---------------------------------------------------------------- words
const L10N = {
  el: {
    days: ['Κυριακή', 'Δευτέρα', 'Τρίτη', 'Τετάρτη', 'Πέμπτη', 'Παρασκευή', 'Σάββατο'],
    months: ['Ιανουαρίου', 'Φεβρουαρίου', 'Μαρτίου', 'Απριλίου', 'Μαΐου', 'Ιουνίου', 'Ιουλίου', 'Αυγούστου', 'Σεπτεμβρίου', 'Οκτωβρίου', 'Νοεμβρίου', 'Δεκεμβρίου'],
    longDate: (w, d, m, y) => `${w}, ${d} ${m} ${y}`,
    guests: n => n === 1 ? '1 καλεσμένος' : `${n} καλεσμένοι`,
    tables: n => n === 1 ? '1 τραπέζι' : `${n} τραπέζια`,
    seatsOf: (s, c) => `${s} από ${c} θέσεις`,
    table: 'Τραπέζι', warm: 'Όλοι όσοι γιόρτασαν μαζί σας.', ourWedding: 'Ο γάμος μας', seatingPlan: 'Σχέδιο τραπεζιών',
    floor: 'Η κάτοψη', whoSat: 'Ποιος κάθισε πού', index: 'Αλφαβητικός κατάλογος', namesByTable: 'Ονόματα ανά τραπέζι',
    unseated: 'Χωρίς θέση', cancelled: 'ακυρώθηκε', cont: 'συνέχεια',
    numbersNote: p => `Οι αριθμοί δείχνουν τις θέσεις — τα ονόματα ανά τραπέζι στη σελίδα ${p}.`,
    unseatedMore: (n, p) => `${n} χωρίς θέση — η λίστα στη σελίδα ${p}.`,
  },
  en: {
    days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
    months: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'],
    longDate: (w, d, m, y) => `${w}, ${d} ${m} ${y}`,
    guests: n => n === 1 ? '1 guest' : `${n} guests`,
    tables: n => n === 1 ? '1 table' : `${n} tables`,
    seatsOf: (s, c) => `${s} of ${c} seats`,
    table: 'Table', warm: 'Everyone who celebrated with you.', ourWedding: 'Our wedding', seatingPlan: 'Seating plan',
    floor: 'The floor plan', whoSat: 'Who sat where', index: 'Alphabetical index', namesByTable: 'Names by table',
    unseated: 'Without a seat', cancelled: 'cancelled', cont: 'continued',
    numbersNote: p => `Numbers mark the seats — the names per table are on page ${p}.`,
    unseatedMore: (n, p) => `${n} without a seat — listed on page ${p}.`,
  },
  de: {
    days: ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'],
    months: ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'],
    longDate: (w, d, m, y) => `${w}, ${d}. ${m} ${y}`,
    guests: n => n === 1 ? '1 Gast' : `${n} Gäste`,
    tables: n => n === 1 ? '1 Tisch' : `${n} Tische`,
    seatsOf: (s, c) => `${s} von ${c} Plätzen`,
    table: 'Tisch', warm: 'Alle, die mit Ihnen gefeiert haben.', ourWedding: 'Unsere Hochzeit', seatingPlan: 'Sitzplan',
    floor: 'Der Sitzplan', whoSat: 'Wer saß wo', index: 'Alphabetisches Verzeichnis', namesByTable: 'Namen pro Tisch',
    unseated: 'Ohne Platz', cancelled: 'abgesagt', cont: 'Fortsetzung',
    numbersNote: p => `Die Zahlen markieren die Plätze — die Namen pro Tisch stehen auf Seite ${p}.`,
    unseatedMore: (n, p) => `${n} ohne Platz — Liste auf Seite ${p}.`,
  },
};

// ---------------------------------------------------------------- fonts
const DJ = '/usr/share/fonts/truetype/dejavu/';
const WF = 'C:/Windows/Fonts/';
const isFile = p => { try { return !!p && fs.statSync(p).isFile(); } catch { return false; } };
let FONTS = null;
function loadFonts() {
  if (FONTS) return FONTS;
  const env = process.env;
  const pick = sets => { for (const set of sets) if (isFile(set[0])) return set.map(p => isFile(p) ? p : set[0]); return null; };
  const sans = pick([[env.PDF_FONT_REGULAR, env.PDF_FONT_BOLD], [DJ + 'DejaVuSans.ttf', DJ + 'DejaVuSans-Bold.ttf'],
    [WF + 'segoeui.ttf', WF + 'segoeuib.ttf'], [WF + 'arial.ttf', WF + 'arialbd.ttf']]);
  if (!sans) throw new Error('pdf: no TrueType font with Greek glyphs found — install fonts-dejavu-core (Debian/Ubuntu) or set PDF_FONT_REGULAR and PDF_FONT_BOLD to .ttf files');
  const serif = pick([[env.PDF_FONT_SERIF, env.PDF_FONT_SERIF_BOLD, env.PDF_FONT_SERIF_ITALIC],
    [DJ + 'DejaVuSerif.ttf', DJ + 'DejaVuSerif-Bold.ttf', DJ + 'DejaVuSerif-Italic.ttf'],
    [WF + 'pala.ttf', WF + 'palab.ttf', WF + 'palai.ttf'], [WF + 'georgia.ttf', WF + 'georgiab.ttf', WF + 'georgiai.ttf']]);
  const narrow = env.PDF_FONT_NARROW === 'none' ? null : pick([[env.PDF_FONT_NARROW], [DJ + 'DejaVuSansCondensed.ttf'], [WF + 'ARIALN.TTF']]);
  const read = p => fs.readFileSync(p);
  const f = { S: read(sans[0]), SB: read(sans[1]) };
  f.R = serif ? read(serif[0]) : f.S; f.RB = serif ? read(serif[1]) : f.SB; f.RI = serif ? read(serif[2]) : f.S;
  f.N = narrow ? read(narrow[0]) : f.S;
  f.nameScale = narrow ? 100 : 87;   // no condensed face: the plan's names are set 87% wide (unnoticeable at 5–7 pt)
  f.paths = { sans, serif, narrow };
  FONTS = f;
  return f;
}
/** Which font files the renderer uses (for logs / health). Throws when no usable font exists. */
export function pdfFontInfo() { return loadFonts().paths; }

// ---------------------------------------------------------------- small helpers
const isNum = v => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const num = (v, d) => { const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v; return isNum(n) ? n : d; };
// control characters, bidi overrides, zero-width marks and variation selectors never reach the page
const JUNK = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufe00-\ufe0f\ufeff]/g;
const str = v => typeof v === 'string' ? v : (typeof v === 'number' && Number.isFinite(v)) ? String(v) : '';   // never calls a plan's toString
const cleanText = (s, max) => [...str(s).replace(JUNK, '').replace(/\s+/g, ' ').trim()].slice(0, max).join('');
function safeColor(c) {
  if (typeof c !== 'string') return null;
  const m = /^#([0-9a-f]{3,8})$/i.exec(c.trim()); if (!m) return null;
  let h = m[1];
  if (h.length === 3 || h.length === 4) h = h.slice(0, 3).split('').map(x => x + x).join('');
  else if (h.length === 6 || h.length === 8) h = h.slice(0, 6); else return null;
  return '#' + h.toLowerCase();
}
function luminance(hex) {
  const n = parseInt(hex.slice(1), 16), ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
function parseDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str(s)); if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3], dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return null;
  return { y, mo, d, wd: dt.getUTCDay() };
}

// ---- Greek-aware letter case (the planner's "Aa" display mode; mirrors planner.src.html upperGreek / lowerGreek / caseName)
const GREEK_FIRST = 'Γιώργος Γεώργιος Γιάννης Ιωάννης Κώστας Κωνσταντίνος Δημήτρης Δημήτριος Νίκος Νικόλαος Μιχάλης Μιχαήλ Βασίλης Βασίλειος Αντώνης Αντώνιος Χρήστος Παναγιώτης Πάνος Θανάσης Αθανάσιος Αλέξανδρος Αλέξης Ανδρέας Μανώλης Εμμανουήλ Σταύρος Σπύρος Σπυρίδων Θοδωρής Θεόδωρος Στέλιος Στυλιανός Λευτέρης Ελευθέριος Πέτρος Παύλος Στέφανος Φώτης Φώτιος Τάσος Αναστάσιος Άγγελος Ευάγγελος Βαγγέλης Ηλίας Σωτήρης Σωτήριος Γρηγόρης Γρηγόριος Λάμπρος Μάριος Μάρκος Χάρης Χαράλαμπος Μπάμπης Άρης Αριστείδης Διονύσης Διονύσιος Νότης Λουκάς Ορέστης Περικλής Σάκης Τάκης Μάκης Άκης Ζαχαρίας Ιάσονας Οδυσσέας Φίλιππος Απόστολος Τόλης Αργύρης Αργύριος Θωμάς Ιορδάνης Κυριάκος Λεωνίδας Μιλτιάδης Μενέλαος Νεκτάριος Πρόδρομος Σεραφείμ Σωκράτης Τηλέμαχος Τριαντάφυλλος Χρυσόστομος Χρύσανθος Γεράσιμος Μάνος Νάσος Ντίνος Ρένος Στράτος Ευστράτιος Ευθύμης Ευθύμιος Θέμης Θεμιστοκλής Λάζαρος Πασχάλης Παρασκευάς Ραφαήλ Ρήγας Σίμος Τζώρτζης Χρόνης Άρτεμης Αχιλλέας Βύρωνας Δαμιανός Ερμής Ευριπίδης Ζήσης Θεοφάνης Ιάκωβος Κλεάνθης Κοσμάς Λούης Μελέτης Νεόφυτος Ξενοφών Ορφέας Πλάτωνας Ρωμανός Σέργιος Τέλης Τρύφωνας Φάνης Φοίβος Χρυσοβαλάντης Μαρία Ελένη Κατερίνα Αικατερίνη Γεωργία Σοφία Άννα Δήμητρα Βασιλική Βίκυ Ειρήνη Ευαγγελία Εύη Χριστίνα Αθηνά Αναστασία Νατάσα Ιωάννα Παρασκευή Βούλα Αγγελική Ευφροσύνη Φρόσω Φωτεινή Δέσποινα Κωνσταντίνα Ντίνα Ελευθερία Ζωή Νίκη Ελπίδα Ιουλία Μαργαρίτα Ραφαέλα Στέλλα Στυλιανή Χρυσούλα Χρύσα Παναγιώτα Γιώτα Θεοδώρα Δώρα Αλεξάνδρα Αντωνία Ανδριάνα Αργυρώ Αρετή Ασπασία Αφροδίτη Βαρβάρα Βερονίκη Γλυκερία Ευτυχία Ζαφειρία Θάλεια Ισμήνη Καλλιόπη Κλεοπάτρα Λυδία Μαριάννα Μαρίνα Μελίνα Μυρτώ Νεφέλη Ολυμπία Ουρανία Πηνελόπη Ρένα Σμαράγδα Τζένη Φανή Φαίδρα Χαρά Χαρίκλεια Χάιδω Ελισάβετ Λίνα Ανθή Αριάδνη Βιργινία Δανάη Ελένα Ερμιόνη Ευδοκία Ευγενία Ζηνοβία Ηρώ Θεανώ Ιφιγένεια Κική Κλαίρη Κορίνα Λαμπρινή Μάγδα Μαγδαληνή Μαρίκα Μάρθα Μαριλένα Ματίνα Μίνα Μυρσίνη Νάντια Νικολέτα Ξένια Πέγκυ Πόπη Ρεβέκκα Ρούλα Σεβαστή Σούλα Τασούλα Τατιάνα Τζίνα Τούλα Φιλιώ Φλώρα Φωφώ Χρυσάνθη Αλίκη Άλκηστη Άρτεμις Βάσω Βενετία Γαλάτεια Ελεάννα Ελίνα Ερατώ Ζέτα Ηλέκτρα Ιόλη Καίτη Κάτια Λένα Λητώ Μαίρη Μελίτα Νανά Νάσια Νόρα Ρίτα Σάσα Τζούλια Τίνα Φένια Φαίη Αγάπη Αγνή Αιμιλία Αντιγόνη Αρσινόη Βικτωρία Γεσθημανή Δάφνη Διαμάντω Ελευθερία Ευανθία Ζαχαρούλα Θεοδοσία Καλομοίρα Κρυσταλλία Κυριακή Λεμονιά Μαριάνθη Μελπομένη Νικολίνα Πολυξένη Σταματία Σταυρούλα Χρυσαυγή';
function upperGreek(s) {
  return String(s || '').normalize('NFD').replace(/([\u0370-\u03ff])([\u0300-\u036f]+)/g, (m, b, marks) => b + marks.replace(/[\u0300\u0301\u0342\u0345]/g, '')).normalize('NFC').toUpperCase();
}
let GREEK_FIRST_MAP = null;
function lowerGreek(s) {
  if (!GREEK_FIRST_MAP) { GREEK_FIRST_MAP = {}; for (const w of GREEK_FIRST.split(' ')) { const k = upperGreek(w); if (!(k in GREEK_FIRST_MAP)) GREEK_FIRST_MAP[k] = w; } }
  return String(s || '').replace(/[\p{L}\p{M}]+/gu, w => {
    if (w !== w.toUpperCase() || w === w.toLowerCase()) return w;
    const hit = GREEK_FIRST_MAP[upperGreek(w)]; if (hit) return hit;
    const low = w.toLowerCase().replace(/σ$/, 'ς'); return low.charAt(0).toUpperCase() + low.slice(1);
  });
}
const caseName = (s, mode) => mode === 'upper' ? upperGreek(s) : mode === 'lower' ? lowerGreek(s) : String(s || '');
function shortName(n) {   // «Κωνσταντίνος Παπαδόπουλος» → «Κωνσταντίνος Π.» (the planner's "short" name mode)
  const parts = n.trim().split(/\s+/).filter(Boolean); if (parts.length < 2) return n;
  const c = [...parts[1]][0]; return parts[0] + ' ' + (c ? c.toUpperCase() + '.' : '');
}

// ---------------------------------------------------------------- the clean plan model
function normalize(raw, lang) {
  let p = raw && typeof raw === 'object' ? raw : {};
  if (!Array.isArray(p.tables) && p.plan && typeof p.plan === 'object') p = p.plan;   // tolerate an export {name, plan}
  const nameCase = ['upper', 'lower'].includes(p.nameCase) ? p.nameCase : 'asis';
  const fontScale = num(p.seatFontScale, 1) >= 0.6 && num(p.seatFontScale, 1) <= 2 ? num(p.seatFontScale, 1) : 1;
  const stage = p.stage && typeof p.stage === 'object' ? p.stage : {};
  const W = clamp(Math.round(num(stage.w, 2100)), 700, 20000), H = clamp(Math.round(num(stage.h, 1400)), 600, 20000);
  const material = typeof p.stageMaterial === 'string' && Object.prototype.hasOwnProperty.call(MATERIAL, p.stageMaterial) ? p.stageMaterial : 'grass';

  const groups = new Map();
  for (const g of (Array.isArray(p.groups) ? p.groups : []).slice(0, MAX_GROUPS)) {
    if (!g || typeof g !== 'object' || (typeof g.id !== 'string' && typeof g.id !== 'number')) continue;
    const id = String(g.id); if (groups.has(id)) continue;
    groups.set(id, { id, name: cleanText(g.name, 60), color: safeColor(g.color) || GROUP_FALLBACK });
  }
  const guests = new Map();
  const src = p.guests && typeof p.guests === 'object' && !Array.isArray(p.guests) ? p.guests : {};
  let gcount = 0;
  for (const id of Object.keys(src)) {
    if (gcount >= MAX_GUESTS) break;
    const g = src[id]; if (!g || typeof g !== 'object') continue;
    const name = cleanText(caseName(cleanText(g.name, 120), nameCase), 80);
    if (!name) continue;
    const grp = g.groupId != null ? groups.get(str(g.groupId)) : null;
    guests.set(id, { id, name, group: grp || null, color: grp ? grp.color : GROUP_FALLBACK, cut: g.status === 'cut' });
    gcount++;
  }
  const seen = new Set(), tables = [];
  for (const t of (Array.isArray(p.tables) ? p.tables : [])) {
    if (tables.length >= MAX_TABLES) break;
    if (!t || typeof t !== 'object') continue;
    const shape = t.shape === 'head' ? 'head' : t.shape === 'rect' ? 'rect' : 'round';
    const capacity = clamp(Math.floor(num(t.capacity, 10)) || 10, shape === 'rect' ? 2 : 1, MAX_SEATS);
    const seats = [];
    const rawSeats = Array.isArray(t.seats) ? t.seats : [];
    for (let i = 0; i < capacity; i++) {
      const gid = rawSeats[i];
      if (typeof gid === 'string' && guests.has(gid) && !seen.has(gid)) { seen.add(gid); seats.push(gid); } else seats.push(null);
    }
    let rot = num(t.rot, 0) % 360;
    tables.push({ id: str(t.id) || String(tables.length), shape, label: cleanText(t.label, 60), capacity, seats, rot,
      x: clamp(num(t.x, 200), COORD_MIN, COORD_MAX), y: clamp(num(t.y, 200), COORD_MIN, COORD_MAX), index: tables.length });
  }
  const features = [];
  for (const f of (Array.isArray(p.features) ? p.features : [])) {
    if (features.length >= MAX_FEATURES) break;
    if (!f || typeof f !== 'object') continue;
    const kind = ['zone', 'prop', 'marker', 'label'].includes(f.kind) ? f.kind : 'marker';
    features.push({ kind, label: cleanText(f.label, 80),
      material: typeof f.material === 'string' && Object.prototype.hasOwnProperty.call(MATERIAL, f.material) ? f.material : (kind === 'zone' ? 'grass' : null),
      x: clamp(num(f.x, 200), COORD_MIN, COORD_MAX), y: clamp(num(f.y, 200), COORD_MIN, COORD_MAX),
      w: clamp(num(f.w, 100), 8, 20000), h: clamp(num(f.h, 100), 8, 20000), rot: num(f.rot, 0) % 360 });
  }
  return { W, H, material, fontScale, guests, groups, tables, features, lang };
}

// Table geometry in the planner's stage pixels, in the table's own (unrotated) frame — planner.src.html roundGeom / headGeom,
// and contract §3 for "rect". seats[i] = the point on the table edge in front of chair i and the outward direction there.
function tableGeom(t, fontScale) {
  const n = t.capacity, fs = Math.round(11 * fontScale), seatH = fs + 11;
  if (t.shape === 'round') {
    const need = n < 2 ? 46 : 46 / (2 * Math.sin(Math.PI / n));
    const ringR = Math.max(need, 46, seatH * 1.2), r = Math.max(24, ringR - seatH / 2 - 7);
    const seats = [];
    for (let i = 0; i < n; i++) { const a = (i / n) * 2 * Math.PI - Math.PI / 2; seats.push({ ex: Math.cos(a) * r, ey: Math.sin(a) * r, ux: Math.cos(a), uy: Math.sin(a) }); }
    return { shape: 'round', r, seats };
  }
  const slot = Math.round(64 * fontScale), seats = [];
  if (t.shape === 'head') {
    const top = Math.max(1, n - 2), innerW = top * slot, tw = innerW + 34, th = seatH + 50;
    for (let i = 0; i < n; i++) {
      if (i < top) seats.push({ ex: -innerW / 2 + slot / 2 + i * slot, ey: th / 2, ux: 0, uy: 1 });   // the couple's row faces the dance floor
      else if (i === top) seats.push({ ex: -tw / 2, ey: 0, ux: -1, uy: 0 });
      else seats.push({ ex: tw / 2, ey: 0, ux: 1, uy: 0 });
    }
    return { shape: 'box', w: tw, h: th, slot, seats };
  }
  const per = Math.ceil(n / 2), innerW = per * slot, tw = innerW + 34, th = 70;   // "rect": long table, seats on both long sides
  for (let i = 0; i < n; i++) {
    const side = i < per ? -1 : 1, k = i < per ? i : i - per;
    seats.push({ ex: -innerW / 2 + slot / 2 + k * slot, ey: side * th / 2, ux: 0, uy: side });
  }
  return { shape: 'box', w: tw, h: th, slot, seats };
}

// ---------------------------------------------------------------- geometry for collisions (page points)
// OBB: {cx,cy, ux,uy (unit, along the length), hw (half length), hh (half height)}; circle: {cx,cy,r}
function obbCorners(o) {
  const vx = -o.uy, vy = o.ux, out = [];
  for (const [a, b] of [[1, 1], [1, -1], [-1, -1], [-1, 1]]) out.push([o.cx + o.ux * o.hw * a + vx * o.hh * b, o.cy + o.uy * o.hw * a + vy * o.hh * b]);
  return out;
}
function aabbOf(o) {
  if (o.r != null) return [o.cx - o.r, o.cy - o.r, o.cx + o.r, o.cy + o.r];
  const c = obbCorners(o); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of c) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return [x0, y0, x1, y1];
}
function hitObbObb(a, b) {
  const dx = b.cx - a.cx, dy = b.cy - a.cy;
  const axes = [[a.ux, a.uy], [-a.uy, a.ux], [b.ux, b.uy], [-b.uy, b.ux]];
  for (const [ax, ay] of axes) {
    const d = Math.abs(dx * ax + dy * ay);
    const ra = a.hw * Math.abs(a.ux * ax + a.uy * ay) + a.hh * Math.abs(-a.uy * ax + a.ux * ay);
    const rb = b.hw * Math.abs(b.ux * ax + b.uy * ay) + b.hh * Math.abs(-b.uy * ax + b.ux * ay);
    if (d > ra + rb) return false;
  }
  return true;
}
function hitObbCircle(o, c) {
  const dx = c.cx - o.cx, dy = c.cy - o.cy;
  const lx = clamp(dx * o.ux + dy * o.uy, -o.hw, o.hw), ly = clamp(-dx * o.uy + dy * o.ux, -o.hh, o.hh);
  const px = o.cx + o.ux * lx - o.uy * ly, py = o.cy + o.uy * lx + o.ux * ly;
  return Math.hypot(c.cx - px, c.cy - py) < c.r;
}
const hitAny = (a, b) => a.r != null ? (b.r != null ? Math.hypot(a.cx - b.cx, a.cy - b.cy) < a.r + b.r : hitObbCircle(b, a)) : (b.r != null ? hitObbCircle(a, b) : hitObbObb(a, b));

class Grid {
  constructor(cell) { this.cell = cell; this.m = new Map(); }
  keys(bb) { const c = this.cell, out = []; for (let i = Math.floor(bb[0] / c); i <= Math.floor(bb[2] / c); i++) for (let j = Math.floor(bb[1] / c); j <= Math.floor(bb[3] / c); j++) out.push(i + ',' + j); return out; }
  add(item) { item.bb = item.bb || aabbOf(item.shape); for (const k of this.keys(item.bb)) { let a = this.m.get(k); if (!a) this.m.set(k, a = []); a.push(item); } }
  query(bb) { const set = new Set(); for (const k of this.keys(bb)) { const a = this.m.get(k); if (a) for (const it of a) set.add(it); } return set; }
}

// ---------------------------------------------------------------- the renderer
export async function renderPlanPdf(plan, meta = {}) {
  const fonts = loadFonts();
  meta = meta && typeof meta === 'object' ? meta : {};
  const lang = ['el', 'en', 'de'].includes(meta.lang) ? meta.lang : 'el';
  const mode = meta.mode === 'keepsake' ? 'keepsake' : 'floor';
  const W = L10N[lang];
  const P = normalize(plan, lang);
  const date = parseDate(meta.weddingDate);
  const title = cleanText(meta.name, 120) || (mode === 'keepsake' ? W.ourWedding : W.seatingPlan);
  const venue = cleanText(meta.venueName, 120);
  const longDate = date ? W.longDate(W.days[date.wd], date.d, W.months[date.mo - 1], date.y) : '';
  const shortDate = date ? `${String(date.d).padStart(2, '0')}.${String(date.mo).padStart(2, '0')}.${date.y}` : '';

  const doc = new PDFDocument({ autoFirstPage: false, bufferPages: true, margin: 0, lang: { el: 'el-GR', en: 'en', de: 'de-DE' }[lang], displayTitle: true,
    info: { Title: title + (mode === 'keepsake' ? '' : ' — ' + W.seatingPlan), Author: 'TakeaSeat', Creator: 'takeaseat.gr', Producer: 'takeaseat.gr' } });
  const chunks = [];
  const done = new Promise((resolve, reject) => { doc.on('data', c => chunks.push(c)); doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject); });
  try {
    // parsed fonts are kept between renders (parsing DejaVu costs more than drawing a whole plan); pdfkit ≥ 0.20 takes them
    const faces = ['S', 'SB', 'R', 'RB', 'RI', 'N'];
    for (const k of faces) doc.registerFont(k, (fonts.parsed && fonts.parsed[k]) || fonts[k]);
    const ctx = makeCtx(doc, fonts.nameScale);
    if (!fonts.parsed) { const parsed = {}; for (const k of faces) { doc.font(k); if (doc._font && doc._font.font && typeof doc._font.font.layout === 'function') parsed[k] = doc._font.font; } if (Object.keys(parsed).length === faces.length) fonts.parsed = parsed; }
    const K = { doc, ctx, P, W, lang, mode, title, venue, longDate, shortDate, date, budget: makeBudget() };
    if (mode === 'keepsake') renderKeepsake(K); else renderFloor(K);
    footers(K);
  } catch (e) { done.catch(() => {}); try { doc.end(); } catch { /* ignore */ } throw e; }
  doc.end();
  return done;
}

// Text helpers bound to one document: glyph coverage (a character no loaded face has is dropped instead of printing a box),
// cached measuring, and drawing at a BASELINE (y = baseline, not the top of the line).
function makeCtx(doc, nameScale = 100) {
  const covers = {}, widths = new Map(), metrics = {};
  for (const k of ['S', 'SB', 'R', 'RB', 'RI', 'N']) {
    doc.font(k); const f = doc._font, fk = f && f.font, cache = new Map();
    covers[k] = cp => { if (!fk || typeof fk.hasGlyphForCodePoint !== 'function') return true; let v = cache.get(cp); if (v === undefined) { try { v = !!fk.hasGlyphForCodePoint(cp); } catch { v = true; } cache.set(cp, v); } return v; };
    const cap = f && isNum(f.capHeight) && f.capHeight > 0 ? f.capHeight / 1000 : 0.7;
    metrics[k] = { cap, asc: f && isNum(f.ascender) ? f.ascender / 1000 : 0.9, desc: f && isNum(f.descender) ? -f.descender / 1000 : 0.22 };
  }
  const fallback = { R: 'S', RB: 'SB', RI: 'S', N: 'S', S: 'S', SB: 'S' };
  const covered = (s, face) => { for (const ch of s) { const cp = ch.codePointAt(0); if (cp !== 32 && !covers[face](cp)) return false; } return true; };
  // → [text, face]: the preferred face if it has every glyph, else the sans, else the text without the missing glyphs
  function prep(s, face) {
    s = String(s ?? '');
    if (covered(s, face)) return [s, face];
    const fb = fallback[face]; if (covered(s, fb)) return [s, fb];
    let out = ''; for (const ch of s) { const cp = ch.codePointAt(0); if (cp === 32 || covers[fb](cp)) out += ch; }
    return [out.replace(/\s+/g, ' ').trim(), fb];
  }
  function width(s, face, size, spacing = 0) {
    const key = face + '\u0001' + s; let w = widths.get(key);
    if (w === undefined) { doc.font(face).fontSize(1); w = doc.widthOfString(s); widths.set(key, w); }
    return w * size * (face === 'N' ? nameScale / 100 : 1) + spacing * Math.max(0, [...s].length - 1);
  }
  // draw (already prepared) text; align relative to x; y is the baseline
  function draw(s, x, y, o = {}) {
    if (!s) return;
    const face = o.face || 'S', size = o.size || 9, sp = o.spacing || 0;
    let xx = x; if (o.align === 'center') xx = x - width(s, face, size, sp) / 2; else if (o.align === 'right') xx = x - width(s, face, size, sp);
    doc.font(face).fontSize(size).fillColor(o.color || C.text, o.opacity == null ? 1 : o.opacity);
    doc.text(s, xx, y, { lineBreak: false, baseline: 'alphabetic', characterSpacing: sp || undefined, horizontalScaling: face === 'N' && nameScale !== 100 ? nameScale : undefined });
  }
  // shrink to fit a width (down to min), then cut with an ellipsis
  function fit(s, face, size, maxW, min, sp = 0) {
    let sz = size, w = width(s, face, sz, sp);
    if (w > maxW) { sz = Math.max(min, size * maxW / w); w = width(s, face, sz, sp); }
    if (w > maxW + 0.01) {
      const chars = [...s]; let lo = 0, hi = chars.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (width(chars.slice(0, mid).join('').trimEnd() + '…', face, sz, sp) <= maxW) lo = mid; else hi = mid - 1; }
      s = lo > 0 ? chars.slice(0, lo).join('').trimEnd() + '…' : '';
    }
    return [s, sz];
  }
  // word-wrap into lines of maxW (no hyphenation; an over-long word is cut); stops after maxLines + 1 lines
  function wrap(s, face, size, maxW, sp = 0, maxLines = Infinity) {
    const words = s.split(' '), lines = []; let cur = '';
    for (const w of words) {
      const t = cur ? cur + ' ' + w : w;
      if (!cur || width(t, face, size, sp) <= maxW) cur = t; else { lines.push(cur); cur = w; if (lines.length > maxLines) return lines; }
    }
    if (cur) lines.push(cur);
    return lines.map(l => width(l, face, size, sp) > maxW ? fit(l, face, size, maxW, size, sp)[0] : l);
  }
  return { prep, width, draw, fit, wrap, metrics };
}

// ---------------------------------------------------------------- ornaments
function heart(doc, cx, cy, size, color) {
  doc.save().translate(cx, cy).scale(size)
    .path('M0,0.36 C-0.08,0.28 -0.5,0.02 -0.5,-0.24 C-0.5,-0.48 -0.22,-0.58 0,-0.34 C0.22,-0.58 0.5,-0.48 0.5,-0.24 C0.5,0.02 0.08,0.28 0,0.36 Z')
    .fill(color).restore();
}
function flourish(doc, cx, cy, halfW, color) {   // ——— ♥ ———  with tapering hairlines
  doc.save().lineWidth(0.5).strokeColor(color).strokeOpacity(0.85);
  doc.moveTo(cx - halfW, cy).lineTo(cx - 9, cy).stroke();
  doc.moveTo(cx + 9, cy).lineTo(cx + halfW, cy).stroke();
  doc.circle(cx - halfW - 2.5, cy, 0.9).fill(color); doc.circle(cx + halfW + 2.5, cy, 0.9).fill(color);
  doc.restore();
  heart(doc, cx, cy + 0.3, 8, color);
}

// ---------------------------------------------------------------- floor plan: layout
const NAME_MAX = 7.5, NAME_MIN = 4.6;   // points; below NAME_MIN the plan switches to seat numbers + a name list

// Name placement is a search, and the plan may come from anyone (POST /pdf): it gets a hard work budget per render — a
// deadline and an operation count (collision tests, candidate spots). When either runs out, the plan shows seat numbers
// and the name list follows, exactly as when the names do not fit. Real plans use a few percent of it.
const NAME_BUDGET_MS = 400, NAME_BUDGET_OPS = 2e6;   // (2e6 ≈ 0.35 s on a desktop; real plans need 50–100k)
const OUT_OF_BUDGET = new Error('pdf: name placement budget exhausted');
function makeBudget(ms = NAME_BUDGET_MS, maxOps = NAME_BUDGET_OPS) {
  const end = performance.now() + ms;
  let ops = 0, check = 1024;
  return {
    out: false,
    get ops() { return ops; },
    spend(n = 1) {
      ops += n;
      if (ops >= check) { check = ops + 1024; if (ops > maxOps || performance.now() > end) { this.out = true; throw OUT_OF_BUDGET; } }
    },
  };
}

// Compute where everything goes for a plan page of this box. Pure layout — nothing is drawn.
function layoutPlan(K, box, opts) {
  const { P, ctx } = K;
  // the extent: the stage + everything placed on it (a table dragged outside the stage still shows)
  let x0 = 0, y0 = 0, x1 = P.W, y1 = P.H;
  const geoms = P.tables.map(t => tableGeom(t, P.fontScale));
  const ext = (w, h, rot) => { const a = rot * Math.PI / 180, c = Math.abs(Math.cos(a)), s = Math.abs(Math.sin(a)); return [w / 2 * c + h / 2 * s, w / 2 * s + h / 2 * c]; };
  P.tables.forEach((t, i) => {
    const g = geoms[i], [ex, ey] = g.shape === 'round' ? [g.r, g.r] : ext(g.w, g.h, t.rot);
    x0 = Math.min(x0, t.x - ex); x1 = Math.max(x1, t.x + ex); y0 = Math.min(y0, t.y - ey); y1 = Math.max(y1, t.y + ey);
  });
  for (const f of P.features) {
    const [ex, ey] = ext(f.w, f.h, f.rot);
    x0 = Math.min(x0, f.x - ex); x1 = Math.max(x1, f.x + ex); y0 = Math.min(y0, f.y - ey); y1 = Math.max(y1, f.y + ey);
  }
  const pad = opts.pad || 0;
  const bw = Math.max(1, x1 - x0), bh = Math.max(1, y1 - y0);
  const s = Math.min((box.w - 2 * pad) / bw, (box.h - 2 * pad) / bh);
  const ox = box.x + (box.w - bw * s) / 2 - x0 * s, oy = box.y + (box.h - bh * s) / 2 - y0 * s;
  const tp = (x, y) => [ox + x * s, oy + y * s];

  // tables in page points
  const tables = P.tables.map((t, i) => {
    const g = geoms[i], rad = t.rot * Math.PI / 180, c = Math.cos(rad), sn = Math.sin(rad);
    const [cx, cy] = tp(t.x, t.y);
    const rotL = (lx, ly) => [lx * c - ly * sn, lx * sn + ly * c];
    const T = { t, g, cx, cy, c, sn, rot: t.rot };
    if (g.shape === 'round') { T.r = g.r * s; T.body = { cx, cy, r: T.r + 0.6 }; T.spacing = 2 * Math.PI * (T.r + 3) / Math.max(1, t.capacity); }
    else { T.w = g.w * s; T.h = g.h * s; T.body = { cx, cy, ux: c, uy: sn, hw: T.w / 2 + 0.6, hh: T.h / 2 + 0.6 }; T.spacing = g.slot * s; }
    T.seats = g.seats.map(se => { const [ex, ey] = rotL(se.ex * s, se.ey * s), [ux, uy] = rotL(se.ux, se.uy); return { ex: cx + ex, ey: cy + ey, ux, uy }; });
    return T;
  });
  return { s, ox, oy, tp, tables, x0, y0, x1, y1 };
}

// Try to put every seated guest's name on the plan at one font size (largest that fits without collisions).
function placeNames(K, L, bounds) {   // (the page-size trial and the real page ask for the same layout: computed once)
  const key = [bounds.x0, bounds.y0, bounds.x1, bounds.y1, L.s].map(v => v.toFixed(3)).join(',');
  K.nameCache = K.nameCache || new Map();
  if (!K.nameCache.has(key)) {
    let res = null;
    if (!K.budget.out) {
      try { res = placeNamesNow(K, L, bounds); } catch (e) { if (e !== OUT_OF_BUDGET) throw e; res = null; }
    }
    K.nameCache.set(key, res);
  }
  return K.nameCache.get(key);
}
function placeNamesNow(K, L, bounds) {
  const { P, ctx, mode } = K;
  const B = K.budget, hit = (a, b) => { B.spend(); return hitAny(a, b); };   // every collision test is paid for
  const face = 'N';
  const people = [];   // {T, i, g, full, short}
  for (const T of L.tables) T.t.seats.forEach((gid, i) => {
    const g = gid && P.guests.get(gid); if (!g || (mode === 'keepsake' && g.cut)) return;
    const [nm, nf] = ctx.prep(g.name, face);   // (a name the condensed face cannot show falls back to the sans)
    if (!nm) return;   // nothing printable (an emoji-only name the fonts lack): the chair dot stays
    people.push({ T, i, g, face: nf, full: nm, short: ctx.prep(shortName(nm), nf)[0] });
  });
  const cr = T => clamp(T.spacing * 0.26, 1.0, 1.9);
  if (!people.length) return { size: NAME_MAX, labels: [], shortened: 0, cr };
  if (people.length > 700) return null;   // hundreds of names on one sheet are unreadable anyway — seat numbers + the list
  // hard obstacles: every table top and chair; soft ones: the decor captions (avoided when possible)
  const statics = new Grid(24);
  for (const T of L.tables) {
    statics.add({ shape: T.body, tbl: T });
    const r = cr(T);
    T.seats.forEach((se, i) => statics.add({ shape: { cx: se.ex + se.ux * (1 + r), cy: se.ey + se.uy * (1 + r), r }, tbl: T, seat: i }));
  }
  const decor = new Grid(24);
  for (const fb of L.featureText || []) decor.add({ shape: fb });
  // Candidate spots for one name: straight out from the chair first, then fanned a little to either side
  // (a neighbour table in the way), full name before the short form «Κωνσταντίνος Π.».
  const deg = Math.PI / 180;
  const fanNear = [0, 8, -8, 16, -16], fanWide = [24, -24, 32, -32];
  const maxShort = Math.max(2, Math.round(people.length * 0.12));
  const maxAway = Math.max(2, Math.round(people.length * 0.04));
  function attempt(size) {
    const hh = size * 0.5 + 0.3, placed = new Grid(24), labels = [];
    let shortened = 0;
    const chairOf = p => { const se = p.T.seats[p.i], r = cr(p.T); return [se.ex + se.ux * (1 + r), se.ey + se.uy * (1 + r), r]; };
    const make = (p, text, sx, sy, dx, dy, extra) => {
      const len = ctx.width(text, p.face, size);
      return { p, text, len, sx, sy, dx, dy, ...extra, shape: { cx: sx + dx * len / 2, cy: sy + dy * len / 2, ux: dx, uy: dy, hw: len / 2 + 0.2, hh } };
    };
    const build = (p, text, off) => {   // straight out from the chair, turned by `off` degrees
      const se = p.T.seats[p.i], [chx, chy, r] = chairOf(p), c = Math.cos(off * deg), s = Math.sin(off * deg);
      const dx = se.ux * c - se.uy * s, dy = se.ux * s + se.uy * c;
      return make(p, text, chx + dx * (r + 1.3), chy + dy * (r + 1.3), dx, dy);
    };
    const blocked = lab => {
      B.spend();
      const bb = aabbOf(lab.shape); lab.bb = bb;
      if (bb[0] < bounds.x0 || bb[2] > bounds.x1 || bb[1] < bounds.y0 || bb[3] > bounds.y1) return true;
      for (const o of statics.query(bb)) { if (o.tbl === lab.p.T && o.seat === lab.p.i) continue; if (hit(lab.shape, o.shape)) return true; }
      for (const o of placed.query(bb)) if (hit(lab.shape, o.shape)) return true;
      return false;
    };
    const onDecor = lab => { for (const o of decor.query(lab.bb)) if (hit(lab.shape, o.shape)) return true; return false; };
    const take = (p, lab) => { if (lab.text !== p.full) shortened++; placed.add(lab); labels.push(lab); };
    // Head and long tables: the names of a side run level under their chairs like a caption — one row when they fit
    // between the chairs, else two staggered rows (the outer row tied to its chair by a hairline). All or nothing per side.
    const level = side => {
      const T = side[0].p.T;
      let ax = T.c, ay = T.sn; if (ax < -1e-6 || (Math.abs(ax) <= 1e-6 && ay < 0)) { ax = -ax; ay = -ay; }   // upright
      const one = (q, text, rows) => {
        const p = q.p, se = p.T.seats[p.i], [chx, chy, r] = chairOf(p), row = rows === 2 ? q.k % 2 : 0, len = ctx.width(text, p.face, size);
        const off = r + 1.2 + hh + row * (2 * hh + 0.5), cx = chx + se.ux * off, cy = chy + se.uy * off;
        return { p, text, len, sx: cx - ax * len / 2, sy: cy - ay * len / 2, dx: ax, dy: ay,
          tie: row ? [chx + se.ux * r, chy + se.uy * r, cx - se.ux * hh, cy - se.uy * hh] : null,
          shape: { cx, cy, ux: ax, uy: ay, hw: len / 2 + 1.4, hh } };   // a little air between names in one row
      };
      // clashes between the side's own names and with everything already on the page
      const tieHits = (a, b) => { if (!a.tie) return false; const [x0, y0, x1, y1] = a.tie; for (let q = 0; q <= 1.001; q += 0.25) if (hit({ cx: x0 + (x1 - x0) * q, cy: y0 + (y1 - y0) * q, r: 0.7 }, b.shape)) return true; return false; };
      const clashes = out => { const bad = new Set(); out.forEach((a, i) => { if (blocked(a)) bad.add(i); for (let j = 0; j < i; j++) if (hit(a.shape, out[j].shape) || tieHits(a, out[j]) || tieHits(out[j], a)) { bad.add(i); bad.add(j); } }); return bad; };
      for (const rows of [1, 2]) { const out = side.map(q => one(q, q.p.full, rows)); if (!clashes(out).size) return out; }
      for (const rows of [2, 1]) {   // the longest clashing names in their short form, one at a time (each at most once)
        const out = side.map(q => one(q, q.p.full, rows));
        for (let n = 0; n < side.length && shortened + n < maxShort; n++) {
          const c = clashes(out);   // (once per step)
          if (!c.size) return out;
          const bad = [...c].filter(i => side[i].p.short && out[i].text !== side[i].p.short);
          if (!bad.length) break;
          const i = bad.reduce((a, b) => out[b].len > out[a].len ? b : a);
          out[i] = one(side[i], side[i].p.short, rows);
        }
        if (!clashes(out).size && out.filter((l, i) => l.text !== side[i].p.full).length + shortened <= maxShort) return out;
      }
      return null;
    };
    // the head table first (the couple's names deserve the best spots), then the others in plan order
    const byTable = new Map();
    for (const p of people) { if (!byTable.has(p.T)) byTable.set(p.T, []); byTable.get(p.T).push(p); }
    const ordered = [];
    for (const T of [...byTable.keys()].sort((a, b) => (a.t.shape === 'head' ? 0 : 1) - (b.t.shape === 'head' ? 0 : 1))) {
      let rest = byTable.get(T);
      if (T.g.shape === 'box' && Math.abs(T.c) >= Math.SQRT1_2 - 1e-9) {   // (a table turned more than 45°: its names are level already)
        const sides = new Map();
        for (const p of rest) {
          const se = T.seats[p.i];
          if (Math.abs(se.ux * T.c + se.uy * T.sn) > 0.9) continue;   // a chair at the end of the table
          const g = T.g.seats[p.i], key = g.uy > 0 ? 'b' : 'a';
          if (!sides.has(key)) sides.set(key, []);
          sides.get(key).push({ p, k: Math.round((g.ex + T.g.w / 2) / T.g.slot) });
        }
        const done = new Set();
        for (const side of sides.values()) { const labs = level(side); if (labs) for (const lab of labs) { take(lab.p, lab); done.add(lab.p); } }
        rest = rest.filter(p => !done.has(p));
      }
      ordered.push(...rest);
    }
    // 1) every name next to its chair (full name, then the short form; a small fan first, a wider one after)
    const away = [];
    for (const p of ordered) {
      const wide = p.T.g.shape === 'round' ? fanWide : [];
      const variants = [[p.full, fanNear], [p.short, fanNear], [p.full, wide], [p.short, wide]];
      let chosen = null, fallback = null;
      for (const [text, fan] of variants) {
        if (!text || (text === p.short && p.short === p.full && fan !== wide)) continue;
        if (text !== p.full && shortened >= maxShort) continue;
        for (const off of fan) {
          const lab = build(p, text, off);
          if (blocked(lab)) continue;
          if (onDecor(lab)) { fallback = fallback || lab; continue; }
          chosen = lab; break;
        }
        if (chosen) break;
      }
      chosen = chosen || fallback;
      if (chosen) take(p, chosen);
      else { away.push(p); if (away.length > maxAway) return null; }   // too crowded at this size
    }
    // 2) the few with no room at their chair: the nearest free spot, level, tied to the chair by a hairline (as in the planner)
    for (const p of away) {
      const [chx, chy, r] = chairOf(p), se = p.T.seats[p.i];
      let chosen = null;
      for (const text of [p.full, p.short]) {
        if (!text || (text !== p.full && shortened >= maxShort)) continue;
        for (let d = r + 5; d <= 46 && !chosen; d += 3.5) {
          let best = null;
          for (let k = 0; k < 16; k++) {
            const a = k / 16 * 2 * Math.PI, px = chx + Math.cos(a) * d, py = chy + Math.sin(a) * d;
            const left = Math.cos(a) < -0.2;
            const lab = make(p, text, px, py, left ? -1 : 1, 0, { away: [chx, chy, r] });
            if (blocked(lab) || onDecor(lab)) continue;
            // the hairline must not cross another table
            let crosses = false;
            for (let q = 0.3; q < 1 && !crosses; q += 0.2) { const mx = chx + (px - chx) * q, my = chy + (py - chy) * q; for (const o of statics.query([mx - 0.5, my - 0.5, mx + 0.5, my + 0.5])) if (!(o.tbl === p.T && o.seat != null) && hit({ cx: mx, cy: my, r: 0.5 }, o.shape)) { crosses = true; break; } }
            if (crosses) continue;
            const pref = -(Math.cos(a) * se.ux + Math.sin(a) * se.uy);   // same distance: the most outward wins
            if (!best || pref < best.pref) best = { lab, pref };
          }
          if (best) chosen = best.lab;
        }
        if (chosen) break;
      }
      if (!chosen) return null;
      take(p, chosen);
    }
    return { size, labels, shortened, away: away.length, cr };
  }
  for (let f = NAME_MAX; f >= NAME_MIN - 1e-9; f -= 0.2) { const a = attempt(Math.round(f * 10) / 10); if (a) return a; }
  return null;
}

// ---------------------------------------------------------------- floor plan: drawing
function drawPlan(K, box, opts) {
  const { doc, ctx, P, mode } = K;
  // 1) layout with names; if the names do not fit readably, seat numbers
  const L = layoutPlan(K, box, opts);
  const bounds = { x0: box.x - 12, y0: box.y - 6, x1: box.x + box.w + 12, y1: box.y + box.h + 6 };
  const fl = layoutFeatures(K, L);
  L.featureText = fl.texts;
  const names = opts.numbers ? null : placeNames(K, L, bounds);
  const numbers = !names;
  if (names && names.labels.length) {   // a zone caption with a name across it moves to a free spot of its zone
    const g = new Grid(24);
    for (const l of names.labels) g.add({ shape: l.shape });
    for (const T of L.tables) g.add({ shape: T.body });
    const free = sp => { const q = { ...sp, hw: sp.hw + 3, hh: sp.hh + 1.5 }; for (const o of g.query(aabbOf(q))) if (hitAny(q, o.shape)) return false; return true; };
    for (const it of fl.items) if (it.spots && it.spots.length > 1 && !free(it.spots[0])) {
      const sp = it.spots.find(free); if (sp) { it.tcx = sp.cx; it.tcy = sp.cy; }
    }
  }

  // 2) the stage
  const [sx0, sy0] = L.tp(0, 0), sw = P.W * L.s, sh = P.H * L.s;
  const mat = MATERIAL[P.material];
  doc.save().roundedRect(sx0, sy0, sw, sh, Math.min(8, sw / 40)).fillColor(mat[0]).fill().restore();
  doc.save().roundedRect(sx0, sy0, sw, sh, Math.min(8, sw / 40)).lineWidth(0.6).strokeColor('#d6cbbd').stroke().restore();

  // 3) decor
  drawFeatures(K, L, fl);

  // 4) tables, chairs, names
  for (const T of L.tables) drawTableBody(K, T);
  if (numbers) {
    for (const T of L.tables) drawSeatNumbers(K, T);
  } else {
    for (const l of names.labels) drawName(K, l, names.size);
    for (const T of L.tables) {
      const r = names.cr(T);
      T.seats.forEach((se, i) => {
        const gid = T.t.seats[i], g = gid && P.guests.get(gid), on = g && !(mode === 'keepsake' && g.cut);
        const cx = se.ex + se.ux * (1 + r), cy = se.ey + se.uy * (1 + r);
        if (on) doc.save().circle(cx, cy, r).fillColor(g.cut ? '#d8d0c6' : g.color).fill().restore();
        else doc.save().circle(cx, cy, r * 0.8).lineWidth(0.35).fillColor('#ffffff').strokeColor(C.chairEmpty).fillAndStroke().restore();
      });
    }
  }
  for (const T of L.tables) drawTableLabel(K, T, numbers);
  return { numbers, nameSize: names ? names.size : null, shortened: names ? names.shortened : 0, away: names ? names.away || 0 : 0, scale: L.s };
}

function layoutFeatures(K, L) {
  const { P, ctx } = K;
  const items = [], texts = [];
  for (const f of P.features) {
    const [cx, cy] = L.tp(f.x, f.y), w = f.w * L.s, h = f.h * L.s, rad = f.rot * Math.PI / 180;
    const it = { f, cx, cy, w, h, rad };
    if (f.label) {
      const face = f.kind === 'zone' || f.kind === 'label' ? 'RI' : f.kind === 'marker' ? 'SB' : 'S';
      const [txt, fc] = ctx.prep(f.label, face);
      if (txt) {
        const maxSize = f.kind === 'zone' ? 11 : f.kind === 'label' ? 8.5 : 7;
        const inner = f.kind === 'zone' ? 0.86 : 0.9;
        let vertical = false, size = Math.min(maxSize, (f.kind === 'zone' ? h * 0.2 : h * 0.55));
        let [t2, sz] = ctx.fit(txt, fc, Math.max(size, 3.6), w * inner, 3.6);
        if (h > w * 1.3) {   // a tall narrow item (a lake along the wall, a buffet turned sideways): the label may run upwards
          const [v2, vs] = ctx.fit(txt, fc, Math.max(3.6, Math.min(maxSize, w * (f.kind === 'zone' ? 0.3 : 0.5))), h * inner, 3.6);
          if (v2 && (vs > sz + 0.3 || (t2 !== txt && v2 === txt))) { vertical = true; t2 = v2; sz = vs; }
        }
        if (t2 && sz >= 3.6) {
          it.text = t2; it.face = fc; it.size = sz; it.vertical = vertical;
          const tw = ctx.width(t2, fc, sz);
          // zone captions sit near the top edge (the middle is where the cake table and the dancing are) — or, if names end
          // up there, in the middle or near the bottom (see drawPlan); the rest are centred
          const inset = Math.min(h * 0.2, sz * 1.9);
          const offs = f.kind === 'zone' && !vertical ? [-h / 2 + inset, 0, h / 2 - inset] : [0];
          const a = rad + (vertical ? -Math.PI / 2 : 0);
          const ux = Math.cos(a), uy = Math.sin(a);
          it.ta = a;
          it.spots = offs.map(off => ({ cx: cx - Math.sin(rad) * off, cy: cy + Math.cos(rad) * off, ux, uy, hw: tw / 2 + 1, hh: sz * 0.55 }));
          [it.tcx, it.tcy] = [it.spots[0].cx, it.spots[0].cy];
          texts.push(it.spots[0]);
        }
      }
    }
    items.push(it);
  }
  return { items, texts };
}

function drawFeatures(K, L, fl) {
  const { doc, ctx } = K;
  const order = { zone: 0, marker: 1, prop: 2, label: 3 };
  const items = fl.items.slice().sort((a, b) => order[a.f.kind] - order[b.f.kind]);
  for (const it of items) {
    const { f, cx, cy, w, h } = it;
    doc.save().translate(cx, cy).rotate(f.rot);
    const r = Math.min(f.kind === 'label' ? h / 2 : 5, w / 4, h / 4);
    if (f.kind === 'zone') {
      const m = MATERIAL[f.material] || MATERIAL.grass;
      doc.roundedRect(-w / 2, -h / 2, w, h, r).fillColor(m[1]).fill();
      doc.roundedRect(-w / 2, -h / 2, w, h, r).lineWidth(0.5).strokeColor(m[2]).stroke();
    } else if (f.kind === 'prop') {
      doc.roundedRect(-w / 2, -h / 2, w, h, r).fillColor('#fffdf9').fill();
      doc.roundedRect(-w / 2, -h / 2, w, h, r).lineWidth(0.45).strokeColor('#d6c8b4').stroke();
    } else if (f.kind === 'marker') {
      doc.roundedRect(-w / 2, -h / 2, w, h, r).fillColor('#e2d9cd').fill();
    } else {
      doc.roundedRect(-w / 2, -h / 2, w, h, r).fillColor('#ffffff').fill();
      doc.roundedRect(-w / 2, -h / 2, w, h, r).lineWidth(0.5).strokeColor(C.goldSoft).stroke();
    }
    doc.restore();
    if (it.text) {
      const color = f.kind === 'zone' ? (MATERIAL[f.material] || MATERIAL.grass)[3] : f.kind === 'marker' ? '#4a4038' : f.kind === 'label' ? C.ink : C.soft;
      const cap = ctx.metrics[it.face].cap;
      let a = it.ta * 180 / Math.PI;   // keep text upright-ish
      a = ((a % 360) + 540) % 360 - 180; if (a > 90) a -= 180; if (a < -90) a += 180;
      doc.save().translate(it.tcx, it.tcy).rotate(a);
      ctx.draw(it.text, 0, cap * it.size / 2, { face: it.face, size: it.size, color, align: 'center' });
      doc.restore();
    }
  }
}

function drawTableBody(K, T) {
  const { doc } = K;
  if (T.g.shape === 'round') {
    doc.save().circle(T.cx, T.cy, T.r).fillColor(C.card).fill().restore();
    doc.save().circle(T.cx, T.cy, T.r).lineWidth(Math.min(0.8, T.r / 14)).strokeColor(C.goldSoft).stroke().restore();
    if (T.r > 7) doc.save().circle(T.cx, T.cy, T.r - Math.min(1.8, T.r * 0.08)).lineWidth(0.25).strokeColor(C.goldLine).strokeOpacity(0.8).stroke().restore();
  } else {
    const head = T.t.shape === 'head', rr = Math.min(3.5, T.h / 4);
    doc.save().translate(T.cx, T.cy).rotate(T.rot);
    doc.roundedRect(-T.w / 2, -T.h / 2, T.w, T.h, rr).fillColor(head ? '#fffaf1' : C.card).fill();
    doc.roundedRect(-T.w / 2, -T.h / 2, T.w, T.h, rr).lineWidth(head ? 0.9 : 0.7).strokeColor(C.goldSoft).stroke();
    const ins = Math.min(1.8, T.h * 0.1);
    if (T.h > 8) doc.roundedRect(-T.w / 2 + ins, -T.h / 2 + ins, T.w - 2 * ins, T.h - 2 * ins, Math.max(0.5, rr - ins)).lineWidth(0.25).strokeColor(head ? C.gold : C.goldLine).strokeOpacity(0.7).stroke();
    doc.restore();
  }
}

const HEAD_DEFAULTS = ['νυφικό τραπέζι', 'head table', 'brauttisch'];   // the planner's default head-table labels
function isDefaultHead(label) { const l = label.toLowerCase().replace(/^💑\s*/, ''); return !l || HEAD_DEFAULTS.includes(l); }

function drawTableLabel(K, T, numbers) {
  const { doc, ctx, P, mode } = K;
  const t = T.t;
  const occ = t.seats.filter(g => g && P.guests.get(g) && !(mode === 'keepsake' && P.guests.get(g).cut)).length;
  if (T.g.shape === 'round') {
    const maxW = T.r * 1.55;
    let label = t.label || String(t.index + 1);
    const [txt, face] = ctx.prep(label, 'RB');
    const [tt, sz] = ctx.fit(txt, face, clamp(T.r * 0.62, 5, 16), maxW, 3.8);
    const cap = ctx.metrics[face].cap;
    const showCount = mode === 'floor' && T.r > 9;
    const cs = clamp(sz * 0.42, 3.4, 5.5);
    const yb = T.cy + cap * sz / 2 - (showCount ? cs * 0.55 : 0);
    ctx.draw(tt, T.cx, yb, { face, size: sz, color: C.accentInk, align: 'center' });
    if (showCount) ctx.draw(`${occ}/${t.capacity}`, T.cx, yb + cs * 1.45, { face: 'S', size: cs, color: C.faint, align: 'center' });
    return;
  }
  // head / long table: the label runs along the table, kept upright
  let a = ((T.rot % 360) + 540) % 360 - 180; if (a > 90) a -= 180; if (a < -90) a += 180;
  const head = t.shape === 'head';
  const def = head && isDefaultHead(t.label);
  doc.save().translate(T.cx, T.cy).rotate(a);
  const maxW = T.w * 0.84, sz0 = clamp(T.h * 0.36, 4.5, 12);
  if (def) {   // the couple's table: a heart
    heart(doc, 0, 0, Math.min(T.h * 0.55, 14), C.accent);
  } else {
    const [txt, face] = ctx.prep(t.label || (head ? '♥' : String(t.index + 1)), 'RB');
    const hs = Math.min(T.h * 0.4, 8);
    const withHeart = head && T.w > 40;
    const [tt, sz] = ctx.fit(txt, face, sz0, maxW - (withHeart ? hs + 3 : 0), 3.8);
    const tw = ctx.width(tt, face, sz), cap = ctx.metrics[face].cap;
    const x = withHeart ? (hs + 3) / 2 : 0;
    if (withHeart) heart(doc, x - tw / 2 - 3 - hs / 2, 0, hs, C.accent);
    ctx.draw(tt, x, cap * sz / 2, { face, size: sz, color: C.accentInk, align: 'center' });
  }
  doc.restore();
}

function drawName(K, l, size) {
  const { doc, ctx } = K;
  const a = Math.atan2(l.dy, l.dx) * 180 / Math.PI;
  const flip = l.dx < -1e-6;   // pointing left: turn the text round so it still reads left to right
  const cap = ctx.metrics[l.p.face].cap;
  const color = l.p.g.cut ? '#a79d91' : C.text;
  if (l.tie) doc.save().moveTo(l.tie[0], l.tie[1]).lineTo(l.tie[2], l.tie[3]).lineWidth(0.3).strokeColor(l.p.g.color).strokeOpacity(0.9).stroke().restore();
  if (l.away) {   // a name that had to move: a hairline back to its chair
    const [cx, cy, r] = l.away, d = Math.hypot(l.sx - cx, l.sy - cy) || 1;
    doc.save().moveTo(cx + (l.sx - cx) / d * r, cy + (l.sy - cy) / d * r).lineTo(l.sx - l.dx * 0.8, l.sy)
      .lineWidth(0.3).strokeColor(l.p.g.color).strokeOpacity(0.9).stroke().restore();
  }
  doc.save().translate(l.sx, l.sy);
  if (flip) { doc.rotate(a + 180); ctx.draw(l.text, -l.len, cap * size / 2, { face: l.p.face, size, color }); }
  else { doc.rotate(a); ctx.draw(l.text, 0, cap * size / 2, { face: l.p.face, size, color }); }
  doc.restore();
}

function drawSeatNumbers(K, T) {
  const { doc, ctx, P, mode } = K;
  const r = clamp(T.spacing * 0.4, 1.7, 3.6);
  T.seats.forEach((se, i) => {
    const gid = T.t.seats[i], g = gid && P.guests.get(gid), on = g && !(mode === 'keepsake' && g.cut);
    const cx = se.ex + se.ux * (0.8 + r), cy = se.ey + se.uy * (0.8 + r);
    const col = on ? (g.cut ? '#d8d0c6' : g.color) : null;
    if (col) doc.save().circle(cx, cy, r).fillColor(col).fill().restore();
    else doc.save().circle(cx, cy, r).lineWidth(0.35).fillColor('#ffffff').strokeColor(C.chairEmpty).fillAndStroke().restore();
    const txt = String(i + 1), sz = r * (txt.length > 1 ? 1.05 : 1.2);
    const tc = col ? (luminance(col) > 0.42 ? '#2b2330' : '#ffffff') : C.faint;
    ctx.draw(txt, cx, cy + ctx.metrics.SB.cap * sz / 2, { face: 'SB', size: sz, color: tc, align: 'center' });
  });
}

// ---------------------------------------------------------------- page chrome
function pageHeader(K, W_, x, y, w, opts = {}) {
  const { ctx, doc } = K;
  const [tt, tf] = ctx.prep(opts.title, 'RB');
  const [t2, ts] = ctx.fit(tt, tf, opts.size || 20, w * 0.62, 11);
  ctx.draw(t2, x, y + ts * 0.8, { face: tf, size: ts, color: C.ink });
  const sub = opts.sub ? ctx.prep(opts.sub, 'RI') : null;
  if (sub && sub[0]) { const [s2, ss] = ctx.fit(sub[0], sub[1], 10, w * 0.62, 7); ctx.draw(s2, x, y + ts * 0.8 + 14, { face: sub[1], size: ss, color: C.soft }); }
  if (opts.right) { const [r, rf] = ctx.prep(opts.right, 'S'); const [r2] = ctx.fit(r, rf, 8, w * 0.36, 6); ctx.draw(r2, x + w, y + ts * 0.8, { face: rf, size: 8, color: C.faint, align: 'right' }); }
  if (opts.right2) { const [r, rf] = ctx.prep(opts.right2, 'S'); const [r2] = ctx.fit(r, rf, 8, w * 0.36, 6); ctx.draw(r2, x + w, y + ts * 0.8 + 14, { face: rf, size: 8, color: C.faint, align: 'right' }); }
  const ly = y + ts * 0.8 + (sub && sub[0] ? 24 : 12);
  doc.save().moveTo(x, ly).lineTo(x + w, ly).lineWidth(0.5).strokeColor(C.goldSoft).stroke().restore();
  return ly;
}

function legend(K, x, y, w, groups) {   // group colour dots + names on one or two lines; returns the height used
  const { ctx, doc } = K;
  let cx = x, cy = y, lines = 1;
  for (const g of groups) {
    const [nm, f] = ctx.prep(g.name, 'S'); if (!nm) continue;
    const [n2] = ctx.fit(nm, f, 7, 160, 7);
    const iw = 8 + ctx.width(n2, f, 7) + 12;
    if (cx + iw > x + w && cx > x) { if (lines >= 2) break; cx = x; cy += 11; lines++; }
    doc.save().circle(cx + 2.5, cy - 2.4, 2.5).fillColor(g.color).fill().restore();
    ctx.draw(n2, cx + 8, cy, { face: f, size: 7, color: C.soft });
    cx += iw;
  }
  return lines * 11;
}

function usedGroups(K) {
  const { P, mode } = K, set = new Set();
  for (const t of P.tables) for (const gid of t.seats) { const g = gid && P.guests.get(gid); if (g && g.group && !(mode === 'keepsake' && g.cut)) set.add(g.group); }
  return [...P.groups.values()].filter(g => set.has(g));
}

function footers(K) {
  const { doc, ctx, mode, title, shortDate } = K;
  const range = doc.bufferedPageRange(), total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    const pw = doc.page.width, ph = doc.page.height, m = pw > 1000 ? 42 : 34, y = ph - 18;
    if (mode === 'keepsake' && i === 0) { ctx.draw('takeaseat.gr', pw / 2, ph - 40, { face: 'S', size: 7, color: C.faint, align: 'center', spacing: 0.6 }); continue; }
    ctx.draw('takeaseat.gr', pw - m, y, { face: 'S', size: 6.5, color: C.faint, align: 'right', spacing: 0.4 });
    if (total > 1) ctx.draw(String(i + 1), pw / 2, y, { face: 'R', size: 8, color: C.soft, align: 'center' });
    if (mode === 'keepsake') { const [t, f] = ctx.prep(title + (shortDate ? ' · ' + shortDate : ''), 'S'); const [t2] = ctx.fit(t, f, 6.5, pw / 2 - m - 40, 5); ctx.draw(t2, m, y, { face: f, size: 6.5, color: C.faint }); }
  }
}

// ---------------------------------------------------------------- floor mode
function sortedTables(K) {
  const coll = new Intl.Collator(K.lang, { numeric: true, sensitivity: 'base' });
  const rank = t => t.shape === 'head' ? 0 : 1;
  return K.P.tables.slice().sort((a, b) => rank(a) - rank(b) || coll.compare(a.label, b.label) || a.index - b.index);
}
function tableTitle(K, t) {
  const l = t.label;
  if (!l) return `${K.W.table} ${t.index + 1}`;
  return /^\d{1,4}[a-zA-Zα-ωΑ-Ω]?$/.test(l) ? `${K.W.table} ${l}` : l;
}

function planHeaderInfo(K) {
  const { P, W, mode } = K;
  let seated = 0, cap = 0;
  for (const t of P.tables) { cap += t.capacity; for (const gid of t.seats) { const g = gid && P.guests.get(gid); if (g && !(mode === 'keepsake' && g.cut)) seated++; } }
  return { seated, cap };
}

function renderFloor(K) {
  const { doc, ctx, P, W } = K;
  const { seated, cap } = planHeaderInfo(K);
  const unseated = [];
  const seatedSet = new Set(); for (const t of P.tables) for (const g of t.seats) if (g) seatedSet.add(g);
  for (const g of P.guests.values()) if (!seatedSet.has(g.id)) unseated.push(g);
  const coll = new Intl.Collator(K.lang, { sensitivity: 'base' });
  unseated.sort((a, b) => coll.compare(a.name, b.name));

  const sizes = P.tables.length > 24 ? ['A3'] : ['A4', 'A3'];
  let chosen = null;
  for (let pass = 0; pass < 2 && !chosen; pass++) {
    for (const size of sizes) {
      const r = planPage(K, size, { numbers: pass === 1, dryRun: true, unseated, seated, cap });
      if (!r.numbers || pass === 1) { chosen = { size, numbers: r.numbers }; break; }
    }
  }
  const r = planPage(K, chosen.size, { numbers: chosen.numbers, unseated, seated, cap });
  if (r.needsList) nameListPages(K, chosen.size, r.numbers, unseated, r.unseatedOnList);
}

// one landscape plan page (dryRun: only decide whether the names fit)
function planPage(K, size, o) {
  const { doc, ctx, P, W, mode } = K;
  const [pw, ph] = size === 'A3' ? [1190.55, 841.89] : [841.89, 595.28];
  const m = size === 'A3' ? 42 : 32;
  const groups = usedGroups(K);
  // footer band: legend + (floor) unseated box
  let unseatedLines = [], unseatedOnList = false;
  if (mode === 'floor' && o.unseated.length) {
    const txt = o.unseated.slice(0, 400).map(g => g.name).join('  ·  ');   // (more than fits in three lines anyway)
    const [t2, f] = ctx.prep(txt, 'S');
    unseatedLines = ctx.wrap(t2, f, 6.5, pw - 2 * m - 16, 0, 3);
    if (unseatedLines.length > 3) { unseatedOnList = true; unseatedLines = []; }
  }
  const legendH = groups.length ? 24 : 0;
  const unH = unseatedLines.length ? 14 + unseatedLines.length * 8.5 + 6 : (unseatedOnList ? 14 : 0);
  const headerTop = m - 6;
  const headerH = 44;
  const box = { x: m, y: headerTop + headerH + 12, w: pw - 2 * m, h: ph - (headerTop + headerH + 12) - (m + legendH + unH + 4) };
  if (o.dryRun) {
    const L = layoutPlan(K, box, {});
    const bounds = { x0: box.x - 12, y0: box.y - 6, x1: box.x + box.w + 12, y1: box.y + box.h + 6 };
    L.featureText = layoutFeatures(K, L).texts;
    const names = o.numbers ? null : placeNames(K, L, bounds);
    return { numbers: !names };
  }
  doc.addPage({ size: [pw, ph], margin: 0 });
  const sub = [K.longDate, K.venue].filter(Boolean).join('  ·  ');
  const right = mode === 'floor' ? `${W.tables(P.tables.length)}  ·  ${W.seatsOf(o.seated, o.cap)}` : `${W.guests(o.seated)}  ·  ${W.tables(P.tables.length)}`;
  pageHeader(K, pw, m, headerTop, pw - 2 * m, { title: mode === 'keepsake' ? W.floor : K.title, sub: mode === 'keepsake' ? [K.title, K.longDate].filter(Boolean).join('  ·  ') : sub, right, size: size === 'A3' ? 22 : 19 });
  const res = drawPlan(K, box, { numbers: o.numbers });
  if (process.env.PDF_DEBUG) console.error(`pdf: plan ${size} scale=${res.scale.toFixed(3)} ${res.numbers ? 'seat numbers' : `names ${res.nameSize}pt, ${res.shortened} short, ${res.away} moved`} · placement ops ${K.budget.ops}${K.budget.out ? ' (budget exhausted)' : ''}`);
  // under the plan: the group legend on the left, a note on the right, then (floor) the guests without a seat
  let y = box.y + box.h + 14;
  const notes = [];
  if (res.numbers) notes.push(W.numbersNote(doc.bufferedPageRange().count + 1));
  if (!unseatedLines.length && unseatedOnList) notes.push(W.unseatedMore(o.unseated.length, doc.bufferedPageRange().count + 1));
  let noteW = 0;
  if (notes.length) {
    const [t, f] = ctx.prep(notes.join('   '), 'RI'), [t2, s2] = ctx.fit(t, f, 7.5, (pw - 2 * m) * 0.6, 6);
    noteW = ctx.width(t2, f, s2);
    ctx.draw(t2, pw - m, y + 6, { face: f, size: s2, color: C.soft, align: 'right' });
  }
  if (groups.length) { legend(K, m, y + 6, pw - 2 * m - noteW - (noteW ? 24 : 0), groups); y += legendH; }
  if (unseatedLines.length) {
    const bx = m, bw = pw - 2 * m, bh = 14 + unseatedLines.length * 8.5;
    doc.save().roundedRect(bx, y, bw, bh, 4).fillColor('#fbf8f4').fill().restore();
    doc.save().roundedRect(bx, y, bw, bh, 4).lineWidth(0.4).strokeColor(C.line).stroke().restore();
    ctx.draw(`${W.unseated} (${o.unseated.length})`.toUpperCase(), bx + 8, y + 9.5, { face: 'SB', size: 5.8, color: C.accentInk, spacing: 0.5 });
    unseatedLines.forEach((ln, i) => ctx.draw(ln, bx + 8, y + 18 + i * 8.5, { face: 'S', size: 6.5, color: C.soft }));
  }
  return { numbers: res.numbers, needsList: mode === 'floor' && (res.numbers || unseatedOnList), unseatedOnList };
}

// compact per-table name lists (floor mode, when the plan shows seat numbers) — one page if at all possible
function nameListPages(K, size, withTables, unseated, withUnseated) {
  const { doc, ctx, P, W } = K;
  const [pw, ph] = size === 'A3' ? [1190.55, 841.89] : [841.89, 595.28];
  const m = size === 'A3' ? 42 : 32;
  const tables = withTables ? sortedTables(K) : [];
  const cards = tables.map(t => ({ title: tableTitle(K, t), count: `${t.seats.filter(Boolean).length}/${t.capacity}`,
    rows: t.seats.map((gid, i) => { const g = gid && P.guests.get(gid); return g ? { num: i + 1, name: g.name, color: g.color, cut: g.cut } : null; }).filter(Boolean) }));
  if (withUnseated && unseated.length) cards.push({ title: W.unseated, count: String(unseated.length), rows: unseated.map(g => ({ name: g.name, color: g.color })) , loose: true });
  // pick the largest font that fits one page, else flow over pages at a readable size
  let chosen = null, cols = 0;
  for (let fs = 8.4; fs >= 5.6; fs -= 0.2) {
    const lay = flowLayout(cards, { fs, pw, ph, m, top: m + 44, dry: true, K });
    if (lay.pages <= 1 && !lay.overflow) { chosen = fs; cols = lay.used; break; }   // one page: as few (wider) columns as it needs
  }
  flowLayout(cards, { fs: chosen || 6.8, cols, pw, ph, m, top: m + 44, K, newPage: () => {
    doc.addPage({ size: [pw, ph], margin: 0 });
    pageHeader(K, pw, m, m - 6, pw - 2 * m, { title: withTables ? W.namesByTable : W.unseated, sub: [K.title, K.longDate].filter(Boolean).join('  ·  '), size: size === 'A3' ? 20 : 17 });
  } });
}

// Cards in columns, top to bottom then the next column / page. Used for the floor name list and the keepsake "who sat where".
function flowLayout(cards, o) {
  const { K } = o, { ctx, doc } = K;
  const fs = o.fs, lh = fs * 1.38, titleH = fs * 2.3, padB = fs * 0.9, gap = o.gap ?? 12;
  const avail = o.pw - 2 * o.m;
  const cols = o.cols || Math.max(2, Math.floor((avail + gap) / (fs * 20 + gap)));
  const colW = (avail - gap * (cols - 1)) / cols;
  const bottom = o.ph - o.m - 12;
  // a card longer than a column (a long «Χωρίς θέση» list) continues in the next column / on the next page
  const perCol = Math.max(1, Math.floor((bottom - o.top - titleH - padB) / lh));
  const pieces = [];
  for (const card of cards) {
    if (card.rows.length <= perCol) { pieces.push(card); continue; }
    for (let i = 0; i < card.rows.length; i += perCol) pieces.push({ ...card, title: i ? `${card.title} (${K.W.cont})` : card.title, count: i ? '' : card.count, heart: card.heart && !i, rows: card.rows.slice(i, i + perCol) });
  }
  let pages = 0, col = 0, y = Infinity, used = 0, overflow = false;
  const startPage = () => { pages++; col = 0; y = o.top; if (!o.dry) o.newPage(); };
  for (const card of pieces) {
    const h = titleH + card.rows.length * lh + padB;
    if (y + h > bottom) { col++; y = o.top; if (col >= cols || pages === 0) startPage(); }
    if (pages === 0) startPage();
    if (y + h > bottom + 0.5) overflow = true;   // (cannot happen after the split — but never report it as fitting)
    if (!o.dry) drawCard(K, card, o.m + col * (colW + gap), y, colW, h, fs, lh, titleH, o.style || 'compact');
    used = Math.max(used, col + 1);
    y += h + gap * 0.8;
  }
  return { pages: pages + (overflow ? 1 : 0), used, overflow };
}

function drawCard(K, card, x, y, w, h, fs, lh, titleH, style) {
  const { doc, ctx } = K;
  const keep = style === 'keepsake';
  doc.save().roundedRect(x, y, w, h, keep ? 6 : 4).fillColor(keep ? '#fffdfa' : '#fdfbf8').fill().restore();
  doc.save().roundedRect(x, y, w, h, keep ? 6 : 4).lineWidth(0.45).strokeColor(keep ? '#e4d8c6' : C.line).stroke().restore();
  const px = keep ? 10 : 7;
  const [tt, tf] = ctx.prep(card.title, 'RB');
  const tsz = fs * (keep ? 1.4 : 1.2);
  const countW = card.count ? ctx.width(card.count, 'S', fs * 0.85) + 6 : 0;
  if (card.heart) heart(doc, x + px + tsz * 0.35, y + titleH * 0.55 - tsz * 0.3, tsz * 0.75, C.accent);
  const hx = card.heart ? tsz * 0.9 : 0;
  const [t2, ts] = ctx.fit(tt, tf, tsz, w - 2 * px - countW - hx, fs);
  ctx.draw(t2, x + px + hx, y + titleH * 0.55, { face: tf, size: ts, color: C.accentInk });
  if (card.count) ctx.draw(card.count, x + w - px, y + titleH * 0.55, { face: 'S', size: fs * 0.85, color: C.faint, align: 'right' });
  doc.save().moveTo(x + px, y + titleH * 0.78).lineTo(x + w - px, y + titleH * 0.78).lineWidth(0.4).strokeColor(C.goldSoft).strokeOpacity(0.8).stroke().restore();
  let yy = y + titleH + lh * 0.55;
  for (const r of card.rows) {
    let nx = x + px;
    doc.save().circle(nx + fs * 0.3, yy - fs * 0.33, fs * 0.28).fillColor(r.color || GROUP_FALLBACK).fill().restore();
    nx += fs * 0.95;
    if (r.num != null) { ctx.draw(String(r.num), nx + fs * 1.1, yy, { face: 'S', size: fs * 0.82, color: C.faint, align: 'right' }); nx += fs * 1.55; }
    const [n, f] = ctx.prep(r.name + (r.cut ? ` (${K.W.cancelled})` : ''), 'S');
    const [n2, s2] = ctx.fit(n, f, fs, x + w - px - nx, fs * 0.85);
    ctx.draw(n2, nx, yy, { face: f, size: s2, color: r.cut ? C.faint : C.text });
    yy += lh;
  }
}

// ---------------------------------------------------------------- keepsake
function renderKeepsake(K) {
  const { doc, ctx, P, W } = K;
  const { seated } = planHeaderInfo(K);
  cover(K, seated);
  // the floor plan: A4 landscape unless the plan is big (A3 keeps the names readable)
  const sizes = P.tables.length > 24 ? ['A3'] : ['A4', 'A3'];
  let chosen = null;
  for (let pass = 0; pass < 2 && !chosen; pass++) for (const size of sizes) {
    const r = planPage(K, size, { numbers: pass === 1, dryRun: true, unseated: [], seated, cap: 0 });
    if (!r.numbers || pass === 1) { chosen = { size, numbers: r.numbers }; break; }
  }
  const pr = planPage(K, chosen.size, { numbers: chosen.numbers, unseated: [], seated, cap: 0 });
  whoSatWhere(K, pr.numbers);
  alphaIndex(K);
}

function cover(K, seated) {
  const { doc, ctx, P, W } = K;
  const pw = 595.28, ph = 841.89;
  doc.addPage({ size: [pw, ph], margin: 0 });
  // a fine double frame
  doc.save().rect(26, 26, pw - 52, ph - 52).lineWidth(0.7).strokeColor(C.goldSoft).stroke().restore();
  doc.save().rect(31, 31, pw - 62, ph - 62).lineWidth(0.25).strokeColor(C.goldSoft).stroke().restore();
  let y = 150;
  flourish(doc, pw / 2, y, 70, C.gold);
  y += 52;
  // the couple
  const [tt, tf] = ctx.prep(K.title, 'R');
  let sz = 40, lines = ctx.wrap(tt, tf, sz, pw - 150);
  while (lines.length > 2 && sz > 22) { sz -= 2; lines = ctx.wrap(tt, tf, sz, pw - 150); }
  lines = lines.slice(0, 3).map(l => ctx.fit(l, tf, sz, pw - 150, sz)[0]);
  for (const l of lines) { ctx.draw(l, pw / 2, y + sz * 0.7, { face: tf, size: sz, color: C.ink, align: 'center' }); y += sz * 1.18; }
  y += 10;
  if (K.longDate) { const [d, df] = ctx.prep(K.longDate, 'RI'); ctx.draw(d, pw / 2, y + 10, { face: df, size: 15, color: C.soft, align: 'center' }); y += 30; }
  if (K.venue) { const [v, vf] = ctx.prep(upperGreek(K.venue), 'S'); const [v2] = ctx.fit(v, vf, 8.5, pw - 170, 6, 1.6); ctx.draw(v2, pw / 2, y + 8, { face: vf, size: 8.5, color: C.gold, align: 'center', spacing: 1.6 }); y += 22; }
  // at the foot: the warm line and the numbers; between: a miniature of the night
  const yWarm = ph - 138;
  const [wl, wf] = ctx.prep(W.warm, 'RI');
  ctx.draw(ctx.fit(wl, wf, 14, pw - 140, 9)[0], pw / 2, yWarm, { face: wf, size: 14, color: C.accentInk, align: 'center' });
  const stats = [W.guests(seated), W.tables(P.tables.length)].join('   ·   ');
  const [st, sf] = ctx.prep(upperGreek(stats), 'S');
  ctx.draw(st, pw / 2, yWarm + 24, { face: sf, size: 7.5, color: C.faint, align: 'center', spacing: 1.2 });
  const top = Math.max(y + 46, 360), bottom = yWarm - 46;
  if (bottom - top > 80) miniature(K, { x: 98, y: top, w: pw - 196, h: bottom - top });
}

// Every table in gold, every guest a dot in the colour of their group, the dance floor and the other floor areas as a
// breath of colour underneath: the shape of the night at a glance.
function miniature(K, box) {
  const { doc, P } = K;
  if (!P.tables.length) return;
  const L = layoutPlan(K, box, {});
  // the tables' footprint (not the whole venue) decides the scale, so the picture fills its frame
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const T of L.tables) {
    const a = T.rot * Math.PI / 180, ex = T.r != null ? T.r : Math.abs(T.w / 2 * Math.cos(a)) + Math.abs(T.h / 2 * Math.sin(a)), ey = T.r != null ? T.r : Math.abs(T.w / 2 * Math.sin(a)) + Math.abs(T.h / 2 * Math.cos(a));
    x0 = Math.min(x0, T.cx - ex - 4); x1 = Math.max(x1, T.cx + ex + 4); y0 = Math.min(y0, T.cy - ey - 4); y1 = Math.max(y1, T.cy + ey + 4);
  }
  const k = Math.min(box.w / Math.max(1, x1 - x0), box.h / Math.max(1, y1 - y0), 3);
  const mx = box.x + (box.w - (x1 - x0) * k) / 2, my = box.y + (box.h - (y1 - y0) * k) / 2;
  const map = (x, y) => [mx + (x - x0) * k, my + (y - y0) * k];
  // floor areas, clipped to the picture
  doc.save().rect(mx - 6, my - 6, (x1 - x0) * k + 12, (y1 - y0) * k + 12).clip();
  for (const f of P.features) {
    if (f.kind !== 'zone') continue;
    const [px, py] = L.tp(f.x, f.y), [cx, cy] = map(px, py), w = f.w * L.s * k, h = f.h * L.s * k;
    doc.save().translate(cx, cy).rotate(f.rot).roundedRect(-w / 2, -h / 2, w, h, Math.min(4, w / 4, h / 4))
      .fillColor((MATERIAL[f.material] || MATERIAL.grass)[1]).fillOpacity(0.55).fill().restore();
  }
  doc.restore();
  for (const T of L.tables) {
    const [cx, cy] = map(T.cx, T.cy);
    if (T.r != null) {
      doc.save().circle(cx, cy, T.r * k).lineWidth(0.6).fillColor('#fffdf8').strokeColor(C.goldSoft).fillAndStroke().restore();
    } else {
      doc.save().translate(cx, cy).rotate(T.rot).roundedRect(-T.w * k / 2, -T.h * k / 2, T.w * k, T.h * k, Math.min(2.5, T.h * k / 4))
        .lineWidth(0.6).fillColor('#fffdf8').strokeColor(C.goldSoft).fillAndStroke().restore();
      if (T.t.shape === 'head') heart(doc, cx, cy, Math.min(T.h * k * 0.5, 9), C.accent);
    }
    const dr = clamp(T.spacing * k * 0.2, 0.7, 1.9);
    T.seats.forEach((se, i) => {
      const gid = T.t.seats[i], g = gid && P.guests.get(gid); if (!g || g.cut) return;
      const [ex, ey] = map(se.ex, se.ey);
      doc.save().circle(ex + se.ux * (dr + 1), ey + se.uy * (dr + 1), dr).fillColor(g.color).fill().restore();
    });
  }
}

function whoSatWhere(K, withNumbers) {
  const { doc, ctx, P, W } = K;
  const pw = 595.28, ph = 841.89, m = 44;
  const cards = [];
  for (const t of sortedTables(K)) {
    const rows = t.seats.map((gid, i) => { const g = gid && P.guests.get(gid); return g && !g.cut ? { num: withNumbers ? i + 1 : null, name: g.name, color: g.color } : null; }).filter(Boolean);
    if (!rows.length) continue;
    cards.push({ title: tableTitle(K, t), count: String(rows.length), rows, heart: t.shape === 'head' });
  }
  if (!cards.length) return;
  // the largest type that still needs no more pages than the smallest does (no lonely card on a last page)
  const pagesAt = fs => flowLayout(cards, { K, fs, pw, ph, m, top: m + 58, cols: 3, gap: 14, dry: true }).pages;
  const least = pagesAt(7); let fs = 7;
  for (let f = 8.4; f > 7; f -= 0.2) if (pagesAt(f) <= least) { fs = f; break; }
  flowLayout(cards, { K, fs, pw, ph, m, top: m + 58, cols: 3, gap: 14, style: 'keepsake', newPage: () => {
    doc.addPage({ size: [pw, ph], margin: 0 });
    pageHeader(K, pw, m, m - 4, pw - 2 * m, { title: W.whoSat, sub: [K.title, K.longDate].filter(Boolean).join('  ·  '), size: 22 });
  } });
}

function alphaIndex(K) {
  const { doc, ctx, P, W, lang } = K;
  const tableOf = new Map();
  for (const t of P.tables) for (const gid of t.seats) if (gid) tableOf.set(gid, t);
  const coll = new Intl.Collator(lang, { sensitivity: 'base', numeric: true });
  const entries = [];
  for (const [gid, t] of tableOf) { const g = P.guests.get(gid); if (g && !g.cut) entries.push({ name: g.name, color: g.color, t }); }
  if (!entries.length) return;
  entries.sort((a, b) => coll.compare(a.name, b.name) || coll.compare(a.t.label, b.t.label));
  const pw = 595.28, ph = 841.89, m = 44, cols = 3, gap = 20;
  const colW = (pw - 2 * m - gap * (cols - 1)) / cols, top = m + 58, bottom = ph - m - 14, fs = 7.8, lh = 10.6;
  let col = 0, y = Infinity, started = false;
  const newPage = () => {
    doc.addPage({ size: [pw, ph], margin: 0 });
    pageHeader(K, pw, m, m - 4, pw - 2 * m, { title: W.index, sub: [K.title, K.longDate].filter(Boolean).join('  ·  '), size: 22 });
    col = 0; y = top; started = true;
  };
  const advance = need => { if (y + need > bottom) { col++; y = top; if (col >= cols) newPage(); } };
  let letter = null;
  for (const e of entries) {
    const first = upperGreek([...e.name.normalize('NFD').replace(/[\u0300-\u036f]/g, '')][0] || '#');
    const L1 = /\p{L}/u.test(first) ? first : '#';
    if (!started) newPage();
    if (L1 !== letter) {
      advance(lh * 3.2);
      if (letter !== null && y !== top) y += lh * 0.5;
      const x = m + col * (colW + gap);
      const [lt, lf] = ctx.prep(L1, 'RB');
      ctx.draw(lt, x, y + lh * 0.9, { face: lf, size: 12, color: C.accent });
      K.doc.save().moveTo(x + 14, y + lh * 0.9 - 3.5).lineTo(x + colW, y + lh * 0.9 - 3.5).lineWidth(0.35).strokeColor(C.goldSoft).stroke().restore();
      y += lh * 1.6; letter = L1;
    }
    advance(lh);
    const x = m + col * (colW + gap);
    const tl = e.t.label ? e.t.label : String(e.t.index + 1);
    const [tt, tf] = ctx.prep(tl, 'S');
    const [t2] = ctx.fit(tt, tf, fs, colW * 0.4, fs);
    const tw = ctx.width(t2, tf, fs);
    doc.save().circle(x + 2.2, y + lh * 0.62 - fs * 0.33, 1.9).fillColor(e.color).fill().restore();
    const [nm, nf] = ctx.prep(e.name, 'S');
    const [n2, ns] = ctx.fit(nm, nf, fs, colW - tw - 18, fs * 0.85);
    ctx.draw(n2, x + 7, y + lh * 0.62, { face: nf, size: ns, color: C.text });
    ctx.draw(t2, x + colW, y + lh * 0.62, { face: tf, size: fs, color: C.accentInk, align: 'right' });
    // dotted leader
    const lx0 = x + 7 + ctx.width(n2, nf, ns) + 3, lx1 = x + colW - tw - 3;
    if (lx1 - lx0 > 4) doc.save().moveTo(lx0, y + lh * 0.62 - 0.5).lineTo(lx1, y + lh * 0.62 - 0.5).lineWidth(0.5).dash(0.4, { space: 1.8 }).strokeColor(C.faint).strokeOpacity(0.7).stroke().undash().restore();
    y += lh;
  }
}
