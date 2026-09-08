# TakeaSeat — wedding seating planner

B2B wedding seating-plan SaaS for Greek wedding venues (κτήματα). A venue creates one plan per
couple; the couple opens a private link on their phone and places guests at tables.

**Live:** https://takeaseat.gr

> **New here? Read [HANDOFF.md](HANDOFF.md)** — architecture, deploy runbook, backups/monitoring,
> access map, and open items. Real credentials are in `ACCESS.local.md` (git-ignored) and Andreas's
> password manager. **This repo is public — never commit secrets.**

## The app

- **Home** (`index.html`) — Greek marketing page for venues.
- **Seat editor** — `seating-planner-el.html` (EL), `-de.html` (DE), `seating-planner.html` (EN).
  Same code, different UI strings; each has an `.artifact.html` twin. A planner edit must be applied
  to all three languages **and** their twins.
- **Consoles** — `admin.html` (owner) and `venue.html` (venue self-service).
- **Legal** — `privacy.html`, `terms.html`, `dpa.html`.

## Backend

Self-hosted: `server/server.mjs` runs the exact API logic from `wedding-sync-worker.js` over SQLite,
in the `takeaseat-api` Docker container behind the shared Caddy on the Hetzner box, and also serves
the static app. See [HANDOFF.md](HANDOFF.md) for how it fits together and how to deploy.
(The old Cloudflare Worker + GitHub Pages path is retired; GitHub Pages now redirects to takeaseat.gr.)

## Using the seat editor on a phone

The editor needs no login — the couple link *is* the key (`...?plan=<id>#key=<editKey>`; the key rides
in the URL `#fragment`, so it's never sent to servers or logs). To seat guests by tap (drag-and-drop
doesn't exist on touch):

1. Tap a guest in the drawer (**☰** opens it below 820px). A bar appears at the bottom.
2. Tap any chair to seat them.

Tap a seated guest to pick them up — then tap another chair to move them, **↩** to send them back to
the pool, or **✎** to rename / change type. **✕** cancels. Tap an empty chair with nothing picked up
to type a name straight in. Decor items show **⚙**; group chips show **⋯** (rename / recolour / delete).
Drag tables and decor with one finger, pinch to zoom, drag on the grass to pan. Everything still works
the old way with a mouse.
