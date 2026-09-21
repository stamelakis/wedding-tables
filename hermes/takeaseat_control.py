#!/usr/bin/env python
"""TakeaSeat → Hermes (voice / watch control).

TakeaSeat is a REMOTE web app (https://takeaseat.gr), so this is a small HEADLESS local shim
("bridge, don't port"): each Hermes action forwards to TakeaSeat's own API and returns ONE spoken
sentence. Questions read the live database; two actions create things (a wedding, a venue).

THE ONE RULE: we never write into a venue we have sold to. Writes that create weddings go only to
venues listed in TAKEASEAT_OWN_VENUES (ours — Jockey, a "direct couples" venue…). Creating a venue
is onboarding a customer; from that moment it is theirs and the shim will not touch it again.

CREATION IS TWO SPOKEN STEPS (2026-09-21). takeaseat_new_wedding / takeaseat_new_venue only PROPOSE
(«Να φτιάξω γάμο «Μαρία και Νίκος», 12/9/2027, στο Jockey;») and keep that one proposal for
PENDING_SECONDS; nothing is written until he says «επιβεβαιώνω στο TakeaSeat» (takeaseat_confirmtakeaseat)
— that phrase and nothing else: a question («τι επιβεβαιώνω στο TakeaSeat;»), a deferral («… αύριο») or a
negation ("I won't confirm TakeaSeat") creates nothing. A sentence that asks to delete / remove / cancel
never proposes or creates anything (there is no voice deletion), and a question never proposes. Hermes
matches by substrings of the descriptions, so the descriptions of the actions that create hold only
imperative phrases of a creation request (see ACTIONS, and sim_match.py).

Config — a git-ignored .env beside this file (see .env.example):
  TAKEASEAT_URL            default https://takeaseat.gr
  TAKEASEAT_OWNER_KEY      the OWNER_KEY of admin.html (server.env on the box)
  TAKEASEAT_OWN_VENUES     comma-separated venue ids we own (new weddings may be created there)
  TAKEASEAT_OWN_VENUE      the default venue for "new wedding" (must be in OWN_VENUES)
  TAKEASEAT_PLAN_ID        the plan the seating questions are about (Andreas & Lina)
  TAKEASEAT_PLAN_EDIT_KEY  its edit key (reads the plan; also opens the editor with edit rights on this PC)
  TAKEASEAT_VENUE_KEY      optional: our venue's console key, needed once that venue has set its own key
                           (the admin API stops revealing a venue key after the venue changes it)

Since 2026-09-18 reading a plan needs a credential (the plan id alone is not enough): the plan is read
with TAKEASEAT_PLAN_EDIT_KEY, else with our own venue's key.

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
import unicodedata
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
VENUE_KEY = os.environ.get("TAKEASEAT_VENUE_KEY", "")

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
    if VENUE_KEY and VENUE_KEY.split(".")[0] == vid:
        return VENUE_KEY
    d = _owner(f"/admin/venues/{vid}")
    if not d.get("key"):
        raise RuntimeError("Το κτήμα έχει ορίσει δικό του κωδικό — βάλτε τον στο TAKEASEAT_VENUE_KEY του .env.")
    return d["key"]


def _plan_headers() -> dict:
    """Reading a plan needs a credential: its edit key, else our own venue's key."""
    if PLAN_EDIT_KEY:
        return {"X-Edit-Key": PLAN_EDIT_KEY}
    if OWN_VENUE:
        return {"X-Venue-Key": _venue_key(OWN_VENUE)}
    raise RuntimeError("Λείπει το TAKEASEAT_PLAN_EDIT_KEY για να διαβάσω τον γάμο.")


def _plan():
    if not PLAN_ID:
        raise RuntimeError("Δεν έχει οριστεί ποιον γάμο να κοιτάω (TAKEASEAT_PLAN_ID).")
    d = _api(f"/plans/{PLAN_ID}", headers=_plan_headers())
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
_NOT_NAMES = {"takeaseat", "hermes", "jockey", "τζοκει", "τραπεζολογιο"}


