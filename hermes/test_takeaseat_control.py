"""Tests for the TakeaSeat → Hermes shim (takeaseat_control.py): the two-step creation and the delete guard.

Run with the Hermes venv (certifi, dotenv; httpx for the matcher test), from the repo root:
  C:\\Users\\andre\\hermes\\.venv\\Scripts\\python -m unittest discover -s hermes -p "test_*.py"

NOTHING HERE REACHES takeaseat.gr: _api and _owner are replaced by a recording fake for every test, BASE points at
an .invalid host, and urllib's urlopen raises if anything still tries the network. The clipboard is stubbed too.
LOCALAPPDATA points at a throwaway folder (set before hermes_control is imported), so no registration file can be
written into the real %LOCALAPPDATA%\\Hermes\\apps; the apps named in the foreign-app test are written there.
"""
from __future__ import annotations

import atexit
import json
import os
import shutil
import sys
import tempfile
import unittest
import urllib.request
from pathlib import Path
from unittest import mock

HERE = Path(__file__).resolve().parent
_TMP = tempfile.mkdtemp(prefix="takeaseat-hermes-test-")
atexit.register(shutil.rmtree, _TMP, True)
os.environ["LOCALAPPDATA"] = _TMP
sys.path.insert(0, str(HERE))
import takeaseat_control as tc  # noqa: E402
from hermes_control import Control  # noqa: E402

VENUE = "v_test"
BRIDE = "δημιούργησε νέο γάμο για το ζευγάρι Μαρία και Νίκος στις 12 Σεπτεμβρίου 2027"
APP = " TakeaSeat τραπεζολόγιο"   # run_action appends the app name the orchestrator passed
CONFIRM = tc.CONFIRM_ACTION
WRITES = ("takeaseat_new_wedding", "takeaseat_new_venue", CONFIRM)


class FakeTakeaSeat:
    """Stands in for takeaseat.gr: answers the reads, records every call, and creates nothing anywhere."""

    def __init__(self, can_create=True):
        self.calls = []
        self.can_create = can_create

    def api(self, path, method="GET", body=None, headers=None):
        self.calls.append((method, path, body))
        if method == "GET" and path == f"/venues/{VENUE}":
            return {"venue": {"name": "Jockey"}, "canCreate": self.can_create, "weddings": []}
        if method == "POST" and path == f"/venues/{VENUE}/weddings":
            return {"planId": "p_fake", "editKey": "k_fake"}
        raise AssertionError(f"unexpected API call {method} {path}")

    def owner(self, path, method="GET", body=None):
        self.calls.append((method, "owner:" + path, body))
        if method == "GET" and path == f"/admin/venues/{VENUE}":
            return {"key": "vk_fake"}
        if method == "POST" and path == "/admin/venues":
            return {"key": "nk_fake"}
        raise AssertionError(f"unexpected owner call {method} {path}")

    def posts(self):
        return [c for c in self.calls if c[0] != "GET"]


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def _no_network(*a, **k):
    raise AssertionError("a test tried to reach the network")


