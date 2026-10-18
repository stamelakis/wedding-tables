# TakeaSeat — STATUS

Updated: 2026-10-18

**Status:** Live runs `4534cf2` (deployed 2026-10-18, tag `deploy-2026-10-18-1`), healthy, everything in the
repo is deployed. Nothing is open on the product side; what remains waits on Andreas's business steps.

## In progress / unfinished

- Nothing half-built. Party plans created before today keep the label «Τραπέζι της γιορτής» until the
  customer renames it (deliberately not rewritten on load: it could trip a venue's table lock). Converting
  such a plan to another kind still works (LEGACY_HEADS, on both planner and server).

## Next

1. **Daily operations: `OPERATIONS-PLAN.md`** (written 2026-10-18, draft, revised once). Seven phases: one
   customer sheet → customer card with notes, timeline and a 5-year customer memory → the venues' own sheet →
   every contact in the sheet → payments ledger → «Σήμερα» page and morning mail → online payment (later).
   Waiting for Andreas's OK and his seven decisions (§6); then phase 1.
2. **Only if a free online plan is ever offered: an 8-table limit on the server.** Not a gap today — checked
   2026-10-18: every plan on the server comes from a purchase (admin), a venue with a licence or free year,
   or a paying couple's extra plan; no free path exists. The free 8-table cap belongs to plans that stay on
   a device (the lab, unsaved plans), and the planner enforces it. Build the server check together with a
   free online plan, if Andreas decides to offer one.

## Waiting on Andreas

- **Accountant** (€10,000 VAT threshold, and who issues receipts for TakeaSeat sales until the company
  exists), **company registration**, **lawyer review** of terms — later.
- **The operations plan**: OK it (or change it) and answer its seven decisions, `OPERATIONS-PLAN.md` §6.

## Known problems

- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.

## History

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
