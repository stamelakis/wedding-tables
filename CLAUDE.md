# TakeaSeat — rules for a session in this folder

`HANDOFF.md` is the operations guide (what the product is, roles, lifecycle, Amelie, deploy, access
keys). Read it for anything structural. This file only holds what is easy to get wrong and the
decisions a future session might undo by mistake. `STATUS.md` says where we are.

## Run · build · test

```bash
node tools/build-planner.mjs            # regenerate the planner outputs
node tools/build-planner.mjs --check    # must print "all planner outputs up to date"
node tools/test-api.mjs                 # the whole suite (1196 checks today)
node tools/dev.mjs                      # local stack on :8080 — never `node server/server.mjs`
node tools/dev-customers.mjs            # the same, seeded with one customer per «Θέλουν εμένα» flag and stage
```

Preview with `preview_start {name:"takeaseat-local"}` (`.claude/launch.json`), then
`http://localhost:8080/lab.html?ev=baptism|party`. For admin.html's «Πελάτες» use `takeaseat-customers`
(owner key `dev-owner-key`). It runs on `node:sqlite`, because better-sqlite3 has no Windows binary here.

Deploy: `ssh -i ~/.ssh/hetzner root@178.104.158.125 /opt/takeaseat/server/deploy.sh` (without `-i` the
login is refused). It backs up, pulls, builds (the
build runs the full suite), restarts and health-checks; on failure it rolls back by itself.

## Gotchas

- **`planner.src.html` is the only source.** `seating-planner-{el,en,de}.html`, the three
  `.artifact.html` twins and `lab.html` are generated. Edit the source, rebuild, then `--check`.
- **The suite never runs the planner's code** — it only reads the source as text, plus one check that the
  inline scripts parse. A planner change is not verified until it is opened in the preview. Tests may read
  `planner.src.html` but not the built pages: the Docker check stage does not carry them.
- **`server/worker.mjs` is not in git.** `tools/dev.mjs` copies it from `wedding-sync-worker.js`, and
  the Docker build does the same. There is one source of truth; never "fix both".
- **The Dockerfile copies files by name, twice.** Line 29 for the public pages, and the check stage
  for anything the tests read. A new page or a new file read by a test must be added, or it 404s in
  production / the build dies. Both have already happened. A build-time check now refuses any image
  whose `sitemap.xml` lists a page the image does not carry — that guard only covers the sitemap.
- **The i18n duplicate-key scanner does not skip comments.** An apostrophe in a comment inside the
  `T_ALL` dictionaries opens a string it never closes; the build then reports nonsense duplicate keys
  and `duplicate-key scan could not read the dictionaries`. Keep comments there apostrophe-free.
- **Bash heredocs eat one level of backslashes.** Writing JS/Python through `<<'PY'` turns `\\n` into a
  real newline and breaks string literals. Use `chr(92)+"n"`, a raw string, or the Edit tool.
- **Every kind question goes through `KIND_PFX`** (`{wedding:"", baptism:"b_", party:"p_"}`), which
  exists identically in `planner.src.html`, `wedding-sync-worker.js`, `server/pdf.mjs` and
  `trapezi.html`. A test fails on any `=== "baptism"` in the planner except the children's corner.
  The second kind leaked by growing such tests; the third kind found two still standing.
- **The planner and the server must write identical starter words** — head table and group names, per
  kind, per language. A test compares `STARTER_WORDS` with the planner dictionaries and has already
  caught two disagreements.
- **«Τραπέζι τιμής» is reserved.** The suite uses that exact string as the example of a label a venue
  typed for itself and that we must never overwrite. It can never be a starter word.
- **Renaming a starter word breaks the retype paths** unless the old string is added to a legacy-alias
  list in both `retypeStarterWords` (planner) and `retypeStarter` (worker): both match the *current*
  dictionary only, so an existing plan stops being recognised as planner-written.
- **The deploy guard reads the database, not the calendar.** It refuses only while a real event is
  within one day back / two ahead (templates, test rows and trashed plans excluded), and falls back to
  the old Friday–Sunday rule when the database cannot be read.
- **The box is shared** with the education app and Amelie. Use `mktemp -d` for scratch files — a
  generic `/tmp/x.json` once clobbered another app's file. The API has no published port: reach it with
  `curl --resolve takeaseat.gr:443:127.0.0.1 https://takeaseat.gr/...`.
