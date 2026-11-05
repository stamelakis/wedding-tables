# TakeaSeat — rules for a session in this folder

`HANDOFF.md` is the operations guide (what the product is, roles, lifecycle, Amelie, deploy, access
keys). Read it for anything structural. This file only holds what is easy to get wrong and the
decisions a future session might undo by mistake. `STATUS.md` says where we are.

## Run · build · test

```bash
node tools/build-planner.mjs            # regenerate the planner outputs
node tools/build-planner.mjs --check    # must print "all planner outputs up to date"
node tools/test-api.mjs                 # the whole suite (1796 checks today)
node tools/dev.mjs                      # local stack on :8080 — never `node server/server.mjs`
node tools/dev-customers.mjs            # the same, seeded with one customer per «Θέλουν εμένα» flag and stage
```

Preview with `preview_start {name:"takeaseat-local"}` (`.claude/launch.json`), then
`http://localhost:8080/lab.html?ev=baptism|party|company`. For admin.html's «Πελάτες» use `takeaseat-customers`
(owner key `dev-owner-key`). It runs on `node:sqlite`, because better-sqlite3 has no Windows binary here. `takeaseat-maillog` prints every mail to `preview_logs`, setup links included, so a sign-up can be followed locally.

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
- **Every kind question goes through `KIND_PFX`** (`{wedding:"", baptism:"b_", party:"p_", company:"c_"}`), which
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
- **A self-signed test customer on live also sits in `signups:index`**, beside `venue:`, `email:`, `signup:`, `afm:`, `tok:`, `plan:` and `venues:index`; take only its entries out of the two index rows. Deleting those rows directly writes no `books:` line.
- **A test customer on live leaves a line in the books.** Forgetting a venue keeps `books:v:<id>`, and «Για τα λογιστικά» has no delete button, so a made-up customer stays there unless
  that row and its `books:index` entry are deleted by hand. Ask Andreas first. A live test runs best inside the container (`docker exec -i takeaseat-api node --input-type=module -`), with `OWNER_KEY` from its environment.

## Decisions

One line each, so a session sees the rule. Before changing one, read its full record, with the reasons and what was rejected:
`COMPANIES-PLAN.md` §7, `HANDOFF.md` §10, `OPERATIONS-PLAN.md` §9. New decisions go here in 2–3 lines; move them out when this file nears 150 lines.

### Companies and γραφεία (`COMPANIES-PLAN.md` §7, and §2)

- **Companies and organisers follow `COMPANIES-PLAN.md`.** The word is «Γραφείο εκδηλώσεων», never «διοργανωτής», which means the venue's client on γιορτή screens. A company never keeps guest notes.
- **A company is a `venue:` row with `custType:"company"` and a `per_wedding` licence**, not a new record type. `publicVenue` tells only a company or a γραφείο its `custType`. The ΑΦΜ is editable only on a `custType` row; `books:` keeps the word, never the ΑΦΜ.
- **A company's `per_wedding` quota of 0 means none, never "no limit".** Only «+1 εκδήλωση (25 €)» moves it, a deleted event still counts, and an unused event does not hold the memory clock (`licenceHolds`).
- **A company and a γραφείο tick `dpa.html` at the first opening; nothing answers until then** (`agreement_required`). A Κτήμα signs the paper one.
- **A company and a γραφείο may copy names and seats from an old event; a Κτήμα copies only the room** (`people_not_allowed`). Guest notes never travel (`withoutGuestNotes`).
- **A venue has a list of rooms (`v.rooms`), not one `templateId`** (`roomsOf`, `setRooms`). A company's room has `kind:"company"`; a Κτήμα's has no kind. Events copy a room, so changing it never changes them.
- **`?co=1` / `weddingVenue.company` and `?of=1` / `weddingVenue.office` only choose the login words; they grant nothing.** A bare `venue.html` stays Κτήμα.
- **A company opens its plans in the venue role:** `CO_OWNER` makes `tr` look up `o_<key>` first. A new venue-role string it can see needs an `o_` twin, in three languages. `prof.couplePerms` stays null; PATCH cannot change its kind.
- **A plan is kept 1 to 5 years, the customer's choice, 1 by default** (`PUT /venues/:id/keep`), as `dpa.html` §4 states. A shorter choice deletes what is past it within 24 hours, after a warning.
- **A γραφείο is a `venue:` row with `custType:"organiser"`, a Κτήμα in everything but its word**, sharing the `afm:` free-year fence. `POST /signup/venue` accepts only that word; a company can never sign itself up.
- **`owner.office` makes `tr` look up `g_<kind prefix>key`, then `g_key`, for everyone on a γραφείο's plan.** A new string saying «κτήμα» on a venue plan needs a `g_` twin, in three languages (a test scans; `cUploadNone` is exempt).
- **«Κτήμα» stays where it describes a κτήμα:** the legal pages define it to include a γραφείο, and the Google titles in `STATUS.md` are held back on purpose. Only a γραφείο's and its client's screens must not say it.
- **On a company event's screens: «η εταιρεία» and «η εκδήλωση»,** never «διοργανωτής» or «γιορτή» (a test refuses them in `c_`). Its starter has round tables, a «Σκηνή» and no DJ.
- **The kind makes the customer a company one way only:** to `company` adds `custType`; to a γιορτή it stays a company; to a γάμος or βάπτιση drops `custType` and the ΑΦΜ.
- **A company buying directly opens at once, with no 14-day withdrawal** (terms 8Α). The guide says «παραστατικό» until the accountant answers and promises no keepsake mail.

