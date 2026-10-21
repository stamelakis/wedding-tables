# TakeaSeat — STATUS

Updated: 2026-10-21

**Status:** Live runs `ce16a3e` (deployed 2026-10-21, tag `deploy-2026-10-21-4`), healthy. Operations phases 1–3
are live; terms.html and privacy.html now name the γιορτή in §0 and everywhere else, after Andreas read the Greek.

## In progress / unfinished

- Nothing half-done.
- Party plans created before 2026-10-17 keep the label «Τραπέζι της γιορτής» until the customer renames it
  (deliberately not rewritten on load). Converting such a plan to another kind still works (LEGACY_HEADS).

## Next

1. **Operations phase 4: every contact lands in your sheet** (`OPERATIONS-PLAN.md` §4). Phases 5–6 follow; phase 7
   (online payment) waits on the company, accountant and lawyer. The page's remaining English sections move to
   Greek as each is touched.
2. **venue.html and index.html still list only γάμους και βαπτίσεις in eight strings customers read** (found by the
   smoke test after the terms/privacy deploy). venue.html: the intro (~458), the free-year notes (~375, ~583) and
   «Η συνδρομή σας καλύπτει γάμους και βαπτίσεις το ίδιο» (~976). index.html: the subscription and 25 € offers in the
   search-engine data (~31, ~36), «καλύπτει γάμους και βαπτίσεις χωρίς διάκριση» (~418) and «μία εκδήλωση — γάμο ή
   βάπτιση» (~456). Same fix as terms.html, written per sentence. *Done when:* both pages name the γιορτή wherever they
   list kinds, Andreas has read the Greek, and it is deployed.
3. **Only if a free online plan is ever offered: an 8-table limit on the server.** Not a gap today (checked
   2026-10-18): every plan on the server comes from a purchase, a venue licence or free year, or a paying couple.

## Waiting on Andreas

- **Nothing to do for phase 3.** Not checked after the deploy: the one real venue's console on the new sheet (that
  needs the venue's own key). The same code was checked on the local copy. The three new dates are recorded from
  today only, so the venue's existing events show their stage without «δεν στάλθηκε / δεν έχει ανοίξει» (by design).
  If the venue says anything about the new screen, pass it on.
- **A look at «Πελάτες» and the card on your phone** (phases 1–2, live): open https://takeaseat.gr/admin.html, sign
  in with the owner key, tap the one real venue. Try a note, an «Επόμενο βήμα» and a «📞 Τηλεφώνησα» line, and look
  at «Μνήμη» at the bottom. Also open «+ Ιδιώτης» and, on the venue, «Επεξεργασία…» (close both without saving):
  they are Greek since 2026-10-21 and were only checked on a local copy. Next time a customer is waiting on a
  link, paste «Αντιγραφή μηνύματος» to yourself first: the βάπτιση/γιορτή endings and the English and German texts
  (`CLAIM_MSG` in admin.html) have not been read by a native speaker.
- **A design question for later, no rush:** while a venue has not set its own key, the owner key can read that
  key in admin.html, and with it the venue's client cards. A venue that sets its own key closes this. If «the
  admin never sees a venue's clients» must hold strictly, say so and the admin box will stop showing the key.
- **Accountant, add:** how long the «Για τα λογιστικά» records (name and purchase dates of a forgotten customer)
  must be kept. Today they have no end date and no delete button.
- **Accountant** (€10,000 VAT threshold, and who issues receipts for TakeaSeat sales until the company
  exists; also how many years payment records must be kept), **company registration** — later. The receipt
  question only blocks the receipt-number part of operations phase 5.
