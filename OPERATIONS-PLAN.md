# TakeaSeat — daily operations: the development plan

Written 2026-10-18, revised the same day (customer memory, the venues' own sheet). **Status: approved by
Andreas on 2026-10-18, with all seven decisions in §6 accepted as suggested.** Each phase below gets its own
session and its own status line here (§8) as it moves.

**The goal, in one line:** every customer, from the first message to years later, is one row you can see,
tap and act on from your phone, and the system tells you each morning what needs you. Nothing about a
customer lives only in your head, your phone or your mailbox. Venues get the same for their own clients.

---

## 1. Where we start (what exists today)

- **The database.** One SQLite file on the server; every record is one row holding JSON (`venue:…`, `plan:…`,
  `signup:…`). Backed up every night, encrypted, copied off-site. **We keep it.** At our size (hundreds, even a
  few thousand customers) it answers instantly. The "sheet" you want is a *screen* on top of this database,
  not a second database.
- **admin.html today** has separate lists: Venues, Direct customers, Signups, Support requests, a lookup tool,
  trash, the after-the-event settings. Each answers one question. None answers "who needs me today?".
- **venue.html today** has a searchable list of the venue's events with progress and last change. It holds no
  contact details of the couple, no notes, no history.
- **History today.** Each plan has an access log (who opened, saved, reset a link, changed the date, support
  visits). Venues and signups have no history of their own. Calls, Viber messages, offers: recorded nowhere.
- **Memory today.** When a couple's plan is deleted (a year after the event) their email goes with it;
  privacy.html promises exactly that. If they write again for a baptism, nothing recognises them.
- **Payments today.** None in the system. Money arrives outside it; a direct customer's `paidAt` is simply the
  moment you created them; a renewal shows "invoice due" until you press «invoiced». Legal receipts come from
  the Λογιστής app (myDATA).
- **How people reach us today.** Couples: a mailto link. Venues: the self-signup form, or phone / Viber /
  WhatsApp. Facebook, Instagram, Amelie referrals, word of mouth: no record.
- **Already automatic** (keeps running, nothing to build): the hourly sweep (lock after the event, keepsake
  mail, deletion a year after, trash, season renewals and their reminder mails), signup expiry, nightly
  backups, two uptime monitors, one mail to you per new signup.

## 2. Rules this plan keeps

1. **You never see a plan's content, nor what a venue keeps about its own clients.** Your sheet shows status,
   dates and counts, the same things admin.html shows today. Never guest names, seating or notes. That is a
   promise in privacy.html and terms.html.
2. **One copy of the data, on our server.** Rejected: syncing customers into Google Sheets or a CRM
   (HubSpot, Pipedrive). That means two places that drift apart, customer data handed to another company, and
   new privacy-page and DPA wording. When you need a spreadsheet, the sheet has an Excel export button.
3. **TakeaSeat records payments; Λογιστής issues receipts.** TakeaSeat never issues a tax document itself. One
   set of books, one myDATA connection.
4. **Every manual step takes three taps or fewer on a phone.**
5. **A customer memory on a clock that restarts.** When someone comes back, you see who they are and what
   they had before. Each customer has a **memory card**: name, email, phone, ΑΦΜ (businesses), how they found
   us, what they asked for, what they bought and when, amounts, the kind and date of each event, the venue's
   name, the stages they went through, your notes, why they did not buy. It never holds anything from inside
   a plan.
   - **Customers who bought: kept 5 years after the last contact, purchase or event.** Each new one restarts
     the 5 years, so a customer who keeps coming back is never forgotten. Five years spans a wedding, the
     first child's baptism and usually the second.
   - **Contacts who never bought: 2 years after the last contact**, restarting the same way.
   - **Plans are unchanged:** guest notes are erased the day after the event, the plan a year after.
   - **Tax records** (payments, receipt numbers) stay as long as tax law requires, even after the memory card
     is gone, reduced to name and amounts.
   - **Anyone can ask to be forgotten**, and the card is erased (tax records excepted). Note fields say "no
     health information".
   - "Keep it forever" is not allowed (GDPR storage limitation; see CLAUDE.md, Decisions). A fixed period
     that restarts with each new contact is allowed. The 5 and 2 years are our proposal; the lawyer
     confirms them. privacy.html changes with them, because today it promises that a couple's email is
     deleted with the plan. The cheap moment to change that is before the first real customers.

## 3. The customer journey, contact to done

There is one **Stage** column for every customer:

| # | Stage | Meaning | Set by |
|---|---|---|---|
| 1 | Νέα επαφή | someone wrote or called, not answered yet | form / you |
| 2 | Σε συζήτηση | answered, waiting on them (price sent, demo link sent) | you |
| 3 | Αναμένεται πληρωμή | they said yes, payment details sent | you |
| 4 | Ενεργοποίηση | paid or signed up, link sent, not opened yet | system |
| 5 | Ενεργός | using it, has an upcoming event | system |
| 6 | Ανανέωση | venue: free year or season ends within 60 days, or invoice due | system |
| 7 | Ολοκληρώθηκε | couple: event done · venue: did not renew | system |
| 8 | Δεν προχώρησε | a contact who did not buy (with the reason) | you |

Stages 4–7 are worked out from data that already exists, so you never set them by hand. A venue's weddings
are *events of that venue*, not separate customers: the venue is your customer, its couples are the venue's
(phase 3 gives the venue its own sheet for them).

**A venue, step by step**

1. Calls, writes or signs up → a row appears (by itself for the form and the signup; one tap for a call).
2. You answer (template), send the lab link → *Σε συζήτηση*, with a follow-up date.
3. It signs up for the free year → *Ενεργοποίηση*. Setup link unopened after 3 days → on your morning list.
4. It opens the link and builds its space → *Ενεργός*. No wedding after 14 days → on your list (a call helps).
5. The free year ends in 60 days → *Ανανέωση*: you send the season offer; the expected 129 € + VAT appears.
6. Payment arrives → you record it (3 taps), issue the receipt in Λογιστής, tick «paid season».
7. Every later season: renewal reminder mails (automatic) → invoice due → paid → receipt. If it cancels →
   *Ολοκληρώθηκε* with the reason.
8. Years later the same venue, or a new owner of it, calls again → the sheet recognises the ΑΦΜ, email or
   phone and shows its memory card.

**A couple or parents (direct), step by step**

1. Writes through the form / calls / comes from Amelie → *Νέα επαφή*.
2. You answer with the price and how it works → *Σε συζήτηση* → they agree → *Αναμένεται πληρωμή*.
3. Payment arrives → «Έγινε πελάτης» turns the contact into a customer (form prefilled), the claim link is
   mailed, you record the payment and issue the receipt.
4. 14-day wait (automatic) → planner opens → *Ενεργός*. Claim link unused after 3 days → on your list.
5. Names phase, full phase, the event (automatic). Optional: event in 7 days and seating under half done → on
   your list, a good moment for a friendly call.
6. Day after the event: locked, keepsake mailed (automatic) → *Ολοκληρώθηκε*.
7. A year later the plan is deleted (automatic). **The memory card stays** for 5 years from the last contact.
8. They write again for their child's baptism → the sheet recognises the email or phone: "γάμος 6/2026,
   Κτήμα …, πλάνο 19 €". The new event joins the same card and the 5 years start again.
9. A withdrawal within 14 days: you record the refund against the payment, Λογιστής issues the credit note.

## 4. What we build, phase by phase

Each phase is one session (two at most), ends deployed and checked on your phone, and is useful on its own.

### Phase 1 — «Πελάτες»: one sheet for everyone
*Read-only, no new data, lowest risk.*
- A new first screen in admin.html: one table, one row per customer: venues, direct customers, signups not
  yet confirmed (contacts join in phase 4).
- Columns: name · type (κτήμα / ζευγάρι / γονείς / γιορτή) · stage · next event date · events (upcoming /
  total) · licence or plan until · last activity · email and phone (tap to call, Viber or mail) · ⚑ flags.
- Filter chips: Όλοι · **Θέλουν εμένα** · Κτήματα · Ιδιώτες · Εκδήλωση σε 14 ημέρες · Λήγουν σε 60 ημέρες ·
  Αρχείο. One search box (name, email, ΑΦΜ, phone). Sort by any column. On a phone the rows become cards.
- «Θέλουν εμένα» flags: setup link unopened after 3 days · confirmed venue with no wedding after 14 days ·
  claim link unused after 3 days · renewal invoice due or renewal skipped · free year ends within 60 days ·
  open support request.
- Tap a row → the **customer card** (read-only in this phase): details, licence or plan state, every event
  with its date and phase, each plan's existing access log, signup details.
- «Excel» button: what is on screen, as a file.
- *Done when:* every venue, direct customer and pending signup appears exactly once with the right stage;
  each flag shows up for a test customer built to trigger it; a test proves the new endpoint never returns a
  key, link or guest name; checked on desktop and phone width.

### Phase 2 — The customer card becomes where you work, and remembers
- Every button of the old lists moves into the card (send link, new link, edit, reset key, unfreeze, licence,
  delete). The old separate lists then go.
- **Private notes**, one box, saved as you type (it joins today's venue `notes` and couple `contact`).
- **Επόμενο βήμα**: what and when ("call about the renewal, 3/11"). On that day it appears in «Θέλουν εμένα».
- **Timeline**, newest first, one list merging: system events (signup, link opened, plan claimed, date
  changes, link resets, support visits, reminder mails, keepsake, lock, deletion) and your own entries
  («Τηλεφώνησα», «Viber», «Έστειλα προσφορά» + a line of text), each one tap.
- **The memory card and its clock** (rule 5): deleting a plan no longer drops the couple's email; the card
  keeps it, with the date it will be forgotten shown on the card. The sweep erases cards whose clock ran out.
  «Ξέχασέ τον» erases one on request (tax records stay). privacy.html and terms.html change with it (Greek
  reviewed by you).
- *Done when:* every old button works from the card; a note, a next step and an entry survive a reload;
  system events show with the right dates; tests prove a card outlives its deleted plan, restarts its clock
  on a new event, is erased on its date and on request, and that tax records survive the erasure; tests for
  each new endpoint, including "owner key only".

### Phase 3 — The venue's own sheet (venue.html)
*The same idea, for the venue's clients. TakeaSeat only processes this for the venue (DPA); you never see it.*
- «Εκδηλώσεις» becomes a sheet: one row per event: name, kind, date, the client's phone and email (new,
  optional, typed by the venue), stage (link not sent · client has not opened it · seating in progress, % ·
  ready · done), last change by the client, flags.
- Filters: Επερχόμενες · Αυτόν τον μήνα · **Θέλουν προσοχή** (event in 14 days and seating under half;
  client never opened the link) · Παλιές. Search, sort, «Excel».
- Tap a row → the **event card**: details, the client's contact (tap to call, Viber, mail), the venue's
  private notes (the client never sees them), next step and date, timeline (client opened the link, saves,
  date changes, new links, support visits), the PDFs.
- **The venue's memory**: when the plan is deleted a year after the event, the client card stays (name,
  contact, kind and date, notes, never the guest list) for 5 years by default, which the venue can shorten.
  When the same family books a baptism, the venue sees "γάμος εδώ, 6/2026". dpa.html §4 and privacy.html
  change together with this default, never one without the other.
