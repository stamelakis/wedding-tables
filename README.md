# Wedding Seating Planner

Open `seating-planner.html` in any browser (German: `seating-planner-de.html`). Your plan saves automatically in that browser; use **Export** to back it up as a file.

## ☁ Share & sync across devices

Click **☁ Share** to put a plan online (stored in a Cloudflare Worker + KV at
`wedding-sync.andrewstamelakis.workers.dev`). You get a link like:

```
seating-planner.html?plan=<id>&key=<editKey>
```

Open that link on your phone, another computer, or send it to your partner — everyone
with it sees the plan and can edit. Edits you make sync automatically (a couple of
seconds after each change); reopening a linked plan pulls the latest version. Anyone
with the link can edit, so only share it with people you trust.
