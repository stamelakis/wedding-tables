# TakeaSeat — companies and event organisers: the development plan

Written and approved 2026-11-03. **Status: approved by Andreas, all six decisions settled.** Each phase gets its own
session, its own deploy and its own status line in §6.

**The goal, in one line:** a company can plan its own events and come back to them, and an organiser can run events in
any room, each in their own words and on the same one product.

**Done when:** on the live site, with the suite passing:
- a company can be recorded with its ΑΦΜ, plan an event in company wording, buy again and start from its old design;
- an organiser can sign up and run events in different rooms.

---

## 1. Where we start

- **Company dinners are sold today as a «γιορτή».** The home page, the γιορτή guide, the terms and the privacy page name
  «εταιρικό δείπνο». The screen then says «Η γιορτή έγινε» and the starter groups include «Οικογένεια» and «Παιδιά».
- **A company cannot be recorded as a customer.** The chips are Ζευγάρι, Γονείς, Γιορτή, Κτήμα. The ΑΦΜ field shows only
  for a venue, and the server erases it for anything else (`o.afm = ""` in the lead code of `wedding-sync-worker.js`).
  The contact form has no company option. The terms call direct buyers «ιδιώτες», all with the consumer 14-day withdrawal.
- **A direct customer is one event.** A `couple:` record has one main plan; its extra plans follow that plan's date, lock
  and deletion, so that "one paid wedding can never become a second one". A second purchase would be a second row.
- **Designs cannot be revived.** A plan locks the day after the event, stays view-only for a year, then is deleted, and
  new plans are refused once the event is over (`wedding_over`). A free design lives only in the visitor's browser
  (or a file they download from the menu); we never have a copy.
- **A venue has one room.** `v.templateId` holds a single template. The console also works with none: the client then
  sets up the room. «Από υπάρχουσα εκδήλωση…» already copies a room and tables without the people (`layoutOnly`).
- **The server can already keep a plan for a different period**, per venue, per customer and per plan (`retention`,
  up to `MAX_KEEP_DAYS`). The terms, privacy page and `dpa.html` already allow a different period by agreement.

## 2. Decisions (Andreas, 2026-11-03)

1. **Names.** The organiser is a «Γραφείο εκδηλώσεων»; the new kind is «Εταιρική εκδήλωση». Not «διοργανωτής»: on γιορτή
   screens that word already means the venue's client (`custN` in venue.html, nine places in the planner), so screens
   would read "the organiser sends the link to the organiser". Andreas reviews all the Greek as usual.
2. **Prices.** A company pays 25 € with ΦΠΑ per event above 8 tables, which is what the site already says for a company
   dinner. Up to 8 tables is free, through the lab, as today. A γραφείο pays what a Κτήμα pays: 349 € + ΦΠΑ a year, with
   one free year per ΑΦΜ.
3. **What a revive copies, and for how long.**
   - The room and tables always. They hold no guests, so a saved room follows the customer card's clock: 5 years from
     the last contact, restarting with each new contact, and it goes when the customer is forgotten.
   - Names and seats while the old plan still exists.
   - **The company or γραφείο chooses how long a plan is kept: 1, 2, 3, 4 or 5 years, default 1.** They can change it or
     delete sooner. Never "forever". A Κτήμα gets the same choice, since it shares the console, still starting at 1 year.
   - A company must accept `dpa.html` when it buys (a new tick box): its guest list is its own responsibility and we
     store it for it, as for a venue.
   - Couples, parents and private γιορτές stay at one year (Andreas's decision of 2026-10-16).
4. **No separate charge for saving.** The next purchase includes starting from an old design, and the longer periods are
   included too. Every payment is by hand until phase 7 of `OPERATIONS-PLAN.md`, so a charge of a few euros costs more
   work than it earns. Once online payment exists, "1 year included, longer for a fee" is the first candidate.
5. **Company plans open at once**, with no 14-day wait and no 30-day room rule. The wait exists for the consumer
   withdrawal right, which a company does not have, and a returning company wants its old room straight away.
6. **Guest notes are still erased the day after the event, for everyone.** Andreas asked whether a company could choose
   to keep them, then settled on no. Rejected: a company's choice to store them: notes are where allergies end up, and a
   health detail belongs to the guest, so the company's tick does not make keeping it fine. Instead the CSV download
   already includes notes and the import reads them back, so a company keeps its own file and brings the notes in next
   time. The planner says so before the event. Other details that repeat (department, VIP) go in groups, which are kept
   with the names.

**This replaces the decision "one third kind, not several"** in `CLAUDE.md`. The cost of a kind (about 135 strings in
three languages) is accepted knowingly.

## 3. What we build, phase by phase

### Phase 1 — A company as a customer (small)
- «Εταιρεία» and «Γραφείο εκδηλώσεων» as chips in «+ Νέα επαφή» and as filters in «Πελάτες». The ΑΦΜ is kept for both,
  and «Γνωστός πελάτης» finds them by it.
- Both as choices on `epikoinonia.html`, with the "no related mails" tick as it stands.
- Until phase 3, «Έγινε πελάτης» sells through today's dialogs (a company through «+ Ιδιώτης» as a γιορτή, with its ΑΦΜ on
  the card and in the «Για τον Λογιστή» file; a γραφείο through «+ Κτήμα»).
