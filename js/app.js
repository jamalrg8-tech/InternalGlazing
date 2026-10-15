/* =====================================================================
   app.js — views, routing and rendering.
   Reads only from the local cache (Store); writes only through Sync.
   ===================================================================== */

(function (global) {
  'use strict';

  var state = {
    user: null,
    profile: null,
    data: { sites: [], activities: [], activity_updates: [], activity_team: [], profiles: [], attachments: [] },
    filters: { q: '', site: '', status: '', category: '', contractor: '', mine: false },
    installEvent: null
  };

  var root = document.getElementById('root');

  /* ---------------------------------------------------------------
     Small helpers
     --------------------------------------------------------------- */
  function esc(s) {
    if (s === null || s === undefined) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function today() { return new Date().toISOString().slice(0, 10); }

  /* Older starter data stored the word "null" instead of an empty date. */
  function realDate(d) { return d && d !== 'null' ? d : null; }

  function fmtDate(d) {
    d = realDate(d);
    if (!d) return '—';
    var parts = String(d).slice(0, 10).split('-');
    if (parts.length !== 3) return String(d);
    var months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return parts[2] + ' ' + months[parseInt(parts[1], 10) - 1] + ' ' + parts[0].slice(2);
  }

  function fmtWhen(ts) {
    if (!ts) return '';
    var d = new Date(ts);
    var diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + ' min ago';
    if (diff < 86400) return Math.floor(diff / 3600) + ' hr ago';
    if (diff < 604800) return Math.floor(diff / 86400) + ' d ago';
    return fmtDate(d.toISOString());
  }

  function daysUntil(dateStr) {
    dateStr = realDate(dateStr);
    if (!dateStr) return null;
    var target = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    var now = new Date(today() + 'T00:00:00');
    return Math.round((target - now) / 86400000);
  }

  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }

  function siteById(id) {
    for (var i = 0; i < state.data.sites.length; i++) {
      if (state.data.sites[i].id === id) return state.data.sites[i];
    }
    return null;
  }
  function activityById(id) {
    for (var i = 0; i < state.data.activities.length; i++) {
      if (state.data.activities[i].id === id) return state.data.activities[i];
    }
    return null;
  }
  function profileById(id) {
    for (var i = 0; i < state.data.profiles.length; i++) {
      if (state.data.profiles[i].id === id) return state.data.profiles[i];
    }
    return null;
  }
  function personName(id) {
    var p = profileById(id);
    return p ? (p.full_name || 'Unnamed') : 'Someone';
  }
  function isOffice() {
    return state.profile && (state.profile.role === 'admin' || state.profile.role === 'supervisor');
  }

  /* Everyone who can be put on a task: people added by name, plus anyone
     who has set their name on their own phone. */
  function teamPeople() {
    return state.data.profiles.filter(function (p) {
      return p.full_name && p.full_name.trim() && !p.archived;
    }).sort(function (x, y) { return x.full_name.localeCompare(y.full_name); });
  }
  function assigneeNames(activityId) {
    return teamFor(activityId).map(function (t) { return personName(t.user_id); });
  }

  /* Checkbox list of team members, plus a box to add a new name. */
  function peoplePicker(selected) {
    var people = teamPeople();
    return '<div class="people" id="people">' +
      (people.length ? people.map(function (p) { return personChip(p, !!selected[p.id]); }).join('')
                     : '<p class="eyebrow" id="people-empty" style="margin:4px 0">Nobody added yet — type a name below.</p>') +
      '</div>' +
      '<div class="addperson">' +
        '<input id="np-name" placeholder="Add a team member\'s name" autocomplete="off" aria-label="New team member name">' +
        '<input id="np-role" placeholder="Role, e.g. Installer (optional)" autocomplete="off" aria-label="Role">' +
        '<button type="button" class="btn btn-ghost" id="np-add">Add person</button>' +
      '</div>';
  }
  function personChip(p, on) {
    return '<label class="person' + (on ? ' on' : '') + '">' +
      '<input type="checkbox" data-user="' + esc(p.id) + '"' + (on ? ' checked' : '') + '>' +
      '<span><strong>' + esc(p.full_name) + '</strong>' +
      (p.job_title ? '<span class="eyebrow">' + esc(p.job_title) + '</span>' : '') + '</span></label>';
  }
  /* onAdd(personId) runs after a new name is added and ticked. */
  function wirePeoplePicker(onAdd) {
    var box = document.getElementById('people');
    box.addEventListener('change', function (e) {
      var l = e.target.closest('.person');
      if (l) l.classList.toggle('on', e.target.checked);
    });
    var nameEl = document.getElementById('np-name'), roleEl = document.getElementById('np-role');
    function add() {
      var name = nameEl.value.trim();
      if (!name) { toast('Type the person\'s name'); nameEl.focus(); return; }
      var existing = teamPeople().filter(function (p) { return p.full_name.toLowerCase() === name.toLowerCase(); })[0];
      var done = existing ? Promise.resolve(existing) : Sync.insert('profiles', {
        full_name: name, job_title: roleEl.value.trim() || null, role: 'member',
        created_by: state.user ? state.user.id : null, created_at: new Date().toISOString()
      });
      done.then(function (p) {
        return loadLocal().then(function () {
          var cb = box.querySelector('input[data-user="' + p.id + '"]');
          if (!cb) {
            var empty = document.getElementById('people-empty');
            if (empty) empty.remove();
            box.insertAdjacentHTML('beforeend', personChip(p, true));
            cb = box.querySelector('input[data-user="' + p.id + '"]');
          } else {
            cb.checked = true; cb.closest('.person').classList.add('on');
          }
          nameEl.value = ''; roleEl.value = '';
          toast(existing ? name + ' ticked' : name + ' added');
          if (onAdd) onAdd(p.id);
        });
      });
    }
    document.getElementById('np-add').addEventListener('click', add);
    nameEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } });
  }
  function pickedPeople() {
    var out = [];
    document.querySelectorAll('#people input[data-user]').forEach(function (cb) {
      if (cb.checked) out.push(cb.getAttribute('data-user'));
    });
    return out;
  }

  function teamFor(activityId) {
    return state.data.activity_team.filter(function (t) { return t.activity_id === activityId; });
  }
  function updatesFor(activityId) {
    return state.data.activity_updates
      .filter(function (u) { return u.activity_id === activityId; })
      .sort(function (a, b) { return (b.created_at || '') < (a.created_at || '') ? -1 : 1; });
  }
  function attachmentsFor(activityId) {
    return state.data.attachments.filter(function (a) { return a.activity_id === activityId; });
  }

  /* ---------------------------------------------------------------
     Data load
     --------------------------------------------------------------- */
  function loadLocal() {
    var names = ['sites', 'activities', 'activity_updates', 'activity_team', 'profiles', 'attachments'];
    return Promise.all(names.map(function (n) { return Store.getAll(n); }))
      .then(function (res) {
        names.forEach(function (n, i) { state.data[n] = res[i]; });
      });
  }

  /* ---------------------------------------------------------------
     Shared UI pieces
     --------------------------------------------------------------- */
  var SYNC_LABELS = {
    connecting: ['sync', 'Connecting'],
    live:       ['',     'Synced'],
    pending:    ['sync', 'Sending…'],
    offline:    ['off',  'Offline — saved here'],
    error:      ['off',  'Sync problem']
  };
  function netPill() {
    var st = Sync.syncState();
    if (!st.enabled) return '';
    var l = SYNC_LABELS[st.status];
    if (!l) return '';
    return '<a class="netpill ' + l[0] + '" href="#/settings" title="Sync status"><span class="dot"></span>' + esc(l[1]) + '</a>';
  }

  /* Every screen except the dashboard gets Back (previous screen) and
     Home (dashboard). Back goes to wherever the person came from; if they
     opened this screen directly, it falls back to `backHref` or the dashboard. */
  function appbar(title, sub, backHref, actionsHtml) {
    return '<div class="appbar">' +
      '<button class="iconbtn backbtn" data-back="' + esc(backHref || '#/') + '" aria-label="Back">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>' +
        '<span class="backlbl">Back</span></button>' +
      '<h1>' + esc(title) + (sub ? '<span class="sub">' + esc(sub) + '</span>' : '') + '</h1>' +
      (actionsHtml || '') + netPill() +
      '<button class="iconbtn" data-nav="#/" aria-label="Dashboard" title="Dashboard">' +
        '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/></svg></button>' +
      '</div>';
  }

  /* The Eurolux wordmark, drawn in code so it needs no image file and
     works offline. Swap the .brand-mark markup for an <img> if you want
     to use the real logo asset instead. */
  function euroluxMark() {
    return '<span class="brand-mark" aria-label="Eurolux">' +
      '<span class="brand-bar"></span>' +
      '<span class="brand-word">EUROLUX</span>' +
      '</span>';
  }

  function todayLong() {
    var d = new Date();
    var days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    var months = ['January','February','March','April','May','June','July',
                  'August','September','October','November','December'];
    return days[d.getDay()] + ', ' + d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
  }

  /* Brand masthead shown at the top of the main dashboard: date on the
     left, Eurolux mark on the right, full app title beneath. */
  function masthead() {
    return '<header class="masthead">' +
      '<div class="masthead-top">' +
        '<time class="masthead-date">' + esc(todayLong()) + '</time>' +
        euroluxMark() +
      '</div>' +
      '<h1 class="masthead-title">Eurolux Internal Glazing Project Tracker</h1>' +
      (netPill() ? '<div class="masthead-sync">' + netPill() + '</div>' : '') +
      '</header>';
  }

  function footer() {
    return '<footer class="app-footer">' +
      'Eurolux Projects and Procurement Management system — Developed with love by Uncle Ed, Version 4.20' +
      '</footer>';
  }

  function tabbar(active) {
    var tabs = [
      { href: '#/', key: 'dash', label: 'Dashboard', icon: 'M3 5h18M3 12h18M3 19h12' },
      { href: '#/board', key: 'board', label: 'Board', icon: 'M4 4h5v16H4zM10 4h5v10h-5zM16 4h4v7h-4z' },
      { href: '#/sites', key: 'sites', label: 'Projects', icon: 'M4 20V9l8-5 8 5v11H4z' },
      { href: '#/reports', key: 'reports', label: 'Reports', icon: 'M5 20V10M12 20V4M19 20v-7' },
      { href: '#/settings', key: 'set', label: 'Settings', icon: 'M4 12a8 8 0 0113.7-5.7M20 12a8 8 0 01-13.7 5.7M18 4v4h-4M6 20v-4h4' }
    ];
    return '<nav class="tabbar">' + tabs.map(function (t) {
      return '<a href="' + t.href + '" class="' + (t.key === active ? 'active' : '') + '">' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="' + t.icon + '"/></svg>' +
        t.label + '</a>';
    }).join('') + '</nav>';
  }

  /* The menu sits at the top, directly under the header. Views still emit
     it last; this moves it into one sticky top block with the header. */
  function placeTopbar() {
    var nav = root.querySelector(':scope > .tabbar, main ~ .tabbar');
    if (!nav || nav.parentNode.classList.contains('topbar')) return;
    var head = root.querySelector(':scope > .masthead, :scope > .appbar');
    var wrap = document.createElement('div');
    wrap.className = 'topbar';
    if (head) { root.insertBefore(wrap, head); wrap.appendChild(head); }
    else root.insertBefore(wrap, root.firstChild);
    wrap.appendChild(nav);
  }
  if (global.MutationObserver) new MutationObserver(placeTopbar).observe(root, { childList: true });

  function statusChip(status) {
    var m = statusMeta(status);
    return '<span class="chip chip-status" style="--chip-c:' + m.color + '">' + esc(status) + '</span>';
  }

  function flagFor(a) {
    if (a.status === 'Completed') return '';
    var d = daysUntil(a.target_finish_date);
    if (d === null) return '';
    if (d < 0) return '<span class="chip chip-flag">' + Math.abs(d) + 'd overdue</span>';
    if (d <= DUE_SOON_DAYS) return '<span class="chip chip-soon">Due in ' + d + 'd</span>';
    return '';
  }

  function activityCard(a) {
    var s = siteById(a.site_id);
    var m = statusMeta(a.status);
    var scope = a.scope_description || '(no scope recorded)';
    if (scope.length > 120) scope = scope.slice(0, 118) + '…';

    return '<article class="card"><a class="card-link" href="#/activity/' + esc(a.id) + '">' +
      '<span class="spine" style="--spine-c:' + m.color + '"></span>' +
      '<div class="card-body">' +
        '<div class="card-top"><span class="card-title">' + esc(scope) + '</span>' +
        '</div>' +
        '<div class="card-site">' + esc(s ? s.name : 'Unknown project') +
          (s && s.main_contractor ? ' · ' + esc(s.main_contractor) : '') + '</div>' +
        '<div class="card-meta">' +
          statusChip(a.status) +
          '<span class="chip chip-cat">' + esc(a.category) + '</span>' +
          flagFor(a) +
          '<span class="datepair">Target <b>' + fmtDate(a.target_finish_date) + '</b></span>' +
        '</div>' +
        (function () {
          var names = assigneeNames(a.id);
          return names.length ? '<div class="assignees"><svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/></svg>' + esc(names.join(', ')) + '</div>' : '';
        })() +
      '</div></a></article>';
  }

  function emptyState(title, body, actionHtml) {
    return '<div class="empty"><div class="edge"></div><h3>' + esc(title) + '</h3>' +
      '<p>' + esc(body) + '</p>' + (actionHtml || '') + '</div>';
  }

  /* ---------------------------------------------------------------
     Filtering
     --------------------------------------------------------------- */
  function filtered() {
    var f = state.filters;
    var q = f.q.trim().toLowerCase();
    return state.data.activities.filter(function (a) {
      var s = siteById(a.site_id);
      if (f.site && a.site_id !== f.site) return false;
      if (f.status && a.status !== f.status) return false;
      if (f.category && a.category !== f.category) return false;
      if (f.contractor && (!s || s.main_contractor !== f.contractor)) return false;
      if (f.mine && state.user) {
        var mine = teamFor(a.id).some(function (t) { return t.user_id === state.user.id; });
        if (!mine) return false;
      }
      if (q) {
        var hay = [(a.scope_description || ''), (a.category || ''), (a.status || ''),
          (s ? s.name : ''), (s ? s.main_contractor : ''), (s ? s.community : '')]
          .join(' ').toLowerCase();
        if (hay.indexOf(q) === -1) return false;
      }
      return true;
    });
  }

  /* The standard types plus any custom ones people have typed in. */
  function allCategories() {
    var seen = {}, extra = [];
    CATEGORIES.forEach(function (c) { seen[c] = 1; });
    state.data.activities.forEach(function (a) {
      var c = (a.category || '').trim();
      if (c && !seen[c]) { seen[c] = 1; extra.push(c); }
    });
    extra.sort(function (a, b) { return a.localeCompare(b); });
    return CATEGORIES.slice(0, -1).concat(extra, CATEGORIES.slice(-1));
  }

  function contractors() {
    var seen = {};
    state.data.sites.forEach(function (s) { if (s.main_contractor) seen[s.main_contractor] = 1; });
    return Object.keys(seen).sort();
  }

  function filterBar() {
    var f = state.filters;
    function opts(list, sel) {
      return list.map(function (v) {
        var val = typeof v === 'string' ? v : v.value;
        var lab = typeof v === 'string' ? v : v.label;
        return '<option value="' + esc(val) + '"' + (sel === val ? ' selected' : '') + '>' + esc(lab) + '</option>';
      }).join('');
    }
    var siteOpts = state.data.sites
      .slice()
      .sort(function (a, b) { return a.name.localeCompare(b.name); })
      .map(function (s) { return { value: s.id, label: s.name }; });

    return '<div class="searchwrap"><input type="search" id="f-q" placeholder="Search task, project or contractor" value="' + esc(f.q) + '"></div>' +
      '<div class="filters">' +
      '<select id="f-status"><option value="">All statuses</option>' + opts(STATUSES.map(function (s) { return s.name; }), f.status) + '</select>' +
      '<select id="f-site"><option value="">All projects</option>' + opts(siteOpts, f.site) + '</select>' +
      '<select id="f-cat"><option value="">All types</option>' + opts(allCategories(), f.category) + '</select>' +
      '<select id="f-con"><option value="">All contractors</option>' + opts(contractors(), f.contractor) + '</select>' +
      '<select id="f-mine"><option value="">Everyone</option><option value="1"' + (f.mine ? ' selected' : '') + '>Assigned to me</option></select>' +
      '</div>';
  }

  function wireFilters(rerender) {
    function bind(id, key, transform) {
      var el = document.getElementById(id);
      if (!el) return;
      var evt = el.tagName === 'INPUT' ? 'input' : 'change';
      el.addEventListener(evt, function () {
        state.filters[key] = transform ? transform(el.value) : el.value;
        rerender();
      });
    }
    bind('f-q', 'q');
    bind('f-status', 'status');
    bind('f-site', 'site');
    bind('f-cat', 'category');
    bind('f-con', 'contractor');
    bind('f-mine', 'mine', function (v) { return v === '1'; });
  }

  /* =====================================================================
     VIEW — Auth
     ===================================================================== */
  /* =====================================================================
     VIEW — Who is using this device
     Asked once, no password. Only so updates carry a name.
     ===================================================================== */
  function hasName() {
    var n = state.profile && state.profile.full_name;
    return !!(n && n.trim() && n !== 'Site device');
  }

  function viewIdentity() {
    document.body.classList.add('no-nav');
    root.innerHTML =
      '<div class="auth-wrap"><div class="auth-card">' +
        '<div class="auth-mark"><span class="edge"></span><div><h1>Eurolux Glazing Tracker</h1></div></div>' +
        '<p class="tag">Who is using this device? Your name goes against the updates you post, so the team can see who logged what.</p>' +
        '<div class="field"><label for="d-name">Your name</label>' +
        '<input id="d-name" autocomplete="name" placeholder="e.g. Ramesh Kumar"></div>' +
        '<button class="btn btn-primary btn-block" id="d-go">Start</button>' +
        '<div class="auth-switch">Change it any time under Sync. <button id="d-skip">Skip</button></div>' +
      '</div></div>';

    function finish() {
      document.body.classList.remove('no-nav');
      route();
    }
    document.getElementById('d-go').addEventListener('click', function () {
      var name = document.getElementById('d-name').value.trim();
      if (!name) { toast('Enter a name, or choose skip'); return; }
      Sync.setDisplayName(name)
        .then(loadLocal)
        .then(function () {
          state.profile = profileById(state.user.id) || state.profile;
          if (state.profile) state.profile.full_name = name;
          finish();
        });
    });
    document.getElementById('d-skip').addEventListener('click', finish);
    document.getElementById('d-name').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') document.getElementById('d-go').click();
    });
  }

  /* =====================================================================
     VIEW — Dashboard
     ===================================================================== */
  function viewDashboard() {
    var list = filtered();

    var attention = list.filter(function (a) {
      if (a.status === 'Completed') return false;
      var d = daysUntil(a.target_finish_date);
      return (d !== null && d <= DUE_SOON_DAYS) ||
             a.status === 'Rejected / Resubmit' ||
             a.status === 'Needs Review';
    }).sort(function (x, y) {
      var dx = daysUntil(x.target_finish_date), dy = daysUntil(y.target_finish_date);
      if (dx === null) return 1;
      if (dy === null) return -1;
      return dx - dy;
    });

    var attentionIds = {};
    attention.forEach(function (a) { attentionIds[a.id] = 1; });

    var live = list.filter(function (a) { return !attentionIds[a.id] && a.status !== 'Completed'; });
    var done = list.filter(function (a) { return !attentionIds[a.id] && a.status === 'Completed'; });

    var html = masthead();

    html += '<main>';
    html += '<div class="quick">' +
      '<button class="btn btn-primary" id="q-task"><span aria-hidden="true">+</span> New task</button>' +
      '<button class="btn btn-ghost" id="q-site"><span aria-hidden="true">+</span> New project</button>' +
      '</div>';
    html += filterBar();

    if (!list.length) {
      html += emptyState(
        state.data.activities.length ? 'Nothing matches those filters' : 'No tasks yet',
        state.data.activities.length ? 'Clear a filter to see more.' : 'Add your first task to start tracking it.',
        ''
      );
    } else {
      if (attention.length) {
        html += '<div class="sechead"><h2>Needs attention</h2><span class="count mono">' + attention.length + '</span></div>';
        html += attention.map(activityCard).join('');
      }
      if (live.length) {
        html += '<div class="sechead"><h2>Work in Progress</h2><span class="count mono">' + live.length + '</span></div>';
        html += live.map(activityCard).join('');
      }
      if (done.length) {
        html += '<div class="sechead"><h2>Completed</h2><span class="count mono">' + done.length + '</span></div>';
        html += done.map(activityCard).join('');
      }
    }

    html += footer();
    html += '</main>';
    if (isOffice()) html += '<button class="fab" id="fab" aria-label="New task">+</button>';
    html += tabbar('dash');
    root.innerHTML = html;

    wireFilters(viewDashboard);
    var fab = document.getElementById('fab');
    if (fab) fab.addEventListener('click', function () { location.hash = '#/activity/new'; });
    document.getElementById('q-task').addEventListener('click', function () { location.hash = '#/activity/new'; });
    document.getElementById('q-site').addEventListener('click', function () { location.hash = '#/site/new'; });

  }

  /* =====================================================================
     VIEW — Board
     ===================================================================== */
  function viewBoard() {
    var list = filtered();
    // Every status gets a column — items migrated as "Needs Review" must not
    // be invisible here, since reviewing them is the whole point.
    var cols = STATUSES.slice().sort(function (a, b) {
      if (a.name === 'Needs Review') return -1;
      if (b.name === 'Needs Review') return 1;
      return 0;
    });

    var html = appbar('Board', 'By stage', '#/', '');
    html += '<main>';
    html += filterBar();
    html += '<div class="board">';
    cols.forEach(function (col) {
      var items = list.filter(function (a) { return a.status === col.name; });
      html += '<section class="board-col">' +
        '<h3 style="--col-c:' + col.color + '"><span>' + esc(col.name) + '</span><span>' + items.length + '</span></h3>' +
        '<div class="col-body">' +
          (items.length ? items.map(activityCard).join('')
                        : '<p class="eyebrow" style="padding:10px;text-align:center">Empty</p>') +
        '</div></section>';
    });
    html += footer();
    html += '</div></main>' + tabbar('board');
    root.innerHTML = html;
    wireFilters(viewBoard);
  }

  /* =====================================================================
     VIEW — Sites
     ===================================================================== */
  function viewSites() {
    var q = state.filters.q.trim().toLowerCase();
    var sites = state.data.sites.filter(function (s) {
      if (s.is_archived) return false;
      if (!q) return true;
      return (s.name + ' ' + (s.community || '') + ' ' + (s.main_contractor || '')).toLowerCase().indexOf(q) !== -1;
    }).sort(function (a, b) { return a.name.localeCompare(b.name); });

    var html = appbar('Projects', sites.length + ' active', '#/', '');
    html += '<main>';
    html += '<div class="searchwrap"><input type="search" id="f-q" placeholder="Search projects" value="' + esc(state.filters.q) + '"></div>';

    if (!sites.length) {
      html += emptyState('No projects yet', 'Add a villa or project to group its tasks.',
        isOffice() ? '<a class="btn btn-primary" href="#/site/new">New project</a>' : '');
    } else {
      html += sites.map(function (s) {
        var acts = state.data.activities.filter(function (a) { return a.site_id === s.id; });
        var openCount = acts.filter(function (a) { return a.status !== 'Completed'; }).length;
        return '<article class="card"><a class="card-link" href="#/site/' + esc(s.id) + '">' +
          '<span class="spine" style="--spine-c:' + (!acts.length ? 'var(--st-hold)' : openCount ? 'var(--glass)' : 'var(--st-complete)') + '"></span>' +
          '<div class="card-body">' +
            '<div class="card-top"><span class="card-title">' + esc(s.name) + '</span></div>' +
            '<div class="card-site">' + esc(s.community || 'Community not set') +
              (s.main_contractor ? ' · ' + esc(s.main_contractor) : '') + '</div>' +
            '<div class="card-meta">' +
              (acts.length
                ? '<span class="chip">' + acts.length + ' task' + (acts.length === 1 ? '' : 's') + '</span>' +
                  (openCount ? '<span class="chip chip-cat">' + openCount + ' open</span>'
                             : '<span class="chip" style="background:var(--glass-wash);color:var(--st-complete)">All done</span>')
                : '<span class="chip">No tasks yet</span>') +
            '</div>' +
          '</div></a>' +
          '<div class="card-actions">' +
            '<button class="linkbtn" data-nav="#/site/' + esc(s.id) + '/edit">Edit</button>' +
            '<button class="linkbtn danger" data-delsite="' + esc(s.id) + '">Delete</button>' +
          '</div></article>';
      }).join('');
    }

    html += footer();
    html += '</main>';
    if (isOffice()) html += '<button class="fab" id="fab" aria-label="New project">+</button>';
    html += tabbar('sites');
    root.innerHTML = html;

    var qEl = document.getElementById('f-q');
    qEl.addEventListener('input', function () { state.filters.q = qEl.value; viewSites(); });
    root.querySelectorAll('[data-delsite]').forEach(function (b) {
      b.addEventListener('click', function () { deleteProject(b.getAttribute('data-delsite')); });
    });
    var fab = document.getElementById('fab');
    if (fab) fab.addEventListener('click', function () { location.hash = '#/site/new'; });
  }

  function viewSiteDetail(id) {
    var s = siteById(id);
    if (!s) { root.innerHTML = appbar('Project', '', '#/sites') + '<main>' + emptyState('Project not found', 'It may have been removed.') + '</main>' + tabbar('sites'); return; }

    var acts = state.data.activities.filter(function (a) { return a.site_id === id; });
    var html = appbar(s.name, s.community || '', '#/sites',
      isOffice() ? '<button class="iconbtn" data-nav="#/site/' + esc(id) + '/edit" aria-label="Edit project">&#9998;</button>' : '');

    html += '<main>';
    html += '<div class="panel"><dl class="kv">' +
      '<dt>Contractor</dt><dd>' + esc(s.main_contractor || '—') + '</dd>' +
      '<dt>Client</dt><dd>' + esc(s.client || '—') + '</dd>' +
      '<dt>Address</dt><dd>' + esc(s.address || '—') + '</dd>' +
      '</dl>' +
      '<div class="btnrow" style="margin-top:6px">' +
        '<button class="btn btn-ghost" data-nav="#/site/' + esc(id) + '/edit">Edit project</button>' +
        '<button class="btn btn-danger" id="del-site">Delete project</button>' +
      '</div></div>';

    html += '<div class="sechead"><h2>Tasks</h2><span class="count mono">' + acts.length + '</span></div>';
    html += acts.length
      ? acts.map(activityCard).join('')
      : emptyState('No tasks here yet', 'Add the first task for this project.',
          isOffice() ? '<a class="btn btn-primary" href="#/activity/new?site=' + esc(id) + '">New task</a>' : '');

    html += '</main>';
    if (isOffice()) html += '<button class="fab" id="fab" aria-label="New task">+</button>';
    html += tabbar('sites');
    root.innerHTML = html;

    var fab = document.getElementById('fab');
    if (fab) fab.addEventListener('click', function () { location.hash = '#/activity/new?site=' + id; });
    document.getElementById('del-site').addEventListener('click', function () { deleteProject(id); });
  }

  /* Deletes a project. If it still has tasks, says how many and removes
     them too (with their updates, team and attachments), after confirming. */
  function deleteProject(id) {
    var s = siteById(id);
    if (!s) return;
    var acts = state.data.activities.filter(function (a) { return a.site_id === id; });
    var msg = acts.length
      ? 'Delete "' + s.name + '" and its ' + acts.length + ' task' + (acts.length === 1 ? '' : 's') +
        '?\n\nThe tasks, their updates and attachments will be deleted for everyone. This cannot be undone.'
      : 'Delete the project "' + s.name + '"?\n\nThis cannot be undone.';
    if (!confirm(msg)) return;
    var ids = {};
    acts.forEach(function (a) { ids[a.id] = 1; });
    var ops = [];
    state.data.activity_updates.forEach(function (u) { if (ids[u.activity_id]) ops.push(Sync.remove('activity_updates', u.id)); });
    state.data.attachments.forEach(function (at) { if (ids[at.activity_id]) ops.push(Sync.remove('attachments', at.id)); });
    state.data.activity_team.forEach(function (t) { if (ids[t.activity_id]) ops.push(Sync.removeTeamMember(t.activity_id, t.user_id)); });
    acts.forEach(function (a) { ops.push(Sync.remove('activities', a.id)); });
    Promise.all(ops).then(function () { return Sync.remove('sites', id); }).then(function () {
      toast('Project deleted');
      if (state.filters.site === id) state.filters.site = '';
      if (/^#\/site\//.test(location.hash)) go('#/sites', true);
      else refreshAndRender();
    });
  }

  /* =====================================================================
     VIEW — Activity detail
     ===================================================================== */
  function viewActivity(id) {
    var a = activityById(id);
    if (!a) {
      root.innerHTML = appbar('Task', '', '#/') + '<main>' + emptyState('Not found', 'This task may have been removed.') + '</main>' + tabbar('dash');
      return;
    }
    var s = siteById(a.site_id);
    var m = statusMeta(a.status);
    var pipeline = STATUSES.filter(function (x) { return x.stage >= 0; });

    var html = appbar(s ? s.name : 'Task', a.category, '#/',
      '<button class="iconbtn" data-nav="#/activity/' + esc(id) + '/edit" aria-label="Edit">&#9998;</button>');
    html += '<main>';

    /* --- stage rail: the pipeline is a real sequence, so show position --- */
    html += '<div class="panel">';
    html += '<div class="eyebrow" style="margin-bottom:8px">Stage</div>';
    if (m.stage >= 0) {
      html += '<div class="rail">' + pipeline.map(function (p) {
        var cls = p.stage < m.stage ? 'done' : (p.stage === m.stage ? 'now' : 'off');
        return '<div class="rail-step ' + cls + '"><div class="rail-bar"></div><div class="rail-label">' + esc(p.short) + '</div></div>';
      }).join('') + '</div>';
    } else {
      html += '<p style="margin:0 0 14px">' + statusChip(a.status) + '</p>';
    }

    html += '<div class="field"><label for="st">Change status</label><select id="st">' +
      STATUSES.map(function (x) {
        return '<option value="' + esc(x.name) + '"' + (x.name === a.status ? ' selected' : '') + '>' + esc(x.name) + '</option>';
      }).join('') + '</select></div>';
    html += '</div>';

    /* --- details --- */
    html += '<div class="panel">' +
      '<h2>' + esc(a.scope_description || 'No scope recorded') + '</h2>' +
      '<div class="card-meta" style="margin-bottom:10px">' +
        '<span class="chip chip-cat">' + esc(a.category) + '</span>' + flagFor(a) +
      '</div>' +
      '<dl class="kv">' +
        '<dt>Quantity</dt><dd>' + (a.quantity ? esc(a.quantity) : '—') + '</dd>' +
        '<dt>Install date</dt><dd class="mono">' + fmtDate(a.installation_date) + '</dd>' +
        '<dt>Target finish</dt><dd class="mono">' + fmtDate(a.target_finish_date) + '</dd>' +
        '<dt>Actual finish</dt><dd class="mono">' + fmtDate(a.actual_finish_date) + '</dd>' +
      '</dl></div>';

    /* --- team --- */
    var team = teamFor(id);
    html += '<div class="panel"><h2>Team</h2>';
    html += team.length
      ? '<div class="card-meta">' + team.map(function (t) {
          return '<span class="chip">' + esc(personName(t.user_id)) +
            (t.role_on_job ? ' · ' + esc(t.role_on_job) : '') + '</span>';
        }).join('') + '</div>'
      : '<p class="eyebrow">Nobody assigned</p>';
    html += '<div class="btnrow"><button class="btn btn-ghost" data-nav="#/activity/' + esc(id) + '/team">' +
      (team.length ? 'Change who is assigned' : 'Assign team members') + '</button></div>';
    html += '</div>';

    /* --- attachments --- */
    var atts = attachmentsFor(id);
    html += '<div class="panel"><h2>Photos &amp; documents</h2>';
    html += atts.length
      ? '<div class="thumbs" id="thumbs">' + atts.map(function (at) {
          return '<div class="thumb" data-id="' + esc(at.id) + '">' +
            '<span>' + esc(at.file_name || 'file') + '</span>' +
            '<span class="badge">' + esc(at.type) + '' + '</span></div>';
        }).join('') + '</div>'
      : '<p class="eyebrow">Nothing attached yet</p>';
    html += '<div class="field" style="margin-top:12px"><label for="att-type">Attach as</label>' +
      '<select id="att-type">' + ATTACHMENT_TYPES.map(function (t) { return '<option>' + esc(t) + '</option>'; }).join('') + '</select></div>' +
      '<input type="file" id="att-file" accept="image/*,application/pdf" style="display:none">' +
      '<button class="btn btn-ghost btn-block" id="att-btn">Add photo or document</button>';
    html += '</div>';

    /* --- update log --- */
    var ups = updatesFor(id);
    html += '<div class="panel"><h2>Updates</h2>' +
      '<div class="field"><label for="up-text">Add an update</label>' +
      '<textarea id="up-text" placeholder="What happened on site today?"></textarea></div>' +
      '<button class="btn btn-primary btn-block" id="up-btn">Post update</button>';
    html += ups.length
      ? '<ul class="tl" style="margin-top:18px">' + ups.map(function (u) {
          return '<li>' +
            '<div class="who">' + esc(personName(u.author_id)) + ' · ' + esc(fmtWhen(u.created_at)) +
            '</div>' +
            '<div class="txt">' + esc(u.update_text) + '</div></li>';
        }).join('') + '</ul>'
      : '<p class="eyebrow" style="margin-top:16px">No updates logged yet</p>';
    html += '</div>';

    html += '</main>' + tabbar('dash');
    root.innerHTML = html;

    /* status change */
    document.getElementById('st').addEventListener('change', function (e) {
      var next = e.target.value;
      var patch = { status: next };
      if (next === 'Completed' && !realDate(a.actual_finish_date)) patch.actual_finish_date = today();
      Sync.update('activities', id, patch).then(function () {
        toast('Status set to ' + next);
        refreshAndRender();
      });
    });

    /* post update */
    document.getElementById('up-btn').addEventListener('click', function () {
      var box = document.getElementById('up-text');
      var text = box.value.trim();
      if (!text) { toast('Write something first'); return; }
      Sync.insert('activity_updates', {
        activity_id: id,
        author_id: state.user ? state.user.id : null,
        update_text: text,
        created_at: new Date().toISOString()
      }).then(function () {
        box.value = '';
        toast('Update posted');
        refreshAndRender();
      });
    });

    /* attachments */
    var fileInput = document.getElementById('att-file');
    document.getElementById('att-btn').addEventListener('click', function () { fileInput.click(); });
    fileInput.addEventListener('change', function () {
      var f = fileInput.files && fileInput.files[0];
      if (!f) return;
      var type = document.getElementById('att-type').value;
      compress(f).then(function (blob) {
        return Sync.addAttachment(id, blob, type, state.user ? state.user.id : null);
      }).then(function () {
        toast('Saved');
        refreshAndRender();
      }).catch(function (e) {
        toast('Could not attach that file');
        console.error(e);
      });
    });

    /* open an attachment */
    var thumbs = document.getElementById('thumbs');
    if (thumbs) {
      thumbs.addEventListener('click', function (e) {
        var el = e.target.closest('.thumb');
        if (!el) return;
        var att = attachmentsFor(id).filter(function (x) { return x.id === el.getAttribute('data-id'); })[0];
        if (!att) return;
        Sync.fileUrl(att).then(function (url) {
          if (url) window.open(url, '_blank');
          else toast(Sync.syncState().enabled ? 'That file was too large to share, so it is only on the phone that added it'
                                              : 'That file is not on this device');
        });
      });
    }
  }

  /* Shrink photos before they queue — site connections are slow. */
  function compress(file) {
    if (!file.type || file.type.indexOf('image/') !== 0) return Promise.resolve(file);
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(file);
      img.onload = function () {
        var max = 1600;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { resolve(file); return; }
          var name = (file.name || 'photo').replace(/\.[^.]+$/, '') + '.jpg';
          // A File keeps the name through the queue; properties tacked onto a
          // plain Blob don't survive a structured clone into IndexedDB.
          try {
            resolve(new File([blob], name, { type: 'image/jpeg' }));
          } catch (e) {
            blob.name = name;
            resolve(blob);
          }
        }, 'image/jpeg', 0.82);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(file); };
      img.src = url;
    });
  }

  /* =====================================================================
     VIEW — Activity form
     ===================================================================== */
  function viewActivityForm(id, presetSite) {
    var editing = !!id;
    var a = editing ? activityById(id) : null;
    if (editing && !a) { location.hash = '#/'; return; }

    var sites = state.data.sites.slice().sort(function (x, y) { return x.name.localeCompare(y.name); });
    if (!sites.length) {
      root.innerHTML = appbar('New task', '', '#/') + '<main>' +
        emptyState('Add a project first', 'Tasks belong to a project, so create one before adding a task.',
          '<a class="btn btn-primary" href="#/site/new">New project</a>') +
        '</main>' + tabbar('dash');
      return;
    }

    var v = a || {
      site_id: presetSite || sites[0].id,
      category: 'Other',
      scope_description: '',
      quantity: '',
      installation_date: '',
      target_finish_date: '',
      actual_finish_date: '',
      status: 'LPO Pending'
    };

    var isCustomCat = !!v.category && CATEGORIES.indexOf(v.category) === -1;
    var assignedNow = {};
    if (editing) teamFor(id).forEach(function (t) { assignedNow[t.user_id] = 1; });

    var html = appbar(editing ? 'Edit task' : 'New task', '', editing ? '#/activity/' + id : '#/');
    html += '<main><div class="panel">' +
      '<div class="field"><label for="f-site2">Project</label><select id="f-site2">' +
        sites.map(function (s) { return '<option value="' + esc(s.id) + '"' + (s.id === v.site_id ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
        '<option value="__new">+ New project…</option>' +
      '</select></div>' +
      '<div class="field"><label for="f-cat2">Type of work</label><select id="f-cat2">' +
        CATEGORIES.map(function (c) { return '<option value="' + esc(c) + '"' + (c === v.category ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') +
        '<option value="__custom"' + (isCustomCat ? ' selected' : '') + '>' + esc(CUSTOM_CATEGORY_LABEL) + '</option>' +
      '</select>' +
      '<input id="f-cat-custom" placeholder="Type the kind of work, e.g. Mirror installation" value="' + esc(isCustomCat ? v.category : '') + '"' +
        ' style="margin-top:8px' + (isCustomCat ? '' : ';display:none') + '" aria-label="Custom type of work"></div>' +
      '<div class="field"><label for="f-scope">Scope</label>' +
        '<textarea id="f-scope" placeholder="e.g. 5x bathroom shower partitions, master bath fixed glass">' + esc(v.scope_description) + '</textarea>' +
        '<div class="hint">Describe it the way the site team would say it.</div></div>' +
      '<div class="field"><label for="f-qty">Quantity (optional)</label><input id="f-qty" type="number" inputmode="numeric" value="' + esc(v.quantity === null ? '' : v.quantity) + '"></div>' +
      '<div class="row2">' +
        '<div class="field"><label for="f-inst">Install date</label><input id="f-inst" type="date" value="' + esc((realDate(v.installation_date) || '').slice(0, 10)) + '"></div>' +
        '<div class="field"><label for="f-targ">Target finish</label><input id="f-targ" type="date" value="' + esc((realDate(v.target_finish_date) || '').slice(0, 10)) + '"></div>' +
      '</div>' +
      '<div class="field"><label for="f-stat">Status</label><select id="f-stat">' +
        STATUSES.map(function (s) { return '<option' + (s.name === v.status ? ' selected' : '') + '>' + esc(s.name) + '</option>'; }).join('') +
      '</select></div>' +
      (editing ? '<div class="field"><label for="f-act">Actual finish</label><input id="f-act" type="date" value="' + esc((realDate(v.actual_finish_date) || '').slice(0, 10)) + '"></div>' : '') +
      '<div class="field"><label>Assigned to</label>' + peoplePicker(assignedNow) + '</div>' +
      '<div class="btnrow">' +
        '<button class="btn btn-primary" id="save">' + (editing ? 'Save changes' : 'Add task') + '</button>' +
        '<button class="btn btn-ghost" data-back="' + (editing ? '#/activity/' + id : '#/') + '">Cancel</button>' +
        (editing && isOffice() ? '<button class="btn btn-danger" id="del">Delete</button>' : '') +
      '</div>' +
    '</div></main>' + tabbar('dash');

    root.innerHTML = html;

    wirePeoplePicker();
    var siteSel = document.getElementById('f-site2');
    var lastSite = siteSel.value;
    siteSel.addEventListener('change', function () {
      if (siteSel.value !== '__new') { lastSite = siteSel.value; return; }
      siteSel.value = lastSite;
      if (!editing) { state.returnTo = 'task'; go('#/site/new', true); }
      else { toast('Save this task first, then add the project from the dashboard'); }
    });

    var catSel = document.getElementById('f-cat2');
    var catCustom = document.getElementById('f-cat-custom');
    catSel.addEventListener('change', function () {
      var on = catSel.value === '__custom';
      catCustom.style.display = on ? '' : 'none';
      if (on) catCustom.focus();
    });

    document.getElementById('save').addEventListener('click', function () {
      var scope = document.getElementById('f-scope').value.trim();
      var category = catSel.value;
      if (category === '__custom') {
        category = catCustom.value.trim();
        if (!category) { toast('Type the kind of work, or pick one from the list'); catCustom.focus(); return; }
      }
      if (!scope) { toast('Add a short scope description'); return; }
      var qty = document.getElementById('f-qty').value;
      var payload = {
        site_id: document.getElementById('f-site2').value,
        category: category,
        scope_description: scope,
        quantity: qty === '' ? null : Number(qty),
        installation_date: document.getElementById('f-inst').value || null,
        target_finish_date: document.getElementById('f-targ').value || null,
        status: document.getElementById('f-stat').value
      };
      var actEl = document.getElementById('f-act');
      if (actEl) payload.actual_finish_date = actEl.value || null;

      var p = editing
        ? Sync.update('activities', id, payload)
        : Sync.insert('activities', Object.assign(payload, {
            created_by: state.user ? state.user.id : null,
            created_at: new Date().toISOString()
          }));

      var picked = pickedPeople();
      p.then(function (rec) {
        var taskId = editing ? id : rec.id;
        var had = {};
        teamFor(taskId).forEach(function (t) { had[t.user_id] = 1; });
        var want = {};
        picked.forEach(function (u) { want[u] = 1; });
        var ops = [];
        picked.forEach(function (u) {
          if (!had[u]) ops.push(Sync.insert('activity_team', { activity_id: taskId, user_id: u, role_on_job: null }));
        });
        Object.keys(had).forEach(function (u) { if (!want[u]) ops.push(Sync.removeTeamMember(taskId, u)); });
        return Promise.all(ops).then(function () { return rec; });
      }).then(function (rec) {
        toast(editing ? 'Saved' : 'Task added');
        go('#/activity/' + (editing ? id : rec.id), true);
      });
    });

    var delBtn = document.getElementById('del');
    if (delBtn) {
      delBtn.addEventListener('click', function () {
        if (!confirm('Delete this task and its updates? This cannot be undone.')) return;
        Sync.remove('activities', id).then(function () {
          toast('Deleted');
          go('#/', true);
        });
      });
    }
  }

  /* =====================================================================
     VIEW — Team assignment
     ===================================================================== */
  function viewTeam(id) {
    var a = activityById(id);
    if (!a) { location.hash = '#/'; return; }
    var assigned = {};
    teamFor(id).forEach(function (t) { assigned[t.user_id] = 1; });

    var html = appbar('Team', a.scope_description || a.category, '#/activity/' + id);
    html += '<main><div class="panel"><h2>Who is doing this task?</h2>' +
      '<p style="font-size:.85rem;color:var(--ink-3);margin-top:0">Tick people to assign them. Not on the list? Add their name below.</p>' +
      peoplePicker(assigned) + '</div>' +
      '<div class="btnrow"><button class="btn btn-primary" data-back="#/activity/' + esc(id) + '">Done</button></div>' +
      '</main>' + tabbar('dash');
    root.innerHTML = html;

    function assign(uid, on) {
      return (on ? Sync.insert('activity_team', { activity_id: id, user_id: uid, role_on_job: null })
                 : Sync.removeTeamMember(id, uid)).then(loadLocal);
    }
    wirePeoplePicker(function (uid) { assign(uid, true); });
    document.getElementById('people').addEventListener('change', function (e) {
      var cb = e.target;
      if (!cb.matches('input[data-user]')) return;
      assign(cb.getAttribute('data-user'), cb.checked).then(function () {
        toast(cb.checked ? 'Assigned' : 'Removed');
      });
    });
  }

  /* =====================================================================
     VIEW — Site form
     ===================================================================== */
  function viewSiteForm(id) {
    var editing = !!id;
    var s = editing ? siteById(id) : null;
    if (editing && !s) { location.hash = '#/sites'; return; }
    var v = s || { name: '', community: '', client: '', main_contractor: '', address: '' };

    var html = appbar(editing ? 'Edit project' : 'New project', '', editing ? '#/site/' + id : '#/sites');
    html += '<main><div class="panel">' +
      '<div class="field"><label for="s-name">Project name</label><input id="s-name" value="' + esc(v.name) + '" placeholder="e.g. Villa 16, Cluster 38"></div>' +
      '<div class="field"><label for="s-comm">Community</label><input id="s-comm" value="' + esc(v.community || '') + '" placeholder="e.g. Jumeirah Islands"></div>' +
      '<div class="field"><label for="s-con">Main contractor</label><input id="s-con" value="' + esc(v.main_contractor || '') + '" placeholder="e.g. GTS, MACS, JMS"></div>' +
      '<div class="field"><label for="s-client">Client</label><input id="s-client" value="' + esc(v.client || '') + '"></div>' +
      '<div class="field"><label for="s-addr">Address</label><input id="s-addr" value="' + esc(v.address || '') + '"></div>' +
      '<div class="btnrow">' +
        '<button class="btn btn-primary" id="save">' + (editing ? 'Save changes' : 'Add project') + '</button>' +
        '<button class="btn btn-ghost" data-back="' + (editing ? '#/site/' + id : '#/sites') + '">Cancel</button>' +
        (editing ? '<button class="btn btn-danger" id="del-site">Delete project</button>' : '') +
      '</div></div></main>' + tabbar('sites');
    root.innerHTML = html;
    var delSite = document.getElementById('del-site');
    if (delSite) delSite.addEventListener('click', function () { deleteProject(id); });

    document.getElementById('save').addEventListener('click', function () {
      var name = document.getElementById('s-name').value.trim();
      if (!name) { toast('Give the project a name'); return; }
      var payload = {
        name: name,
        community: document.getElementById('s-comm').value.trim() || null,
        main_contractor: document.getElementById('s-con').value.trim() || null,
        client: document.getElementById('s-client').value.trim() || null,
        address: document.getElementById('s-addr').value.trim() || null
      };
      var p = editing
        ? Sync.update('sites', id, payload)
        : Sync.insert('sites', Object.assign(payload, {
            created_by: state.user ? state.user.id : null,
            created_at: new Date().toISOString(),
            is_archived: false
          }));
      p.then(function (rec) {
        toast(editing ? 'Saved' : 'Project added');
        var back = (!editing && state.returnTo === 'task') ? '#/activity/new?site=' + rec.id : '#/site/' + (editing ? id : rec.id);
        state.returnTo = null;
        go(back, true);
      });
    });
  }

  /* =====================================================================
     VIEW — Settings / sync
     ===================================================================== */
  function viewSettings() {
    Promise.all([Store.getAll('sites'), Store.getAll('activities')]).then(function (res) {
      var siteCount = res[0].length, actCount = res[1].length;

      var html = appbar('Settings', Sync.syncState().enabled ? 'Shared sync' : 'On this device', '#/', '');
      html += '<main>';

      // --- who ---
      html += '<div class="panel"><h2>This device</h2>' +
        '<div class="field"><label for="set-name">Name shown on your updates</label>' +
        '<input id="set-name" value="' + esc(state.profile ? (state.profile.full_name || '') : '') + '" placeholder="e.g. Ramesh Kumar"></div>' +
        '<div class="btnrow"><button class="btn btn-primary" id="save-name">Save name</button></div></div>';

      // --- where the data lives ---
      var st = Sync.syncState();
      var where, note;
      if (!st.enabled) {
        where = 'On this device only';
        note = 'Shared sync is not switched on yet, so nothing is sent anywhere and other people cannot see this data. ' +
          'Clearing the browser\'s data, or uninstalling the app, erases it — so keep a backup.';
      } else if (st.status === 'error') {
        where = 'Saved here — not syncing';
        note = st.error || 'Could not reach the shared database.';
      } else if (st.status === 'offline') {
        where = 'Saved here — will sync when back online';
        note = 'Changes made without signal are kept on this device and sent automatically when the connection returns.';
      } else if (st.linked) {
        where = 'Shared with the whole team';
        note = 'Everyone using the tracker sees the same list. Changes appear on other phones within seconds, and anything entered without signal is sent once you are back online.';
      } else {
        where = 'Connecting to the shared list…';
        note = 'Anything already on this device is being uploaded and merged with everyone else\'s.';
      }
      html += '<div class="panel"><h2>Your data</h2>' +
        '<dl class="kv">' +
        '<dt>Stored</dt><dd>' + esc(where) + '</dd>' +
        '<dt>Projects</dt><dd class="mono">' + siteCount + '</dd>' +
        '<dt>Tasks</dt><dd class="mono">' + actCount + '</dd>' +
        '</dl>' +
        '<p style="font-size:.85rem;color:' + (st.status === 'error' ? 'var(--alert)' : 'var(--ink-3)') + ';margin:4px 0 0">' + esc(note) + '</p></div>';

      // --- backup / move between devices ---
      html += '<div class="panel"><h2>Backup &amp; transfer</h2>' +
        '<p style="font-size:.85rem;color:var(--ink-3);margin-top:0">' +
          (st.enabled ? 'Export a backup file as a safety copy. Importing one merges it into the shared list — the newer copy of each item wins. '
                      : 'Export a backup file to keep it safe or move your work to another device. ') +
        'Photos are not included in the backup file.</p>' +
        '<div class="btnrow">' +
          '<button class="btn btn-primary" id="backup">Export backup</button>' +
          '<button class="btn btn-ghost" id="restore">Import backup</button>' +
        '</div>' +
        '<input type="file" id="restore-file" accept="application/json,.json" style="display:none">' +
        '<div class="btnrow"><button class="btn btn-ghost" id="export">Export work list (CSV)</button></div></div>';

      // --- starter data ---
      if (siteCount === 0 && actCount === 0) {
        html += '<div class="panel"><h2>Starter data</h2>' +
          '<p style="font-size:.85rem;color:var(--ink-3);margin-top:0">Load the projects and tasks from your ' +
          '\u201cProject Schedule \u2013 Shamel\u201d spreadsheet to begin with something to edit.</p>' +
          '<div class="btnrow"><button class="btn btn-ghost" id="load-seed">Load spreadsheet data</button></div></div>';
      }

      if (state.installEvent) {
        html += '<div class="panel"><h2>Install</h2>' +
          '<p style="font-size:.85rem;color:var(--ink-3);margin-top:0">Add the tracker to your home screen so it opens like an app.</p>' +
          '<div class="btnrow"><button class="btn btn-primary" id="install">Install app</button></div></div>';
      }

      // --- danger ---
      html += '<div class="panel"><h2>Reset</h2>' +
        '<p style="font-size:.85rem;color:var(--ink-3);margin-top:0">' +
          (st.enabled ? 'Clear this device\'s copy. The shared list is not touched and downloads again when the app reopens. Anything not yet sent is lost.'
                      : 'Erase everything on this device and start empty. Export a backup first if you might want it back.') + '</p>' +
        '<div class="btnrow"><button class="btn btn-danger btn-block" id="reset">' +
          (st.enabled ? 'Clear this device\'s copy' : 'Erase all data on this device') + '</button></div></div>';

      html += footer();
      html += '</main>' + tabbar('set');
      root.innerHTML = html;

      document.getElementById('save-name').addEventListener('click', function () {
        var name = document.getElementById('set-name').value.trim();
        if (!name) { toast('Enter a name'); return; }
        Sync.setDisplayName(name).then(loadLocal).then(function () {
          state.profile = profileById(state.user.id) || state.profile;
          if (state.profile) state.profile.full_name = name;
          toast('Name saved');
        });
      });

      document.getElementById('backup').addEventListener('click', function () {
        Sync.exportAll().then(function (dump) {
          downloadBlob(JSON.stringify(dump, null, 2),
            'glazing-backup-' + today() + '.json', 'application/json');
          toast('Backup exported');
        });
      });

      var restoreFile = document.getElementById('restore-file');
      document.getElementById('restore').addEventListener('click', function () { restoreFile.click(); });
      restoreFile.addEventListener('change', function () {
        var f = restoreFile.files && restoreFile.files[0];
        if (!f) return;
        var mode = Sync.syncState().linked ? 'merge'
          : (confirm('Import backup.\n\nOK = REPLACE everything on this device with the backup.\nCancel = MERGE the backup into what is already here.')
             ? 'replace' : 'merge');
        var reader = new FileReader();
        reader.onload = function () {
          var dump;
          try { dump = JSON.parse(reader.result); }
          catch (e) { toast('That file is not valid'); return; }
          Sync.importAll(dump, mode).then(function () {
            toast('Backup imported');
            refreshAndRender();
          }).catch(function (e) { toast(e.message || 'Could not import that file'); });
        };
        reader.readAsText(f);
      });

      document.getElementById('export').addEventListener('click', exportCsv);

      var seedBtn = document.getElementById('load-seed');
      if (seedBtn) seedBtn.addEventListener('click', function () {
        seedBtn.disabled = true;
        loadSeedData().then(function (n) {
          toast(n ? 'Loaded ' + n + ' tasks' : 'Nothing to load');
          refreshAndRender();
        }).catch(function () { toast('Could not load starter data'); seedBtn.disabled = false; });
      });

      var inst = document.getElementById('install');
      if (inst) inst.addEventListener('click', function () {
        state.installEvent.prompt();
        state.installEvent = null;
      });

      document.getElementById('reset').addEventListener('click', function () {
        if (!confirm(Sync.syncState().enabled
          ? 'Clear this device\'s copy? The shared list stays as it is and downloads again.'
          : 'Erase ALL data on this device? This cannot be undone. Export a backup first if you want to keep it.')) return;
        Sync.resetDevice().then(function () { location.reload(); });
      });
    });
  }

  /* =====================================================================
     VIEW — Reports
     All projects, or just those with tasks in a chosen status. Printable
     (Save as PDF from the print dialog) and exportable to a spreadsheet.
     ===================================================================== */
  var rep = { status: '', projState: '', contractor: '', category: '', detail: true };

  function isOpenTask(a) { return a.status !== 'Completed'; }
  function isOverdue(a) {
    if (!isOpenTask(a)) return false;
    var d = daysUntil(a.target_finish_date);
    return d !== null && d < 0;
  }

  /* Rows of { site, tasks (matching filter), all (every task on the project) } */
  function reportRows() {
    var bySite = {};
    state.data.activities.forEach(function (a) {
      (bySite[a.site_id] = bySite[a.site_id] || []).push(a);
    });
    return state.data.sites.filter(function (s) { return !s.is_archived; }).map(function (s) {
      var all = bySite[s.id] || [];
      var tasks = all.filter(function (a) {
        if (rep.status && a.status !== rep.status) return false;
        if (rep.category && a.category !== rep.category) return false;
        return true;
      });
      return { site: s, all: all, tasks: tasks };
    }).filter(function (r) {
      if (rep.contractor && r.site.main_contractor !== rep.contractor) return false;
      var open = r.all.filter(isOpenTask).length;
      if (rep.projState === 'active' && !open) return false;
      if (rep.projState === 'done' && (open || !r.all.length)) return false;
      if (rep.projState === 'empty' && r.all.length) return false;
      // A status or type filter shows only projects that have matching tasks.
      if ((rep.status || rep.category) && !r.tasks.length) return false;
      return true;
    }).sort(function (a, b) { return a.site.name.localeCompare(b.site.name); });
  }

  function viewReports() {
    var rows = reportRows();
    var tasks = [];
    rows.forEach(function (r) { tasks = tasks.concat(r.tasks); });
    var done = tasks.filter(function (a) { return a.status === 'Completed'; }).length;
    var overdue = tasks.filter(isOverdue).length;
    var review = tasks.filter(function (a) { return a.status === 'Needs Review'; }).length;

    function opts(list, sel) {
      return list.map(function (v) {
        var val = typeof v === 'string' ? v : v.value, lab = typeof v === 'string' ? v : v.label;
        return '<option value="' + esc(val) + '"' + (sel === val ? ' selected' : '') + '>' + esc(lab) + '</option>';
      }).join('');
    }

    var filterDesc = [
      rep.status ? 'Status: ' + rep.status : 'All statuses',
      rep.projState ? { active: 'Active projects', done: 'Completed projects', empty: 'Projects with no tasks' }[rep.projState] : 'All projects',
      rep.contractor ? 'Contractor: ' + rep.contractor : '',
      rep.category ? 'Type: ' + rep.category : ''
    ].filter(Boolean).join(' · ');

    var html = appbar('Reports', 'Projects & tasks', '#/', '');
    html += '<main class="report">';
    html += '<div class="print-head"><div class="brand-word">EUROLUX</div>' +
      '<h1>Internal Glazing — Project Report</h1>' +
      '<p>' + esc(todayLong()) + ' · ' + esc(filterDesc) + '</p></div>';

    html += '<div class="filters report-filters">' +
      '<select id="r-status" aria-label="Task status"><option value="">All statuses</option>' + opts(STATUSES.map(function (x) { return x.name; }), rep.status) + '</select>' +
      '<select id="r-proj" aria-label="Project state">' + opts([
        { value: '', label: 'All projects' }, { value: 'active', label: 'Active projects' },
        { value: 'done', label: 'Completed projects' }, { value: 'empty', label: 'Projects with no tasks' }], rep.projState) + '</select>' +
      '<select id="r-con" aria-label="Contractor"><option value="">All contractors</option>' + opts(contractors(), rep.contractor) + '</select>' +
      '<select id="r-cat" aria-label="Type of work"><option value="">All types</option>' + opts(allCategories(), rep.category) + '</select>' +
      '</div>';

    html += '<div class="report-actions">' +
      '<div class="seg" role="group" aria-label="Report layout">' +
        '<button class="' + (rep.detail ? '' : 'on') + '" id="r-sum">Summary</button>' +
        '<button class="' + (rep.detail ? 'on' : '') + '" id="r-det">With tasks</button></div>' +
      '<button class="btn btn-ghost" id="r-csv">Export CSV</button>' +
      '<button class="btn btn-ghost" id="r-view">View PDF</button>' +
      '<button class="btn btn-primary" id="r-pdf">Download PDF</button>' +
      '</div>';

    // KPI tiles
    html += '<div class="kpis">' +
      kpi(rows.length, 'Projects') + kpi(tasks.length, 'Tasks') +
      kpi(done, 'Completed', 'good') + kpi(tasks.length - done, 'Open') +
      kpi(overdue, 'Overdue', overdue ? 'bad' : '') + kpi(review, 'Needs review', review ? 'warn' : '') +
      '</div>';

    // status breakdown — tap a row to filter by it
    var counts = {};
    tasks.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    var max = 0;
    STATUSES.forEach(function (x) { max = Math.max(max, counts[x.name] || 0); });
    html += '<div class="panel"><h2>Tasks by status</h2><div class="bars">' +
      STATUSES.map(function (x) {
        var n = counts[x.name] || 0;
        return '<button class="barrow' + (rep.status === x.name ? ' on' : '') + '" data-status="' + esc(x.name) + '">' +
          '<span class="barlbl">' + esc(x.name) + '</span>' +
          '<span class="bartrack"><span class="barfill" style="width:' + (max ? Math.round(n / max * 100) : 0) + '%;background:' + x.color + '"></span></span>' +
          '<span class="barnum mono">' + n + '</span></button>';
      }).join('') + '</div>' +
      (rep.status ? '<button class="linkbtn" id="r-clear">Show all statuses</button>' : '') +
      '</div>';

    // projects table
    html += '<div class="sechead"><h2>Projects</h2><span class="count mono">' + rows.length + '</span></div>';
    if (!rows.length) {
      html += emptyState('No projects match', 'Change or clear a filter to see more.');
    } else {
      html += '<div class="rtable-wrap"><table class="rtable"><thead><tr>' +
        '<th>Project</th><th>Contractor</th><th class="num">Tasks</th><th class="num">Done</th>' +
        '<th class="num">Open</th><th class="num">Overdue</th><th>Progress</th></tr></thead><tbody>' +
        rows.map(function (r) {
          var n = r.tasks.length;
          var d = r.tasks.filter(function (a) { return a.status === 'Completed'; }).length;
          var od = r.tasks.filter(isOverdue).length;
          var pct = n ? Math.round(d / n * 100) : 0;
          var main = '<tr class="prow"><td><a href="#/site/' + esc(r.site.id) + '"><strong>' + esc(r.site.name) + '</strong></a>' +
              (r.site.community ? '<span class="sub">' + esc(r.site.community) + '</span>' : '') + '</td>' +
            '<td>' + esc(r.site.main_contractor || '—') + '</td>' +
            '<td class="num">' + n + '</td><td class="num">' + d + '</td><td class="num">' + (n - d) + '</td>' +
            '<td class="num' + (od ? ' bad' : '') + '">' + od + '</td>' +
            '<td><span class="prog"><span style="width:' + pct + '%"></span></span><span class="mono pct">' + pct + '%</span></td></tr>';
          if (!rep.detail || !n) return main;
          return main + '<tr class="trows"><td colspan="7"><table class="ttable"><tbody>' +
            r.tasks.slice().sort(function (x, y) {
              return (statusMeta(x.status).stage + 10) % 20 - (statusMeta(y.status).stage + 10) % 20;
            }).map(function (a) {
              var who = assigneeNames(a.id).join(', ');
              return '<tr><td><a href="#/activity/' + esc(a.id) + '">' + esc(a.scope_description || '(no scope)') + '</a>' +
                '<span class="sub">' + esc(a.category || '') + (who ? ' · ' + esc(who) : '') + '</span></td>' +
                '<td>' + statusChip(a.status) + '</td>' +
                '<td class="mono">' + fmtDate(a.target_finish_date) + (isOverdue(a) ? ' <span class="bad">overdue</span>' : '') + '</td></tr>';
            }).join('') + '</tbody></table></td></tr>';
        }).join('') +
        '</tbody></table></div>';
    }

    html += footer() + '</main>' + tabbar('reports');
    root.innerHTML = html;

    function bindSel(elId, key) {
      document.getElementById(elId).addEventListener('change', function (e) { rep[key] = e.target.value; viewReports(); });
    }
    bindSel('r-status', 'status'); bindSel('r-proj', 'projState'); bindSel('r-con', 'contractor'); bindSel('r-cat', 'category');
    root.querySelectorAll('.barrow').forEach(function (b) {
      b.addEventListener('click', function () {
        var st = b.getAttribute('data-status');
        rep.status = rep.status === st ? '' : st;
        viewReports();
      });
    });
    var clr = document.getElementById('r-clear');
    if (clr) clr.addEventListener('click', function () { rep.status = ''; viewReports(); });
    document.getElementById('r-sum').addEventListener('click', function () { rep.detail = false; viewReports(); });
    document.getElementById('r-det').addEventListener('click', function () { rep.detail = true; viewReports(); });
    document.getElementById('r-view').addEventListener('click', function () { reportPdf(rows, filterDesc, 'view'); });
    document.getElementById('r-pdf').addEventListener('click', function () { reportPdf(rows, filterDesc, 'save'); });
    document.getElementById('r-csv').addEventListener('click', function () { exportReportCsv(rows); });
  }

  /* ---------------------------------------------------------------
     PDF — built on the phone with jsPDF (loaded only when first used,
     then kept for offline use by the service worker).
     --------------------------------------------------------------- */
  var PDF_LIBS = [
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js',
    'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js'
  ];
  var pdfReady = null;
  function loadPdfLib() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    if (pdfReady) return pdfReady;
    pdfReady = PDF_LIBS.reduce(function (p, src) {
      return p.then(function () {
        return new Promise(function (resolve, reject) {
          var sc = document.createElement('script');
          sc.src = src; sc.onload = resolve;
          sc.onerror = function () { reject(new Error('load ' + src)); };
          document.head.appendChild(sc);
        });
      });
    }, Promise.resolve()).catch(function (e) { pdfReady = null; throw e; });
    return pdfReady;
  }

  function reportPdf(rows, filterDesc, mode) {
    // Open the viewer window straight away (inside the tap) so pop-up
    // blockers allow it; it's filled once the PDF is ready.
    var win = mode === 'view' ? window.open('', '_blank') : null;
    if (win) win.document.write('<p style="font-family:sans-serif;padding:24px">Preparing report…</p>');
    toast('Preparing PDF…');
    loadPdfLib().then(function () {
      var doc = buildReportPdf(rows, filterDesc);
      var name = 'Eurolux-Glazing-Report-' + today() + (rep.status ? '-' + rep.status.replace(/\W+/g, '-') : '') + '.pdf';
      if (mode === 'view') {
        var url = URL.createObjectURL(doc.output('blob'));
        if (win) win.location.href = url; else window.open(url, '_blank') || (location.href = url);
      } else {
        doc.save(name);
        toast('PDF downloaded');
      }
    }).catch(function (e) {
      console.error(e);
      if (win) win.close();
      toast('PDF needs a connection the first time — opening print instead');
      setTimeout(function () { window.print(); }, 600);
    });
  }

  function buildReportPdf(rows, filterDesc) {
    var jsPDF = window.jspdf.jsPDF;
    var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
    var W = doc.internal.pageSize.getWidth(), M = 14;
    var tasks = [];
    rows.forEach(function (r) { tasks = tasks.concat(r.tasks); });
    var done = tasks.filter(function (a) { return a.status === 'Completed'; }).length;
    var overdue = tasks.filter(isOverdue).length;
    var review = tasks.filter(function (a) { return a.status === 'Needs Review'; }).length;

    // header band
    doc.setFillColor(0, 0, 0); doc.rect(0, 0, W, 24, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('times', 'bold'); doc.setFontSize(16); doc.text('EUROLUX', M, 11);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.text('Internal Glazing — Project Report', M, 18);
    doc.text(todayLong(), W - M, 11, { align: 'right' });
    doc.text(filterDesc, W - M, 18, { align: 'right' });
    doc.setTextColor(26, 26, 26);

    // KPI boxes
    var k = [[rows.length, 'Projects'], [tasks.length, 'Tasks'], [done, 'Completed'],
             [tasks.length - done, 'Open'], [overdue, 'Overdue'], [review, 'Needs review']];
    var bw = (W - 2 * M - 5 * 4) / 6, y = 32;
    k.forEach(function (it, i) {
      var x = M + i * (bw + 4);
      doc.setDrawColor(220); doc.setFillColor(247, 247, 247); doc.roundedRect(x, y, bw, 17, 1, 1, 'FD');
      doc.setFont('times', 'bold'); doc.setFontSize(16);
      if (it[1] === 'Completed') doc.setTextColor(21, 128, 61);
      else if (it[1] === 'Overdue' && it[0]) doc.setTextColor(185, 28, 28);
      else if (it[1] === 'Needs review' && it[0]) doc.setTextColor(180, 83, 9);
      else doc.setTextColor(26, 26, 26);
      doc.text(String(it[0]), x + 4, y + 8.5);
      doc.setTextColor(102); doc.setFont('helvetica', 'normal'); doc.setFontSize(8);
      doc.text(it[1], x + 4, y + 14);
    });
    doc.setTextColor(26, 26, 26);

    // status breakdown
    var counts = {};
    tasks.forEach(function (a) { counts[a.status] = (counts[a.status] || 0) + 1; });
    doc.autoTable({
      startY: y + 24, margin: { left: M, right: M }, tableWidth: 110,
      head: [['Status', 'Tasks']],
      body: STATUSES.map(function (x) { return [x.name, String(counts[x.name] || 0)]; }),
      theme: 'grid', styles: { fontSize: 8, cellPadding: 1.6, lineColor: [225, 225, 225] },
      headStyles: { fillColor: [0, 0, 0], textColor: 255, fontStyle: 'bold' },
      columnStyles: { 1: { halign: 'right', cellWidth: 20 } },
      didParseCell: function (h) { if (h.section === 'head' && h.column.index === 1) h.cell.styles.halign = 'right'; }
    });

    // projects summary
    doc.autoTable({
      startY: doc.lastAutoTable.finalY + 8, margin: { left: M, right: M },
      head: [['Project', 'Community', 'Contractor', 'Tasks', 'Done', 'Open', 'Overdue', 'Progress']],
      body: rows.map(function (r) {
        var n = r.tasks.length, d = r.tasks.filter(function (a) { return a.status === 'Completed'; }).length;
        return [r.site.name, r.site.community || '', r.site.main_contractor || '', n, d, n - d,
                r.tasks.filter(isOverdue).length, (n ? Math.round(d / n * 100) : 0) + '%'];
      }),
      theme: 'striped', styles: { fontSize: 8.5, cellPadding: 2 },
      headStyles: { fillColor: [0, 0, 0], textColor: 255 },
      alternateRowStyles: { fillColor: [247, 247, 247] },
      columnStyles: { 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' },
                      6: { halign: 'right' }, 7: { halign: 'right' } },
      didParseCell: function (h) {
        if (h.section === 'head' && h.column.index >= 3) h.cell.styles.halign = 'right';
        if (h.section === 'body' && h.column.index === 6 && Number(h.cell.raw) > 0) {
          h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold';
        }
      }
    });

    // task detail, grouped by project
    if (rep.detail) {
      var body = [];
      rows.forEach(function (r) {
        if (!r.tasks.length) return;
        body.push([{ content: r.site.name + (r.site.main_contractor ? '  ·  ' + r.site.main_contractor : ''), colSpan: 6,
          styles: { fillColor: [235, 235, 235], fontStyle: 'bold' } }]);
        r.tasks.forEach(function (a) {
          body.push([a.scope_description || '(no scope)', a.category || '', a.status || '',
            assigneeNames(a.id).join(', '), fmtDate(a.target_finish_date), isOverdue(a) ? 'Overdue' : '']);
        });
      });
      if (body.length) {
        doc.addPage();
        doc.setFont('times', 'bold'); doc.setFontSize(13); doc.text('Tasks by project', M, 16);
        doc.autoTable({
          startY: 21, margin: { left: M, right: M },
          head: [['Task', 'Type', 'Status', 'Assigned to', 'Target', '']],
          body: body, theme: 'grid',
          styles: { fontSize: 8, cellPadding: 1.8, lineColor: [225, 225, 225], valign: 'top' },
          headStyles: { fillColor: [0, 0, 0], textColor: 255 },
          columnStyles: { 0: { cellWidth: 95 }, 1: { cellWidth: 38 }, 2: { cellWidth: 34 },
                          3: { cellWidth: 52 }, 4: { cellWidth: 22 }, 5: { cellWidth: 18 } },
          didParseCell: function (h) {
            if (h.section === 'body' && h.column.index === 5 && h.cell.raw === 'Overdue') {
              h.cell.styles.textColor = [185, 28, 28]; h.cell.styles.fontStyle = 'bold';
            }
          }
        });
      }
    }

    // footer on every page
    var pages = doc.internal.getNumberOfPages();
    for (var i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(120);
      var H = doc.internal.pageSize.getHeight();
      doc.text('Eurolux Internal Glazing Project Tracker', M, H - 7);
      doc.text('Page ' + i + ' of ' + pages, W - M, H - 7, { align: 'right' });
    }
    return doc;
  }

  function kpi(n, label, tone) {
    return '<div class="kpi' + (tone ? ' ' + tone : '') + '"><strong>' + n + '</strong><span>' + esc(label) + '</span></div>';
  }

  function exportReportCsv(rows) {
    var out = [['Project', 'Community', 'Contractor', 'Task', 'Type', 'Status', 'Assigned to', 'Install date', 'Target finish', 'Actual finish', 'Overdue']];
    rows.forEach(function (r) {
      if (!r.tasks.length) {
        out.push([r.site.name, r.site.community || '', r.site.main_contractor || '', '', '', '', '', '', '', '', '']);
      }
      r.tasks.forEach(function (a) {
        out.push([r.site.name, r.site.community || '', r.site.main_contractor || '',
          a.scope_description || '', a.category || '', a.status || '', assigneeNames(a.id).join(', '),
          (realDate(a.installation_date) || '').slice(0, 10), (realDate(a.target_finish_date) || '').slice(0, 10),
          (realDate(a.actual_finish_date) || '').slice(0, 10), isOverdue(a) ? 'Yes' : '']);
      });
    });
    var csv = out.map(function (r) {
      return r.map(function (cell) {
        var v = String(cell === null || cell === undefined ? '' : cell);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');
    downloadBlob('﻿' + csv, 'glazing-report-' + today() + (rep.status ? '-' + rep.status.replace(/\W+/g, '-').toLowerCase() : '') + '.csv', 'text/csv;charset=utf-8');
    toast('Report exported');
  }

  function downloadBlob(content, filename, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url; link.download = filename;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /* Loads the bundled spreadsheet extract on request. */
  function loadSeedData() {
    return fetch('data/seed.json').then(function (r) {
      if (!r.ok) throw new Error('seed missing');
      return r.json();
    }).then(function (dump) {
      return Sync.importAll(dump, 'merge').then(function () {
        return (dump.data && dump.data.activities ? dump.data.activities.length : 0);
      });
    });
  }

  function exportCsv() {
    var rows = [['Project', 'Community', 'Contractor', 'Type', 'Scope', 'Qty', 'Install date', 'Target finish', 'Actual finish', 'Status']];
    filtered().forEach(function (a) {
      var s = siteById(a.site_id) || {};
      rows.push([
        s.name || '', s.community || '', s.main_contractor || '',
        a.category || '', a.scope_description || '', a.quantity === null || a.quantity === undefined ? '' : a.quantity,
        (realDate(a.installation_date) || '').slice(0, 10), (realDate(a.target_finish_date) || '').slice(0, 10),
        (realDate(a.actual_finish_date) || '').slice(0, 10), a.status || ''
      ]);
    });
    var csv = rows.map(function (r) {
      return r.map(function (cell) {
        var v = String(cell === null || cell === undefined ? '' : cell);
        return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(',');
    }).join('\n');

    downloadBlob('\ufeff' + csv, 'glazing-work-' + today() + '.csv', 'text/csv;charset=utf-8');
    toast('Exported');
  }

  /* =====================================================================
     Router
     ===================================================================== */
  function route() {
    if (!state.user) { return; }  // ensureSession always yields one
    document.body.classList.remove('no-nav');

    var hash = location.hash || '#/';
    var qIndex = hash.indexOf('?');
    var query = {};
    if (qIndex > -1) {
      hash.slice(qIndex + 1).split('&').forEach(function (kv) {
        var p = kv.split('=');
        query[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
      });
      hash = hash.slice(0, qIndex);
    }
    var parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);

    window.scrollTo(0, 0);

    if (!parts.length) return viewDashboard();
    if (parts[0] === 'board') return viewBoard();
    if (parts[0] === 'settings') return viewSettings();
    if (parts[0] === 'reports') return viewReports();

    if (parts[0] === 'sites') return viewSites();
    if (parts[0] === 'site') {
      if (parts[1] === 'new') return viewSiteForm(null);
      if (parts[2] === 'edit') return viewSiteForm(parts[1]);
      return viewSiteDetail(parts[1]);
    }
    if (parts[0] === 'activity') {
      if (parts[1] === 'new') return viewActivityForm(null, query.site);
      if (parts[2] === 'edit') return viewActivityForm(parts[1]);
      if (parts[2] === 'team') return viewTeam(parts[1]);
      return viewActivity(parts[1]);
    }
    return viewDashboard();
  }

  function refreshAndRender() {
    return loadLocal().then(route);
  }

  /* Delegated navigation. Buttons carry data-nav; card links carry href.
     Handling both here guarantees a tap anywhere on a card opens it, even
     if the browser doesn't fire the native hashchange for some reason. */
  document.addEventListener('click', function (e) {
    var backEl = e.target.closest('[data-back]');
    if (backEl) { goBack(backEl.getAttribute('data-back')); return; }

    var navEl = e.target.closest('[data-nav]');
    if (navEl) { location.hash = navEl.getAttribute('data-nav'); return; }

    var link = e.target.closest('a[href^="#/"]');
    if (link) {
      e.preventDefault();
      var target = link.getAttribute('href');
      if (location.hash === target) route();       // same route: force a repaint
      else location.hash = target;
    }
  });

  /* In-app history, so Back never leaves the app. A list of the screens
     visited; works with the phone's own back button too. */
  var navStack = ['#/'];
  var replacing = false;
  function curHash() { return location.hash || '#/'; }
  window.addEventListener('hashchange', function () {
    var h = curHash();
    if (replacing) { replacing = false; navStack[navStack.length - 1] = h; }
    else if (navStack.length > 1 && navStack[navStack.length - 2] === h) navStack.pop();
    else navStack.push(h);
    refreshAndRender();
  });
  function goBack(fallback) {
    if (navStack.length > 1) history.back();
    else go(fallback || '#/', true);
  }
  /* Navigate; with replace=true the current screen is swapped out of the
     history, so Back after saving a form skips the form. */
  function go(hash, replace) {
    if (location.hash === hash) { refreshAndRender(); return; }
    if (replace) {
      replacing = true;
      location.replace(location.href.split('#')[0] + hash);
    } else {
      location.hash = hash;
    }
  }

  /* Someone else changed something (or the sync status moved). Redraw —
     unless the person is part-way through typing, in which case the fresh
     data shows as soon as they move to another screen. */
  function isBusy() {
    var h = location.hash || '';
    if (/\/(new|edit|team)(\?|$)/.test(h)) return true;
    var a = document.activeElement;
    if (a && (a.tagName === 'TEXTAREA' || (a.tagName === 'INPUT' && a.type !== 'checkbox') || a.tagName === 'SELECT')) return true;
    var up = document.getElementById('up-text');
    return !!(up && up.value.trim());
  }
  Sync.on(function (evt) {
    if (!state.user || document.body.classList.contains('no-nav')) return;
    if (evt === 'data:remote') {
      loadLocal().then(function () {
        state.profile = profileById(state.user.id) || state.profile;
        if (!isBusy()) { var y = window.scrollY; route(); window.scrollTo(0, y); }
      });
    } else if (evt === 'sync:status') {
      if (!isBusy()) { var y2 = window.scrollY; route(); window.scrollTo(0, y2); }
    }
  });

  /* =====================================================================
     Boot
     ===================================================================== */
  function boot() {
    // The app always opens on the main dashboard.
    if (location.hash !== '#/') {
      history.replaceState(null, '', location.href.split('#')[0] + '#/');
    }
    Sync.ensureSession().then(function (sess) {
      state.user = sess.user;
      Sync.initCloud();
      return loadLocal().then(function () {
        state.profile = profileById(state.user.id) || { full_name: '', role: 'admin' };
        if (!hasName()) { viewIdentity(); return; }
        route();
      });
    }).catch(function (err) {
      console.error(err);
      root.innerHTML = '<div class="auth-wrap"><div class="auth-card">' +
        '<div class="auth-mark"><span class="edge"></span><div><h1>Eurolux Glazing Tracker</h1></div></div>' +
        '<p class="tag">This device is blocking local storage.</p>' +
        '<div class="auth-msg err">The app needs browser storage to work. If you are in a private/incognito window, ' +
        'open it in a normal window instead.</div></div></div>';
    });
  }

  window.addEventListener('beforeinstallprompt', function (e) {
    e.preventDefault();
    state.installEvent = e;
  });

  global.boot = boot;
  document.addEventListener('DOMContentLoaded', boot);
})(window);
