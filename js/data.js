/* =====================================================================
   data.js — the data layer.

   The views only ever read from the device's own copy (IndexedDB, via
   store.js), so the app opens instantly and works with no signal.

   Two modes:

   • Local only (FIREBASE_CONFIG is null) — everything stays on this
     device. Backup files are the only way data moves.

   • Shared (FIREBASE_CONFIG set) — every write also goes to Cloud
     Firestore, and live listeners copy everyone else's changes back into
     the device's copy. Firestore queues writes made with no signal and
     sends them when the connection returns.

     The first time a device connects, whatever it already holds is
     uploaded and merged — the newer copy of each record wins — so nobody
     loses the work they entered while the app was local-only.
   ===================================================================== */

(function (global) {
  'use strict';

  var listeners = [];

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : ((r & 0x3) | 0x8);
      return v.toString(16);
    });
  }

  function on(fn) { listeners.push(fn); }
  function emit(evt, data) {
    listeners.forEach(function (fn) { try { fn(evt, data); } catch (e) { console.error(e); } });
  }

  /* The local copy always works, so the app is always usable. */
  function configured() { return true; }
  function online() { return global.navigator ? global.navigator.onLine !== false : true; }

  var TABLES = ['sites', 'activities', 'activity_updates', 'activity_team', 'profiles', 'attachments'];
  function keyOf(table) { return table === 'activity_team' ? 'key' : 'id'; }

  /* =================================================================
     Cloud (Firestore) — all of it is skipped when not configured.
     ================================================================= */
  var cloud = {
    enabled: false,     // config present and SDK loaded
    linked: false,      // this device has merged its data and is listening
    db: null,
    status: 'local',    // local | connecting | live | offline | pending | error
    error: '',
    unsubs: [],
    pendingTables: {}
  };

  /* Firestore holds each file as one document, which is capped at 1 MiB.
     Base64 adds a third, so files are kept under ~720 KB before encoding. */
  var MAX_CLOUD_FILE = 720 * 1024;

  function setStatus(s, err) {
    if (cloud.status === s && !err) return;
    cloud.status = s;
    cloud.error = err || '';
    emit('sync:status', s);
  }

  function clean(obj) {
    var out = JSON.parse(JSON.stringify(obj));
    delete out._pending;
    return out;
  }

  function stamp(r) { return (r && (r.updated_at || r.created_at)) || ''; }

  function cloudSet(table, row) {
    if (!cloud.linked) return;
    var id = row[keyOf(table)];
    // Not awaited: Firestore applies it locally at once and sends it when it can.
    cloud.db.collection(table).doc(String(id)).set(clean(row)).catch(function (e) {
      console.error('Cloud write failed', table, e);
      setStatus('error', e.message);
    });
  }

  function cloudDel(table, id) {
    if (!cloud.linked) return;
    cloud.db.collection(table).doc(String(id)).delete().catch(function (e) {
      console.error('Cloud delete failed', table, e);
    });
  }

  function initCloud() {
    var cfg = global.FIREBASE_CONFIG;
    if (!cfg || !cfg.projectId) return;
    if (!global.firebase || !global.firebase.firestore) {
      setStatus('error', 'Sync library did not load. Check the connection and reopen the app.');
      return;
    }
    cloud.enabled = true;
    setStatus('connecting');
    try {
      if (!global.firebase.apps.length) global.firebase.initializeApp(cfg);
      cloud.db = global.firebase.firestore();
      // Keeps Firestore's own queue of unsent writes across app restarts.
      cloud.db.enablePersistence({ synchronizeTabs: true }).catch(function () {});
    } catch (e) {
      setStatus('error', e.message);
      return;
    }

    global.firebase.auth().onAuthStateChanged(function (user) {
      cloud.signedIn = !!user;
      if (user) startLink();
    });
    signIn();

    global.addEventListener('online', function () {
      if (!cloud.signedIn) signIn();
      else if (!cloud.linked) startLink();
      else recompute();
    });
    global.addEventListener('offline', function () { setStatus('offline'); });
  }

  /* A device that has signed in before restores its session from storage
     even with no signal (onAuthStateChanged fires). Otherwise keep trying. */
  var retryTimer = null;
  function retryLater(fn) {
    clearTimeout(retryTimer);
    retryTimer = setTimeout(fn, 30000);
  }
  function isNetwork(e) {
    var m = (e && (e.code || e.message)) || '';
    return !online() || /network|unavailable|timeout|offline|failed to get document/i.test(m);
  }
  function signIn() {
    if (cloud.signedIn) return;
    global.firebase.auth().signInAnonymously().catch(function (e) {
      console.warn('Sign-in failed', e);
      if (cloud.signedIn) return;
      if (isNetwork(e)) setStatus('offline'); else setStatus('error', friendly(e));
      retryLater(signIn);
    });
  }

  function friendly(e) {
    var m = (e && (e.code || e.message)) || '';
    if (/operation-not-allowed|admin-restricted/.test(m)) return 'Anonymous sign-in is not turned on in Firebase (Authentication → Sign-in method).';
    if (/permission-denied/.test(m)) return 'Firebase refused access — check the Firestore rules were published.';
    return (e && e.message) || 'Could not connect';
  }

  var linking = null;
  function startLink() {
    if (cloud.linked || linking) return linking;
    linking = global.Store.getMeta('cloudLinked').then(function (done) {
      return done ? null : firstUpload();
    }).then(function () {
      return global.Store.setMeta('cloudLinked', true);
    }).then(function () {
      cloud.linked = true;
      linking = null;
      listen();
      // Make sure this device's name is visible to everyone else.
      return global.Store.getMeta('deviceUser').then(function (u) {
        if (!u) return;
        return global.Store.get('profiles', u.id).then(function (p) {
          if (p) cloudSet('profiles', p);
        });
      });
    }).catch(function (e) {
      linking = null;
      console.warn('Linking postponed', e);
      // Most often: no signal. Stay on the device copy and try again shortly.
      if (isNetwork(e)) setStatus('offline'); else setStatus('error', friendly(e));
      retryLater(startLink);
    });
    return linking;
  }

  /* Merge this device's existing records into the shared database.
     Only writes a record if the cloud doesn't have it or has an older copy,
     so a stale phone can't overwrite someone's newer edits. */
  function firstUpload() {
    setStatus('pending');
    var writes = [];
    return TABLES.reduce(function (p, table) {
      return p.then(function () {
        return Promise.all([
          global.Store.getAll(table),
          cloud.db.collection(table).get({ source: 'server' })
        ]).then(function (res) {
          var local = res[0], remote = {};
          res[1].forEach(function (d) { remote[d.id] = d.data(); });
          local.forEach(function (row) {
            var id = String(row[keyOf(table)]);
            var theirs = remote[id];
            if (!theirs || stamp(row) > stamp(theirs)) writes.push({ table: table, id: id, row: clean(row) });
          });
        });
      });
    }, Promise.resolve()).then(function () {
      return commitBatches(writes);
    }).then(function () {
      return uploadLocalFiles();
    });
  }

  function commitBatches(writes) {
    var chunks = [];
    for (var i = 0; i < writes.length; i += 400) chunks.push(writes.slice(i, i + 400));
    return chunks.reduce(function (p, chunk) {
      return p.then(function () {
        var b = cloud.db.batch();
        chunk.forEach(function (w) { b.set(cloud.db.collection(w.table).doc(w.id), w.row); });
        return b.commit();
      });
    }, Promise.resolve());
  }

  /* Photos/documents already on this device go up too, if they fit. */
  function uploadLocalFiles() {
    return global.Store.getAll('attachments').then(function (atts) {
      return atts.reduce(function (p, at) {
        return p.then(function () {
          if (!at.blob_id) return null;
          return cloud.db.collection('files').doc(at.blob_id).get({ source: 'server' }).then(function (doc) {
            if (doc.exists) return null;
            return global.Store.get('blobs', at.blob_id).then(function (rec) {
              if (!rec || !rec.blob) return null;
              return putFile(at.blob_id, rec.blob, at.file_name, true).then(function (ok) {
                if (ok && !at.in_cloud) {
                  at.in_cloud = true;
                  return global.Store.put('attachments', at).then(function () {
                    return cloud.db.collection('attachments').doc(at.id).set(clean(at));
                  });
                }
              });
            });
          }).catch(function (e) { console.warn('File upload skipped', at.file_name, e); });
        });
      }, Promise.resolve());
    });
  }

  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var r = new FileReader();
      r.onload = function () { resolve(String(r.result).split(',')[1] || ''); };
      r.onerror = function () { reject(r.error); };
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    var bin = atob(b64), len = bin.length, bytes = new Uint8Array(len);
    for (var i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  }

  /* Re-encode a photo smaller until it fits a Firestore document. */
  function shrinkImage(blob) {
    if (!blob.type || blob.type.indexOf('image/') !== 0 || typeof document === 'undefined') {
      return Promise.resolve(blob);
    }
    return new Promise(function (resolve) {
      var img = new Image();
      var url = URL.createObjectURL(blob);
      img.onload = function () {
        var tries = [[1600, 0.75], [1280, 0.7], [1024, 0.65], [800, 0.6]];
        (function attempt(i) {
          var max = tries[i][0], q = tries[i][1];
          var scale = Math.min(1, max / Math.max(img.width, img.height));
          var c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          c.toBlob(function (out) {
            if (out && (out.size <= MAX_CLOUD_FILE || i === tries.length - 1)) {
              URL.revokeObjectURL(url); resolve(out);
            } else attempt(i + 1);
          }, 'image/jpeg', q);
        })(0);
      };
      img.onerror = function () { URL.revokeObjectURL(url); resolve(blob); };
      img.src = url;
    });
  }

  /* Queues the file for the shared database. Resolves as soon as it is
     queued (true) or found too big to share (false) — it does NOT wait for
     the upload, which with no signal would only finish once back online.
     `waitForServer` makes it wait, for the one-off first upload. */
  function putFile(id, blob, name, waitForServer) {
    var p = blob.size > MAX_CLOUD_FILE ? shrinkImage(blob) : Promise.resolve(blob);
    return p.then(function (b) {
      if (b.size > MAX_CLOUD_FILE) return false;
      return blobToBase64(b).then(function (b64) {
        var write = cloud.db.collection('files').doc(id).set({
          name: name || 'file', contentType: b.type || '', size: b.size, data: b64
        });
        if (waitForServer) return write.then(function () { return true; });
        write.catch(function (e) { console.error('File upload failed', e); });
        return true;
      });
    });
  }

  /* Live listeners: every change anyone makes lands in this device's copy. */
  var renderTimer = null;
  function listen() {
    cloud.unsubs.forEach(function (u) { u(); });
    cloud.unsubs = [];
    var keyless = {};
    TABLES.forEach(function (table) {
      var unsub = cloud.db.collection(table).onSnapshot({ includeMetadataChanges: true }, function (snap) {
        cloud.pendingTables[table] = snap.metadata.hasPendingWrites;
        cloud.fromCache = snap.metadata.fromCache;
        recompute();
        if (!snap.docChanges().length && keyless[table]) return;   // metadata-only
        keyless[table] = true;
        var rows = snap.docs.map(function (d) {
          var r = d.data();
          r[keyOf(table)] = d.id;
          return r;
        });
        replaceTable(table, rows).then(function () {
          clearTimeout(renderTimer);
          renderTimer = setTimeout(function () { emit('data:remote'); }, 120);
        });
      }, function (e) {
        console.error('Listener failed', table, e);
        setStatus('error', friendly(e));
      });
      cloud.unsubs.push(unsub);
    });
  }

  function replaceTable(table, rows) { return global.Store.replaceTable(table, rows); }

  function recompute() {
    if (!cloud.enabled) return setStatus('local');
    if (!online()) return setStatus('offline');
    var pending = Object.keys(cloud.pendingTables).some(function (k) { return cloud.pendingTables[k]; });
    if (pending) return setStatus('pending');
    if (cloud.linked && !cloud.fromCache) return setStatus('live');
  }

  function syncState() {
    return { enabled: cloud.enabled, linked: cloud.linked, status: cloud.status, error: cloud.error };
  }

  /* ---------------------------------------------------------------
     Device identity — a local id and a display name, so the update
     log can show WHO wrote each note. Not a password.
     --------------------------------------------------------------- */
  function ensureSession() {
    return global.Store.getMeta('deviceUser').then(function (u) {
      if (u && u.id) return { user: u };
      var user = { id: uuid(), full_name: '' };
      return global.Store.setMeta('deviceUser', user).then(function () {
        return global.Store.put('profiles', { id: user.id, full_name: '', role: 'admin' });
      }).then(function () { return { user: user }; });
    });
  }

  function session() { return ensureSession(); }

  function currentUserId() {
    return global.Store.getMeta('deviceUser').then(function (u) { return u ? u.id : null; });
  }

  function setDisplayName(name) {
    return global.Store.getMeta('deviceUser').then(function (u) {
      u = u || { id: uuid() };
      u.full_name = name;
      var prof = { id: u.id, full_name: name, role: 'admin', updated_at: new Date().toISOString() };
      return global.Store.setMeta('deviceUser', u).then(function () {
        return global.Store.put('profiles', prof);
      }).then(function () { cloudSet('profiles', prof); emit('data:changed'); return u; });
    });
  }

  /* Clears this device's copy. With sync on, the shared data downloads
     again on next open; nothing is removed from the shared database. */
  function resetDevice() { return global.Store.wipeAll(); }

  /* ---------------------------------------------------------------
     Writes — to the device copy, then to the cloud when sync is on.
     --------------------------------------------------------------- */
  function insert(table, record) {
    var isTeam = table === 'activity_team';
    if (!isTeam) record.id = record.id || uuid();
    var stored = JSON.parse(JSON.stringify(record));
    if (isTeam) { stored.key = record.activity_id + '|' + record.user_id; delete stored.id; }
    stored.updated_at = stored.updated_at || new Date().toISOString();
    return global.Store.put(table, stored).then(function () {
      cloudSet(table, stored);
      emit('data:changed');
      return stored;
    });
  }

  function update(table, id, patch) {
    return global.Store.get(table, id).then(function (existing) {
      var merged = Object.assign({}, existing || { id: id }, patch);
      merged.updated_at = new Date().toISOString();
      return global.Store.put(table, merged).then(function () {
        cloudSet(table, merged);
        emit('data:changed');
        return merged;
      });
    });
  }

  function remove(table, id) {
    return global.Store.del(table, id).then(function () { cloudDel(table, id); emit('data:changed'); });
  }

  function removeTeamMember(activityId, userId) {
    var key = activityId + '|' + userId;
    return global.Store.del('activity_team', key)
      .then(function () { cloudDel('activity_team', key); emit('data:changed'); });
  }

  /* Photos and documents: kept on the device, and shared when sync is on. */
  function addAttachment(activityId, file, type, userId) {
    var id = uuid();
    var ext = (file.name || 'photo.jpg').split('.').pop().toLowerCase();
    var row = {
      id: id,
      activity_id: activityId,
      file_name: file.name || 'photo.' + ext,
      type: type || 'Site Photo',
      uploaded_by: userId || null,
      uploaded_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      blob_id: id,
      in_cloud: false
    };
    return global.Store.put('blobs', { id: id, blob: file, contentType: file.type })
      .then(function () {
        if (!cloud.linked) return false;
        return putFile(id, file, row.file_name).catch(function (e) {
          console.warn('File kept on this device only', e);
          return false;
        });
      })
      .then(function (shared) {
        row.in_cloud = !!shared;
        return global.Store.put('attachments', row);
      })
      .then(function () {
        cloudSet('attachments', row);
        emit('data:changed');
        return row;
      });
  }

  /* Returns a temporary object URL for a stored file, or null. Files from
     other devices are fetched from the shared database once, then kept. */
  function fileUrl(attachment) {
    if (!attachment || !attachment.blob_id) return Promise.resolve(null);
    return global.Store.get('blobs', attachment.blob_id).then(function (rec) {
      if (rec && rec.blob) return URL.createObjectURL(rec.blob);
      if (!cloud.linked) return null;
      return cloud.db.collection('files').doc(attachment.blob_id).get().then(function (doc) {
        if (!doc.exists) return null;
        var d = doc.data();
        var blob = base64ToBlob(d.data, d.contentType);
        return global.Store.put('blobs', { id: attachment.blob_id, blob: blob, contentType: d.contentType })
          .then(function () { return URL.createObjectURL(blob); });
      }).catch(function () { return null; });
    });
  }

  function pull() { return Promise.resolve(true); }
  function push() { return Promise.resolve(0); }
  function syncNow() { return cloud.enabled ? startLink() || Promise.resolve(true) : Promise.resolve(true); }
  function subscribeRealtime() {}
  function unsubscribeRealtime() {}

  /* ---------------------------------------------------------------
     Backup — a safety copy, and how data moves when sync is off.
     --------------------------------------------------------------- */
  function exportAll() {
    return Promise.all(TABLES.map(function (t) { return global.Store.getAll(t); }))
      .then(function (res) {
        var dump = { app: 'glazing-tracker', version: 1, exported_at: new Date().toISOString(), data: {} };
        TABLES.forEach(function (t, i) { dump.data[t] = res[i]; });
        // Attachment files (blobs) are intentionally NOT included — a JSON
        // backup would balloon.
        return dump;
      });
  }

  /* With sync on, imports always MERGE (newer copy wins), so one person's
     import can never wipe everyone else's work. */
  function importAll(dump, mode) {
    if (!dump || dump.app !== 'glazing-tracker' || !dump.data) {
      return Promise.reject(new Error('That is not a Glazing Tracker backup file.'));
    }
    if (cloud.linked) mode = 'merge';
    var steps = Promise.resolve();
    var cloudWrites = [];
    if (mode === 'replace') {
      TABLES.forEach(function (t) { steps = steps.then(function () { return global.Store.clear(t); }); });
    }
    TABLES.forEach(function (t) {
      var rows = dump.data[t] || [];
      steps = steps.then(function () {
        if (!rows.length) return null;
        if (mode === 'replace' || !cloud.linked) return global.Store.putMany(t, rows);
        return global.Store.getAll(t).then(function (existing) {
          var have = {};
          existing.forEach(function (r) { have[r[keyOf(t)]] = r; });
          var newer = rows.filter(function (r) {
            var mine = have[r[keyOf(t)]];
            return !mine || stamp(r) > stamp(mine);
          });
          newer.forEach(function (r) { cloudWrites.push({ table: t, id: String(r[keyOf(t)]), row: clean(r) }); });
          return newer.length ? global.Store.putMany(t, newer) : null;
        });
      });
    });
    return steps.then(function () {
      if (cloud.linked && cloudWrites.length) return commitBatches(cloudWrites);
    }).then(function () { emit('data:changed'); });
  }

  global.Sync = {
    uuid: uuid,
    on: on,
    emit: emit,
    configured: configured,
    online: online,
    session: session,
    ensureSession: ensureSession,
    currentUserId: currentUserId,
    setDisplayName: setDisplayName,
    resetDevice: resetDevice,
    insert: insert,
    update: update,
    remove: remove,
    removeTeamMember: removeTeamMember,
    addAttachment: addAttachment,
    fileUrl: fileUrl,
    pull: pull,
    push: push,
    syncNow: syncNow,
    subscribeRealtime: subscribeRealtime,
    unsubscribeRealtime: unsubscribeRealtime,
    exportAll: exportAll,
    importAll: importAll,
    initCloud: initCloud,
    syncState: syncState
  };
})(window);
