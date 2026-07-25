# Glazing Tracker

An offline, install-to-phone app for tracking internal glazing work — internal
partitions, internal doors, shower partitions, balustrades and staircase glass
balustrades — across villas and sites.

**This version stores everything on the device.** No server, no database, no
sign-in, no accounts, no setup. Open it and start. It's a plain HTML/CSS/JS
Progressive Web App with no build step.

---

## How the data works — read this first

Everything you enter is saved **in the browser on the device you entered it on**,
using the browser's built-in storage (IndexedDB). That has consequences worth
understanding:

- **It's private and works with no signal.** Nothing is uploaded anywhere.
- **It does not sync between devices.** Your phone and an installer's phone each
  keep their own separate copy. A change on one does not appear on the other.
- **It can be erased.** Clearing the browser's site data, or deleting the
  installed app, erases the work with it. So take backups (below).

If you later need one shared list that everyone sees live, that needs a server —
the earlier Supabase version of this app did exactly that and is still in the
project's git history.

### Backups and moving between devices

Under **Settings → Backup & transfer**:

- **Export backup** writes a `.json` file you can keep somewhere safe (email it to
  yourself, drop it in cloud storage).
- **Import backup** reads one back — either *replacing* everything on the device or
  *merging* into it. This is how you move your work to a new phone: export on the
  old one, import on the new one.
- **Export work list (CSV)** gives you a spreadsheet of the current filtered list
  for reporting.

> Photos and documents are **not** included in a backup file — they'd make it
> huge. They stay on the device that took them.

---

## Using it

### Install on a phone

- **Android / Chrome:** open the site → menu → *Add to Home screen*.
- **iPhone / Safari:** open the site → Share → *Add to Home Screen* (Safari only).

It then opens full-screen like an app and runs with no connection.

### First open

You're asked once for your name. That's just the label shown against updates you
post, so if you do move a backup between people it's clear who wrote what. It can
be skipped and changed later under **Settings**.

### Starter data

On a fresh, empty install, **Settings → Starter data** can load the 28 sites and
39 jobs extracted from your *Project Schedule (Internal) — Shamel* spreadsheet, so
you begin with something real to edit rather than a blank slate. 24 of those items
came across as **Needs Review** where the spreadsheet wasn't explicit — they sort
to the top of the dashboard so you can fix them as you go.

---

## What it does

- **Sites and work items** — every job belongs to a site, tagged with one of the
  five glazing categories, with install and target finish dates.
- **Stage tracking** — LPO Pending → Measurement → Material Ordered → Delivered →
  In Progress → Completed, plus On Hold, Rejected / Resubmit and Needs Review.
- **Update log** — timestamped notes against each job; nothing overwrites anything.
- **Team** — assign installers to a job (as a label; there are no logins).
- **Photos & documents** — attach site photos, LPOs, drawings and snags, kept on
  the device.
- **Dashboard, board and filters** — by site, status, category, contractor.
- **Backup / restore / CSV export.**

---

## Deploying (optional)

You don't need a server, but hosting it somewhere gives you a URL to install from.
Any static host works. For Vercel:

1. Push this folder to a GitHub repo.
2. On [vercel.com](https://vercel.com), import it. Framework preset **Other**,
   no build command, output directory = repo root.
3. Deploy. Every push redeploys.

`vercel.json` sets the caching headers a PWA needs. You can equally open
`index.html` from any static file server.

---

## Project layout

```
├── index.html              App shell
├── manifest.webmanifest    Install metadata
├── sw.js                   Service worker (offline)
├── vercel.json             Static-host headers
├── css/styles.css          Design system
├── js/
│   ├── config.js           Categories and statuses
│   ├── store.js            IndexedDB wrapper
│   ├── data.js             Local data layer + backup/restore
│   └── app.js              Router and views
├── data/seed.json          Optional starter data from the spreadsheet
├── icons/                  App icons
└── tests/                  Headless tests (see below)
```

## Running the tests

```bash
npm install --no-save fake-indexeddb
node tests/test_boot.js    # loads and boots; no server references remain
node tests/test_store.js   # local writes, attachments, export/import, reset
```

Both run headlessly against a real IndexedDB — no browser needed.

---

## Troubleshooting

**Nothing saves / "browser is blocking local storage"** — you're probably in a
private/incognito window, which blocks persistent storage. Open it in a normal
window.

**My data vanished** — the browser's site data was cleared, or the app was
reinstalled. Restore from your most recent backup. Take backups regularly.

**A colleague can't see my jobs** — expected: there's no sync. Export a backup and
send it to them to import, or host one shared install that everyone opens on the
same device.

**A code change isn't showing** — the service worker serves a cached copy. Close
all tabs and reopen; `sw.js` and `index.html` are set to revalidate, so it
resolves on the next load.