- **Lawyer review** of terms — later. Add to the list: the customer-memory periods (5 years after the last
  contact for buyers, 2 for non-buyers, venues' client cards 1–5 years, default 5) and the «say no to related
  mails» line under ν. 3471/2006 άρθρο 11 §3 (`OPERATIONS-PLAN.md` §2.5 and §6). Both are built before the review;
  the review may change the numbers. Also: the terms' opening calls direct buyers «ιδιώτες», but a company that
  buys a γιορτή for its own company dinner is a business, and §8 gives every direct buyer the consumer-law 14-day
  withdrawal (ν. 2251/1994), with the planner opening only after it, a business included.

## Known problems

- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.
- The 🛟 on the «Υποστήριξη έως …» badge shows as an empty box on Windows 10 browsers (no such emoji there).

## History

- 2026-10-21 — terms.html and privacy.html name the γιορτή, deployed (`ce16a3e`, tag `deploy-2026-10-21-4`) after
  Andreas read the Greek. Both §0s define «γιορτή» (γενέθλια, ονομαστική εορτή, επέτειος, εταιρικό δείπνο) and say
  «το ζευγάρι» there is whoever organises it; privacy §12 names it and a child's birthday; seven two-kind lists in
  terms.html (opening, §1, §4, §7 ×3 incl. the free year, the 25 € price in §8) name all three kinds. terms.html
  version 18 → 21 October 2026 (privacy was already 21). Two new checks: both §0s name it in both languages, and no
  two-kind list is left on either page (it finds 15 on the old pages). 1135 checks on the box, healthy after 3 s,
  pre-deploy backup `takeaseat-20261021-173926.db.gz.age`; live pages carry the new date and wording. Verifier smoke
  test of seven live pages (/, terms, privacy, dpa, venue, lab?ev=party, the γιορτή guide) passed, no console errors.
- 2026-10-21 — Operations phase 3 deployed (`23e0ad0`, tag `deploy-2026-10-21-3`) after Andreas read the Greek:
  1133 checks on the box, healthy after 3 s, pre-deploy backup `takeaseat-20261021-171711.db.gz.age`; live
  dpa/privacy show version 21 October 2026 and the new lines; verifier smoke test of seven live pages passed,
  no console errors (nothing behind a sign-in was opened).
- 2026-10-21 — Operations phase 3 built (not deployed): venue.html sheet and event card, `vcli:` client cards, the
  three dates, the venue's 1–5 year memory, dpa/privacy lines. 1133 checks; security review clean; verifier passed
  desktop and phone. Commits `04074ec`, `1bcc6ae`, `cf5788d`, `53305a8`, `1e2e1fa`.

- 2026-10-21 — Deployed `e51c05a` (tag `deploy-2026-10-21-2`): «Αντιγραφή μηνύματος» ends per kind (σύντροφο only for a
  γάμο) and speaks the link's language (el/en/de, the planner's own words); the venue's copied key says «Κωδικός
  κτήματος»; a quick change of link language no longer leaves the customer on the wrong one. 1057 checks; all 9
  messages and 3 quick-switch runs checked on a local copy; live pages smoke-tested.
- 2026-10-21 — Deployed `6e30131` (tag `deploy-2026-10-21-1`): admin.html's dialogs in Greek — «+ Ιδιώτης»,
  «+ Κτήμα», «Επεξεργασία…» of a customer and a venue, the «Κάδος», the key and link boxes and all their
  confirms and toasts, with Greek dates and `lang="el"` on the dialog. Fixed on the way: the trash showed a
  γιορτή as "Wedding"; «Μετά τον γάμο» became «Μετά την εκδήλωση». Andreas approved the Greek. Suite 1046;
  every dialog checked on screen locally (also at 375 px); live smoke test after the deploy.
- 2026-10-18 — Deployed `aed530c` (tag `deploy-2026-10-18-3`): operations phase 2. `4e329ac` server (notes,
  next step, timeline, memory clock, «Ξέχασέ τον», books), `83bcd96` (a forgotten self-signup venue takes its
  signup row at once), and the admin card; the old lists are gone. Andreas decided: free-year venues remembered
  5 years (not 2); forgetting keeps only what the books need; he approved the Greek of the card, privacy and
  terms. Also fixed on the way: the couple edit dialog never sent the event type it offered, and offered no
  γιορτή. Suite 1046, `/security-review` clean. Live check: admin.html serves the card, privacy and terms say 5
  years, the new routes answer 403 without the owner key or with a wrong one, no errors in the log.