- **First version only.** Two bigger things wait until real venues ask for them (decision 7): enquiries
  with a date calendar (couples asking "is 12 June free?"), and the venue's own payments from its clients
  (deposit, balance, due dates).
- *Done when:* a venue sees only its own clients (test); a client never sees the venue's notes or flags
  (test); a client card outlives its deleted plan and goes at the venue's chosen date (test); no admin
  endpoint returns a venue's client data (test); checked on a phone with test data; dpa.html and
  privacy.html updated, Greek reviewed by you.

### Phase 4 — Every contact lands in your sheet
- **«+ Νέα επαφή»**, made for the phone: name, how they came (τηλέφωνο, email, Viber, WhatsApp, Facebook,
  Instagram, Amelie, σύσταση, άλλο), what they are, event date or venue, one line, next step. Under 30 seconds.
- **«Γνωστός πελάτης»**: as you type an email, phone or ΑΦΜ (and on every form submission) the sheet checks the
  memory cards and shows the match: what they had, when, and what was said. One tap adds the contact to
  that card instead of a new row.
- **A contact form on the site** replaces the couples' mailto: name, email, phone (optional), kind of event,
  date, message. It creates the contact, mails you, and sends the person an automatic "we got it" (el / en).
  Same spam limits as the venue signup.
- **«Έγινε πελάτης»** opens the existing add-customer or add-venue form prefilled; the history carries over.
- **Reply templates**, 4–6 texts: price and how it works (couples / venues), payment details, welcome,
  reminder. Copy with one tap, or send by mail from the card (logged in the timeline). Greek reviewed by you.