- *Done when:* a company and a γραφείο can each be added, found by ΑΦΜ and turned into a customer, appearing exactly once;
  a form sent as a company arrives with that type. Tests for each, checked on screen at phone width.

### Phase 2 — The fourth kind, «Εταιρική εκδήλωση» (large)
- Builder, PDFs, emails, `trapezi.html`, `venue.html`, the demo (`lab.html?ev=company`, one more door in `labDoor`).
- Starter: no head table, opt-in as for a γιορτή, named «Κεντρικό τραπέζι». Starter groups proposed for Andreas to read,
  under the filter "does it change a seating decision"; no «Οικογένεια» or «Παιδιά».
- A new guide page for company events; the γιορτή pages stop naming «εταιρικό δείπνο» and link to it. Terms, privacy and
  `dpa.html` define the fourth kind. Existing company dinners stay γιορτές until someone changes the kind.
- On an online company plan, before the event, the planner says the notes go the day after and that the CSV download
  keeps a copy (decision 6). Not on a device-only plan: the erasure is the server's.
- *Done when:* a company event reads right from demo to PDF in all three languages, Andreas has read the Greek, converting
  a plan between all four kinds keeps custom labels, and the tests compare the new strings with the server's.

### Phase 3 — One console, saved rooms, start from an old design (medium to large, changes the data)
- **Design to confirm at the start of this phase:** a company gets the same console as a Κτήμα, paying per event instead
  of per year, rather than a `couple:` record stretched to hold many events. It gives one row per customer, the room list,
  the retention setting and the agreement without new machinery, and decision 5 comes free: the phase rules never limit
  a venue. Its cost is a key to keep, with the existing recovery mail. Needs a per-event allowance (Andreas records the
  payment, an event becomes available) and a move for any company sold through «+ Ιδιώτης» in the meantime.
- A list of saved rooms replaces the single template; choosing one when an event is created. Existing venues keep theirs
  as the first entry. This also answers the home page's «Έχετε περισσότερους από έναν χώρους δεξιώσεων;».
- «Ξεκίνα από παλιό σχέδιο»: room and tables, optionally names and seats, in a new event. Never the notes.
- The 1–5 year choice beside «Μνήμη πελατών», warning what would go when the period is shortened, as that one does.
- *Done when:* automated tests for the normal cases, the edge cases and the failures (a deleted source, another customer's
  plan refused, notes never copied, a shortened period, forgetting a customer takes its rooms); `/security-review`;
  backup before the deploy; a real run through on screen.

### Phase 4 — The organiser in public (medium)
- `venue.html` sign-up asks Κτήμα or Γραφείο εκδηλώσεων, and the console, mails and planner speak its word (about 30 Greek
  lines in the planner say «κτήμα»; the customer-facing ones must follow the account type).
- A section on the home page, a guide page, and `terms.html` and `dpa.html` naming the γραφείο.
- *Done when:* a γραφείο signs up on the live site, makes two events in two saved rooms, and neither it nor its client
  meets the word «κτήμα» anywhere. Andreas has read the Greek.

## 4. For the lawyer and the accountant (add to the lists in `STATUS.md`)

- **Lawyer:** the 1–5 year choice; a company as controller and the tick accepting `dpa.html`; no consumer withdrawal for
  a company buying for itself, and the terms' «ιδιώτες» wording; a saved room's table labels can hold a person's name.
- **Accountant:** invoices to companies at 25 € per event, together with the open question of who issues receipts.

## 5. For the agent building it

- Every kind goes through `KIND_PFX`, identical in `planner.src.html`, `wedding-sync-worker.js`, `server/pdf.mjs` and
  `trapezi.html`. Also `EVENT_KINDS`, `STARTER_WORDS`, `CUST_TYPE`, `CONTACT_KINDS`, `LEAD_TYPES`, `KINDS` in
  `epikoinonia.html`, `EV` in `venue.html` and admin.html, and the lab's `ev=` pattern. The kind's value is `company`;
  choose a prefix that clashes with no existing key.
- The planner and the server must write identical starter words. «Τραπέζι τιμής» can never be one.
- `layoutOnly(src, fromWedding)`: with `true` it resets the groups and drops the client's decor, which is right between a
  venue's different clients. A company's or γραφείο's copy of its own design needs its own rules; do not reuse it blindly.
- Names copied into a new plan go through `withoutGuestNotes`, whatever the source's age.
- Anything that moves a deletion date must clear that plan from `meta:archive` (see the comment above `ARCHIVE_KEY`), or
  the hourly sweep goes on skipping it. The public pages and `dpa.html` §4 change together with any default.
- New pages go in the Dockerfile's two lists and `sitemap.xml`. Tests read `planner.src.html`, never the built pages.
- The CSV download carries notes; the .xlsx download does not. The planner mentions the erasure only on online plans.

## 6. Phase status

| Phase | Status |
|---|---|
| 1. A company as a customer | Live 2026-11-03 (`924490c`, `deploy-2026-11-03-1`) |
| 2. The fourth kind | Not started |
| 3. One console, saved rooms, old designs | Not started |
| 4. The organiser in public | Not started |
