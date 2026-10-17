# TakeaSeat — STATUS

Updated: 2026-10-17

**Status:** Live runs `e1d7098` (deployed 2026-10-17, tag `deploy-2026-10-17-2`), healthy, everything in the
repo is deployed. A γιορτή now starts with no head table; the toolbar's «Κεντρικό» adds one, named
«Κεντρικό τραπέζι». Retention (a year per plan, guest notes gone the day after) is live since 2026-10-16.

## In progress / unfinished

- Nothing half-built. Party plans created before today keep the label «Τραπέζι της γιορτής» until the
  customer renames it (deliberately not rewritten on load: it could trip a venue's table lock). Converting
  such a plan to another kind still works (LEGACY_HEADS, on both planner and server).

## Next

1. **The free 8-table cap on the server.** Needed before advertising anything "free online". Today only the
   planner refuses a 9th guest table on a plan that is not online; nothing on the server checks it.
   *Done when:* the server refuses (with a clear message) a save that would push a capped plan past 8 guest
   tables, a paid/online plan is unaffected, and tests cover both plus the head table not counting.
2. **Small: tell the planner user that guest notes are erased the day after the event**, next to the note
   field (el/en/de, Greek reviewed by Andreas). The pages say it; the field itself does not yet.

## Waiting on Andreas

- **Search Console.** Request indexing for
  `https://takeaseat.gr/plano-trapezion-giortis.html`, `https://takeaseat.gr/lab.html`,
  `https://takeaseat.gr/` — open Search Console, choose the takeaseat.gr property, paste each URL in the top bar. (The pages
  return 200; the deep links given on 2026-10-16 opened a 404 inside Search Console.) Report back what Indexing → **Pages** says
  after 2–3 days.
- **DKIM — switched on 2026-10-16** in Papaki's Email Manager («Η εγγραφή DKIM ρυθμίστηκε σωστά»; the
  zone's SOA serial changed the same day). Its selector is unknown, so it is not yet confirmed from
  outside: send one mail from info@takeaseat.gr to a Gmail → «Εμφάνιση πρωτοτύπου» → expect `DKIM: PASS`.
  DMARC is still `p=none` with no reporting address.
- **English/German name of the party head table.** Greek is now «Κεντρικό τραπέζι»; English still says
  «Celebration table» and German «Festtisch». Say whether to change them to «Main table» / «Haupttisch»
  (then the old words join LEGACY_HEADS) or leave them.
- **Accountant** (€10,000 VAT threshold), **company registration**, **lawyer review** of terms.

## Known problems

- **The 8-table free cap is client-side only** — no server limit exists at all.
- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 28 % on 2026-10-17. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.

## History

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
