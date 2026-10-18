# TakeaSeat — daily operations: the development plan

Written 2026-10-18, revised the same day (customer memory, the venues' own sheet). **Status: draft, waiting
for Andreas's OK.** Each phase below gets its own session and its own status line here as it moves.

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

## 6. Decisions needed from Andreas

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

## 8. Phase status

| Phase | Status |
|---|---|
| 1 «Πελάτες» sheet | not started, waiting for the OK on this plan |
| 2 Customer card + memory | — |
| 3 The venue's own sheet | — |
| 4 Contacts | — |
| 5 Payments | — |
| 6 «Σήμερα» | — |
| 7 Online payment | not scheduled |