- 2026-10-18 — Deployed `33a84df` (tag `deploy-2026-10-18-2`): operations phase 1, «Πελάτες» in admin.html.
  It has one row per customer, the six «Θέλουν εμένα» flags, seating %, a read-only card and Excel. The
  privacy test proves no guest name, key, token or link leaves the endpoints. Suite now 981. Andreas
  approved the Greek as it is, including «Ενεργός» for a κτήμα, the shared row words for two links,
  «12:00 π.μ.», and «Ανανέωση» for both reload and renewal. Live check: the endpoints refuse anyone without
  the owner key, and the sheet's one row matches the old lists. The verifier smoke-tested the public pages.

- 2026-10-18 — `OPERATIONS-PLAN.md` written and approved: seven phases from one customer sheet to online
  payment, a customer memory on a restarting 5-/2-year clock, the venues' own client sheet; all seven
  decisions accepted as suggested. Nothing built yet.

- 2026-10-18 — Deployed `4534cf2`: the Excel import window says guest notes are erased the day after the
  event (el/en/de, Greek approved by Andreas), shown only on an online plan. The planner has no typed note
  field. New test: every inline planner script parses (a stray `//` once blanked the planner locally with
  all 917 checks green). First deploy attempt stopped in the Docker check stage (the test read `lab.html`,
  which that stage does not carry) — nothing went live; fixed and redeployed. 918 checks.

- 2026-10-18 — STATUS corrected: the "server 8-table cap" was not a gap (no free way onto the server);
  Search Console and DKIM checked by Andreas; party head table stays «Celebration table» / «Festtisch» in en/de.
- 2026-10-17 — Lab fix deployed (`e1d7098`): the selected kind button was invisible (undefined `--brand`
  colour, since 2026-10-04 — Andreas saw «Γάμος · Βάπτιση» and no Γιορτή); a returning visitor's saved demo
  no longer beats `?ev=` (one demo per kind, nothing overwritten; a bare lab.html keeps what they had). The
  γιορτή page picture lost its head table. Live smoke test passed, 916 checks.

- 2026-10-17 — Party head table: no head table in a γιορτή starter, opt-in «Κεντρικό τραπέζι», old label kept as an alias; landing page updated. Deployed d026190, live smoke test passed, 910 checks.

- 2026-10-16 (evening) — Deployed `b7beb77`, retention: **every plan (couple's own and venue wedding, past
  events too) is kept one year after the event**; guest notes are erased the day after, from the plan and every
  saved version; dpa.html §4 says a year for new venues. The hourly sweep skips finished plans (`meta:archive`,
  full pass nightly after 04:00). privacy/terms/dpa/index/landing pages reworded, Greek approved by Andreas.
  903 checks. Live `meta:settings` had no stored rule, so both defaults are 365 (confirmed via the admin API).

- 2026-10-16 — Deployed `eb2f0cb` (the five commits since 2026-10-04, tag `deploy-2026-10-16-1`), then
  `534f2c1` (tag `-2`): a venue's seat maximum now covers an honour table the couple adds (it was exempt),
  and the first upload counts honour tables as the planner does (a second one was silently dropped).
  870 checks. DKIM switched on at Papaki. Retention decided: one year, automatic, couples' own plans.
- 2026-10-10 — Researched the γιορτή honour table: Greek has no attested phrase for it; decided no
  head table in the starter, «Κεντρικό τραπέζι» if added. Costed archiving (6 cents/year at 10 years).
- 2026-10-06 — Diagnosed the full disk: Docker build cache, 40 GB of it edu-admin's.
- 2026-10-04 — `eb2f0cb` third landing page + the three kinds visible on the home page; `b399d95` the
  lab can show all three kinds; `3567539` the planner's half of «γιορτή»; `4ec5ceb` the server's half;
  `b9b5aad` the lab becomes indexable; `946563d` baptism starter room + two fixes **(deployed)**;
  `253510a` sitemap guard; `7061df5` Dockerfile test stage; `19c8f92` data-driven deploy guard;
  `7e74041` baptisms + Amelie cross-links.
