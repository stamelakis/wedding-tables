# TakeaSeat — STATUS

Updated: 2026-10-11

**Status:** Live site healthy (container up 7 days, `{"ok":true,"mail":true}`, 867 checks green).
Five commits are built, tested and pushed but **NOT DEPLOYED** since 2026-10-04 — the third event
kind («γιορτή»), the new landing page, the home-page changes and the lab's SEO are invisible to the
public. Live runs `946563d`; the repo is at `eb2f0cb`.

## In progress / unfinished

- **The «γιορτή» honour table.** Research finished 2026-10-10 and the decision is made (below), but
  **no code has been written**. Stopped before the first edit. See CLAUDE.md → Decisions.

## Next

1. **Deploy the five commits.** `ssh root@178.104.158.125 /opt/takeaseat/server/deploy.sh` (no
   `--force` needed; the guard now reads the database, not the calendar).
   *Done when:* `/plano-trapezion-giortis.html` returns 200, the home page serves the «Τι σχεδιάζετε»
   section, and `lab.html` no longer contains `noindex`.
2. **The honour table for γιορτή.** A γιορτή starts with NO special table (add one from the toolbar if
   you want it); if added it is «Κεντρικό τραπέζι». Four things ship together, see CLAUDE.md → Gotchas:
   the `KIND_HEAD` map, the `labState()` guard, the five Greek strings + `STARTER_WORDS`, and the
   `LEGACY_HEADS` alias so old plans still get re-pointed.
   *Done when:* checks pass, the lab's «Γιορτή» button does not throw, and a party plan labelled
   «Τραπέζι της γιορτής» still converts correctly to a wedding.
3. **Two live server bugs** (see Known problems) — small, independent of 2.
4. **Retention 7 → 395 days**, after taking archived plans out of the hourly sweep.
5. **The free 8-table cap on the server.** Needed before advertising anything "free online".

## Waiting on Andreas

- **Search Console — after the deploy, not before.** Open Search Console → the search bar at the top
  → paste each URL → Enter → **Request indexing**: `https://takeaseat.gr/plano-trapezion-giortis.html`,
  `https://takeaseat.gr/lab.html`, `https://takeaseat.gr/`. Report back what Indexing → **Pages** says
  after 2–3 days. Requesting before the deploy wastes the quota: one URL is a 404, the other noindexed.
- **Papaki — DKIM is missing.** Verified absent on 10 selectors. Ask Papaki/SecureMail to *enable DKIM
  for takeaseat.gr and publish the record*. If they hand you a TXT value instead, paste it here. Our
  mail (claim links, venue setup links, keepsake PDFs) is signed by nothing today. DMARC exists but is
  `p=none` with no reporting address.
- **Decide the γιορτή wording:** customer = «ο διοργανωτής», ornament = ★, honour table =
  «Κεντρικό τραπέζι», groups = Οικογένεια/Φίλοι/Συνάδελφοι/Παιδιά.
- **Decide retention:** raise the default from 7 days to one year? «Δεν σβήνουμε ποτέ» cannot be said —
  see CLAUDE.md → Decisions.
- **Accountant** (€10,000 VAT threshold), **company registration**, **lawyer review** of terms.

## Known problems

- **maxSeats bypass** — `wedding-sync-worker.js:815` exempts every `shape:"head"` table from a venue's
  per-table seat cap. With the add-head button that is a way around the venue's layout lock.
- **Second honour table silently deleted** — `wedding-sync-worker.js:1552` keeps `++headT <= 1` on the
  first upload and flags `enforced`, so the planner shows a notice for a change nobody made.
- **The hourly sweep reads every plan** on the same thread that answers the API. Blocks any long
  retention: ~210 MB and 2.6 s per pass at 5,000 plans.
- **The 8-table free cap is client-side only** — no server limit exists at all.
- **Shared-box disk.** On 2026-10-06 Docker build cache (edu-admin's builds, 40 GB of 53 GB) filled the
  disk to 85 %. Cleared — now 19 %, cache 2.6 GB. Recurs unless edu-admin's Dockerfile stops rebuilding
  node_modules every time. TakeaSeat's own share was 0.1 GB.

## History

- 2026-10-10 — Researched the γιορτή honour table: Greek has no attested phrase for it; decided no
  head table in the starter, «Κεντρικό τραπέζι» if added. Costed archiving (6 cents/year at 10 years).
- 2026-10-06 — Diagnosed the full disk: Docker build cache, 40 GB of it edu-admin's.
- 2026-10-04 — `eb2f0cb` third landing page + the three kinds visible on the home page; `b399d95` the
  lab can show all three kinds; `3567539` the planner's half of «γιορτή»; `4ec5ceb` the server's half;
  `b9b5aad` the lab becomes indexable; `946563d` baptism starter room + two fixes **(deployed)**;
  `253510a` sitemap guard; `7061df5` Dockerfile test stage; `19c8f92` data-driven deploy guard;
  `7e74041` baptisms + Amelie cross-links.
