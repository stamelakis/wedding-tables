#!/usr/bin/env python
"""TakeaSeat → Hermes (voice / watch control).

TakeaSeat is a REMOTE web app (https://takeaseat.gr), so this is a small HEADLESS local shim
("bridge, don't port"): each Hermes action forwards to TakeaSeat's own API and returns ONE spoken
sentence. Questions read the live database; two actions create things (a wedding, a venue).

THE ONE RULE: we never write into a venue we have sold to. Writes that create weddings go only to
venues listed in TAKEASEAT_OWN_VENUES (ours — Jockey, a "direct couples" venue…). Creating a venue
is onboarding a customer; from that moment it is theirs and the shim will not touch it again.

Config — a git-ignored .env beside this file (see .env.example):
  TAKEASEAT_URL            default https://takeaseat.gr
  TAKEASEAT_OWNER_KEY      the OWNER_KEY of admin.html (server.env on the box)
  TAKEASEAT_OWN_VENUES     comma-separated venue ids we own (new weddings may be created there)
  TAKEASEAT_OWN_VENUE      the default venue for "new wedding" (must be in OWN_VENUES)
  TAKEASEAT_PLAN_ID        the plan the seating questions are about (Andreas & Lina)
  TAKEASEAT_PLAN_EDIT_KEY  its edit key (only used to open the editor with edit rights on this PC)

Run it (and keep it running so Hermes can see it):
  C:\\Users\\andre\\hermes\\.venv\\Scripts\\python takeaseat_control.py
A Startup shortcut (TakeaSeatHermes.lnk) launches it with pythonw at logon.
"""
from __future__ import annotations

import datetime as _dt
import json
import os
import re
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
HERMES_DIR = Path(os.environ.get("HERMES_DIR", r"C:\Users\andre\hermes"))


def _load_env() -> None:
    try:
        from dotenv import load_dotenv  # available in the hermes venv
        load_dotenv(HERE / ".env")
        return
    except Exception:
        pass
    try:
        for line in (HERE / ".env").read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    except OSError:
        pass


_load_env()
BASE = os.environ.get("TAKEASEAT_URL", "https://takeaseat.gr").rstrip("/")
OWNER_KEY = os.environ.get("TAKEASEAT_OWNER_KEY", "")
OWN_VENUES = [v.strip() for v in os.environ.get("TAKEASEAT_OWN_VENUES", "").split(",") if v.strip()]
OWN_VENUE = os.environ.get("TAKEASEAT_OWN_VENUE", OWN_VENUES[0] if OWN_VENUES else "")
PLAN_ID = os.environ.get("TAKEASEAT_PLAN_ID", "")
PLAN_EDIT_KEY = os.environ.get("TAKEASEAT_PLAN_EDIT_KEY", "")

try:  # the system CA bundle here misreads a valid Let's Encrypt chain — use certifi's roots
    import certifi
    _CTX: ssl.SSLContext | None = ssl.create_default_context(cafile=certifi.where())
except Exception:
    _CTX = None

sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERMES_DIR))
from hermes_control import expose  # noqa: E402


# ── HTTP ──────────────────────────────────────────────────────────────────────
def _api(path: str, method: str = "GET", body: dict | None = None, headers: dict | None = None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    h = {"Content-Type": "application/json"}
    h.update(headers or {})
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=h)
    try:
        with urllib.request.urlopen(req, timeout=15, context=_CTX) as r:
            return json.loads(r.read().decode("utf-8") or "null")
    except urllib.error.HTTPError as e:
        try:
            err = json.loads(e.read().decode("utf-8")).get("error", "")
        except Exception:
            err = ""
        if e.code in (401, 403):
            raise RuntimeError("Το TakeaSeat απέρριψε το κλειδί — ελέγξτε το .env.")
        if e.code == 404:
            raise RuntimeError("Το TakeaSeat δεν βρήκε αυτό που ζήτησα (404).")
        raise RuntimeError(f"Το TakeaSeat απάντησε σφάλμα {e.code}{(' — ' + err) if err else ''}.")
    except RuntimeError:
        raise
    except Exception:
        raise RuntimeError("Δεν μπορώ να συνδεθώ στο TakeaSeat αυτή τη στιγμή.")


def _owner(path: str, method: str = "GET", body: dict | None = None):
    if not OWNER_KEY:
        raise RuntimeError("Λείπει το κλειδί ιδιοκτήτη TAKEASEAT_OWNER_KEY στο .env.")
    return _api(path, method, body, {"X-Owner-Key": OWNER_KEY})


def _venue_key(vid: str) -> str:
    d = _owner(f"/admin/venues/{vid}")
    return d.get("key") or ""


