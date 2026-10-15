/* =====================================================================
   config.js — app vocabulary.

   This build is fully local: there is no server to configure. Everything
   below just has to match the labels used across the app. No keys, no URLs.
   ===================================================================== */

/* ---------------------------------------------------------------------
   Shared vocabulary — the categories and statuses used across the app.
   --------------------------------------------------------------------- */

window.CATEGORIES = [
  'Internal Partition',
  'Internal Door',
  'Shower Partition',
  'Balustrade',
  'Staircase Glass Balustrade',
  'Snagging',
  'Other'
];

/* "Type of work" also accepts anything typed in. Choosing this option in
   the form reveals a text box; whatever is typed is saved as the type. */
window.CUSTOM_CATEGORY_LABEL = 'Other (type your own)…';

/* The pipeline in the order work actually moves through it. `stage` drives
   the progress rail; the three off-pipeline states sit outside it. */
window.STATUSES = [
  { name: 'LPO Pending',         stage: 0, color: 'var(--st-lpo)',       short: 'LPO' },
  { name: 'Measurement',         stage: 1, color: 'var(--st-measure)',   short: 'Measure' },
  { name: 'Material Ordered',    stage: 2, color: 'var(--st-ordered)',   short: 'Ordered' },
  { name: 'Delivered',           stage: 3, color: 'var(--st-delivered)', short: 'Delivered' },
  { name: 'In Progress',         stage: 4, color: 'var(--st-progress)',  short: 'Install' },
  { name: 'Completed',           stage: 5, color: 'var(--st-complete)',  short: 'Done' },
  { name: 'On Hold',             stage: -1, color: 'var(--st-hold)',     short: 'Hold' },
  { name: 'Rejected / Resubmit', stage: -1, color: 'var(--st-reject)',   short: 'Rejected' },
  { name: 'Needs Review',        stage: -1, color: 'var(--st-review)',   short: 'Review' }
];

window.ATTACHMENT_TYPES = ['Site Photo', 'LPO', 'Drawing', 'Snag'];

window.statusMeta = function (name) {
  for (var i = 0; i < window.STATUSES.length; i++) {
    if (window.STATUSES[i].name === name) return window.STATUSES[i];
  }
  return { name: name || 'Unknown', stage: -1, color: 'var(--ink-3)', short: name || '—' };
};

/* Days before the target finish date that an activity starts flagging. */
window.DUE_SOON_DAYS = 3;
