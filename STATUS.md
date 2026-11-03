# TakeaSeat — STATUS

Updated: 2026-11-03

**Status:** Live runs `be68c33` (deployed 2026-11-03, tag `deploy-2026-11-03-8`, pre-deploy backup
`/opt/backups/takeaseat-20261103-211634.db.gz.age`), healthy. The fourth kind, «Εταιρική εκδήλωση» (phase 2 of `COMPANIES-PLAN.md`), is live after Andreas
read the Greek and said yes; phases 3–4 are not built. 1630 checks pass, on the local copy and in the server's build. Operations phases 1–6 are live.

**Live smoke test of phase 2, read-only, passed:** the company demo at desktop, 1000px and 375px, the γιορτή demo, the new guide, the home page's four cards,
the γιορτή guide, terms, privacy, dpa, and six more pages load with no console errors, the sitemap lists the guide, `/health` ok, `/admin/customers` refuses
without a key. On the local copy only: converting between the four kinds, the PDFs in el, en and de, the admin dialogs, the venue console. **Not checked
live:** a company plan bought and used for real (signed-in screens, its PDF, its mail), and a real iPhone tapping the kind picker in the demo. Also not
yet seen live: a real form sent as a company, a real new due on «Πληρωμές», a real morning mail.

## In progress / unfinished

- Party plans created before 2026-10-17 keep the label «Τραπέζι της γιορτής» until the customer renames it
  (deliberately not rewritten on load). Converting such a plan to another kind still works (LEGACY_HEADS).

## Next

1. **What Google and link previews show still names three kinds** (index.html:7, 8, 14, 15, 25, epikoinonia.html:8). Left on purpose by Andreas: those words affect the ranking, so change them
   deliberately, once companies start looking. Every other line found by a search for a baptism and a party named close together now includes company events.
2. **Phases 3–4 of `COMPANIES-PLAN.md`**, each in its own session: one console with saved rooms and
   old designs, then the organiser in public. Each has its own "done when" there.
3. **Phase 7 (online payment)** waits on the company, accountant and lawyer. The page's remaining English sections move
   to Greek as each is touched.
4. **Only if a free online plan is ever offered: an 8-table limit on the server.** Not a gap today (checked
   2026-10-18): every plan on the server comes from a purchase, a venue licence or free year, or a paying couple.

## Waiting on Andreas

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
  the review may change the numbers. Also: the terms' opening calls direct buyers «ιδιώτες», but a company that
  buys a γιορτή for its own company dinner is a business, and §8 gives every direct buyer the consumer-law 14-day
  withdrawal (ν. 2251/1994), with the planner opening only after it, a business included. And: terms §8's
  «άμεση έναρξη» names only a γάμος under 21 days away, while the payment reply says «εκδήλωση»; confirm it may
  cover a βάπτιση or γιορτή and widen §8's wording. The terms' opening now says «ιδιώτες και εταιρείες» while §8 still gives every direct buyer the 14-day withdrawal, and phase 2 is live, so this matters more now. And the four points for companies in `COMPANIES-PLAN.md` §4: the
  1–5 year choice, a company accepting `dpa.html`, no consumer withdrawal for a company, table labels in saved rooms.

## Known problems

- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.
- **Hermes's registration file can go stale** (twice now: 2026-09-22 and 2026-10-19 to 2026-10-23): it names a dead
  port while the shim serves on another, so Hermes says TakeaSeat is "not answering". Fix: restart through
  `TakeaSeatHermes.lnk` and check the file (HANDOFF). The cause is in Hermes's `hermes_control.py`, another project.
- **This PC's C: drive is 98 % full** (9.7 GB free on 2026-10-23). Not the server's; the server is at 24 %.
- The 🛟 on the «Υποστήριξη έως …» badge shows as an empty box on Windows 10 browsers (no such emoji there).
- **The tour once threw a `TypeError … 'prep'`** when «Επόμενο» was pressed past its last step (planner around line 5502, seen 2026-11-03 in a screen check, not
  company-specific). Probably a stale double click; not reproduced by hand and not fixed.

## History

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