class ShimTest(unittest.TestCase):
    def setUp(self):
        self.fake = FakeTakeaSeat()
        self.clock = Clock()
        tc._pending.clear()
        tc._recent.clear()
        tc._others_cache.clear()
        for p in (
            mock.patch.object(tc, "_api", self.fake.api),
            mock.patch.object(tc, "_owner", self.fake.owner),
            mock.patch.object(tc, "_clip", lambda text: None),
            mock.patch.object(tc, "BASE", "https://takeaseat.invalid"),
            mock.patch.object(tc, "OWN_VENUES", [VENUE]),
            mock.patch.object(tc, "OWN_VENUE", VENUE),
            mock.patch.object(tc, "VENUE_KEY", ""),
            mock.patch.object(tc.time, "monotonic", self.clock),
            mock.patch.object(urllib.request, "urlopen", _no_network),
        ):
            p.start()
            self.addCleanup(p.stop)
        self.control = Control("TakeaSeat τραπεζολόγιο", tc.ACTIONS)   # never started: no server, no file

    def call(self, action, task="", value=""):
        """As Hermes does it: hermes_control passes only the parameters the action declares."""
        params = {"task": task} if task else {}
        if value:
            params["value"] = value
        return self.control._invoke(tc.ACTIONS[action][0], params)

    def later(self, seconds):
        self.clock.t += seconds

    # ── the bug ───────────────────────────────────────────────────────────────
    def test_the_bug_sentence_creates_nothing(self):
        for task in ("σβήσε το ζευγάρι Μαρία", "σβήσε το ζευγάρι Μαρία στις 12/9", "σβήσε το ζευγάρι Μαρία" + APP):
            with self.assertRaisesRegex(RuntimeError, "δεν σβήνω"):
                self.call("takeaseat_new_wedding", task)
        self.assertEqual(self.fake.calls, [])
        self.assertEqual(tc._pending, {})

    def test_every_delete_word_is_refused_by_both_proposals(self):
        sentences = [
            "σβήσε τον γάμο Μαρία και Νίκος στις 12/9", "ΣΒΗΣΕ τον γάμο Μαρία στις 12/9", "σβησε γαμο Μαρια 12/9",
            "διέγραψε τον γάμο της Μαρίας στις 12/9", "διαγραφή γάμου Μαρία 12/9/2027", "διάγραψε Μαρία 12/9",
            "αφαίρεσε τον γάμο Μαρία στις 12/9", "ακύρωσε τον γάμο της Μαρίας στις 12/9", "άκυρο ο γάμος 12/9",
            "κατάργησε τον γάμο 12/9", "ξέχνα τον νέο γάμο Μαρία 12/9",
            "delete the wedding for Maria on 12/9/2027", "Remove the couple Maria 12/9", "cancel the new wedding 12/9",
            "erase Maria's wedding 12/9", "wipe the wedding 12/9",
            # review 2026-09-22: these used to get a proposal
            "drop the new wedding for Maria on 12/9", "scrap the new wedding for Maria on 12/9",
            "get rid of the new wedding for Maria on 12/9", "πέτα τον νέος γάμος 12/9", "Πέτα τον γάμο Μαρία 12/9",
            "clear the new venue Sunset Estate 12/9", "kill the new venue Sunset 12/9",
            "σβύσε το ζευγάρι Μαρία στις 12/9", "βγάλε το ζευγάρι Μαρία στις 12/9", "trash the wedding 12/9", "purge Maria 12/9",
        ]
        for task in sentences:
            for action in ("takeaseat_new_wedding", "takeaseat_new_venue"):
                with self.subTest(task=task, action=action), self.assertRaisesRegex(RuntimeError, "δεν σβήνω"):
                    self.call(action, task + APP)
        self.assertEqual(self.fake.calls, [])

    def test_a_delete_sentence_also_drops_a_waiting_proposal(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.assertTrue(tc._pending)
        with self.assertRaises(RuntimeError):
            self.call("takeaseat_new_wedding", "σβήσε τον γάμο της Μαρίας" + APP)
        self.assertEqual(tc._pending, {})
        self.later(30)
        with self.assertRaisesRegex(RuntimeError, "Καμία δημιουργία"):
            self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertEqual(self.fake.posts(), [])

    def test_a_negated_request_proposes_nothing(self):
        for task in ("μην φτιάξεις νέο γάμο Μαρία στις 12/9", "όχι, νέος γάμος Μαρία 12/9", "don't create a new wedding 12/9"):
            with self.subTest(task=task), self.assertRaisesRegex(RuntimeError, "άρνηση"):
                self.call("takeaseat_new_wedding", task + APP)
        self.assertEqual(self.fake.calls, [])

    # ── two steps: propose, then confirm ──────────────────────────────────────
    def test_propose_reads_only_and_says_what_it_would_create(self):
        said = self.call("takeaseat_new_wedding", BRIDE + APP)
        self.assertEqual(said, "Να φτιάξω γάμο «Μαρία και Νίκος», 12/9/2027, στο Jockey; "
                               "Αν ναι, πείτε «επιβεβαιώνω στο TakeaSeat» μέσα σε 3 λεπτά.")
        self.assertEqual(self.fake.posts(), [])
        self.assertTrue(all(c[0] == "GET" for c in self.fake.calls))

    def test_confirm_creates_exactly_once(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(25)
        said = self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertTrue(said.startswith("Δημιουργήθηκε ο γάμος «Μαρία και Νίκος» στις 12/9/2027 στο Jockey."), said)
        self.assertEqual(self.fake.posts(), [("POST", f"/venues/{VENUE}/weddings", {"label": "Μαρία και Νίκος", "date": "2027-09-12"})])
        self.assertEqual(tc._pending, {})
        self.later(5)   # Hermes retries: the second confirm finds nothing
        with self.assertRaisesRegex(RuntimeError, "Καμία δημιουργία"):
            self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertEqual(len(self.fake.posts()), 1)
        # …and the same request again within 2 minutes does not propose a duplicate
        self.assertTrue(self.call("takeaseat_new_wedding", BRIDE + APP).startswith("Ήδη έγινε πριν λίγο"))
        self.assertEqual(tc._pending, {})

    def test_confirm_in_english_and_as_value(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(20)
        self.call(CONFIRM, "confirm in TakeaSeat")
        self.assertEqual(len(self.fake.posts()), 1)

    def test_expired_proposal_creates_nothing(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(tc.PENDING_SECONDS + 1)
        with self.assertRaisesRegex(RuntimeError, "έληξε"):
            self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertEqual(tc._pending, {})
        self.assertEqual(self.fake.posts(), [])

    def test_nothing_pending_creates_nothing(self):
        with self.assertRaisesRegex(RuntimeError, "Καμία δημιουργία"):
            self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertEqual(self.fake.calls, [])

    def test_a_confirm_chained_at_once_is_refused_and_the_proposal_kept(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(2)
        with self.assertRaisesRegex(RuntimeError, "από εσάς"):
            self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertTrue(tc._pending)
        self.later(30)
        self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertEqual(len(self.fake.posts()), 1)

    def test_confirm_with_the_request_sentence_is_refused(self):
        """The orchestrator re-sending his creation sentence to the confirm is not a confirmation."""
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(30)
        with self.assertRaisesRegex(RuntimeError, "επιβεβαιώνω στο TakeaSeat"):
            self.call(CONFIRM, BRIDE + APP)
        one_breath = "φτιάξε γάμο Μαρία και Νίκος στις 12/9/2027 επιβεβαιώνω στο TakeaSeat"
        self.call("takeaseat_new_wedding", one_breath + APP)
        self.later(30)
        with self.assertRaisesRegex(RuntimeError, "πείτε μόνο"):   # more than the phrase: refused before the "heard" check
            self.call(CONFIRM, one_breath + APP)
        self.assertTrue(tc._pending)
        with mock.patch.object(tc, "_plain_confirm", lambda text: True):   # the second lock alone: his own sentence again
            with self.assertRaisesRegex(RuntimeError, "από εσάς"):
                self.call(CONFIRM, one_breath + APP)
        self.assertEqual(self.fake.posts(), [])

    def test_confirm_needs_our_name_and_no_other_app(self):
        apps = Path(_TMP) / "Hermes" / "apps"
        apps.mkdir(parents=True, exist_ok=True)
        (apps / "Λογιστή.json").write_text(json.dumps({"name": "Λογιστή", "port": 1}), encoding="utf-8")
        tc._others_cache.clear()
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(30)
        with self.assertRaisesRegex(RuntimeError, "Λογιστή"):
            self.call(CONFIRM, "επιβεβαιώνω στον λογιστή")
        with self.assertRaisesRegex(RuntimeError, "πείτε μόνο"):
            self.call(CONFIRM, "επιβεβαιώνω")
        self.assertTrue(tc._pending)
        self.assertEqual(self.fake.posts(), [])

    def test_no_or_cancel_at_the_confirm_drops_the_proposal(self):
        for task in ("δεν επιβεβαιώνω στο TakeaSeat", "όχι, μην επιβεβαιώσεις στο TakeaSeat", "άκυρο στο TakeaSeat",
                     "σβήσε το, επιβεβαιώνω στο TakeaSeat", "don't confirm TakeaSeat"):
            with self.subTest(task=task):
                self.call("takeaseat_new_wedding", BRIDE + APP)
                self.later(30)
                self.assertIn("ακύρωσα την πρόταση", self.call(CONFIRM, task))
                self.assertEqual(tc._pending, {})
        self.assertEqual(self.fake.posts(), [])

    # ── review 2026-09-22: the confirm is the phrase and nothing else ─────────
    def test_a_question_deferral_or_english_negation_at_the_confirm_creates_nothing(self):
        cancel = ["I won't confirm TakeaSeat", "I can't confirm TakeaSeat yet", "I cannot confirm TakeaSeat",
                  "I shouldn't confirm TakeaSeat", "I wont confirm TakeaSeat", "δεν επιβεβαιώνω", "I'd rather not confirm TakeaSeat"]
        keep = ["τι επιβεβαιώνω στο TakeaSeat;", "τι ακριβώς επιβεβαιώνω στο TakeaSeat", "γιατί επιβεβαιώνω στο TakeaSeat;",
                "επιβεβαιώνω στο TakeaSeat;", "επιβεβαιώνω στο TakeaSeat αύριο", "επιβεβαιώνω στο TakeaSeat μετά",
                "wait, confirm TakeaSeat later", "should I confirm TakeaSeat?", "what do I confirm in TakeaSeat",
                "επιβεβαιώνω στο TakeaSeat τον άλλο γάμο", "confirm TakeaSeat and the invoice"]
        for task in cancel + keep:
            for tail in ("", APP):
                with self.subTest(task=task + tail):
                    tc._pending.clear()
                    self.call("takeaseat_new_wedding", BRIDE + APP)
                    self.later(40)
                    try:
                        said = self.call(CONFIRM, task + tail)
                    except RuntimeError as e:
                        said = str(e)
                    self.assertRegex(said, "[Δδ]εν έφτιαξα τίποτα")
                    if task in cancel:
                        self.assertEqual(tc._pending, {})    # a no drops the proposal
                    else:
                        self.assertTrue(tc._pending)          # a question / «later» keeps it for the real yes
        self.assertEqual(self.fake.posts(), [])
        # …and the real phrase still works afterwards
        self.later(5)
        self.assertTrue(self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP).startswith("Δημιουργήθηκε ο γάμος"))
        self.assertEqual(len(self.fake.posts()), 1)

    def test_the_question_at_the_confirm_says_what_is_waiting(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.later(40)
        with self.assertRaisesRegex(RuntimeError, "Περιμένει επιβεβαίωση: τον γάμο «Μαρία και Νίκος»"):
            self.call(CONFIRM, "τι επιβεβαιώνω στο TakeaSeat;" + APP)
        self.assertEqual(self.fake.posts(), [])

    def test_the_confirm_phrase_variants_that_do_confirm(self):
        for task in ("επιβεβαιώνω στο TakeaSeat", "ναι, επιβεβαιώνω στο TakeaSeat.", "confirm TakeaSeat", "yes, confirm in TakeaSeat",
                     "OK confirm Take a Seat", "επιβεβαιώνω TakeaSeat"):
            with self.subTest(task=task):
                tc._pending.clear(); tc._recent.clear()
                self.call("takeaseat_new_wedding", BRIDE + APP)
                self.later(40)
                self.assertTrue(self.call(CONFIRM, task + APP).startswith("Δημιουργήθηκε ο γάμος"), task)
        self.assertEqual(len(self.fake.posts()), 6)

    # ── review 2026-09-22: a question never proposes ──────────────────────────
    def test_questions_propose_nothing(self):
        wedding_q = ["ποιος είναι ο νέος γάμος στις 12/9", "πότε είναι ο νέος γάμος της Μαρίας στις 12/9", "υπάρχει νέος γάμος 12/9;",
                     "is there a new wedding on 12/9", "when is the new wedding on 12/9", "any new wedding on 12/9?",
                     "πού είναι ο γάμος της Μαρίας στις 12/9", "should I create a wedding for Maria on 12/9"]
        venue_q = ["is there a new venue", "ποιο είναι το νέο κτήμα", "how is the new venue Sunset doing", "what's the new venue called",
                   "πόσα κτήματα φτιάξαμε"]
        for action, qs in (("takeaseat_new_wedding", wedding_q), ("takeaseat_new_venue", venue_q)):
            for q in qs:
                for tail in ("", APP):
                    with self.subTest(q=q + tail), self.assertRaisesRegex(RuntimeError, "ερώτηση"):
                        self.call(action, q + tail)
        self.assertEqual(tc._pending, {})
        self.assertEqual(self.fake.calls, [])

    def test_a_question_does_not_drop_a_waiting_proposal(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        with self.assertRaisesRegex(RuntimeError, "ερώτηση"):
            self.call("takeaseat_new_wedding", "ποιος είναι ο νέος γάμος στις 12/9" + APP)
        self.later(40)
        self.assertTrue(self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP).startswith("Δημιουργήθηκε ο γάμος «Μαρία και Νίκος»"))

    def test_polite_requests_still_propose(self):
        for task in ("can you create a new wedding for Maria and Nikos on 12/9/2027?", "μπορείς να φτιάξεις γάμο για τη Μαρία στις 12/9/2027;",
                     "φτιάξε γάμο για το ζευγάρι Μαρία και Νίκος που παντρεύεται στις 12/9/2027"):
            with self.subTest(task=task):
                self.assertIn("Να φτιάξω γάμο", self.call("takeaseat_new_wedding", task + APP))
        self.assertEqual(self.fake.posts(), [])

    # ── review 2026-09-22: a place that is not ours ───────────────────────────
    def test_a_customer_venue_named_gets_no_proposal(self):
        for task in ("φτιάξε γάμο για τη Μαρία και τον Νίκο στις 12/9/2027 στο Κτήμα Ηλιοβασίλεμα",
                     "create a new wedding for Maria and Nikos on 12 September 2027 at Sunset Estate",
                     "φτιάξε γάμο στην Villa Rosa για τη Μαρία στις 12/9/2027"):
            with self.subTest(task=task), self.assertRaisesRegex(RuntimeError, "δεν είναι δικό μας κτήμα"):
                self.call("takeaseat_new_wedding", task + APP)
        with self.assertRaisesRegex(RuntimeError, "δεν είναι δικό μας κτήμα"):
            self.call("takeaseat_new_wedding", "φτιάξε γάμο στις 12/9/2027" + APP, value="Μαρία και Νίκος στο Κτήμα Ηλιοβασίλεμα")
        self.assertEqual(tc._pending, {})
        self.assertEqual(self.fake.posts(), [])

    def test_our_venue_and_the_date_words_leave_the_couple_name_clean(self):
        cases = {
            "φτιάξε γάμο για τη Μαρία και τον Νίκο στις 12/9/2027 στο Jockey": "Μαρία και τον Νίκο",
            "φτιάξε γάμο στο Jockey για τη Μαρία και τον Νίκο στις 12/9/2027": "Μαρία και τον Νίκο",
            "φτιάξε γάμο για τη Μαρία στις 12/9/2027 και τον Νίκο": "Μαρία και τον Νίκο",
            "φτιάξε γάμο για τη Μαρία στις 12/9/2027 στο Τζόκεϊ": "Μαρία",
            "create a new wedding for Maria and Nikos on 12 September 2027 at Jockey": "Maria and Nikos",
        }
        for task, name in cases.items():
            with self.subTest(task=task):
                tc._pending.clear()
                self.assertIn(f"«{name}», ", self.call("takeaseat_new_wedding", task + APP))
        self.assertEqual(self.fake.posts(), [])

    # ── venues: the same two steps ─────────────────────────────────────────────
    def test_new_venue_is_two_steps_too(self):
        said = self.call("takeaseat_new_venue", "δημιούργησε νέο κτήμα πελάτη Κτήμα Ηλιοβασίλεμα" + APP)
        self.assertTrue(said.startswith("Να φτιάξω νέο κτήμα-πελάτη «Κτήμα Ηλιοβασίλεμα» με εποχιακή άδεια έως "), said)
        self.assertEqual(self.fake.calls, [])   # a proposal of a venue reads nothing
        self.later(30)
        said = self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertTrue(said.startswith("Δημιουργήθηκε το κτήμα «Κτήμα Ηλιοβασίλεμα»"), said)
        posts = self.fake.posts()
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][1], "owner:/admin/venues")
        self.assertEqual(posts[0][2]["name"], "Κτήμα Ηλιοβασίλεμα")

    def test_a_new_proposal_replaces_the_old_one(self):
        self.call("takeaseat_new_wedding", BRIDE + APP)
        self.call("takeaseat_new_venue", "νέο κτήμα Κτήμα Ηλιοβασίλεμα" + APP)
        self.later(30)
        self.call(CONFIRM, "επιβεβαιώνω στο TakeaSeat" + APP)
        self.assertEqual([p[1] for p in self.fake.posts()], ["owner:/admin/venues"])

    # ── the standing rules still hold ────────────────────────────────────────
    def test_never_in_a_venue_we_do_not_own(self):
        with mock.patch.object(tc, "OWN_VENUE", "v_sold"):
            with self.assertRaisesRegex(RuntimeError, "κτήμα πελάτη"):
                self.call("takeaseat_new_wedding", BRIDE + APP)
        self.assertEqual(self.fake.calls, [])

    def test_a_venue_that_cannot_create_gets_no_proposal(self):
        self.fake.can_create = False
        with self.assertRaisesRegex(RuntimeError, "δεν επιτρέπει"):
            self.call("takeaseat_new_wedding", BRIDE + APP)
        self.assertEqual(tc._pending, {})
        self.assertEqual(self.fake.posts(), [])

    def test_the_date_is_still_required(self):
        with self.assertRaisesRegex(RuntimeError, "ημερομηνία"):
            self.call("takeaseat_new_wedding", "νέος γάμος Μαρία και Νίκος" + APP)
        self.assertEqual(self.fake.calls, [])

    def test_the_place_and_app_name_are_not_part_of_the_couple(self):
        said = self.call("takeaseat_new_wedding", "φτιάξε γάμο για την Ελένη και τον Γιώργο στις 5/6/2027 στο Jockey" + APP)
        self.assertIn("«Ελένη και τον Γιώργο», 5/6/2027", said)
        said = self.call("takeaseat_new_wedding", "νέος γάμος Μαρία και Νίκος στις 12/9/2027 στο TakeaSeat")
        self.assertIn("«Μαρία και Νίκος», 12/9/2027", said)

    # ── what Hermes sees ─────────────────────────────────────────────────────
    def test_actions_and_gate_words(self):
        sys.path.insert(0, os.environ.get("HERMES_DIR", r"C:\Users\andre\hermes"))
        from hermes import appbridge as ab
        self.assertEqual(len(tc.ACTIONS), 12)
        words = {k: ab._words(k, d) for k, (_f, d) in tc.ACTIONS.items()}
        owners = lambda w: [k for k, ws in words.items() if w in ws]   # noqa: E731
        # no action of ours holds a bare «επιβεβαιώνω» / "confirm" (every app's gate word): the confirm's words all
        # carry our name, and belong to it alone
        self.assertEqual(owners("επιβεβαιωνω"), [])
        self.assertEqual(owners("confirm"), [])
        self.assertTrue(words[CONFIRM] - {"takeaseat"})
        for w in words[CONFIRM] - {"takeaseat"}:
            self.assertIn("takeaseat", w)
            self.assertEqual(owners(w), [CONFIRM])
        # no word that counts for a proposal is a bare noun, or a noun phrase of a question («νέος γάμος», "new venue")
        for action in ("takeaseat_new_wedding", "takeaseat_new_venue"):
            distinct = {w for w in words[action] if len(owners(w)) == 1}
            for bare in ("γαμοσ", "γαμο", "ζευγαρι", "κτημα", "πελατη", "wedding", "venue", "couple", "client", "customer",
                         "νεοσγαμοσ", "νεοκτημα", "νεοκτημαπελατη", "newwedding", "newvenue"):
                self.assertNotIn(bare, distinct, action)
            self.assertTrue(all(len(w) >= 8 for w in distinct), (action, distinct))
            self.assertTrue(all(w.startswith(("δημιουργησε", "φτιαξε", "create", "onboard")) for w in distinct), (action, distinct))

    def test_hermes_matcher_routes_the_bug_sentence_elsewhere(self):
        sys.path.insert(0, os.environ.get("HERMES_DIR", r"C:\Users\andre\hermes"))
        from hermes import appbridge as ab
        me = {"name": "TakeaSeat τραπεζολόγιο", "port": 1,
              "actions": [{"name": k, "describe": d} for k, (_f, d) in tc.ACTIONS.items()]}
        for sentence in ("σβήσε το ζευγάρι Μαρία", "delete the couple Maria", "remove the wedding for Maria and Nikos"):
            for s in (sentence, sentence + APP):
                hit = ab.match([me], s)
                self.assertFalse(hit and hit[1]["name"] in WRITES, s)
        self.assertEqual(ab.match([me], BRIDE)[1]["name"], "takeaseat_new_wedding")
        self.assertEqual(ab.match([me], "επιβεβαιώνω στο TakeaSeat")[1]["name"], CONFIRM)
        self.assertEqual(ab.match([me], "confirm TakeaSeat")[1]["name"], CONFIRM)
        # a bare gate word, or another app's confirm, is not ours (the app it belongs to must be woken)
        for s in ("επιβεβαιώνω", "confirm", "επιβεβαιώνω στην Αμελί", "επιβεβαιώνω στην Αμελί Αμελί Amelie", "confirm the invoice"):
            self.assertIsNone(ab.match([me], s), s)
        # questions that used to land on a proposal («νέος γάμος», "new venue" in the describes)
        for s in ("ποιος είναι ο νέος γάμος στις 12/9", "πότε είναι ο νέος γάμος της Μαρίας στις 12/9", "υπάρχει νέος γάμος 12/9;",
                  "is there a new wedding on 12/9", "when is the new wedding on 12/9", "any new wedding on 12/9?", "is there a new venue",
                  "ποιο είναι το νέο κτήμα", "how is the new venue Sunset doing", "what's the new venue called",
                  "drop the new wedding for Maria on 12/9", "clear the new venue Sunset Estate", "kill the new venue Sunset"):
            for q in (s, s + APP):
                hit = ab.match([me], q)
                self.assertFalse(hit and hit[1]["name"] in WRITES, q)
        # the unseated question again has a word of its own
        for s in ("καλεσμένοι χωρίς θέση", "χωρίς θέση", "who has no seat"):
            for q in (s, s + APP):
                self.assertEqual(ab.match([me], q)[1]["name"], "takeaseat_unseated_guests", q)


if __name__ == "__main__":
    unittest.main()
