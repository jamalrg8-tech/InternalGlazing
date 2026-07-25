/* =====================================================================
   data.js — the local data layer.

   This app has no server. Everything is stored on THIS device, in the
   browser's IndexedDB (via store.js). There is no network, no login and
   no account. The `Sync` name is kept only so the views don't need to
   change — every call here reads and writes locally and resolves at once.

   Moving data between devices is manual: Export writes a backup file,
   Import reads one back. See app.js → Settings.
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

  /* Always ready — there is nothing to configure. */
  function configured() { return true; }
  function online() { return true; }

  /* ---------------------------------------------------------------
     Device identity — a local id and a display name, so the update
     log can show WHO wrote each note. Not a credential; it never
     leaves the device.
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
      return global.Store.setMeta('deviceUser', u).then(function () {
        return global.Store.put('profiles', { id: u.id, full_name: name, role: 'admin' });
      }).then(function () { emit('data:changed'); return u; });
    });
  }

  /* Clears everything on this device and starts fresh. */
  function resetDevice() { return global.Store.wipeAll(); }

  /* ---------------------------------------------------------------
     Writes — straight to local storage, no queue, no network.
     Signatures match the old Sync layer exactly.
     --------------------------------------------------------------- */
  function insert(table, record) {
    var isTeam = table === 'activity_team';
    if (!isTeam) record.id = record.id || uuid();
    var stored = JSON.parse(JSON.stringify(record));
    if (isTeam) { stored.key = record.activity_id + '|' + record.user_id; delete stored.id; }
    return global.Store.put(table, stored).then(function () { emit('data:changed'); return stored; });
  }

  function update(table, id, patch) {
    return global.Store.get(table, id).then(function (existing) {
      var merged = Object.assign({}, existing || { id: id }, patch);
      merged.updated_at = new Date().toISOString();
      return global.Store.put(table, merged).then(function () { emit('data:changed'); return merged; });
    });
  }

  function remove(table, id) {
    return global.Store.del(table, id).then(function () { emit('data:changed'); });
  }

  function removeTeamMember(activityId, userId) {
    return global.Store.del('activity_team', activityId + '|' + userId)
      .then(function () { emit('data:changed'); });
  }

  /* Photos and documents: the file itself is kept on the device. */
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
      blob_id: id
    };
    return global.Store.put('blobs', { id: id, blob: file, contentType: file.type })
      .then(function () { return global.Store.put('attachments', row); })
      .then(function () { emit('data:changed'); return row; });
  }

  /* Returns a temporary object URL for a stored file, or null. */
  function fileUrl(attachment) {
    if (!attachment || !attachment.blob_id) return Promise.resolve(null);
    return global.Store.get('blobs', attachment.blob_id).then(function (rec) {
      if (!rec || !rec.blob) return null;
      return URL.createObjectURL(rec.blob);
    });
  }

  /* No-ops kept so callers don't need to special-case a server. */
  function pull() { return Promise.resolve(true); }
  function push() { return Promise.resolve(0); }
  function syncNow() { return Promise.resolve(true); }
  function subscribeRealtime() {}
  function unsubscribeRealtime() {}

  /* ---------------------------------------------------------------
     Backup — the only way data moves between devices.
     --------------------------------------------------------------- */
  var TABLES = ['sites', 'activities', 'activity_updates', 'activity_team', 'profiles', 'attachments'];

  function exportAll() {
    return Promise.all(TABLES.map(function (t) { return global.Store.getAll(t); }))
      .then(function (res) {
        var dump = { app: 'glazing-tracker', version: 1, exported_at: new Date().toISOString(), data: {} };
        TABLES.forEach(function (t, i) { dump.data[t] = res[i]; });
        // Attachment files (blobs) are intentionally NOT included — a JSON
        // backup would balloon. Photos stay on the device that took them.
        return dump;
      });
  }

  function importAll(dump, mode) {
    if (!dump || dump.app !== 'glazing-tracker' || !dump.data) {
      return Promise.reject(new Error('That is not a Glazing Tracker backup file.'));
    }
    var steps = Promise.resolve();
    if (mode === 'replace') {
      TABLES.forEach(function (t) { steps = steps.then(function () { return global.Store.clear(t); }); });
    }
    TABLES.forEach(function (t) {
      var rows = dump.data[t] || [];
      steps = steps.then(function () { return rows.length ? global.Store.putMany(t, rows) : null; });
    });
    return steps.then(function () { emit('data:changed'); });
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
    signedUrl: function () { return Promise.resolve(null); }, // legacy no-op
    pull: pull,
    push: push,
    syncNow: syncNow,
    subscribeRealtime: subscribeRealtime,
    unsubscribeRealtime: unsubscribeRealtime,
    exportAll: exportAll,
    importAll: importAll
  };
})(window);
