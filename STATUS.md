# TakeaSeat — STATUS

Updated: 2026-10-16

**Status:** Live runs `534f2c1` (tag `deploy-2026-10-16-2`), healthy, everything in the repo is deployed.
Retention (Next 4) is being built in a separate session started 2026-10-16.

## In progress / unfinished

- **The «γιορτή» honour table.** Decision made (CLAUDE.md → Decisions), **no code yet**. Note: the
  deploy put the old wording live — a party plan's honour table is called «Τραπέζι της γιορτής» on
  takeaseat.gr today, the phrase the research rejected. Next item 1 fixes it.

## Next

1. **The honour table for γιορτή.** A γιορτή starts with NO special table (add one from the toolbar if
   you want it); if added it is «Κεντρικό τραπέζι». Four things ship together, see CLAUDE.md → Gotchas:
   the `KIND_HEAD` map, the `labState()` guard, the five Greek strings + `STARTER_WORDS`, and the
   `LEGACY_HEADS` alias so old plans still get re-pointed.
   *Done when:* checks pass, the lab's «Γιορτή» button does not throw, and a party plan labelled
   «Τραπέζι της γιορτής» still converts correctly to a wedding.
2. **Lab: a returning visitor's saved plan beats the `?ev=` door.** Found by the 2026-10-16 smoke test:
   after `?ev=baptism`, both `?ev=party` and plain `lab.html` reopen the baptism plan, so the «γιορτή»
   landing page's button can land a returning visitor in their old plan. Fresh visitors are fine.
3. **Retention: one year, automatically, for every couple's own plan** (decided 2026-10-16, CLAUDE.md →
   Decisions). Venue weddings stay 7 days. First take archived plans out of the hourly sweep, then change
   the default, then every page that promises 7 days (privacy, terms, index, landing pages, planner,
   venue/admin) in el/en/de — Greek reviewed by Andreas. **In progress in its own session** (started
   2026-10-16 from the session that decided it) — check its commits before starting this again.
4. **The free 8-table cap on the server.** Needed before advertising anything "free online".

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
- **Decide the γιορτή wording:** customer = «ο διοργανωτής», ornament = ★, groups =
  Οικογένεια/Φίλοι/Συνάδελφοι/Παιδιά are already built and live; only the honour table («Κεντρικό
  τραπέζι», opt-in) is still to build.
- **Accountant** (€10,000 VAT threshold), **company registration**, **lawyer review** of terms.

## Known problems

- **The hourly sweep reads every plan** on the same thread that answers the API. Blocks any long
  retention: ~210 MB and 2.6 s per pass at 5,000 plans.
- **The 8-table free cap is client-side only** — no server limit exists at all.
- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — 23 % on 2026-10-16. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.

## History

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
