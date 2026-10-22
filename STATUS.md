# TakeaSeat — STATUS

Updated: 2026-10-22

**Status:** Live runs `bd33f4a` (deployed 2026-10-22, tag `deploy-2026-10-22-1`), healthy. Operations phases 1–4
are live, phase 4 part B (the site's contact form, `epikoinonia.html`) included, after Andreas read its Greek.
Smoke test passed: home, the form (el, en, venue), privacy, a guide, admin, lab and sitemap load; the home page has
no mailto subject links left; the form page has no console errors; `/contact` answers a bad form with `bad_kind` and
refuses another site (403). Not checked live: a real form end to end (needs a real address; see Waiting on Andreas).

## In progress / unfinished

- Party plans created before 2026-10-17 keep the label «Τραπέζι της γιορτής» until the customer renames it
  (deliberately not rewritten on load). Converting such a plan to another kind still works (LEGACY_HEADS).

## Next

1. **Phase 5: payments** (`OPERATIONS-PLAN.md` §4); phase 6 follows; phase 7 (online payment) waits on the
   company, accountant and lawyer. The page's remaining English sections move to Greek as each is touched.
2. **Only if a free online plan is ever offered: an 8-table limit on the server.** Not a gap today (checked
   2026-10-18): every plan on the server comes from a purchase, a venue licence or free year, or a paying couple.

## Waiting on Andreas

- **Send one real form from the live site** with your own email: https://takeaseat.gr/epikoinonia.html. Check that
  you get the "we got it" mail, that the mail to info@ arrives and Reply answers your own address, and that the
  contact shows in «Πελάτες» as «Νέα επαφή». Then «Σβήσε την επαφή…» on its card. Tell the session if anything is off.
- **Send the bank details for the payment text**: δικαιούχος, IBAN and IRIS number (put them in chat; they are not
  secret, they go on every payment message). Until then the live payment reply shows «[ΣΥΜΠΛΗΡΩΣΕ…]» and warns on
  copy. Then fill `REPLY_PAY` in admin.html and deploy.
- **Try «+ Νέα επαφή» on your phone** (live, admin.html, owner key): add a test contact, open its card, tap a ready
  message, then «Σβήσε την επαφή…». It was only checked on the local copy.
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
  withdrawal (ν. 2251/1994), with the planner opening only after it, a business included. And: terms §8's
  «άμεση έναρξη» names only a γάμος under 21 days away, while the payment reply says «εκδήλωση»; confirm it may
  cover a βάπτιση or γιορτή and widen §8's wording.

## Known problems

- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.
- The 🛟 on the «Υποστήριξη έως …» badge shows as an empty box on Windows 10 browsers (no such emoji there).

## History

- 2026-10-22 — phase 4 part B deployed (`bd33f4a`, `deploy-2026-10-22-1`) after Andreas read its Greek (no changes);
  pre-deploy backup `/opt/backups/takeaseat-20261022-123540.db.gz.age`; live smoke test passed.
- 2026-10-22 — operations phase 4 part B built, not deployed (`5262ee2`): the site's contact form
  (`epikoinonia.html` → `POST /contact` → «Νέα επαφή»), "we got it" mail el/en, owner mail with Reply-To, spam limits,
  opt-out tick (decision 6), privacy updated. 1241 checks; screen check at 375 px; `/security-review` clean.
- 2026-10-21 — phase 4 part A deployed (`373419e`, `deploy-2026-10-21-7`) after Andreas read its Greek; his fixes
  A–D in the ready replies (closing line, «Δεν υπάρχει αυτόματη χρέωση», «Κάθε πελάτης σας», immediate start asked
  «γραπτώς»). 1196 checks; replies checked on the local copy at 375 px; live smoke test of five pages passed.
- 2026-10-21 — operations phase 4 part A built, not deployed (`67a99e6`, `70ba96e`): contacts (`lead:` rows) on
  «Πελάτες» with «+ Νέα επαφή», a live «Γνωστός πελάτης» match (email, phone, ΑΦΜ), «Έγινε πελάτης» carrying the
  history (stage moves included), «Δεν προχώρησε» + reason and the 2-year clock, five ready replies (copied or opened
  in his mail app, never mailed by the server). Changed from the plan: "send by mail from the card" became mailto.
  1196 checks (new: owner-key-only, 2-year clock, no guest names or keys in answers, admin.html scripts parse);
  verifier on desktop and 375 px, its eight findings fixed and rechecked; `/security-review` found nothing.
- 2026-10-21 — the βάπτιση guide names the γιορτή, deployed (`45071e7`, tag `deploy-2026-10-21-6`) after Andreas read
  the Greek: its three «η συνδρομή … καλύπτει τους γάμους και τις βαπτίσεις το ίδιο» (FAQ data, FAQ, top note) now say
  «καλύπτει εξίσου γάμους, βαπτίσεις και γιορτές», as in the console. The two-kind check reads this page too; the
  γιορτή guide stays out, because its «Οργανώνετε γάμο ή βάπτιση;» rightly points to the other two kinds. 1137 checks,
  healthy after 3 s, pre-deploy backup `takeaseat-20261021-183415.db.gz.age`; on the live page both visible lines show,
  the FAQ data parses, no console errors; /, venue and the γιορτή guide still 200 with no two-kind list. Verifier at
  phone width (375 px): /, venue and the βάπτιση guide wrap cleanly, no horizontal scroll, no console errors.
- 2026-10-21 — index.html and venue.html name the γιορτή, deployed (`1560286`, tag `deploy-2026-10-21-5`) after
  Andreas read the Greek. About twenty two-kind lists, not the eight first counted: on the home page the link-preview
  title and text, the search-engine data (description, audience, both priced offers), the venue section («νέος
  γάμος», «νέα βάπτιση» ή «νέα γιορτή»; «διπλάσιες μέρες» → «περισσότερες γεμάτες μέρες»), pricing, the three
  pre-filled mails («Είδος (γάμος, βάπτιση ή γιορτή)») and a footer link to the γιορτή guide; in the console the
  intro («…με κάθε πελάτη σας»), both free-year notes and «Η συνδρομή σας καλύπτει εξίσου γάμους, βαπτίσεις και
  γιορτές». Two new checks: no two-kind list on either page (attributes, across tags, percent-encoded mail bodies;
  it trips on every spot of the old pages) and the JSON-LD parses and names the γιορτή. 1137 checks locally, the box's check
  stage passed, healthy after 3 s, pre-deploy backup `takeaseat-20261021-182153.db.gz.age`; the live pages carry
  the new wording and no two-kind list. Verifier smoke test of six live pages (/, venue, venue#signup, the γιορτή
  guide, lab?ev=party, terms) passed, no console errors (nothing behind a sign-in was opened, phone width not checked).
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