- **There is no admin "delete any plan".** A couple's plan goes by `DELETE /plans/:id` with its edit
  key; a venue's by `DELETE /venues/:id/weddings/:planId` then `DELETE /admin/venues/:id/trash/:planId`.
  `/admin/test/*` only touches rows flagged `test:true`.

## Decisions

- **One third kind, `party` («γιορτή»)**, covering γενέθλια, ονομαστική, επέτειος and a company dinner
  — not several kinds. A nameday and a 40th are the same room on the same evening, and each extra kind
  costs ~135 strings in three languages. *Andreas asked for this after hearing the argument against
  building it at all; it is his explicit decision, not a recommendation.*
- **A γιορτή starts with NO honour table** (decided 2026-10-10, built 2026-10-17). A γάμος and a
  βάπτιση each have exactly one table the evening is about; a γιορτή may have none, one or several, so
  it becomes an opt-in table from the toolbar. Rejected: copying the wedding's pattern — Andreas's
  point was that the pattern is not universal, and the language agrees: Greek has no attested phrase
  for such a table at a party.
- **If one is added it is «Κεντρικό τραπέζι».** Rejected: «Τραπέζι της γιορτής» (in real Greek that is
  the Christmas table/menu), «Τιμητικό τραπέζι» (the honorific *banquet*, i.e. the whole event),
  «Τραπέζι των οικοδεσποτών» (zero attestation), «Τραπέζι τιμής» (reserved by the suite, above).
- **The baptism starter adds exactly one thing, the children's corner.** The filter is "does it change
  a seating decision", not "is it common at a baptism" — τούρτα, candy bar and μπομπονιέρες are all
  common and all two taps away in the decor menu, so putting them in the starter only gives the
  customer something to delete.
- **The lab keeps one demo per kind** (2026-10-17). A link naming a kind (`?ev=party`) opens the visitor's
  demo of that kind or adds one beside the old (`labDoor`); a bare `lab.html` reopens what they had. Rejected:
  rebuilding the open demo from the link — it silently threw away what a returning visitor had built.
- **No server-side 8-table cap** (checked 2026-10-18). Every way onto the server needs a purchase, a venue
  licence/free year or the admin, so nothing free reaches it; the cap is for device-only plans and the planner
  enforces it. Build a server check only together with a free online plan, if one is ever offered.
- **`lab.html` is the one indexed planner build**; the three app builds carry `noindex` instead,
  because their URLs carry `?plan=` invite tokens and a plan link must never be indexable. If the lab
  ever goes back to noindex, remove it from `sitemap.xml` in the same commit.
- **«Δεν σβήνουμε ποτέ» must never be written anywhere.** Storage is irrelevant (a 300-guest plan is
  6.9 KB gzipped; keeping everything for a decade costs cents), but GDPR storage limitation does not
  allow "we keep it until you ask us to delete it", and for a venue's weddings TakeaSeat is the
  *processor* — the 7-day deletion is the venue's documented instruction in `dpa.html` §4 and cannot
  be changed unilaterally. The honest promises are a fixed period («ένας χρόνος μετά την εκδήλωση»)
  and an opt-in with the free-text note field stripped, because that field holds allergies.
