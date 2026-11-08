# TakeaSeat — STATUS

Updated: 2026-11-08

**Status:** Live runs `9e5f069` (deployed 2026-11-08 as `deploy-2026-11-08-3`, pre-deploy backup
`/opt/backups/takeaseat-20261108-130634.db.gz.age`), healthy. New page `dorean-schedio-trapezion.html` («Δωρεάν σχέδιο
τραπεζιών»), linked from the home page and the four event pages; checked live at 375px, no console errors. Home page: four doors (κτήματα, γραφεία, εταιρείες,
ζευγάρια & οικογένειες), title names all four events, free plan named in the hero; checked live at 375px, no console errors. **Phase 3 of `COMPANIES-PLAN.md` is live:** a company's console, saved rooms, old designs, the 1–5 year choice. Operations phases 1–6 are live.

**The free online plan is live** (2026-11-08; HANDOFF §1l). Anyone signs up alone at `epikoinonia.html?q=free` and
gets the link by mail; 8 guest tables until «Ξεκλείδωμα (25 €)…» on the admin card; idle cleanup after 30 days / 6
months. Price: 25 € with ΦΠΑ for everyone, companies included (Andreas said deploy without changing it). Checked on
live: `/health`, the main pages with no console errors, the home strip, the form at 375px with no overflow, terms §8Β and
privacy. One real sign-up with Andreas's own email: the mail arrived and the link opened (`claimedAt`, `seenAt` set).
Then that test customer was forgotten (backup just before: `/opt/backups/takeaseat-20261107-230825.db.gz.age`); no
card, no `books:` line, nothing names ΔΟΚΙΜΗ. Not seen live: the 9th table stopped, and an unlock (both on the local copy only).

**Phase 4 (the γραφείο εκδηλώσεων) is live and done** (2026-11-04; the full check is in History).

**Checked on live for phase 3:** read-only, `/health`, 14 pages, `/admin/customers` refusing without a key, the company login's words, terms 8Α, dpa, privacy and the company guide at 375px with no console errors, the company demo. Then a test company through the API on the running server, 32 of 32: agreement gate, rooms, an event from a room, the allowance (three requests at once made one event on the real database), «+1 εκδήλωση», an old design with names and no note, the keep choice, delete, forget. Afterwards it and its two `books:` rows were removed; nothing on live names it. Backup just before that delete: `/opt/backups/takeaseat-20261104-164035.db.gz.age`.