def _plan():
    if not PLAN_ID:
        raise RuntimeError("Δεν έχει οριστεί ποιον γάμο να κοιτάω (TAKEASEAT_PLAN_ID).")
    d = _api(f"/plans/{PLAN_ID}")
    p = d.get("plan") or {}
    tables = p.get("tables") or []
    guests = p.get("guests") or {}
    seated = {g for t in tables for g in (t.get("seats") or []) if g}
    return d, p, tables, guests, seated


# ── helpers ───────────────────────────────────────────────────────────────────
def _when(ms) -> str:
    if not ms:
        return "άγνωστο"
    t = _dt.datetime.fromtimestamp(ms / 1000)
    today = _dt.date.today()
    hm = t.strftime("%H:%M")
    if t.date() == today:
        return f"σήμερα στις {hm}"
    if t.date() == today - _dt.timedelta(days=1):
        return f"χθες στις {hm}"
    return t.strftime("%d/%m/%Y") + f" στις {hm}"


def _license_txt(v: dict) -> str:
    L = v.get("license") or {}
    if L.get("type") == "per_wedding":
        return f"ανά γάμο, {v.get('used', 0)} από {L.get('quota') or '∞'}"
    end = L.get("seasonEnd")
    return f"σεζόν έως {end}" if end else "σεζόν χωρίς λήξη"