_MONTHS = {}
for _i, _names in enumerate([
        ("ιανουαριου", "ιανουαριος", "ιαν", "january", "jan"), ("φεβρουαριου", "φεβρουαριος", "φεβ", "february", "feb"),
        ("μαρτιου", "μαρτιος", "μαρ", "march", "mar"), ("απριλιου", "απριλιος", "απρ", "april", "apr"),
        ("μαιου", "μαιος", "μαι", "may"), ("ιουνιου", "ιουνιος", "ιουν", "june", "jun"),
        ("ιουλιου", "ιουλιος", "ιουλ", "july", "jul"), ("αυγουστου", "αυγουστος", "αυγ", "august", "aug"),
        ("σεπτεμβριου", "σεπτεμβριος", "σεπ", "september", "sep", "sept"), ("οκτωβριου", "οκτωβριος", "οκτ", "october", "oct"),
        ("νοεμβριου", "νοεμβριος", "νοε", "november", "nov"), ("δεκεμβριου", "δεκεμβριος", "δεκ", "december", "dec")], start=1):
    for _nm in _names:
        _MONTHS[_nm] = _i
_ACCENTS = str.maketrans("άέήίόύώϊϋΐΰ", "αεηιουωιυιυ")


_STOP_TAIL = {"στις", "στη", "στην", "την", "τη", "τις", "το", "στο", "στον", "για", "του", "με", "ημερομηνια", "on", "the", "am", "of", "at", "in",
              "δευτερα", "τριτη", "τεταρτη", "πεμπτη", "παρασκευη", "σαββατο", "κυριακη",
              "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}


def _clean_name(name: str) -> str:
    """Drop the words that belonged to the date («… για τις», «… το Σάββατο», "on") from the end of the couple's name,
    and the place («… στο Jockey», «… στο TakeaSeat τραπεζολόγιο» — run_action appends the app's name to his sentence)."""
    toks = [t for t in (name or "").split() if not re.fullmatch(r"\d{1,2}[:.]\d{2}(?:μμ|πμ|am|pm)?", t.lower())]   # a time is not part of a name
    while toks and toks[-1].lower().strip(" ,.;").translate(_ACCENTS) in (_STOP_TAIL | _NOT_NAMES):
        toks.pop()
    return " ".join(toks).strip(" ,.;")[:80]


def _date_from(task: str):
    """The wedding date in his sentence → ("YYYY-MM-DD", the matched text) or (None, "").
    «στις 12 Σεπτεμβρίου (του) 2028», «12/9», «12.09.2027», "2027-09-12", "on 12 September 2027"; no year → the next such
    day. A month name wins over digits (so a time like 21:30 or a phone number never becomes the date)."""
    t = (task or "")
    low = t.lower().translate(_ACCENTS)
    today = _dt.date.today()
    found = None
    for m in re.finditer(r"\b(\d{1,2})\s+([a-zα-ω]+)\.?(?:\s*,?\s+(?:του\s+|of\s+)?(\d{4}))?\b", low):
        if m.group(2) in _MONTHS:
            found = (m, int(m.group(1)), _MONTHS[m.group(2)], int(m.group(3)) if m.group(3) else None); break
    if not found:
        m = re.search(r"(?<![\d:])(\d{4})-(\d{1,2})-(\d{1,2})(?![\d:])", low)
        if m:
            found = (m, int(m.group(3)), int(m.group(2)), int(m.group(1)))
    if not found:
        for m in re.finditer(r"(?<![\d:/.\-])(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2,4}))?(?![\d:])", low):
            if 1 <= int(m.group(1)) <= 31 and 1 <= int(m.group(2)) <= 12:
                found = (m, int(m.group(1)), int(m.group(2)), int(m.group(3)) if m.group(3) else None); break
    if not found:
        return None, ""
    m, day, mon, yr = found
    if yr is not None and yr < 100:
        yr += 2000
    try:
        d = _dt.date(yr or today.year, mon, day)
        if yr is None and d < today:
            d = _dt.date(today.year + 1, mon, day)
    except ValueError:
        return None, ""
    return d.isoformat(), t[m.start():m.end()]


def _cut_date(text: str, said: str) -> str:
    """His sentence without the date and the words that led into it («… στις 12/9 …», "… on the 12/9 …"), wherever the
    date sits — so a date in the middle leaves no «στις» inside the couple's name."""
    text = text or ""
    i = text.find(said) if said else -1
    if i < 0:
        return re.sub(r"\s+", " ", text).strip()
    head = text[:i].split()
    while head and head[-1].lower().strip(" ,.;").translate(_ACCENTS) in _STOP_TAIL:
        head.pop()
    return re.sub(r"\s+", " ", " ".join(head) + " " + text[i + len(said):]).strip()


# «στο / στον / στη / στην <Όνομα>», "at / in <Name>": a run of capitalised words after the preposition.
_PLACE_RE = re.compile(r"(?<!\w)(?:[Σσ]το|[Σσ]τον|[Σσ]την|[Σσ]τη|[Aa]t|[Ii]n)\s+"
                       r"([A-ZΑ-ΩΆΈΉΊΌΎΏ][^\s,.;:!?«»\"]*(?:\s+[A-ZΑ-ΩΆΈΉΊΌΎΏ][^\s,.;:!?«»\"]*)*)")
_MONTH_WORDS = set(_MONTHS) | {k[:-1] for k in _MONTHS if k.endswith("ς")}   # «τον Σεπτέμβριο» is a date, not a place


def _strip_our_place(text: str, vname: str) -> tuple[str, str]:
    """(his sentence without «στο <our venue>», the first place he named that is NOT ours — "" if none).
    Ours = our venue's name word by word (a prefix of it is enough: «στο Jockey» for "Jockey Club"), or TakeaSeat /
    Jockey; the words after it («στο Jockey Μαρία και Νίκος») stay, they are the couple's."""
    vw = _fold(vname).split()
    out = text or ""
    for m in reversed(list(_PLACE_RE.finditer(out))):
        toks = m.group(1).split()
        if toks[0].lower().strip(".,").translate(_ACCENTS) in (_MONTH_WORDS | _STOP_TAIL):
            out = out[:m.start()] + " " + out[m.end():]   # «στον Σεπτέμβριο», «στη Δευτέρα»: the date's words, not a place
            continue
        k = 0
        while k < len(toks):
            w = _fold(toks[k]).strip(".,'’")
            if w in _NOT_NAMES or (k < len(vw) and w == vw[k]):
                k += 1
            else:
                break
        if k == 0:
            return out, m.group(1)
        out = out[:m.start()] + " " + " ".join(toks[k:]) + out[m.end():]
    return re.sub(r"\s+", " ", out).strip(), ""


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


def _done_lately(key: str) -> str:
    """The spoken result of the same creation if it was made in the last 2 minutes, else ""."""
    hit = _recent.get(key)
    return hit[1] if hit and time.monotonic() - hit[0] < 120 else ""


# ── Voice guards for the actions that create ──────────────────────────────────
APP_NAME = "TakeaSeat τραπεζολόγιο"
CONFIRM_PHRASE = "επιβεβαιώνω στο TakeaSeat"
CONFIRM_ACTION = "takeaseat_confirmtakeaseat"   # no bare "confirm" in the name: Hermes counts action-name words too
PENDING_SECONDS = 180.0      # a proposal waits this long for CONFIRM_PHRASE, then it is gone
CONFIRM_GAP_SECONDS = 10.0   # a confirm sooner than this after the proposal did not come from him: he has to
#                              hear the proposal first. The orchestrator is told «Don't ask him to confirm things
#                              he already asked for», so it may try to chain the confirm itself — that is refused.


def _fold(text: str) -> str:
    """Lower case, no accents, σ for ς — «Σβήσε», «σβησε» and «ΣΒΉΣΕ» read the same."""
    d = unicodedata.normalize("NFD", str(text or "").casefold())
    return "".join(c for c in d if not unicodedata.combining(c))


def _squash(text: str) -> str:
    """What Hermes's matcher hears (appbridge._squash): letters and digits only, the words run together."""
    return re.sub(r"[^a-z0-9α-ω]+", "", _fold(text))


# Delete / remove / cancel, in Greek and English, on _fold()ed text (so a final ς is written σ in these patterns). «σβήσε το ζευγάρι Μαρία» used to land on
# takeaseat_new_wedding («ζευγάρι» was the only word that told it apart) and created a wedding at once.
_DELETE_RE = re.compile(
    r"σβησ|σβην|σβυσ|σβυν|διαγραφ|διαγραψ|διεγραψ|αφαιρ|ακυρ|καταργ|ξεχνα"
    r"|\b(?:delet|remov|cancel|erase|wipe|destroy|undo|forget|purg)"
    r"|\b(?:drop|scrap|kill|trash|clear|get\s+rid|throw\s+away|throw\s+out)\b")
# «πέτα», «βγάλε» (throw out, take out) — on accent-stripped text that keeps its case: lower case anywhere, capitalised
# only as the first word, because «Πέτα» / «Βγάλε…» inside a sentence is a name.
_THROW_RE = re.compile(r"(?<!\w)(?:πετα|πεταξε|πεταξτε|πεταχτε|βγαλε|βγαλτε|βγαλ)(?!\w)"
                       r"|^\W*(?:Πετα|Πεταξε|Πεταξτε|Πεταχτε|Βγαλε|Βγαλτε|Βγαλ)(?!\w)")
_NEGATION_RE = re.compile(
    r"(?<!\w)(?:οχι|μη|μην|δεν|no|not|nope|never|cannot|dont|wont|cant|shouldnt|wouldnt|mustnt|didnt|doesnt|isnt|arent)(?!\w)"
    r"|\w+n[’']t(?!\w)")   # don't, won't, can't, shouldn't…
# A question: a question mark (the Greek one is «;»), a question word anywhere, or an English question's first word.
# Checked on _fold()ed text, except «πού» / «πώς», which are «που» / «πως» (that, which) without their accent.
_QUESTION_RE = re.compile(
    r"[?;\u037e]"
    r"|(?<!\w)(?:τι|ποιοσ|ποια|ποιο|ποιοι|ποιεσ|ποιον|ποιου|ποιων|ποτε|γιατι|υπαρχει|υπαρχουν|ποσοι|ποσα|ποσεσ|ποσουσ|ποσο|μηπωσ"
    r"|what|whats|when|whens|how|hows|why|where|wheres|whether)(?!\w)"
    r"|^\W*(?:is|are|was|were|do|does|did|any|who|whos|which|should|shall|has|have|had)(?!\w)"
    r"|(?<!\w)(?:is|are)\s+there(?!\w)")
_QUESTION_ACCENTED_RE = re.compile(r"(?<!\w)(?:πού|πώς)(?!\w)")
_POLITE_RE = re.compile(r"^\W*(?:(?:can|could|would|will)\s+you|μπορεισ\s+να|μπορειτε\s+να|θα\s+μπορουσεσ\s+να|θα\s+μπορουσατε\s+να)(?!\w)")
# The confirm is a WHITELIST: once the app's name, these fillers and punctuation are taken out, only the confirm word may
# be left. «τι επιβεβαιώνω στο TakeaSeat», «επιβεβαιώνω στο TakeaSeat αύριο», "I won't confirm TakeaSeat" leave words behind.
_CONFIRM_WORDS = {"επιβεβαιωνω", "confirm"}
_CONFIRM_FILLER = {"ναι", "yes", "yeah", "yep", "ok", "okay", "οκ", "οκει", "ενταξει", "i", "εγω", "it", "please", "παρακαλω",
                   "στο", "στον", "στη", "στην", "σε", "το", "in", "on", "at", "to", "for", "the", "with",
                   "takeaseat", "τραπεζολογιο", "hermes", "ερμη", "ερμησ"}
_OWN_TOKENS = ("takeaseat", "τραπεζολογ", "τεικασιτ", "τεικεσιτ")   # squashed: «TakeaSeat», "Take a Seat", «τέικ α σιτ»
_APPS_DIR = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "Hermes" / "apps"
_others_cache: dict = {}


def _deaccent(text: str) -> str:
    d = unicodedata.normalize("NFD", str(text or ""))
    return "".join(c for c in d if not unicodedata.combining(c))


def _asks_to_delete(*texts: str) -> bool:
    return any(_DELETE_RE.search(_fold(t)) or _THROW_RE.search(_deaccent(t)) for t in texts if t)


def _negated(*texts: str) -> bool:
    return any(_NEGATION_RE.search(_fold(t)) for t in texts if t)


def _asks(*texts: str) -> bool:
    """A question, not a request: «ποιος είναι ο νέος γάμος στις 12/9», "is there a new venue", "what's the new venue
    called", «υπάρχει νέος γάμος 12/9;». A polite request ("can you create…", «μπορείς να φτιάξεις…») may end in «?»."""
    for t in texts:
        if not t:
            continue
        if _QUESTION_ACCENTED_RE.search(str(t).casefold()):
            return True
        f = _fold(_without_app(t))
        if _POLITE_RE.search(f):
            f = _POLITE_RE.sub(" ", re.sub(r"[?;\u037e]", " ", f))
        if _QUESTION_RE.search(f):
            return True
    return False


def _plain_confirm(text: str) -> bool:
    """True only when the sentence is the confirm phrase and nothing more (see _CONFIRM_WORDS)."""
    f = _fold(_without_app(text))
    f = re.sub(r"take\s*a\s*seat|τεικ\s*[αε]?\s*σιτ", " takeaseat ", f)
    rest = [w for w in re.split(r"[^a-z0-9α-ω]+", f) if w and w not in _CONFIRM_FILLER]
    return bool(rest) and all(w in _CONFIRM_WORDS for w in rest)


def _names_us(text: str) -> bool:
    heard = _squash(text)
    return any(t in heard for t in _OWN_TOKENS)


def _other_apps() -> list:
    """[(name, its 4+ letter squashed words)] of every OTHER app registered with Hermes — read only, names only,
    cached 30 s. Words that are also ours are left out."""
    now = time.monotonic()
    hit = _others_cache.get("apps")
    if hit and now - hit[0] < 30:
        return hit[1]
    out = []
    try:
        files = sorted(_APPS_DIR.glob("*.json"))
    except OSError:
        files = []
    for p in files:
        try:
            name = json.loads(p.read_text(encoding="utf-8")).get("name") or p.stem
        except Exception:
            continue
        if not isinstance(name, str) or name == APP_NAME:
            continue
        words = {w for w in (_squash(t) for t in re.split(r"[^0-9A-Za-zΆ-ώ]+", name)) if len(w) >= 4}
        words = {w for w in words if not any(o in w or w in o for o in _OWN_TOKENS)}
        if words:
            out.append((name, words))
    _others_cache["apps"] = (now, out)
    return out


def _other_app_named(text: str) -> str:
    """The other registered app his sentence names («επιβεβαιώνω στον λογιστή» → Λογιστή), else ""."""
    heard = _squash(text)
    best, longest = "", 0
    for name, words in _other_apps():
        n = max((len(w) for w in words if w in heard), default=0)
        if n > longest:
            best, longest = name, n
    return best


def _refuse_delete_or_no(value: str, task: str, example: str = "φτιάξε γάμο Μαρία και Νίκος στις 12 Σεπτεμβρίου") -> None:
    """Before any proposal: a sentence that deletes, removes, cancels or says no creates nothing, and it also drops
    a proposal that is waiting (whatever he meant, he did not mean «go ahead»). A question proposes nothing either
    (a proposal that is waiting stays: a question is not a no)."""
    if _asks_to_delete(value, task):
        _disarm()
        raise RuntimeError("Στο TakeaSeat δεν σβήνω, δεν αφαιρώ και δεν ακυρώνω τίποτα με φωνή — αυτό γίνεται μόνο "
                           "από την κονσόλα στον υπολογιστή. Δεν έφτιαξα τίποτα.")
    if _negated(value, task):
        _disarm()
        raise RuntimeError("Ακούω άρνηση («όχι», «μην», «δεν») — δεν πρότεινα και δεν έφτιαξα τίποτα.")
    if _asks(value, task):
        raise RuntimeError("Ακούω ερώτηση, όχι αίτημα — δεν πρότεινα και δεν έφτιαξα τίποτα στο TakeaSeat. "
                           f"Για να το φτιάξω, πείτε π.χ. «{example}».")


# The one creation that waits for CONFIRM_PHRASE. hermes_control serves one request at a time; the lock is for
# safety, and the confirm takes the proposal OUT before it runs, so a retry can never create twice.
_pending: dict = {}
_pending_lock = threading.Lock()


def _arm(what: str, key: str, make, task: str, says: str) -> str:
    with _pending_lock:
        _pending.clear()
        _pending.update(what=what, key=key, make=make, at=time.monotonic(), heard=_squash(_without_app(task)))
    return f"{says} Αν ναι, πείτε «{CONFIRM_PHRASE}» μέσα σε {int(PENDING_SECONDS // 60)} λεπτά."


def _disarm() -> str:
    """Forget the waiting proposal; returns what it was ("" if none)."""
    with _pending_lock:
        what = _pending.get("what", "")
        _pending.clear()
    return what


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
        _api("/health")   # needs no key: a missing or stale plan key is reported by the seating questions instead
    except RuntimeError:
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
    d = _api(f"/plans/{PLAN_ID}", headers=_plan_headers()) if PLAN_ID else {}
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
# Two spoken steps: these two only PROPOSE and read back exactly what would be created; takeaseat_confirm creates it.
def _without_app(text: str) -> str:
    """His sentence without the app name run_action appends to it (it is not part of a couple's or venue's name)."""
    return re.sub(re.escape(APP_NAME), " ", str(text or ""), flags=re.I).strip()


def takeaseat_new_wedding(value: str = "", task: str = "", **_):
    """`value` = the thing he named (Hermes ≥ 2026-09-10), `task` = his whole sentence; either gives the couple's name.
    Creates nothing: reads the venue, then proposes. takeaseat_confirm does the POST."""
    _refuse_delete_or_no(value, task)
    if not OWN_VENUE or OWN_VENUE not in OWN_VENUES:
        raise RuntimeError("Δεν έχει οριστεί δικό μας κτήμα για νέους γάμους — δεν γράφω σε κτήμα πελάτη.")
    task = _without_app(task)
    date, said = _date_from(task or value)
    if not date:   # the server needs the date: it decides when the couple can arrange the tables and when the plan closes
        raise RuntimeError("Πείτε μου και την ημερομηνία του γάμου, π.χ. «φτιάξε γάμο Μαρία και Νίκος στις 12 Σεπτεμβρίου».")
    vd = _api(f"/venues/{OWN_VENUE}", headers={"X-Venue-Key": _venue_key(OWN_VENUE)})   # read only
    if not vd.get("canCreate"):
        raise RuntimeError("Το κτήμα μας δεν επιτρέπει νέο γάμο τώρα — έληξε η άδεια ή το όριο. Δεν πρότεινα τίποτα.")
    vname = (vd.get("venue") or {}).get("name", "κτήμα μας")
    # The place he named: ours → taken out of the couple's name; any other («στο Κτήμα Ηλιοβασίλεμα») → nothing proposed.
    spoken, foreign = _strip_our_place(_cut_date(task, said), vname)
    val, foreign_v = _strip_our_place(_cut_date(value or "", said), vname)
    foreign = foreign or foreign_v
    if foreign:
        raise RuntimeError(f"Το «{foreign}» δεν είναι δικό μας κτήμα — σε κτήμα πελάτη δεν γράφω. Με φωνή φτιάχνω "
                           f"γάμους μόνο στο {vname}. Δεν πρότεινα τίποτα.")
    name = _clean_name(val) or _clean_name(_name_from(spoken)) \
        or ("Νέος γάμος " + _dt.datetime.now().strftime("%d/%m %H:%M"))
    key = "wedding:" + name.lower()
    if _done_lately(key):
        return "Ήδη έγινε πριν λίγο: " + _done_lately(key)
    d = _dt.date.fromisoformat(date)

    def make():
        vkey = _venue_key(OWN_VENUE)
        v = _api(f"/venues/{OWN_VENUE}", headers={"X-Venue-Key": vkey})
        if not v.get("canCreate"):
            raise RuntimeError("Το κτήμα μας δεν επιτρέπει νέο γάμο τώρα — έληξε η άδεια ή το όριο.")
        r = _api(f"/venues/{OWN_VENUE}/weddings", "POST", {"label": name, "date": date}, {"X-Venue-Key": vkey})
        link = f"{BASE}/seating-planner-el.html?plan={r['planId']}#key={r['editKey']}"
        _clip(link)
        return (f"Δημιουργήθηκε ο γάμος «{name}» στις {d.day}/{d.month}/{d.year} στο {vname}. "
                "Ο σύνδεσμος του ζευγαριού είναι στο πρόχειρο του υπολογιστή και στην κονσόλα κτήματος.")

    return _arm(f"τον γάμο «{name}»", key, make, task,
                f"Να φτιάξω γάμο «{name}», {d.day}/{d.month}/{d.year}, στο {vname};")


def takeaseat_new_venue(value: str = "", task: str = "", **_):
    """Creates nothing: proposes onboarding a new customer venue. takeaseat_confirm does the POST."""
    _refuse_delete_or_no(value, task, "φτιάξε κτήμα Κτήμα Ηλιοβασίλεμα")
    task = _without_app(task)
    name = _clean_name(value) or _clean_name(_name_from(task)) or ("Νέο κτήμα " + _dt.datetime.now().strftime("%d/%m %H:%M"))
    key = "venue:" + name.lower()
    if _done_lately(key):
        return "Ήδη έγινε πριν λίγο: " + _done_lately(key)
    today = _dt.date.today()
    end = today + _dt.timedelta(days=365)
    lic = {"type": "seasonal", "seasonStart": today.isoformat(), "seasonEnd": end.isoformat(), "cap": 0}

    def make():
        r = _owner("/admin/venues", "POST", {"name": name, "contact": "", "license": lic})
        if not r.get("key"):   # created with an email while mail is on: the venue sets its own key from the e-mailed link
            return f"Δημιουργήθηκε το κτήμα «{name}». Ο σύνδεσμος ρύθμισης κωδικού στάλθηκε στο email του κτήματος."
        _clip(f"Κονσόλα: {BASE}/venue.html\nΚωδικός: {r.get('key', '')}")
        return (f"Δημιουργήθηκε το κτήμα «{name}» με εποχιακή άδεια έως {lic['seasonEnd']}. "
                f"Ο κωδικός του είναι στο πρόχειρο του υπολογιστή — είναι πελάτης, δεν θα γράψω μέσα του.")

    return _arm(f"το κτήμα «{name}»", key, make, task,
                f"Να φτιάξω νέο κτήμα-πελάτη «{name}» με εποχιακή άδεια έως {end.day}/{end.month}/{end.year};")


def takeaseat_confirm(value: str = "", task: str = "", **_):
    """The second step: creates the ONE proposal that is waiting — only if it is still fresh, only on a sentence that
    is the confirm phrase and nothing else (no question, no «later», no no — _plain_confirm), names TakeaSeat and no
    other app, and came after he heard the proposal."""
    said = f"{task} {value}"
    if _asks_to_delete(said) or _negated(said):
        what = _disarm()
        return (f"Εντάξει, ακύρωσα την πρόταση για {what} — δεν έφτιαξα τίποτα." if what
                else "Δεν περίμενε τίποτα στο TakeaSeat — δεν έφτιαξα τίποτα.")
    say_it = f"Για να γίνει, πείτε μόνο «{CONFIRM_PHRASE}»."
    with _pending_lock:
        waiting = _pending.get("what", "") if _pending and time.monotonic() - _pending["at"] <= PENDING_SECONDS else ""
    if _asks(task, value):   # «τι επιβεβαιώνω στο TakeaSeat;» — answered, never taken as a yes
        raise RuntimeError((f"Περιμένει επιβεβαίωση: {waiting}. " if waiting else "Δεν περιμένει τίποτα στο TakeaSeat. ")
                           + f"Δεν έφτιαξα τίποτα. {say_it if waiting else ''}".rstrip())
    other = _other_app_named(said)
    if other:
        raise RuntimeError(f"Ακούστηκε και το {other} — δεν έφτιαξα τίποτα. {say_it}")
    if not _plain_confirm(said) or not _names_us(said):   # «… αύριο», «… μετά», "wait, confirm TakeaSeat later"
        raise RuntimeError(f"Δεν έφτιαξα τίποτα. {say_it}")
    now = time.monotonic()
    with _pending_lock:
        p = dict(_pending)
        if not p:
            raise RuntimeError("Καμία δημιουργία δεν περιμένει επιβεβαίωση στο TakeaSeat — δεν έφτιαξα τίποτα.")
        if now - p["at"] > PENDING_SECONDS:
            _pending.clear()
            raise RuntimeError(f"Η πρόταση για {p['what']} έληξε — δεν έφτιαξα τίποτα. Ζητήστε τη ξανά αν τη θέλετε.")
        if now - p["at"] < CONFIRM_GAP_SECONDS or _squash(_without_app(task)) == p["heard"]:
            raise RuntimeError(f"Η επιβεβαίωση πρέπει να έρθει από εσάς, αφού ακούσετε την πρόταση — δεν έφτιαξα τίποτα ακόμη. {say_it}")
        _pending.clear()   # taken out BEFORE it runs: a retry of this confirm finds nothing and creates nothing
    return _dedupe(p["key"], p["make"])


# How Hermes picks an action (hermes.appbridge.match): every 4+ letter word of an action's NAME and describe is looked
# for as a SUBSTRING of his whole sentence with the spaces squeezed out; a word two of our actions share counts for
# nothing; and this shim is always live while other apps sleep, so our words also take their sentences. Hence:
#  - The two proposals hold only run-together IMPERATIVE phrases («φτιάξεγάμο» hears «φτιάξε γάμο», "createawedding"
#    hears "create a wedding" — do NOT split them) and an explanation both share word for word (so it counts for
#    nothing). No noun phrase: «νέοςγάμος», "newwedding", "newvenue", «νέοκτήμα» are inside questions («ποιος είναι
#    ο νέος γάμος στις 12/9», "is there a new venue") and delete requests ("drop the new wedding"). Never a bare
#    «γάμος», «ζευγάρι», «κτήμα», «πελάτη», "wedding", "venue", "couple", "client" either («σβήσε το ζευγάρι Μαρία»
#    created a wedding; "revenue" holds "venue"; Education's «νέος πελάτης»). The shim refuses questions anyway.
#  - "wedding" and "venue", the words of those two action NAMES, are repeated in the two list questions so they count
#    for nothing; "seat" twice too, because «TakeaSeat» holds it and run_action appends the app name to every sentence.
#  - The confirm (name and describe) holds only the whole phrase run together WITH our name («επιβεβαιώνωστοTakeaSeat»,
#    "confirmTakeaSeat"): a bare «επιβεβαιώνω» or "confirm" is every app's gate word, and with those apps asleep it
#    took their sentences («επιβεβαιώνω στην Αμελί» never woke Amelie). Nothing may contain a bare «επιβεβαιώνω» or
#    "confirm" — hence the name takeaseat_confirmtakeaseat.
#  - No bare function words («είναι», «πόσα», «στον», «χωρίς»): each one took other apps' sentences — «χωρίςθέση» and
#    "noseat" are run together for the same reason.
# Run sim_match.py after changing any of them.
_PROPOSAL_ONLY = " — μόνο πρόταση, χρειάζεται δεύτερη φράση / proposal only, needs a second phrase"
ACTIONS = {
    "takeaseat_site_health": (takeaseat_site_health, "λειτουργεί το TakeaSeat, online η σελίδα / is TakeaSeat online, is the site working"),
    "takeaseat_venues": (takeaseat_venues, "τα κτήματα-πελάτες που έχουμε στο TakeaSeat / how many venues customers do we have, venue list, list clients"),
    "takeaseat_weddings": (takeaseat_weddings, "λίστα γάμων στο Jockey, πόσους γάμους έχουμε / wedding list at Jockey, our own weddings"),
    "takeaseat_seating_progress": (takeaseat_seating_progress, "πρόοδος τραπεζολογίου, πόσοι καλεσμένοι έχουν θέση / seating progress, how many guests are seated"),
    "takeaseat_unseated_guests": (takeaseat_unseated_guests, "ποιοι καλεσμένοι λείπουν, ονόματα που δεν έχουν θέση, χωρίςθέση / which names are still missing a seat, hasnoseat, noseat"),
    "takeaseat_empty_tables": (takeaseat_empty_tables, "ποια τραπέζια έχουν κενές θέσεις, άδεια τραπέζια / which tables have free seats, a free seat, empty tables"),
    "takeaseat_last_change": (takeaseat_last_change, "πότε άλλαξε τελευταία φορά το πλάνο / when was the seating plan last updated"),
    "takeaseat_open_editor": (takeaseat_open_editor, "άνοιξε τον επεξεργαστή τραπεζιών, υπολογιστή / open the seating editor on the PC"),
    "takeaseat_open_lab": (takeaseat_open_lab, "άνοιξε το εργαστήριο δοκιμών / open the seating sandbox laboratory"),
    "takeaseat_new_wedding": (takeaseat_new_wedding, "δημιούργησενέογάμο, δημιούργησεγάμο, δημιούργησεέναγάμο, φτιάξενέογάμο, φτιάξεγάμο, φτιάξεέναγάμο / createanewwedding, createnewwedding, createawedding, createwedding" + _PROPOSAL_ONLY),
    "takeaseat_new_venue": (takeaseat_new_venue, "δημιούργησενέοκτήμα, δημιούργησεκτήμα, δημιούργησεένακτήμα, φτιάξενέοκτήμα, φτιάξεκτήμα, φτιάξεένακτήμα / createanewvenue, createnewvenue, createavenue, createvenue, onboardaclient, onboardanewclient" + _PROPOSAL_ONLY),
    CONFIRM_ACTION: (takeaseat_confirm, "επιβεβαιώνωστοTakeaSeat, επιβεβαιώνωTakeaSeat / confirmTakeaSeat, confirminTakeaSeat"),
}


def _already_running(name: str) -> bool:
    """True if another instance of this app already answers its registered port.
    Two processes of one app share one registration file and clobber each other (logbook, 2026-09-08)."""
    try:
        safe = "".join(c if c.isalnum() or c in "-_" else "-" for c in name).strip("-")
        p = Path(os.environ.get("LOCALAPPDATA", Path.home() / "AppData" / "Local")) / "Hermes" / "apps" / f"{safe}.json"
        reg = json.loads(p.read_text(encoding="utf-8"))
        if int(reg.get("pid", 0)) == os.getpid():
            return False
        with urllib.request.urlopen(f"http://127.0.0.1:{int(reg['port'])}/actions", timeout=2) as r:
            return json.loads(r.read().decode("utf-8")).get("name") == name
    except Exception:
        return False


if __name__ == "__main__":
    if _already_running("TakeaSeat τραπεζολόγιο"):
        sys.exit(0)   # the Startup shortcut and a manual launch must not both register
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
