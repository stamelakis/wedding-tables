# Wedding Seating Planner

Open `seating-planner.html` in any browser (German: `seating-planner-de.html`). Your plan saves automatically in that browser; use **Export** to back it up as a file. New plans start from a clean 12-table layout.

## ☁ Share & sync across devices

Click **☁ Share** to put a plan online (stored in a Cloudflare Worker + KV at
`wedding-sync.andrewstamelakis.workers.dev`). You then have three ways to share:

- **Edit link** — opens the plan on another device and keeps it in sync; anyone with it can
  change the plan. The write key rides in the URL `#fragment`, so it isn't sent to servers,
  logs, or the `Referer` header.
- **View-only link** — opens the plan read-only, for guests to look but not edit.
- **Sync code** — a private, high-entropy code that links all *your* devices. Create one under
  ☁ Share, then enter the same code on your phone / other computer to see every plan you've
  uploaded, kept in sync. Treat it like a password — anyone with it can read and edit those plans.

Edits sync automatically a couple of seconds after each change and are flushed when you close
the tab. Concurrent edits are reconciled by the server with a conflict check, so a stale device
can't silently overwrite newer work; a cloud pull is deferred while you're mid-edit. Use
**Remove from cloud** to delete a plan (and stop its links working).

### Deploying the worker

The backend is `wedding-sync-worker.js`. Deploy it from the Cloudflare dashboard:
**Workers & Pages → `wedding-sync` → Edit code → paste the file → Deploy**. It needs the KV
namespace `wedding-plans` bound as `PLANS`. The worker never returns edit keys through the
sync-code list and requires the edit key to register a plan under a code, so a leaked plan id or
guessed code can't be escalated to write access.

## 📱 On a phone

Below 820px the sidebar becomes a drawer — tap **☰** to open guests, groups and tools.

Drag and drop doesn't exist on touch, so seating works by tapping instead:

1. Tap a guest in the drawer. The drawer closes and a bar appears at the bottom.
2. Tap any chair to seat them.

Tap a seated guest to pick them up again — then tap another chair to move them, **↩** to
send them back to the pool, or **✎** to rename them / change their type. **✕** cancels.
Tap an empty chair with nothing picked up to type a name straight in.

Decor items show a **⚙** to change surface / layer / delete, and group chips show a **⋯** to
rename / recolour / delete — both reachable by tap (there's no right-click on touch).

Drag tables and decor with one finger, pinch with two to zoom, and drag on the grass to
pan. Everything still works the old way with a mouse.
