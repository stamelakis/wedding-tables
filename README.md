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

## 📱 On a phone

Below 820px the sidebar becomes a drawer — tap **☰** to open guests, groups and tools.

Drag and drop doesn't exist on touch, so seating works by tapping instead:

1. Tap a guest in the drawer. The drawer closes and a bar appears at the bottom.
2. Tap any chair to seat them.

Tap a seated guest to pick them up again — then tap another chair to move them, **↩** to
send them back to the pool, or **✎** to rename them / change their type. **✕** cancels.
Tap an empty chair with nothing picked up to type a name straight in.

Drag tables and decor with one finger, pinch with two to zoom, and drag on the grass to
pan. Everything still works the old way with a mouse.