- **Every plan is kept one year after the event, automatically** — a couple's own and a venue's wedding,
  past events included (Andreas, 2026-10-16). Rejected: an opt-in box, a 7-day exception for venues ("why
  make an exception?"), and "forever" (GDPR, above). For venues the year is their instruction in `dpa.html`
  §4: change the default and the agreement together, never one. Read-only from the day after the event.
  The hourly sweep skips finished plans via `meta:archive` (full pass nightly after 04:00) — keep that, or
  a year of plans is read every hour.
- **Guest notes are erased the day after the event**, from the plan and every `hist:` version; names and
  seats stay. The note field is where allergies (health data) end up, and it serves the evening, not the
  year. The pages say so; do not drop the erasure without changing privacy, terms and dpa. The planner
  says it only in the Excel import (the one way a customer brings notes in) and only on an online plan:
  the erasure is the server's, so a device-only plan keeps its notes and must not be told otherwise.
- **Back office follows `OPERATIONS-PLAN.md`** (approved 2026-10-18). Customer data stays in our SQLite only;
  rejected: syncing to Google Sheets or a CRM (two copies drift, data handed to another company). TakeaSeat
  records payments, Λογιστής issues every receipt. Admin endpoints never return a venue's client cards.
- **Customer memory, not "forever"** (Andreas, 2026-10-18): a memory card kept 5 years after the last contact
  for buyers, 2 for non-buyers, the clock restarting on each new contact; plans are still deleted a year after.
  Andreas wanted "as long as possible"; a restarting fixed period is the longest GDPR allows.
- **A venue on its free year counts as a buyer: 5 years, not 2** (Andreas, 2026-10-18, overriding the suggested 2).
  Today `MEMORY_YEARS = 5` applies to every card; the 2 years is for phase 4's leads, who never bought anything.
  The clock waits while a plan exists or a licence can still make events.
- **Forgetting keeps only what the books need** (Andreas, 2026-10-18): `books:<key>` holds the name and the dates
  of what was bought (seasons, renewals, a couple's purchase), never an email, phone, note, event or timeline.
  Rejected: keeping the card or the address "in case". Every erasure (request, clock, old deletes) goes this one way.
- **A deleted plan keeps the couple's card and email, but takes the address out of the recovery index**
  (`email:`), so the kept address can reopen nothing. Do not put it back in the index "to help recovery".
- **The «Πελάτες» sheet never shows what a venue named its events** (2026-10-18). «Οικογένεια Ζαφειρίου» is the
  venue's client data, which the admin never sees (DPA); the card shows date, kind, phase and seating % only,
  and events pass through the whitelist `custEvent`. Rejected: showing the label "to recognise the wedding".
- **In «Πελάτες», «Όλοι» leaves out the archive, but a search on «Όλοι» looks there too**, and a pending
  signup is its venue's row, not a second one (only a signup whose venue is gone gets its own `s:` row).
  Rejected: an archive in «Όλοι» (the finished ones bury the live ones), and a row per signup (counted twice).
- **admin.html's dialogs are Greek only** (2026-10-21). The bilingual `T(en, el)` helper is gone: every dialog and
  card action runs from a Greek screen, so its English half was never shown. Rejected: keeping both languages
  "in case". The page's remaining English sections move to Greek as each is touched — never back.
- **Text Andreas copies to a customer speaks the customer's words, not admin.html's** (2026-10-21). The copied
  link message follows the link's language and the kind (`CLAIM_MSG`); the venue's copied key says «Κωδικός
  κτήματος», venue.html's own field, though the admin box calls it «Κλειδί κονσόλας». Rejected: copying the box's word.
- **A venue's client card lives in its own `vcli:` row, never in the plan** (phase 3, 2026-10-21): the client opens the plan
  and must never read the venue's notes, and the card must outlive the plan (1–5 years, the venue's choice in `dpa.html` §4).
  A link counts as sent at the venue's first copy (the console cannot see Viber or mail), and events made before
  `meta:clienttrack` never claim «δεν στάλθηκε» / «δεν έχει ανοίξει». Rejected: client fields on the plan or the wedding row.
- **Greek is reviewed by Andreas himself.** Strings a customer reads are written per language and
  cross-checked, never find-replaced: 36 `p_*` strings contain «γιορτ» and name the *event*, while
  only five name the *table*.
- **Phase 4's ready replies are copied, or opened in Andreas's own mail app; the server never mails them** (2026-10-21).
  His mail app keeps the thread and the customer's answer lands in his inbox; a server mail would leave no sent copy
  and add one more route that mails strangers. Opening one writes «✉ Email» to the timeline. Rejected: the plan's
  "send by mail from the card". The payment text keeps «[ΣΥΜΠΛΗΡΩΣΕ…]» gaps (`REPLY_PAY`) until Andreas gives the details.
- **A contact that becomes a customer ends** (`adoptLead`): its timeline, source and next step move to the new card and
  the `lead:` row is erased, so no one is in the sheet twice. Do not keep converted leads "for statistics". A couple's
  or venue's phone stays in their notes, where `phonesOf` finds it for «Γνωστός πελάτης»; rejected: a new phone field.