- «Δεν προχώρησε» + reason (τιμή, δεν απάντησε, άλλη λύση…); the card follows the 2-year clock.
- If decision 6 is yes: wherever we take an email (the form, the purchase) one line says we may write
  about a related event later and how to say no. Building the mailings themselves is a later step, each one
  with your OK.
- Rejected for now: reading the info@ mailbox automatically. It is fragile, and it would put the mailbox
  password on the server a second time. A "forward a mail to make it a contact" can come later if needed.
- *Done when:* a form sent on the live site appears in the sheet within seconds and you get the mail; a known
  email is recognised; a phone contact is entered in under 30 s; converting a contact keeps its history;
  spam limits and the 2-year clock are tested.

### Phase 5 — Payments
*Money: full tests, `/security-review`, backup before deploy.*
- Each customer card gets **Πληρωμές**: expected and received.
- **Record a payment** when the bank shows it: amount, date, method (τραπεζική μεταφορά, IRIS, κάρτα,
  μετρητά, άλλο), what for (σεζόν 2027, πλάνο, επιπλέον πλάνο), the receipt number from Λογιστής (can be
  filled in later), a note.
- **Expected payments appear by themselves**: a new direct customer, a free year ending, a season renewal.
  Overdue ones go to «Θέλουν εμένα». The sheet gets a payment column: πληρωμένος / αναμένεται / καθυστερεί /
  δωρεάν έτος.