**Not checked live:** the signed-in screens in a browser (a company's console and its planner were seen on the local copy only, and we do not type live keys into pages); the one real venue's console (needs its own key; its card opens, and it never had a saved room). Also not yet seen live: a company plan used for real, its PDF, a real iPhone tapping the kind picker in the demo, a real form sent as a company, a real new due on «Πληρωμές», a real morning mail.

## In progress / unfinished

- The keep choice's warning before a shorter period was seen only on made-up data in the page, because a past event cannot be created through the screen. Its deletion is covered by the tests. Worth a look the first time a real customer has an old event.
- Party plans created before 2026-10-17 keep the label «Τραπέζι της γιορτής» until the customer renames it
  (deliberately not rewritten on load). Converting such a plan to another kind still works (LEGACY_HEADS).

## Next

1. **Ideas for presenting the site, not started:** «Ποιοι είμαστε» + short FAQ (needs Andreas's facts); a few words
   from the real κτήμα (needs its OK). Done: the four-door hero and title (`2eeebf6`), the free-plan page (`9e5f069`).
2. **Phase 7 (online payment)** waits on the company, accountant and lawyer. The page's remaining English sections move
   to Greek as each is touched.

## Waiting on Andreas

- **Read the Greek of the new free-plan page** (https://takeaseat.gr/dorean-schedio-trapezion.html) and the one new
  sentence in each event page's «Θέλετε πρώτα να το δείτε;» box. Say what reads wrong.
- **The first real free sign-up:** when one shows in «Πελάτες» (marked free), say if anything reads wrong. When one
  asks to unlock, press «Ξεκλείδωμα (25 €)…» on its card after the payment. If a company should pay differently from 25 €, say so.

- **The first real company:** sell it with «+ Εταιρεία», press «+1 εκδήλωση (25 €)» when it buys another, and say if anything reads wrong. Its screens have not been seen signed in on live. You can also open «Πελάτες» once and check nothing named ΔΟΚΙΜΗ is there.
- **When something comes up in «Σήμερα»:** try «αύριο» on a line and «Επαναφορά» under «Κρυμμένα». The 08:00 mail comes
  only on days the list is not empty. When one does come, say if the wording reads right in your mail app.
- **When the next real payment comes in:** record it in «Πληρωμές» («+ Πληρωμή», only the amount is needed) and say if
  anything is off. A new customer's card should read 25 € or 349 € + ΦΠΑ; that has not been seen on live with a real one.
- **Send one real form from the live site** with your own email, choosing «Εταιρεία» so it covers the new type too
  (sending was only tested on the local copy): https://takeaseat.gr/epikoinonia.html. Check that you get the "we got it" mail, that the mail to info@ arrives and Reply answers your own address, and that the
  contact shows in «Πελάτες» as «Νέα επαφή». Then «Σβήσε την επαφή…» on its card. Tell the session if anything is off.
- **Send the bank details for the payment text**: δικαιούχος, IBAN and IRIS number (put them in chat; they are not
  secret, they go on every payment message). Until then the live payment reply shows «[ΣΥΜΠΛΗΡΩΣΕ…]» and warns on
  copy. Then fill `REPLY_PAY` in admin.html and deploy.
- **Nothing to do for phase 3.** Not checked after the deploy: the one real venue's console on the new sheet (that
  needs the venue's own key). The same code was checked on the local copy. The three new dates are recorded from
  today only, so the venue's existing events show their stage without «δεν στάλθηκε / δεν έχει ανοίξει» (by design).
  If the venue says anything about the new screen, pass it on.
- **Next time a customer is waiting on a link,** paste «Αντιγραφή μηνύματος» to yourself first: the βάπτιση/γιορτή
  endings and the English and German texts (`CLAIM_MSG` in admin.html) have not been read by a native speaker.
- **A design question for later, no rush:** while a venue has not set its own key, the owner key can read that
  key in admin.html, and with it the venue's client cards. A venue that sets its own key closes this. If «the
  admin never sees a venue's clients» must hold strictly, say so and the admin box will stop showing the key.
- **Accountant, add (phase 2):** the company guide says «παραστατικό» until invoices are answered. **Accountant, add:** how long the «Για τα λογιστικά» records (name and purchase dates of a forgotten customer)
  must be kept. Today they have no end date and no delete button. Also: invoices to companies at 25 € per event
  (`COMPANIES-PLAN.md` §4).
- **Accountant** (€10,000 VAT threshold, and who issues receipts for TakeaSeat sales until the company
  exists; also how many years payment records must be kept), **company registration** — later. Phase 5 is built
  around the answers: receipt numbers can be added to a payment later, the «Πληρωμές» screen counts the year against
  €10,000 without deciding anything, and VAT is only what you type until the accountant says how it is charged.
- **Lawyer review** of terms — later. Add to the list: the customer-memory periods (5 years after the last
  contact for buyers, 2 for non-buyers, venues' client cards 1–5 years, default 5) and the «say no to related
  mails» line under ν. 3471/2006 άρθρο 11 §3 (`OPERATIONS-PLAN.md` §2.5 and §6). Both are built before the review;
  the review may change the numbers. Phase 4: a γραφείο as controller, its tick accepting `dpa.html`, and its copying a client's guests to that client's next event (terms, dpa and privacy state these once it is live). Also: the terms' opening calls direct buyers «ιδιώτες», but a company that
  buys a γιορτή for its own company dinner is a business, and §8 gives every direct buyer the consumer-law 14-day
  withdrawal (ν. 2251/1994), with the planner opening only after it, a business included. And: terms §8's
  «άμεση έναρξη» names only a γάμος under 21 days away, while the payment reply says «εκδήλωση»; confirm it may
  cover a βάπτιση or γιορτή and widen §8's wording. The terms' opening now says «ιδιώτες και εταιρείες» while §8 still gives every direct buyer the 14-day withdrawal, and phase 2 is live, so this matters more now. And the four points for companies in `COMPANIES-PLAN.md` §4: the
  1–5 year choice, a company accepting `dpa.html`, no consumer withdrawal for a company, table labels in saved rooms. Terms 8Α, dpa.html and privacy.html state these live since 2026-11-04, so the review reads them as written.
  And the free online plan (terms 8Β): deleting a plan unopened for 6 months after one warning mail, one free plan per
  email, and that unlocking starts at once (does the 14-day withdrawal apply to the 25 €, as §8 says today?).

## Known problems

- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.
- **Hermes's registration file can go stale** (twice now: 2026-09-22 and 2026-10-19 to 2026-10-23): it names a dead
  port while the shim serves on another, so Hermes says TakeaSeat is "not answering". Fix: restart through
  `TakeaSeatHermes.lnk` and check the file (HANDOFF). The cause is in Hermes's `hermes_control.py`, another project.
- **This PC's C: drive is nearly full** (17 GB free on 2026-11-06). Not the server's; the server is at 24 %.
- **The trimmed-tables note says «1 ακόμη δεν μπήκαν»** (plural verb for one table; `labCapCut` in planner.src.html,
  old, also in the lab). Fix with a singular form when the planner is next touched.
- On a phone, the free plan's 8-table note shows behind the open tools drawer; it is seen once the drawer closes
  (it stays 12 seconds). The lab behaves the same.
- The 🛟 on the «Υποστήριξη έως …» badge shows as an empty box on Windows 10 browsers (no such emoji there).

## History

- 2026-11-08: New landing page «Δωρεάν σχέδιο τραπεζιών» (`dorean-schedio-trapezion.html`): what the free plan gives, device demo vs free vs 25 € unlock, timeline, terms 8Β rules, 10 FAQ with matching JSON-LD; linked from home and the four event pages; 12 checks, 1874 pass. Live as `9e5f069` (`deploy-2026-11-08-3`); live smoke test passed.
- 2026-11-08: Home page hero now has four doors (κτήματα, γραφεία, εταιρείες, ζευγάρια & οικογένειες), the title names all four events, and the free online plan is named in the hero and both couple cards. Live as `2eeebf6` (`deploy-2026-11-08-2`); checked live at 375px, no console errors.
- 2026-11-08: Deployed the free online plan as `94f43ab` (`deploy-2026-11-08-1`). Live smoke test passed; one sign-up with Andreas's email got the mail and opened, then was forgotten.
- 2026-11-06: Built the free online plan (8 guest tables, unlock 25 €, idle cleanup), commits `42b1a24` and the wrap commit; not deployed. CLAUDE.md's "no server-side cap" decision replaced.
- 2026-11-06: Fixed the guided tour's `TypeError … 'prep'`: a second quick click on a card not yet redrawn moved the tour past its last step (or below the first with «Πίσω»). Buttons now ignore a click once the tour left their step; 3 checks, 1799 pass. Live as `fa76fde` (`deploy-2026-11-06-1`); on live, five quick clicks moved one step and «Τέλος» closed cleanly, no console errors.
- 2026-11-06: The Google, link-preview and structured-data descriptions (index.html, epikoinonia.html) now name «εταιρική εκδήλωση»; titles kept. Live as `c557b34`; the new text was read back from live.
- 2026-11-05: CLAUDE.md trimmed from 216 to 128 lines: one line per decision; the full records moved to `COMPANIES-PLAN.md` §7, `HANDOFF.md` §10 and `OPERATIONS-PLAN.md` §9 (`257b864`).
- 2026-11-05: Phase 4 of `COMPANIES-PLAN.md` finished: a test γραφείο went through the live site, then both test customers were removed by hand.
- 2026-11-04: Phase 3 of `COMPANIES-PLAN.md` live: a company's console, saved rooms, old designs, the 1–5 year choice (`9a092f8`, `deploy-2026-11-04-1`). Live test company passed 32 of 32 through the API and was removed.
- 2026-11-04: **Phase 4 (the γραφείο εκδηλώσεων) is live and done.** Andreas signed a test γραφείο up on the live site on 2026-11-04: the setup mail, the agreement at first opening, two saved rooms, a γάμος and a γιορτή from Αίγλη, and he reported no «κτήμα». The event from the second room, a βάπτιση from Ανατολή, was made by the session through the API on the running server with that γραφείο's own key, and it recorded Ανατολή. Both rooms had the same tables, so that proves the room's name and not different tables; the room dropdown itself worked on the local copy and was never chosen on live. Both test customers were then removed by hand: 15 rows, plus their entries in `venues:index` and `signups:index`; nothing on live names them, and Jockey's row is unchanged. Backup just before that delete: `/opt/backups/takeaseat-20261104-224121.db.gz.age`. Also checked on live, read-only with no sign-in and no form sent: `/health`, 13 pages, `/admin/customers` refusing without a key, the sitemap, the home section, the guide, the γραφείο's login and sign-up form at 375px with no console errors, a bare `venue.html` still saying Κτήμα, the new paragraphs in terms, dpa and privacy, the γιορτή demo loading. 1796 checks pass, on the local copy and in the server's build; `/security-review` found nothing. Seen at 375px on the local copy: sign-up, its mail, the agreement, console, two rooms, two events, the planner as γραφείο and as client, the old-design dialog, guide and home section, admin's card and ready replies. Rooms with tables were seen in a client's wedding and γιορτή, opened from their links, built through the API. **Not seen on screen:** a βάπτιση on a γραφείο's plan (scans only), English and German (tests only), the room saved from inside the planner and not through the API. Andreas read the new Greek on 2026-11-04 and changed nothing.
- 2026-11-03: The last five lines name company events: the 25 € price, how a venue makes an event, the console's welcome, the γιορτή guide, the Greek terms (`be68c33`, `deploy-2026-11-03-8`).
- 2026-11-03: Ten more lines on the home page and the γιορτή and βάπτιση guides name company events (`507b44f`, `deploy-2026-11-03-7`).
- 2026-11-03: Six more sentences on the home page, venue console and admin's copied text name company events (`5d48212`, `deploy-2026-11-03-6`).
- 2026-11-03: The home page's subscription line now names company events (`1ade6c9`, `deploy-2026-11-03-5`).
- 2026-11-03: Phase 2 of `COMPANIES-PLAN.md`, the fourth kind «Εταιρική εκδήλωση», live (`bf431d9`, `deploy-2026-11-03-4`). The first deploy died in the server's build: two files a new test reads were not in the check stage; nothing went live, and a check now refuses that on the local copy. Fixed the clipped ⋯ button at 375px on the way.

- 2026-11-03 — «Πληρωμές» now expects what the site says, 25 € with ΦΠΑ and 349 € + ΦΠΑ, after Andreas's yes (it said 19 € and
  129 € since the ledger was written). Deployed the same day (`2fb509c`, `deploy-2026-11-03-3`) after his second yes. The live database had no ledger rows, no couples and one venue with
  nothing owed, so no recorded due needed correcting; none was changed. 1497 checks pass; a new one fails the build if the
  pages and the ledger ever differ again (replayed against the old numbers: it fails). Seen at phone width on the local
  copy: a new couple 25,00 €, a new venue 349,00 € + ΦΠΑ. `/security-review` found nothing. After the deploy the ledger was
  still empty, the running code held the new numbers, and the two other sites on the box answered.
- 2026-11-03 — second deploy the same day (`40204ad`, `deploy-2026-11-03-2`): the contact page's header fits a phone (under
  520px it drops «Αρχική», since the logo links home), and `privacy.html` says we keep a company's or γραφείο's ΑΦΜ (new
  version date, 3 November 2026).
- 2026-11-03 — phase 1 of `COMPANIES-PLAN.md` built and deployed (`924490c`, `deploy-2026-11-03-1`) after Andreas's yes:
  «Εταιρεία» and «Γραφείο εκδηλώσεων» in «+ Νέα επαφή», «Πελάτες» and the contact form, ΑΦΜ kept and found by «Γνωστός
  πελάτης», sold through «+ Ιδιώτης» (γιορτή) and «+ Κτήμα».
- 2026-11-03 — `COMPANIES-PLAN.md` written and approved by Andreas (a fourth kind, «Γραφείο εκδηλώσεων», old designs, a 1–5
  year choice, guest notes still erased with the company keeping its own CSV); no code changed. Andreas's live look at «Σήμερα», «Πληρωμές», «Πελάτες», the card and «+ Νέα επαφή»: fine.
- 2026-10-23 — phase 6 («Σήμερα», morning mail, Hermes) built (`122e233`, `d81e3ff`, `dc987a2`, `01eb974`) and deployed
  (`deploy-2026-10-23-2`) after Andreas read the Greek; `backup.sh` with the backup stamp installed on the host; the
  Hermes shim restarted (its registration had pointed at a dead port since 2026-10-19).
- 2026-10-23 — phase 5 (payments) deployed (`3e2888e`, `deploy-2026-10-23-1`) after Andreas read its Greek; his two
  asks added first (a forgotten customer's row says why it opens nothing; «Ποσό — μόνο αυτό χρειάζεται»). Pre-deploy
  backup `/opt/backups/takeaseat-20261023-145601.db.gz.age`; live smoke test passed (pages load, payment routes 403
  without the owner key).
- 2026-10-22 — operations phase 5 built (`db46296` server, `5a182f7` screens, `6ae079a`): one `ledger:` row per
  customer, dues that appear by themselves, late ones flagged, refunds and cancellations, the «Πληρωμές» screen with
  the €10,000 meter, an Excel and a «Για τον Λογιστή» import file. 1336 checks, a hand-worked total, `/security-review`
  clean, screen check at desktop and 375 px.
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
