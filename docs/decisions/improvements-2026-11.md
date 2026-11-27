# Which improvement next? (prep, 2026-11-28)

STATUS «Next» lists four improvements suggested on 2026-11-23. This page puts them side by side so the
answer is one letter. Nothing here is built; nothing was sent or spent.

**Where we stand:** live is healthy, but there is no paying κτήμα yet (the one venue on live is where Andreas
had his wedding; he will present TakeaSeat to it in person). Direct couples and free sign-ups are few. So the
question is less "what is nicest" and more "what helps win the first customers".

## A. «We draw your room from a photo» (service for κτήματα)

- **What the customer sees:** on the κτήμα pages (`venue.html`, home door, the four event pages where a κτήμα
  reads) one line and a button: «Στείλτε μας μια φωτογραφία ή ένα σκαρίφημα της αίθουσας και τη σχεδιάζουμε εμείς,
  δωρεάν, πριν ξεκινήσετε». The button opens `epikoinonia.html?kind=venue&q=room`. The κτήμα sends the photo
  by mail or Viber; Andreas draws the room in the planner and saves it as the venue's room (`v.rooms`).
- **Why it matters:** drawing the room is the biggest first hurdle for a κτήμα. Removing it turns "I'll try it
  some day" into "send us a photo". It is also something Andreas can promise at the in-person meeting.
- **Work:** small: words in 3 languages on a few pages, one new `q=` choice in the contact form, a line in the
  guide. No new data, no new mail. The photo never touches our server (it arrives by mail/Viber).
- **Ongoing cost:** Andreas's time, about 30–60 minutes per room. Fine for the first 10–20 κτήματα; later it
  could become paid or limited to buyers.
- **Risk / undo:** almost none; removing the line undoes it. Privacy: a photo of a hall is not personal data;
  the page should say «χωρίς ανθρώπους στη φωτογραφία».

## B. Mail to the couple 10 and 3 days before, when guests still have no seat

- **What the customer sees:** «Σε 10 ημέρες είναι ο γάμος σας και 6 καλεσμένοι δεν έχουν ακόμη θέση» with the
  link to their plan. Again at 3 days if still true. Nothing if everyone is seated.
- **Who gets it:** only those who are *our* customers: direct buyers and free online plans (`couple:` rows with
  an email). A κτήμα's client must not get it from us (for those events the κτήμα decides, TakeaSeat is the
  processor); for them the κτήμα's console could show the same number instead (`seatedPct` already exists, admin
  shows it).
- **Work:** medium, about one session: a daily sweep, the mail in 3 languages × 4 kinds (wedding, βάπτιση,
  γιορτή, εταιρεία), "sent once" marks, tests, one line in privacy.html («Email που στέλνουμε») and dpa.html.
- **Value today:** low, because few couples are ours yet. Grows with direct sales.
- **Risk / undo:** a wrong count or a mail on the wrong day annoys a customer close to their event; tests cover
  it. Easy to switch off.

## C. English page for foreign couples and planners marrying in Greece

- **What the customer sees:** one English landing page (e.g. `seating-plan-wedding-greece.html`) that explains
  TakeaSeat to destination weddings and planners, linked to the English planner and an English contact path.
- **Why it matters:** destination weddings (islands, Athens Riviera) are a real market and planners work with
  many weddings a year. But it only pays once Google sends English traffic, which takes months.
- **Work:** medium-large: the page itself, `sitemap.xml` and the Dockerfile list, `hreflang`, an English
  version of the contact form flow and the payment reply. The legal pages (terms, privacy, dpa) are Greek
  only; selling to foreign consumers would at least need English summaries, and the lawyer should see it.
- **Risk / undo:** the page is easy to remove, but half-English flows (English page → Greek terms) look
  unfinished to exactly the buyers it is meant to win.

## D. A two-question message the day after an event

- **What the customer sees:** two short questions, e.g. «Πώς σας φάνηκε το TakeaSeat, από 1 έως 5;» and
  «Μπορούμε να γράψουμε τη γνώμη σας στη σελίδα μας;», answered by simply replying.
- **Who gets it:** direct buyers: added to the keepsake mail they already receive the day after (no new mail).
  A κτήμα: asked by Andreas himself, by phone or his own mail (nothing automatic towards a κτήμα's clients).
- **Why it matters:** gives real quotes for the site (which item 1, the κτήμα's words, is also after) and tells
  us what to fix. Cheap.
- **Work:** small: a paragraph in the 8 keepsake mails × 3 languages, respecting the `noMail` tick; privacy
  needs no new data because answers arrive as ordinary mail.
- **Risk / undo:** a satisfaction question in a service mail sits close to ν. 3471/2006 άρθρο 11 rules; put it
  on the lawyer's list. Easy to remove.

## Side by side

|   | Helps win the first κτήματα | Work | Ongoing cost | Value today |
|---|---|---|---|---|
| A | strongly | small | Andreas's time per room | high |
| B | no (couples only) | medium | none | low until more direct sales |
| C | no (new market) | medium-large | English upkeep, lawyer | low for months |
| D | a little (quotes for the site) | small | none | medium |

## Recommendation: A

A costs one short session, needs no new data or mail, and is the one that directly helps the in-person meeting
with the κτήμα and every κτήμα after it. **D** is the good second (cheap, gathers quotes), and can follow right
after. **B** waits until direct couples are more than a handful; **C** until the Greek side sells.