- **The «Πληρωμές» screen**: every payment, filters (month, season, method, «χωρίς απόδειξη»), totals per month
  and per season, the year-to-date total (TakeaSeat's part of the €10,000 VAT question), Excel export for the
  accountant.
- Refunds and withdrawals are entries linked to the original payment. A payment is never deleted, only
  cancelled with a reason. Amounts are stored in cents. VAT is shown as you enter it, never computed, until
  the accountant confirms the VAT position.
- Hand-over to Λογιστής: a file it can read. An automatic hand-over is a Λογιστής session, with your OK.
- *Done when:* automated tests for the normal cases, the edge cases (refund, partial payment, a renewal paid
  twice, cancellation) and the failures; the totals match a worked example done by hand; security review
  passed.

### Phase 6 — «Σήμερα» and a morning summary
- admin.html opens on **Σήμερα**: one list, grouped: new contacts to answer · next steps due · payments to
  check or overdue · receipts to issue · renewals within 30 days · stuck activations · support requests ·
  this weekend's events (how many) · system (failed mails, and backup age / disk where the server can see them).
- Each item: one tap to the card, one tap «έγινε» or «αύριο».
- **A mail at 08:00 Athens** to you only, and only when the list is not empty.
- **Hermes**: «τι έχει σήμερα το TakeaSeat;» reads the count and the top three (read-only).
- *Done when:* with test data, each kind of item appears and goes away when handled; the mail goes out once a
  day and never on an empty day; the Hermes answer is checked with `sim_match.py` and its tests.

### Phase 7 — Online payment (later)
Couples pay the 19 € online (card, IRIS, Apple / Google Pay) and get their plan with no step from you;
venues pay their season through a payment link; each payment lands in the ledger by itself.
**Not scheduled.** It needs: the company (or the accountant's answer on who sells until then), a payment
provider chosen after research at that time (Viva Wallet, Stripe, IRIS through a bank: fees, payouts, myDATA
link), the withdrawal button of ν. 5317/2026, updated terms, and the lawyer's view on the couples' withdrawal
options (HANDOFF §8.6).

## 5. Your routine once phase 6 is live

- **Every morning, 5–10 minutes on the phone:** open «Σήμερα» → answer new contacts (templates) → record the
  payments the bank shows → issue receipts in Λογιστής for «χωρίς απόδειξη» → do the next steps due today.
- **During the day:** a call or message from someone new → «+ Νέα επαφή» (it tells you if you know them);
  from a customer → one line in their timeline.
- **Mondays:** renewals within 30 days, stuck activations, how last weekend's events went.
- **Monthly:** the payments export to the accountant.
- **The system on its own:** reminder mails, renewals, locking, keepsakes, plan deletion, forgetting
  memory cards whose clock ran out, backups, monitoring, the morning mail.

## 6. Decisions (all seven accepted by Andreas as suggested, 2026-10-18)

1. **Payment methods to offer until phase 7.** The ledger accepts any method; which ones the price page and
   the templates mention is your call. Suggestion: bank transfer and IRIS.
2. **Who issues receipts for TakeaSeat sales until the company exists?** A question for the accountant. It only
   blocks the receipt-number part of phase 5, not recording payments.
3. **A contact form replaces the couples' mailto** (phase 4). Suggestion: yes.
4. **Memory periods:** 5 years for customers who bought, 2 years for contacts who did not, each restarting
   with every new contact, purchase or event; venues' client cards 5 years by default. Suggestion: yes, and
   the lawyer confirms the numbers.
5. **Seating progress as a percentage in your sheet** (e.g. "event in 5 days, 40 % seated"), never names. It
   lets you call before trouble starts. Suggestion: yes, from phase 1.
6. **Writing to past customers about a related event** (wedding → baptism), with "say no" offered when we
   take the email and in every mail. Greek law allows this for your own customers and a similar service
   (ν. 3471/2006 άρθρο 11 §3, the lawyer confirms). Suggestion: yes, add the line now (phase 4) and decide
   on actual mailings later. Without the line now, it cannot be done later for the customers in between.
7. **The venue sheet's first version** (phase 3): sheet, card, client contact, notes, next step, timeline,
   memory. Enquiries with a date calendar and the venue's own payments wait until real venues ask.
   Suggestion: yes.

## 7. For the agent building it (technical notes)

- New rows: `lead:<id>`, `act:<customerKey>` (timeline, capped), `pay:<id>` + `pays:index`, `snooze:<item>`,
  `vcli:<venueId>:<clientId>` (a venue's client card). Customer keys: `v:<venueId>`, `c:<coupleId>`,
  `l:<leadId>`. «Σήμερα» is computed on request, not stored.
- Memory card: `lastTouch` (last contact, purchase or event date) and `forgetAt` = lastTouch + 5 years
  (bought) / 2 years (never bought) / the venue's setting (venue client cards). The sweep erases at `forgetAt`
  (nightly pass is enough). Erasure keeps `pay:` rows, reduced to name and amounts.
- The plan-deletion step in the sweep currently drops the couple's email (privacy.html promises it). Change
  the step and the page in the same commit.
- Endpoints under `/admin/` (owner key): `GET /admin/customers`, `GET /admin/customers/:key`, leads, payments,
  `GET /admin/today`. Venue client cards under `/venues/:id/…` (venue key only, never in any `/admin/` answer).
  Public `POST /contact`: JSON only, same-origin, rate limits like `POST /signup/venue`.
- Write the API in `wedding-sync-worker.js` only. Tests go in `tools/test-api.mjs`. Any new file a test reads
  goes into the Dockerfile check stage. Any new public page goes into the Dockerfile page list and the sitemap.
- A test feeds a fixture plan with known guest names and asserts no admin endpoint ever returns one, nor any
  key, token, link or venue client card.
- Labels on the new screens are Greek; admin.html's existing English labels move to Greek as each part is
  touched.
- **Phase 1 as built.** `GET /admin/customers` → `{ at, today, customers: [row] }`; `GET /admin/customers/:key` →
  `{ customer: row, venue?, setup?, licence?, couple?, signup?, template?, events: [] }` (`customerList` /
  `customerCard` in the worker). Flags are codes (`setup_unopened`, `no_event`, `claim_unused`, `invoice_due`,
  `renew_skipped`, `trial_ending`, `support_open`); admin.html turns them into words (`C_FLAG`). An event
  reaches the card only through the whitelist `custEvent`: add a field there, never spread a plan or a
  venue's wedding row (its label is the venue's client data). A pending signup is its venue's row; only a
  signup whose venue is gone gets its own key, `s:<signupId>`. Local test data with one customer per flag and
  stage: `node tools/dev-customers.mjs` (preview «takeaseat-customers»).
- **Phase 2 as built.** The card adds `notes`, `nextStep {text,due,at}`, `past [{kind,date,createdAt,goneAt,extra}]`,
  `memory {lastTouch,forgetAt,years,held}` (`held` = "plans" | "licence" | null; null for `s:`) and `timeline
  [{at,code,…}]` — codes only, worded in admin.html (`cTlWords`); his own entries are `act:<key>` rows (capped
  500). Notes stay in the old fields (venue `notes`, couple `contact`, signup `notes`, 2000 chars). Routes under
  `/admin/customers/:key/`: `PUT notes`, `PUT|DELETE next`, `POST next/done`, `POST timeline {kind,text}`,
  `DELETE timeline/:id`, `POST forget`; plus `GET /admin/books`. The flag `next_due` joins the list.
  **One erasure path**: «Ξέχασε τον πελάτη», the old couple/venue/signup deletes and the clock all go through
  `eraseCouple` / `eraseVenue` / `eraseSignup`, which keep only `books:<key>` (a venue: name, licence type, dates
  of seasons and renewals; a couple: name, kind, purchase date; nothing for a free year alone). A self-signup
  venue takes its `signup:` row with it at once. The clock is `MEMORY_YEARS = 5` for every customer (Andreas,
  2026-10-18, free-year venues included; the 2 years for non-buyers waits for phase 4's leads). It waits while
  a plan exists or a licence can still make events; `memorySweep` erases in the nightly pass. A deleted plan
  keeps the couple's card and email but takes the address out of the recovery index. In admin.html the old
  couple, venue and signup lists are gone: «+ Κτήμα» / «+ Ιδιώτης» open the create forms in a dialog, the
  signup prune and «Για τα λογιστικά» are in Εργαλεία, and every action runs from the card (`cardAction` reuses
  `coupleAction` / `venueAction` on the `couplesCache` / `venuesCache` row; answers land in a holder kept across
  redraws). Still English: the create, edit and trash dialogs and the key/link boxes.
- **Phase 3 as built.** A venue client card is `vcli:<venueId>:<clientId>` `{id, venueId, name, phone, email, notes,
  next {text,due,at}, past [{kind,date,label,createdAt,goneAt,deleted?}], createdAt, updatedAt}`; the venue's wedding
  row carries `clientId` and `linkAt` (first copy of the client's link), the plan `seenAt` (the client's first open)
  and `clientSavedAt` (the client's last save) — couple role on a venue plan only. A new client link clears `linkAt`
  and `seenAt`. `meta:clienttrack {since}`: events made before it never show «δεν στάλθηκε» / «δεν έχει ανοίξει»
  (we cannot know). The venue's `clientYears` (1–5, default 5). Routes (venue key only): `GET /venues/:id` rows add
  `client`, `linkAt`, `seenAt`, `savedAt`, and the answer adds `clients` (cards whose events are all gone, with
  `last` — a real event first, a deleted one only when that is all), `clientYears`, `trackSince`;
  `POST …/weddings/:pid/sent`; `GET …/weddings/:pid/card` → `{client, timeline}` (codes `created`, `sent`, `seen`,
  `saved`, `notes_gone`, `audit` + `what`; worded in venue.html `tlWords`); `PUT …/weddings/:pid/client` (makes the
  card on the first write; two first writes at once end on one card); `GET|PUT|PATCH|DELETE /venues/:id/clients/:cid`;
  `POST …/clients/:cid/join {from}`; `PUT /venues/:id/memory {years}`. Memory: `lastTouch` = the latest of the
  card's creation and its events' dates (a future date counts as today); held while an event exists, the trash
  included; the nightly pass erases. Whenever an event's plan goes (a year after, the trash emptied by the sweep or
  by the admin's «erase now»), `clientEventGone` writes it into `past`. venue.html: the sheet (`stageOf`, `flagsOf`,
  `sheetItems`, `FILTERS`, `sheetVisible`, `exportSheetCsv`) and the card (`eventCard` / `clientCard` → `drawCard`;
  `redrawCard` never redraws the notes; writes go one at a time through `cardWrite`; notes flush on any dialog
  change). Test data: `node tools/dev-customers.mjs` also seeds «Κτήμα Ροδακινιά» and prints its console key
  (`<id>.dev-venue-key`).
- **Phase 4 as built (part A: everything but the site's form).** A contact is `lead:<id>` `{id, name, source, type
  (venue|couple|parents|party), date, place, email, phone, afm (venue only), stage 1|2|3, lost {reason, at}?, notes,
  nextStep, moves [{at, stage, reason?}], createdAt, updatedAt}`, listed in `leads:index` (cap 3000), its timeline in
  `act:l:<id>`; customer key `l:<id>`. Stages 1 Νέα επαφή, 2 Σε συζήτηση, 3 Αναμένεται πληρωμή, 8 Δεν προχώρησε
  (= `lost`; archived with 7). Flag `lead_new` while at stage 1. Routes (owner key): `POST /admin/leads`;
  `POST /admin/match {email, phone, afm, except}` → up to 5 cards (POST so a typed number never sits in a URL; it
  never reads `vcli:`); `POST /admin/customers/:key/contact {source, text, stage?, next?}` on any card (a lost contact
  goes back to 2); `PATCH /admin/customers/l:<id>/lead`; `POST /admin/customers/l:<id>/stage {stage, reason?, text?}`.
  «Έγινε πελάτης»: `POST /admin/couples` and `POST /admin/venues` take `fromLead` (409 `lead_gone`); after the create,
  `adoptLead` merges the acts into the customer's `act:` row, sets `fromLead {source, at}` (the card's «Πώς μας
  βρήκε»), copies the next step if the customer has none, turns the lead's `moves` into `{kind:"stage"}` acts (shown as
  `stage` on the timeline, not deletable), and erases the lead. A new contact on any card stamps `contactAt`, which
  `custRow` folds into «Τελευταία κίνηση» (his own «Τηλεφώνησα» lines still do not move it). The lead's notes go across through
  the prefilled form's notes field. Venues now keep `afm` (shown and matched only; the free-year fence is still the
  signup's `afm:` row). A couple's or venue's phone stays in the notes, where `phonesOf` finds it. Memory: 2 years
  after the latest of creation, moves and acts; the nightly pass erases, keeping no books. admin.html: `openNewLead`,
  `leadFormHtml` / `wireLeadForm` (chips; stage default follows «Τηλέφωνο»), `knownHtml`, `leadAction`, `REPLIES`
  (five texts; `REPLY_PAY` holds the IBAN/IRIS gaps), `showReply`. The replies are copied, or opened in his mail
  app (`mailto:`), which writes «✉ Email» to the timeline — nothing is mailed by the server, unlike the plan's
  "send by mail from the card".
- **Phase 4 as built (part B: the site's form).** One page, `epikoinonia.html` (Greek, `?lang=en` for English;
  `?kind=wedding|baptism|party|venue&q=start|ask|demo|other` preselects), replaces every `mailto:…?subject=` on
  index.html and the three guides; the plain info@ address stays in the help lines. It posts JSON to the public
  `POST /contact` {kind, topic, name, email, phone?, date?, place?, message?, nomail?, lang, website}. Only those fields
  are read (`contactFields`): one-line fields stripped of control characters and capped at 120, the message at 1000,
  a date from today up to 5 years ahead and never for a venue. Limits: 5 a day per IP (plus server.mjs's 5 an hour
  and 20 mails an hour per IP), 50 a day in total (then one `ownerContactFull` mail a day and 503 `busy`), a honeypot
  `website` that answers ok and writes nothing, JSON-only + own origin, `LEAD_MAX`. A known email (newest `lead:`
  with that address) joins that contact: empty fields are filled, a lost one goes back to stage 1, an opt-out sticks.
  Otherwise a new lead with `source:"form"` (a source only this route writes; shown as «Φόρμα σελίδας», not a chip),
  `lang`, and `noMail` when ticked; the act is `{kind:"contact", source:"form", text: topic — message}` and stamps
  `contactAt`. Mails: `contactAck` (el/en, fixed text that echoes nothing, 3 a day per address) and `ownerContact` to
  the verified owner address with the message, «Γνωστός πελάτης» matches and `replyTo` the sender (no hourly cap,
  only the 50-a-day ceiling, so a real message is never dropped). `noMail` shows on the card and carries over in
  `adoptLead`; a contact's card also gets `known` (added at route level, since `knownCustomers` calls `customerCard`).
- **Phase 5 as built.** Not `pay:<id>` + `pays:index` as planned above: one row per customer, `ledger:<customerKey>`
  `{cust, name, type, dues[], pays[], erasedAt?}`, so «already paid», a refund's ceiling and «no cancelling a refunded
  payment» are checked in one atomic `kvUpdate`. Customers only (`v:`, `c:`), never `l:` or `s:`. Amounts are integer
  cents (1 … 10,000,000); `vat` is what he typed, never computed. A due `{id, what (season|plan|extra|other), about, from,
  to, amount, plusVat, due, src, waived {reason, at}?}`; a payment `{id, amount, vat, date, method (bank|iris|card|cash|
  other), what, about, dueId?, receipt, note, at, refundOf?, reason?, cancelled {reason, at}?}`. Dues appear by
  themselves (`addDue`, once per season / purchase): a couple made by hand (19 €) and a venue made with a season,
  late 7 days after creation (`DUE_NEW_DAYS`); an automatic renewal, late 30 days into the season (`DUE_RENEW_DAYS`);
  a free year turned into a season, late at max(day after the free year, today + 7). Two are derived, not stored
  (`derivedDues`): `inv-<seasonStart>` for an old `invoiceDue`, and `trial-<seasonEnd>` (a «prospect», never late)
  from 60 days before a free year ends. Paying or waiving one stores it; paying or waiving the season the licence is in
  clears `invoiceDue` (`settleInvoice`). `dueState`: partial payments add up, on a «+ΦΠΑ» due net of the VAT typed
  (`payNet`); states paid · waived · refunded (any refund closes the due, it never reopens) · late · due. Customers
  from before the ledger owe nothing on screen. The sheet row gets `pay {state, owed}` and the flag `pay_overdue`
  (`withPay`). Routes under `/admin/customers/:key/` (owner key): `POST pay` (409 `already_paid` {paid} unless
  `force:true`), `PATCH pay/:id {receipt?, note?}` (nothing else ever changes), `POST pay/:id/refund` (409
  `more_than_paid` {left}), `POST pay/:id/cancel {reason}` (not while it has a live refund), `POST dues`,
  `POST dues/:id/waive {reason}`, `POST dues/:id/unwaive`; each answers `{ok, id?, payments}`. `GET /admin/payments`
  → `{today, payments [{key, name, type, gone, …}], totals {months, years, seasons}, ytd}`; cancelled entries count
  nowhere, a refund counts in the month it was paid back. Erasure (`eraseLedger`, from `eraseVenue` / `eraseCouple`)
  drops the dues and every note and keeps name, amounts, dates, receipts and reasons; a ledger with no payments goes
  whole. Timeline codes `paid`, `refund`, `pay_cancel`, `due_waived`. admin.html: the card's «Πληρωμές» (`cPayHtml`,
  `payFormHtml` pay|refund|due, `paySend`, `onPayClick`), the sheet's «Πληρωμή» column, and the «Πληρωμές» section
  (`renderPayments`, filters month / season / method / «Μόνο χωρίς απόδειξη», totals, the year against €10,000).
  Two files: «Excel» (every live entry, refunds negative) and «Για τον Λογιστή» (`exportLogistis`): `;`-separated,
  `RID;DATE;AMOUNT;NAME;CUSTOMER_AFM;EMAIL;SERVICE;DESCRIPTION;PAYMENT;NOTES`, only payments with no receipt yet,
  RID `TAS-<payment id>` (Λογιστής skips a RID it has, so a second import adds nothing), DESCRIPTION is what the
  receipt says, `|` and line breaks stripped (Λογιστής joins fields with `|`). Refunds stay out: Λογιστής makes them
  credit notes against the receipt. Checked against `logistis/income.py` read-only; no Λογιστής file changed.

## 8. Phase status

| Phase | Status |
|---|---|
| 1 «Πελάτες» sheet | live 2026-10-18 (`33a84df`, tag `deploy-2026-10-18-2`); Greek approved by Andreas; his own look on his phone still to come |
| 2 Customer card + memory | live 2026-10-18 (`aed530c`, tag `deploy-2026-10-18-3`); Greek approved by Andreas; his own look on his phone still to come |
| 3 The venue's own sheet | live 2026-10-21 (`1bcc6ae`, `cf5788d`; deployed as `23e0ad0`, tag `deploy-2026-10-21-3`) after Andreas read the Greek |
| 4 Contacts | part A live 2026-10-21 (`373419e`, tag `deploy-2026-10-21-7`) with Andreas's Greek fixes; part B (the site's form, `epikoinonia.html`) live 2026-10-22 (`bd33f4a`, tag `deploy-2026-10-22-1`) after Andreas read the Greek |
| 5 Payments | built 2026-10-22 (`db46296` server, `5a182f7` screens), security review passed, checked on screen at desktop and phone width; live 2026-10-23 (`3e2888e`, tag `deploy-2026-10-23-1`) after Andreas read the Greek |
| 6 «Σήμερα» | — |
| 7 Online payment | not scheduled |