### The planner, the kinds, keeping data (`HANDOFF.md` §10)

- **A γιορτή starts with NO honour table;** it is an opt-in from the toolbar. Do not copy the wedding's pattern.
- **If one is added it is «Κεντρικό τραπέζι»,** never «Τραπέζι της γιορτής», «Τιμητικό τραπέζι» or «Τραπέζι των οικοδεσποτών».
- **The baptism starter adds exactly one thing, the children's corner.** The filter is "does it change a seating decision", not "is it common".
- **The lab keeps one demo per kind** (`labDoor`). A link naming a kind never rebuilds the open demo.
- **No server-side 8-table cap:** nothing free reaches the server. Build one only together with a free online plan.
- **`lab.html` is the one indexed planner build;** the app builds carry `noindex` because their URLs carry `?plan=` tokens. If the lab goes noindex, remove it from `sitemap.xml` in the same commit.
- **«Δεν σβήνουμε ποτέ» must never be written anywhere** (GDPR storage limitation; for a venue's events TakeaSeat is the processor).
- **Every plan is kept one year after the event, automatically,** read-only from the next day. Change the default and `dpa.html` §4 together, never one. The hourly sweep must keep skipping finished plans via `meta:archive`.
- **Guest notes are erased the day after the event,** from the plan and every `hist:` version (allergies are health data). Do not drop this without changing privacy, terms and dpa. A device-only plan must not be told it happens.
- **Greek is reviewed by Andreas himself.** Customer strings are written per language and cross-checked, never find-replaced.

### The back office (`OPERATIONS-PLAN.md` §9, and §6)

- **Back office follows `OPERATIONS-PLAN.md`.** Customer data stays in our SQLite only, with no Sheets or CRM sync. TakeaSeat records payments, Λογιστής issues every receipt. Admin endpoints never return a venue's client cards.
- **Customer memory is a restarting fixed period, not "forever":** 5 years after the last contact for buyers, 2 for non-buyers; plans still go after their keep period.
- **A venue on its free year counts as a buyer: 5 years** (`MEMORY_YEARS`). The clock waits while a plan exists or a licence can still make events.
- **Forgetting keeps only what the books need:** `books:<key>` holds the name and purchase dates, never an email, phone, note, event or timeline. Every erasure goes this one way.
- **A deleted plan keeps the couple's card and email but leaves the `email:` recovery index.** Do not put it back "to help recovery".
- **«Πελάτες» never shows what a venue named its events** (DPA); events pass through the whitelist `custEvent`.
- **In «Πελάτες», «Όλοι» leaves out the archive, but a search there includes it.** A pending signup is its venue's row, not a second one.
- **admin.html's dialogs are Greek only.** Its remaining English sections move to Greek as each is touched, never back.
- **Text Andreas copies to a customer speaks the customer's words** (`CLAIM_MSG`; «Κωδικός κτήματος», not the admin box's «Κλειδί κονσόλας»).
- **A venue's client card lives in its own `vcli:` row, never in the plan:** the client opens the plan and must not read it, and the card outlives the plan. Events made before `meta:clienttrack` never claim «δεν στάλθηκε».
- **Ready replies are copied or opened in Andreas's own mail app; the server never mails them.** `REPLY_PAY` keeps its «[ΣΥΜΠΛΗΡΩΣΕ…]» gaps until he gives the details.
- **Payments live in one `ledger:<customerKey>` row per customer,** so the checks share one atomic write. A payment is never deleted or re-priced, only cancelled with a reason; refunds are their own entries.
- **A refund closes its due, it never reopens it.** VAT is only what Andreas types until the accountant says otherwise. The only warning is `already_paid`; there is no «more than due» check.
- **The «Για τον Λογιστή» file leaves refunds out and lists only payments with no receipt;** RID is `TAS-<payment id>`. No negative rows, and do not edit Λογιστής's files from here.
- **The prices are written twice, and a test keeps them equal** (`PRICE_PLAN`, `PRICE_SEASON`; the pages and replies). A new price reaches new dues only; never re-price a recorded due or payment.
- **The site has one contact page, `epikoinonia.html`,** opened with `?kind=…&q=…`. No form on each page.
- **The form's "no related mails" tick is stored as `noMail` and sticks** (ν. 3471/2006 άρθρο 11 §3), carried by `adoptLead`. Do not drop it or default it silently.
- **A form from a known email joins that contact.** The mail to Andreas has Reply-To the sender and no hourly cap; the "we got it" mail echoes nothing the sender typed.
- **«Σήμερα» is worded on the server, in Greek,** so the screen, the 08:00 mail and Hermes say the same line.
- **«έγινε» on «Σήμερα» does the real thing where there is one;** elsewhere it hides the line until its situation changes, and money comes back after 7 days if still true.
- **The weekend count never sends the morning mail by itself.** The mail goes only when something waits on Andreas.
- **The backup age comes from the stamp file `/data/backup-ok`,** which `backup.sh` writes. After changing `backup.sh`, install it on the host: deploy.sh only reports the drift.
- **A contact that becomes a customer ends** (`adoptLead`): the `lead:` row is erased, with no "for statistics" copy. A phone stays in the notes, where `phonesOf` finds it; no new phone field.
