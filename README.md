# Glazing Tracker

An offline, install-to-phone app for tracking internal glazing work — internal
partitions, internal doors, shower partitions, balustrades and staircase glass
balustrades — across villas and sites.

**This version stores everything on the device.** No server, no database, no
sign-in, no accounts, no setup. Open it and start. It's a plain HTML/CSS/JS
Progressive Web App with no build step.

---

## How the data works — read this first

Every phone keeps its own copy of the data (in the browser's IndexedDB), so the
app opens instantly and works with no signal.

**With shared sync switched on** (Firebase, below), every change also goes to a
shared online database and appears on everyone else's phone within seconds.
Changes made with no signal are kept on the phone and sent automatically when
the connection returns.

The first time each phone opens the synced version, whatever it already holds
is **uploaded and merged** into the shared list. Where two phones have the same
job, the more recently edited copy wins, so a phone with old starter data can't
overwrite someone's real edits. Nothing has to be exported or imported by hand —
the person with all the data just opens the updated app **on the same phone and
browser they've been using**.

**Without it** (`js/firebase-config.js` left as `null`), the app behaves like
the original local-only build: nothing leaves the device.

### Switching on shared sync (one-off, ~10 minutes)

1. Go to <https://console.firebase.google.com> → **Add project** (any name, e.g.
   *eurolux-glazing*). Google Analytics is not needed.
2. **Build → Firestore Database → Create database.** Pick a location near you
   (e.g. `europe-west` or `me-central`), start in **production mode**.
3. In Firestore, open the **Rules** tab, paste the contents of
   `firestore.rules` from this folder, and **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Anonymous →
   Enable → Save.**
5. **Project settings** (gear icon) → **Your apps** → the web icon `</>` →
   register an app (no hosting needed). Copy the `firebaseConfig` values.
6. Paste them into `js/firebase-config.js` in place of `null`, and redeploy.

Open the app → **Settings → Your data** should say *Shared with the whole team*,
and a **Synced** badge shows in the header.

The free (Spark) plan is plenty for a team this size: 1 GB of storage and
50,000 reads / 20,000 writes per day.

**Who can see it:** any phone that opens the app's link joins the shared list —
there are no individual logins. Keep the link within the team. Per-person
sign-in can be added later if needed.

### Photos and documents

With sync on, photos are shrunk and shared so everyone can open them. Files
larger than about 700 KB that can't be shrunk (big PDFs, for example) stay on
the phone that added it. Without sync, every file stays on its own phone.

### Backups

Under **Settings → Backup & transfer**:

- **Export backup** writes a `.json` safety copy (photos not included).
- **Import backup** reads one back. With sync on it always *merges* (newer copy
  wins), so an import can never wipe the team's list.
- **Export work list (CSV)** gives a spreadsheet of the current filtered list.

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

- **Projects and tasks** — every task belongs to a project (villa / site),
  created straight from the dashboard, tagged with a type of
  work (partitions, doors, showers, balustrades, staircase glass, **Snagging**,
  or anything typed in), with install and target finish dates.
- **Stage tracking** — LPO Pending → Measurement → Material Ordered → Delivered →
  In Progress → Completed, plus On Hold, Rejected / Resubmit and Needs Review.
- **Update log** — timestamped notes against each job; nothing overwrites anything.
- **Team** — assign one or more people to a task; type in a new name (and role)
  if someone isn't on the list yet. Names are shared with the whole team.
- **Back and Home buttons** on every screen; the menu sits at the top; the app
  always opens on the dashboard.
- **Reports** — every project, or only those with tasks in a chosen status
  (also by contractor, type of work, active/completed). Totals, a status
  breakdown and a project table, with or without the task list. **View PDF**,
  **Download PDF** or **Export CSV**. The PDF library loads the first time it's
  used (needs a connection once) and then works offline.
- **Photos & documents** — attach site photos, LPOs, drawings and snags, kept on
  the device.
- **Dashboard, board and filters** — by site, status, category, contractor.
- **Shared live list** across every phone (Firebase), still usable offline.
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
├── firestore.rules         Database access rules (paste into Firebase)
├── css/styles.css          Design system
├── js/
│   ├── firebase-config.js  Shared sync settings (null = local only)
│   ├── config.js           Categories and statuses
│   ├── store.js            IndexedDB wrapper
│   ├── data.js             Data layer: device copy + Firebase sync + backup
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

**A colleague can't see my jobs** — check **Settings → Your data** on both
phones. If it says *On this device only*, `js/firebase-config.js` hasn't been
filled in. If it shows a sync problem, the message says which Firebase step
(rules or anonymous sign-in) is missing.

**A code change isn't showing** — the app's files are fetched fresh whenever
there's a connection, so close the app fully and reopen it once.
