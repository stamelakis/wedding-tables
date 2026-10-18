# TakeaSeat — STATUS

Updated: 2026-10-18

**Status:** Live runs `4534cf2` (deployed 2026-10-18, tag `deploy-2026-10-18-1`), healthy. The repo is ahead
by operations phase 1, the «Πελάτες» sheet: built and tested, **not deployed**. It waits on Andreas's Greek
review and his yes.

## In progress / unfinished

- **Operations phase 1, «Πελάτες» in admin.html** — built 2026-10-18 (`cbcb015` server, `4037e9e` tests,
  `be84788` screen). Suite 981/981. Checked in the preview at desktop and phone width with
  `tools/dev-customers.mjs`, which seeds one customer per flag and stage. The Greek review list is in the
  side-session notes as `customer-sheet-greek-review.md`. It has four open points: «Ενεργός» for a κτήμα, the
  same flag words for two links, «12:00 π.μ.» against 24-hour time, and «Ανανέωση» meaning both reload and
  renewal. After his yes: apply his changes, then `/ship`.
- Party plans created before 2026-10-17 keep the label «Τραπέζι της γιορτής» until the customer renames it
  (deliberately not rewritten on load: it could trip a venue's table lock). Converting such a plan to another
  kind still works (LEGACY_HEADS, on both planner and server).

## Next

1. **Deploy phase 1** after Andreas's Greek review (above), then check it on his phone against the live data.
2. **Operations phase 2: the customer card becomes where you work, and remembers** (`OPERATIONS-PLAN.md` §4).
   It builds on phase 1's `GET /admin/customers/:key` and `customerCardHtml`; §7 has the shape as built.
   Phases 3–6 follow in order; phase 7 (online payment) waits on the company, accountant and lawyer.
3. **Only if a free online plan is ever offered: an 8-table limit on the server.** Not a gap today — checked
   2026-10-18: every plan on the server comes from a purchase (admin), a venue with a licence or free year,
   or a paying couple's extra plan; no free path exists. The free 8-table cap belongs to plans that stay on
   a device (the lab, unsaved plans), and the planner enforces it. Build the server check together with a
   free online plan, if Andreas decides to offer one.

## Waiting on Andreas

- **Accountant** (€10,000 VAT threshold, and who issues receipts for TakeaSeat sales until the company
  exists; also how many years payment records must be kept), **company registration** — later. The receipt
  question only blocks the receipt-number part of operations phase 5.
- **Lawyer review** of terms — later. Add to the list: the customer-memory periods (5 years after the last
  contact for buyers, 2 for non-buyers, venues' client cards 5 by default) and the «say no to related mails»
  line under ν. 3471/2006 άρθρο 11 §3 (`OPERATIONS-PLAN.md` §2.5 and §6). Both are built before the review;
  the review may change the numbers.

## Known problems

- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.

## History

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
