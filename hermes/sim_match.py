"""Voice-routing simulation for the TakeaSeat Hermes actions — a manual check, not a unit test.

Runs Hermes's REAL matcher (hermes.appbridge.match, a pure function) against every app registered on this PC
(%LOCALAPPDATA%\\Hermes\\apps, read only) plus TakeaSeat's ACTIONS as they are in takeaseat_control.py now —
and, for comparison, TakeaSeat's ACTIONS as they were before the two-step creation (BASELINE below, a literal copy of
git HEAD 2026-09-21). The baseline is pinned on purpose: the registration file holds whatever the running shim has,
so after a restart it equals the new ACTIONS and a comparison with it can never show a regression. Nothing is
called: no app, no API, no network.

The three ways run_action (C:\\Users\\andre\\hermes\\hermes\\tools\\actions.py) reaches the matcher:
  1. the bare sentence, every app live;
  2. the sentence with the app name folded in (the orchestrator named TakeaSeat: run_action appends `app`);
  3. another app ASLEEP while TakeaSeat is live: Hermes wakes a sleeping app only when no LIVE app matches,
     and this shim is always live — so no TakeaSeat word may take what he says to a sleeping app, and above
     all no WRITE action (new_wedding, new_venue, confirm) may. Checked with one app asleep at a time, with
     the apps that confirm by voice asleep together, and with EVERY other app asleep (TakeaSeat alone live).

Run it with the Hermes venv (appbridge imports httpx) after changing any describe, or after another app
adds actions:
  C:\\Users\\andre\\hermes\\.venv\\Scripts\\python hermes\\sim_match.py [-v]
Exits 1 on any problem.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, os.environ.get("HERMES_DIR", r"C:\Users\andre\hermes"))
from hermes import appbridge as ab  # noqa: E402

sys.path.insert(1, str(HERE))
import takeaseat_control as tc  # noqa: E402  (imports only: nothing is started or called)

if hasattr(sys.stdout, "reconfigure"):   # a cp1252 console cannot print the Greek sentences
    sys.stdout.reconfigure(encoding="utf-8")

APP = "TakeaSeat τραπεζολόγιο"
WRITES = {"takeaseat_new_wedding", "takeaseat_new_venue", tc.CONFIRM_ACTION}
# TakeaSeat's actions before the two-step creation (git HEAD of 2026-09-21) — what the 11 questions / navigation
# actions must keep routing like. Do not refresh it from the registration file (see the docstring).
BASELINE = {
    "takeaseat_site_health": "λειτουργεί το TakeaSeat, είναι online η σελίδα / is TakeaSeat online, is the site working",
    "takeaseat_venues": "πόσα κτήματα πελάτες έχουμε στο TakeaSeat / how many venues customers do we have, list clients",
    "takeaseat_weddings": "λίστα γάμων στο Jockey, πόσους γάμους έχουμε / weddings list at Jockey, our own weddings",
    "takeaseat_seating_progress": "πρόοδος τραπεζολογίου, πόσοι καλεσμένοι έχουν θέση / seating progress, how many guests are seated",
    "takeaseat_unseated_guests": "ποιοι καλεσμένοι λείπουν, ονόματα χωρίς θέση / which names are still missing a seat",
    "takeaseat_empty_tables": "ποια τραπέζια έχουν κενές θέσεις, άδεια τραπέζια / which tables have free seats, empty tables",
    "takeaseat_last_change": "πότε άλλαξε τελευταία φορά το πλάνο / when was the seating plan last updated",
    "takeaseat_open_editor": "άνοιξε τον επεξεργαστή τραπεζιών στον υπολογιστή / open the seating editor in the browser",
    "takeaseat_open_lab": "άνοιξε το εργαστήριο δοκιμών / open the seating sandbox laboratory",
    "takeaseat_new_wedding": "δημιούργησε νέο γάμο για ζευγάρι / create a new wedding for a couple",
    "takeaseat_new_venue": "δημιούργησε νέο κτήμα πελάτη / create a new venue customer, onboard a client",
}
new = {"name": APP, "port": 1, "actions": [{"name": k, "describe": d} for k, (_f, d) in tc.ACTIONS.items()]}
old = {"name": APP, "port": 1, "actions": [{"name": k, "describe": d} for k, d in BASELINE.items()]}
READS = set(BASELINE) - WRITES
others = [e for e in ab.published() if e["name"] != APP]

S = "takeaseat_"
# (sentence, what it must land on: an action of ours, "-" = not ours at all, "!w" = not one of our WRITE actions
#  [, what the BARE sentence may land on instead — only where it tied with another app's word in the baseline too:
#     the orchestrator then names TakeaSeat, and the "named" pass holds it to the first value])
T = [
    # the 11 questions / navigation actions — must route as before
    ("λειτουργεί το TakeaSeat", S + "site_health"),
    ("είναι online η σελίδα", S + "site_health", "none"),
    ("is TakeaSeat online", S + "site_health"),
    ("is the site working", S + "site_health", "none"),
    ("πόσα κτήματα πελάτες έχουμε", S + "venues"),
    ("πόσους πελάτες έχουμε στο TakeaSeat", S + "venues"),
    ("how many venues customers do we have", S + "venues"),
    ("list clients", S + "venues", "none"),
    ("λίστα γάμων στο Jockey", S + "weddings"),
    ("πόσους γάμους έχουμε", S + "weddings"),
    ("our own weddings", S + "weddings"),
    ("weddings list at Jockey", S + "weddings"),
    ("πρόοδος τραπεζολογίου", S + "seating_progress"),
    ("πόσοι καλεσμένοι έχουν θέση", S + "seating_progress"),
    ("seating progress", S + "seating_progress", "none"),
    ("how many guests are seated", S + "seating_progress"),
    ("ποιοι καλεσμένοι λείπουν", S + "unseated_guests"),
    ("ονόματα χωρίς θέση", S + "unseated_guests"),
    ("καλεσμένοι χωρίς θέση", S + "unseated_guests"),
    ("χωρίς θέση", S + "unseated_guests"),
    ("who has no seat", S + "unseated_guests"),
    ("which names are still missing a seat", S + "unseated_guests"),
    ("ποια τραπέζια έχουν κενές θέσεις", S + "empty_tables"),
    ("άδεια τραπέζια", S + "empty_tables"),
    ("which tables have free seats", S + "empty_tables"),
    ("πότε άλλαξε τελευταία φορά το πλάνο", S + "last_change", "none"),
    ("when was the seating plan last updated", S + "last_change"),
    ("άνοιξε τον επεξεργαστή τραπεζιών στον υπολογιστή", S + "open_editor"),
    ("open the seating editor in the browser", S + "open_editor|none|other:Auto Advertizer Διαφημιστή/profiles_health"),
    ("open the seating editor", S + "open_editor"),
    ("άνοιξε το εργαστήριο δοκιμών", S + "open_lab"),
    ("open the seating sandbox laboratory", S + "open_lab"),
    # creation requests → the PROPOSAL (nothing is created until the confirm)
    ("δημιούργησε νέο γάμο για το ζευγάρι Μαρία και Νίκος στις 12 Σεπτεμβρίου 2027", S + "new_wedding"),
    ("νέος γάμος Μαρία και Νίκος στις 12 Σεπτεμβρίου", "!w"),   # a noun phrase is not a creation by words any more (say «φτιάξε γάμο …»)
    ("φτιάξε γάμο για την Ελένη και τον Γιώργο στις 5/6/2027 στο Jockey", S + "new_wedding"),
    ("φτιάξε νέο γάμο για τη Μαρία και τον Νίκο", S + "new_wedding"),
    ("create a new wedding for Maria and Nikos on 12 September 2027", S + "new_wedding"),
    ("δημιούργησε νέο κτήμα πελάτη Κτήμα Ηλιοβασίλεμα", S + "new_venue"),
    ("νέος πελάτης Κτήμα Ηλιοβασίλεμα", S + "new_venue|none"),   # «νέος πελάτης» is Education's too: not by words
    ("δημιούργησε νέο κτήμα Ηλιοβασίλεμα στο TakeaSeat", S + "new_venue"),
    ("TakeaSeat new wedding Maria and Nikos 12/9/2027", S + "new_wedding|none"),   # only through the action's own name
    ("create a new venue customer Sunset Estate", S + "new_venue"),
    ("onboard a client Sunset Estate", S + "new_venue|none|" + S + "venues"),   # "client" is Education's too: not by words
    # the second step
    ("επιβεβαιώνω στο TakeaSeat", tc.CONFIRM_ACTION),
    ("confirm TakeaSeat", tc.CONFIRM_ACTION),
    ("confirm in TakeaSeat", tc.CONFIRM_ACTION),
    # delete / remove / cancel: never a write action of ours by words (the shim refuses them anyway)
    ("σβήσε το ζευγάρι Μαρία", "!w"),
    ("σβήσε το ζευγάρι Μαρία στις 12/9", "!w"),
    ("διέγραψε τον γάμο της Μαρίας και του Νίκου", "!w"),
    ("ακύρωσε τον γάμο στο Jockey", "!w"),
    ("αφαίρεσε το κτήμα Ηλιοβασίλεμα", "!w"),
    ("delete the couple Maria", "!w"),
    ("remove the wedding for Maria and Nikos", "!w"),
    ("σβήσε οριστικά το ζευγάρι Μαρία και Νίκος", "!w"),
    ("drop the new wedding for Maria on 12/9", "!w"),
    ("scrap the new wedding for Maria on 12/9", "!w"),
    ("get rid of the new wedding for Maria on 12/9", "!w"),
    ("πέτα τον νέος γάμος 12/9", "!w"),
    ("clear the new venue Sunset Estate", "!w"),
    ("kill the new venue Sunset", "!w"),
    ("σβύσε το ζευγάρι Μαρία στις 12/9", "!w"),
    ("βγάλε το ζευγάρι Μαρία στις 12/9", "!w"),
    # questions about weddings/couples/venues: never a write action
    ("πότε είναι ο επόμενος γάμος", "!w"),
    ("πόσοι έρχονται στον γάμο της Μαρίας στις 12 Σεπτεμβρίου", "!w"),
    ("ποιο κτήμα έχει γάμο το Σάββατο", "!w"),
    ("τι γίνεται με το ζευγάρι Μαρία και Νίκος", "!w"),
    ("what's the next wedding", "!w"),
    ("which venue is the wedding at", "!w"),
    ("στείλε στον πελάτη τον σύνδεσμο", "!w"),
    ("τι κάνουν οι νεόγαμοι", "!w"),
    ("ποιος είναι ο νέος γάμος στις 12/9", "!w"),
    ("πότε είναι ο νέος γάμος της Μαρίας στις 12/9", "!w"),
    ("υπάρχει νέος γάμος 12/9;", "!w"),
    ("is there a new wedding on 12/9", "!w"),
    ("when is the new wedding on 12/9", "!w"),
    ("any new wedding on 12/9?", "!w"),
    ("is there a new venue", "!w"),
    ("ποιο είναι το νέο κτήμα", "!w"),
    ("how is the new venue Sunset doing", "!w"),
    ("what's the new venue called", "!w"),
    # Amelie-style sentences
    ("φέρε τις απαντήσεις από την Amelie", "!w"),
    ("φέρε τις απαντήσεις από την Amelie στο TakeaSeat", "!w"),
    ("βάλε τους καλεσμένους της Amelie στο πλάνο", "!w"),
    ("πόσοι απάντησαν στο προσκλητήριο της Μαρίας", "!w"),
    ("επιβεβαιώνω στην Αμελί", "-"),
    ("άκυρο στην Αμελί", "-"),
    # the gate's own traps: a negated / foreign confirm must not land on ours by words
    ("επιβεβαιώνω στον λογιστή", "-"),
    ("δεν επιβεβαιώνω", "!w|" + tc.CONFIRM_ACTION),   # named, it reaches our confirm, which hears «δεν» and CANCELS
    ("επιβεβαιώνω", "-"),   # a bare gate word is not ours
    ("confirm", "-"),
    ("confirm the invoice", "-"),
    ("όχι, μην το φτιάξεις", "!w"),
]

# Sentences he says to OTHER apps (besides every describe they publish) — for the asleep check.
EXTRA = {
    "Auto Advertizer": ["σταμάτα τον poster", "πότε είναι ο επόμενος γύρος", "πόσα ποστ έφυγαν σήμερα",
                        "επιβεβαιώνω στον poster", "the countdown to the next step", "πόσες ομάδες έχουμε στην ουρά"],
    "Λογιστή": ["επιβεβαιώνω στον λογιστή", "άκυρο στον λογιστή", "τι χρωστάω στον ΕΦΚΑ", "πόσα έσοδα έχω βγάλει",
                "πόσες αποδείξεις εκκρεμούν", "φτιάξε πρόχειρο τιμολόγιο", "δημιούργησε νέο τιμολόγιο για τον πελάτη"],
    "Notes": ["ποιος γιορτάζει σήμερα", "έχουμε καμιά γιορτή", "γενέθλια που έρχονται", "τι λείπει από το σπίτι",
              "πρόσφατες σημειώσεις", "γράψε μια σημείωση", "τι έχω να κάνω", "what do I have to do today"],
    "Education": ["νέα αιτήματα πελατών", "ποιους να πάρω τηλέφωνο σήμερα", "τάξεις χωρίς καθηγητή",
                  "νέος πελάτης για ιδιαίτερα", "έχουμε νέους πελάτες"],
    "Academic": ["ποια είναι η κατάσταση", "ξεκίνα την ουρά", "δημιούργησε παρουσίαση", "create a new presentation",
                 "delete the entry", "remove the unstarted entry"],
    "IFS": ["άνοιξε τον χώρο εργασίας της Μαρίας", "πες μου το πιο επείγον περιστατικό", "is the flow runtime working"],
    "Amelie": ["πόσοι έρχονται στο γάμο της Μαρίας", "πότε είναι ο επόμενος γάμος", "σβήσε οριστικά το ζευγάρι Μαρία",
               "φτιάξε το προσκλητήριο της Μαρίας και του Νίκου", "νέος σύνδεσμος για το προσκλητήριο της Μαρίας",
               "φέρε τις απαντήσεις από την Amelie", "επιβεβαιώνω στην Αμελί", "άκυρο στην Αμελί",
               "πόσοι απάντησαν στην πρόσκληση", "ποιο ζευγάρι παντρεύεται μετά", "σβήσε την ευχή της Ελένης"],
}

verbose = "-v" in sys.argv
bad = 0


def pick(phrase, entries):
    m = ab.match(entries, phrase)
    if not m:
        return "none"
    return m[1]["name"] if m[0]["name"] == APP else f"other:{m[0]['name']}/{m[1]['name']}"


def ok_for(got, want):
    if want == "-":
        return not got.startswith(S)
    if want.startswith("!w"):
        return got not in WRITES or got in want.split("|")
    return got in want.split("|") or (want.endswith("|none") and got == "none")


def line(tag, ok, text):
    global bad
    bad += not ok
    if not ok or verbose:
        print(f"{'ok ' if ok else 'BAD'} {tag} {text}")


print(f"TakeaSeat: {len(new['actions'])} actions now, {len(old['actions'])} in the pinned baseline; "
      f"{len(others)} other apps: " + ", ".join(e["name"] for e in others))

for mode in ("bare", "named"):
    print(f"== {'bare sentence, every app live' if mode == 'bare' else 'app name folded in (the orchestrator named TakeaSeat)'}")
    for p, want, *bare_alt in T:
        q = p if mode == "bare" else f"{p} {APP}"
        if mode == "bare" and bare_alt:
            want = f"{want}|{bare_alt[0]}"
        if mode == "named" and want in ("-",):
            continue
        got = pick(q, others + [new])
        before = pick(q, others + [old])
        ok = ok_for(got, want)   # no «unchanged» exemption: a read sentence must land where it says, whatever it did before
        line(mode, ok, f"{q!r:78} -> {got:34} (was {before}; want {want})")

def sentences_of(x):
    sents = []
    for a in ab._actions(x):
        d = a["describe"]
        sents.append(d)
        for sep in (" / ", " — ", " - ", ", ", ": "):
            if sep in d:
                sents += [part for part in d.split(sep) if part.strip()]
    for k, extra in EXTRA.items():
        if k.lower() in x["name"].lower():
            sents += extra
    return list(dict.fromkeys(sents))


def asleep(sleepers, label):
    """Every sentence of each sleeping app, bare and with its name, against the apps still live + TakeaSeat."""
    live = [e for e in others if e not in sleepers]
    for x in sleepers:
        for q in sentences_of(x):
            for qq in (q, f"{q} {x['name']}"):
                got = pick(qq, live + [new])
                before = pick(qq, live + [old])
                if not got.startswith(S) and not before.startswith(S):
                    continue
                if got in WRITES:
                    line("STEAL-WRITE", False, f"[{label} asleep] {qq!r} -> {got} (was {before})")
                elif got.startswith(S) and before.startswith(S) and got != before:
                    # stolen before too, by another question of ours: not new — shown, not counted
                    print(f"moved {label}-asleep steal-read {qq!r} -> {got} (was {before})")
                elif got.startswith(S):
                    # a question of ours taking another app's sentence: reported, a problem only if it is new
                    line("steal-read", got == before, f"[{label} asleep] {qq!r} -> {got} (was {before})")
                elif verbose:
                    print(f"fixed [{label} asleep] {qq!r} -> {got} (was {before})")


print("== another app asleep, TakeaSeat live")
for x in others:
    asleep([x], x["name"])
gates = [e for e in others if any(k in e["name"] for k in ("Amelie", "Λογιστή", "Auto Advertizer"))]
print("== the apps that confirm by voice asleep together: " + ", ".join(e["name"] for e in gates))
asleep(gates, "confirming apps")
print("== every other app asleep (TakeaSeat alone live)")
asleep(list(others), "all")

print("problems:", bad)
sys.exit(1 if bad else 0)