def _clip(text: str) -> None:
    """Put text on the PC clipboard (best effort — never fails the action)."""
    try:
        subprocess.run(["clip"], input=text.encode("utf-16le"), check=False, timeout=5,
                       creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    except Exception:
        pass


_FILLER = r"^[\s:,\-–—]*(?:(?:για|τον|την|το|τους|τις|με\s+όνομα|ονόματι|πελάτη|πελάτης|ζευγάρι|named|called|for|of|the|a|customer|client|couple)\s+)*"
_KEYS = ["ζευγάρι", "ζευγαρι", "γάμου", "γαμου", "γάμος", "γαμος", "γάμο", "γαμο", "wedding", "couple",
         "κτήματος", "κτηματος", "κτήμα", "κτημα", "venue", "customer", "client", "πελάτη", "πελατη", "πελάτης"]
_NOT_NAMES = {"takeaseat", "hermes", "jockey"}


def _name_from(task: str) -> str:
    """Pull the name out of his sentence.
    «νέος γάμος για Μαρία και Νίκο» → «Μαρία και Νίκο» · "create a venue customer Κτήμα Ηλιοβασίλεμα" → «Κτήμα Ηλιοβασίλεμα».
    Speech-to-text capitalises names but not command words, so the name is the run that starts at the first
    capitalised token after the first command keyword; failing that, whatever follows the keyword minus filler."""
    t = (task or "").strip()
    low = t.lower()
    pos, klen = -1, 0
    for k in _KEYS:
        i = low.find(k)
        if i >= 0 and (pos < 0 or i < pos):
            pos, klen = i, len(k)
    rest = t[pos + klen:] if pos >= 0 else t
    toks = rest.split()
    for j, tok in enumerate(toks):
        if tok[:1].isupper() and tok.lower().strip("«»\"'.,") not in _NOT_NAMES:
            return " ".join(toks[j:]).strip(" .;!?\"'«»")[:80]
    rest = re.sub(_FILLER, "", rest, flags=re.I).strip(" .;!?\"'«»")
    return rest[:80]


_recent: dict[str, tuple[float, str]] = {}


def _dedupe(key: str, make):
    """Hermes retries: the same creation asked twice within 2 minutes returns the first result."""
    now = time.monotonic()
    hit = _recent.get(key)
    if hit and now - hit[0] < 120:
        return "Ήδη έγινε πριν λίγο: " + hit[1]
    result = make()
    _recent[key] = (now, result)
    return result


# ── Questions (read-only) ─────────────────────────────────────────────────────
def takeaseat_site_health(**_):
    problems = []
    try:
        req = urllib.request.Request(BASE + "/", method="GET")
        with urllib.request.urlopen(req, timeout=15, context=_CTX) as r:
            if r.status != 200:
                problems.append(f"η σελίδα απαντά {r.status}")
    except Exception:
        problems.append("η σελίδα δεν απαντά")
    try:
        _api(f"/plans/{PLAN_ID}" if PLAN_ID else "/plans/none")
    except RuntimeError as e:
        if "404" not in str(e) or PLAN_ID:
            problems.append("η βάση δεν απαντά")
    if problems:
        raise RuntimeError("Πρόβλημα στο TakeaSeat: " + " και ".join(problems) + ".")
    return "Το TakeaSeat λειτουργεί κανονικά — σελίδα και βάση απαντούν."


def takeaseat_venues(**_):
    vs = _owner("/admin/venues").get("venues") or []
    if not vs:
        return "Δεν υπάρχει κανένα κτήμα ακόμη."
    parts = [f"{v.get('name')} ({v.get('weddingCount', 0)} γάμοι, {_license_txt(v)}{'' if v.get('active') else ', ανενεργό'})" for v in vs[:6]]
    more = f" και άλλα {len(vs) - 6}" if len(vs) > 6 else ""
    sold = [v for v in vs if v.get("id") not in OWN_VENUES]
    return f"{len(vs)} κτήματα, {len(sold)} πελάτες: " + "· ".join(parts) + more + "."


def takeaseat_weddings(**_):
    if not OWN_VENUE:
        raise RuntimeError("Δεν έχει οριστεί δικό μας κτήμα (TAKEASEAT_OWN_VENUE).")
    key = _venue_key(OWN_VENUE)
    d = _api(f"/venues/{OWN_VENUE}", headers={"X-Venue-Key": key})
    v, ws = d.get("venue") or {}, d.get("weddings") or []
    ws = sorted(ws, key=lambda w: -(w.get("createdAt") or 0))
    names = ", ".join(w.get("label", "") for w in ws[:5])
    more = f" και άλλοι {len(ws) - 5}" if len(ws) > 5 else ""
    return f"Στο {v.get('name', 'κτήμα μας')} υπάρχουν {len(ws)} γάμοι: {names}{more}. Άδεια {_license_txt(v)}."


def takeaseat_seating_progress(**_):
    d, p, tables, guests, seated = _plan()
    total, free = len(guests), sum(t.get("capacity", 0) for t in tables) - len(seated)
    return (f"{d.get('name', 'Ο γάμος')}: {len(seated)} από {total} καλεσμένους έχουν θέση σε {len(tables)} τραπέζια, "
            f"{total - len(seated)} χωρίς θέση, {free} κενές θέσεις.")


def takeaseat_unseated_guests(**_):
    d, p, tables, guests, seated = _plan()
    un = [g.get("name", "") for gid, g in guests.items() if gid not in seated and g.get("name")]
    if not un:
        return "Όλοι οι καλεσμένοι έχουν θέση."
    return f"{len(un)} χωρίς θέση: " + ", ".join(un[:8]) + (f" και άλλοι {len(un) - 8}." if len(un) > 8 else ".")


def takeaseat_empty_tables(**_):
    d, p, tables, guests, seated = _plan()
    rows = []
    for t in tables:
        free = sum(1 for s in (t.get("seats") or []) if not s)
        if free:
            rows.append((t.get("label", "?"), free))
    if not rows:
        return "Όλα τα τραπέζια είναι γεμάτα."
    txt = ", ".join(f"{lbl} ({free})" for lbl, free in rows[:8])
    return f"{len(rows)} τραπέζια με κενές θέσεις: {txt}" + (f" και άλλα {len(rows) - 8}." if len(rows) > 8 else ".")


def takeaseat_last_change(**_):
    d = _api(f"/plans/{PLAN_ID}") if PLAN_ID else {}
    return f"Το πλάνο «{d.get('name', '')}» άλλαξε τελευταία φορά {_when(d.get('updated'))}."


# ── Navigation on this PC ─────────────────────────────────────────────────────
def takeaseat_open_editor(**_):
    if not PLAN_ID:
        raise RuntimeError("Δεν έχει οριστεί ποιον γάμο να ανοίξω.")
    url = f"{BASE}/seating-planner-el.html?plan={PLAN_ID}" + (f"#key={PLAN_EDIT_KEY}" if PLAN_EDIT_KEY else "")
    os.startfile(url)  # noqa: S606 — opens the default browser
    return "Άνοιξα τον επεξεργαστή τραπεζιών στον υπολογιστή."


def takeaseat_open_lab(**_):
    os.startfile(f"{BASE}/lab.html")  # noqa: S606
    return "Άνοιξα το εργαστήριο του TakeaSeat στον υπολογιστή."


# ── Creation (only ever in OUR venues; onboarding a venue is allowed) ──────────
def takeaseat_new_wedding(task: str = "", **_):
    if not OWN_VENUE or OWN_VENUE not in OWN_VENUES:
        raise RuntimeError("Δεν έχει οριστεί δικό μας κτήμα για νέους γάμους — δεν γράφω σε κτήμα πελάτη.")
    name = _name_from(task) or ("Νέος γάμος " + _dt.datetime.now().strftime("%d/%m %H:%M"))

    def make():
        key = _venue_key(OWN_VENUE)
        vd = _api(f"/venues/{OWN_VENUE}", headers={"X-Venue-Key": key})
        if not vd.get("canCreate"):
            raise RuntimeError("Το κτήμα μας δεν επιτρέπει νέο γάμο τώρα — έληξε η άδεια ή το όριο.")
        r = _api(f"/venues/{OWN_VENUE}/weddings", "POST", {"label": name}, {"X-Venue-Key": key})
        link = f"{BASE}/seating-planner-el.html?plan={r['planId']}#key={r['editKey']}"
        _clip(link)
        vname = (vd.get("venue") or {}).get("name", "κτήμα μας")
        return f"Δημιουργήθηκε ο γάμος «{name}» στο {vname}. Ο σύνδεσμος του ζευγαριού είναι στο πρόχειρο του υπολογιστή και στην κονσόλα κτήματος."

    return _dedupe("wedding:" + name.lower(), make)


def takeaseat_new_venue(task: str = "", **_):
    name = _name_from(task) or ("Νέο κτήμα " + _dt.datetime.now().strftime("%d/%m %H:%M"))

    def make():
        today = _dt.date.today()
        lic = {"type": "seasonal", "seasonStart": today.isoformat(), "seasonEnd": (today + _dt.timedelta(days=365)).isoformat(), "cap": 0}
        r = _owner("/admin/venues", "POST", {"name": name, "contact": "", "license": lic})
        _clip(f"Κονσόλα: {BASE}/venue.html\nΚωδικός: {r.get('key', '')}")
        return (f"Δημιουργήθηκε το κτήμα «{name}» με εποχιακή άδεια έως {lic['seasonEnd']}. "
                f"Ο κωδικός του είναι στο πρόχειρο του υπολογιστή — είναι πελάτης, δεν θα γράψω μέσα του.")

    return _dedupe("venue:" + name.lower(), make)


ACTIONS = {
    "takeaseat_site_health": (takeaseat_site_health, "λειτουργεί το TakeaSeat, είναι online η σελίδα / is TakeaSeat online, is the site working"),
    "takeaseat_venues": (takeaseat_venues, "πόσα κτήματα πελάτες έχουμε στο TakeaSeat / how many venues customers do we have, list clients"),
    "takeaseat_weddings": (takeaseat_weddings, "λίστα γάμων στο Jockey, πόσους γάμους έχουμε / weddings list at Jockey, our own weddings"),
    "takeaseat_seating_progress": (takeaseat_seating_progress, "πρόοδος τραπεζολογίου, πόσοι καλεσμένοι έχουν θέση / seating progress, how many guests are seated"),
    "takeaseat_unseated_guests": (takeaseat_unseated_guests, "ποιοι καλεσμένοι λείπουν, ονόματα χωρίς θέση / which names are still missing a seat"),
    "takeaseat_empty_tables": (takeaseat_empty_tables, "ποια τραπέζια έχουν κενές θέσεις, άδεια τραπέζια / which tables have free seats, empty tables"),
    "takeaseat_last_change": (takeaseat_last_change, "πότε άλλαξε τελευταία φορά το πλάνο / when was the seating plan last updated"),
    "takeaseat_open_editor": (takeaseat_open_editor, "άνοιξε τον επεξεργαστή τραπεζιών στον υπολογιστή / open the seating editor in the browser"),
    "takeaseat_open_lab": (takeaseat_open_lab, "άνοιξε το εργαστήριο δοκιμών / open the seating sandbox laboratory"),
    "takeaseat_new_wedding": (takeaseat_new_wedding, "δημιούργησε νέο γάμο για ζευγάρι / create a new wedding for a couple"),
    "takeaseat_new_venue": (takeaseat_new_venue, "δημιούργησε νέο κτήμα πελάτη / create a new venue customer, onboard a client"),
}


if __name__ == "__main__":
    expose("TakeaSeat τραπεζολόγιο", ACTIONS)
    # The console may be cp1252 (or absent under pythonw) — a print must never take the registration down.
    try:
        if sys.stdout:
            try:
                sys.stdout.reconfigure(encoding="utf-8")
            except Exception:
                pass
            print(f"[takeaseat-hermes] registered TakeaSeat ({len(ACTIONS)} actions) -> {BASE} "
                  f"[owner key {'set' if OWNER_KEY else 'MISSING'}; own venues {OWN_VENUES or 'NONE'}; plan {PLAN_ID or 'NONE'}]", flush=True)
    except Exception:
        pass
    threading.Event().wait()  # keep the process (and the registration) alive
