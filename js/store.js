/* =====================================================================
   store.js — local device database (IndexedDB)

   Everything the app renders comes from here first, so the UI works
   identically with or without a connection. Writes made offline are
   applied locally AND appended to the `outbox`, which sync.js drains
   once the device is back online.
   ===================================================================== */

(function (global) {
  'use strict';

  var DB_NAME = 'glazing-tracker';
  var DB_VERSION = 1;

  var STORES = {
    sites:            'id',
    activities:       'id',
    activity_updates: 'id',
    activity_team:    'key',   // synthetic `${activity_id}|${user_id}`
    attachments:      'id',
    profiles:         'id',
    outbox:           'id',
    blobs:            'id',    // photos captured offline, awaiting upload
    meta:             'key'
  };

  var dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = function (e) {
        var db = e.target.result;
        Object.keys(STORES).forEach(function (name) {
          if (!db.objectStoreNames.contains(name)) {
            db.createObjectStore(name, { keyPath: STORES[name] });
          }
        });
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }

  function tx(storeName, mode, fn) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, mode);
        var store = t.objectStore(storeName);
        var out;
        try { out = fn(store); } catch (err) { reject(err); return; }
        t.oncomplete = function () { resolve(out && out.result !== undefined ? out.result : out); };
        t.onerror = function () { reject(t.error); };
        t.onabort = function () { reject(t.error); };
      });
    });
  }

  function getAll(storeName) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, 'readonly');
        var req = t.objectStore(storeName).getAll();
        req.onsuccess = function () { resolve(req.result || []); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function get(storeName, key) {
    return open().then(function (db) {
      return new Promise(function (resolve, reject) {
        var t = db.transaction(storeName, 'readonly');
        var req = t.objectStore(storeName).get(key);
        req.onsuccess = function () { resolve(req.result || null); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function put(storeName, record) {
    return tx(storeName, 'readwrite', function (s) { s.put(record); });
  }

  function putMany(storeName, records) {
    return tx(storeName, 'readwrite', function (s) {
      records.forEach(function (r) { s.put(r); });
    });
  }

  function del(storeName, key) {
    return tx(storeName, 'readwrite', function (s) { s.delete(key); });
  }

  function clear(storeName) {
    return tx(storeName, 'readwrite', function (s) { s.clear(); });
  }

  /* Replace a whole store with a fresh server snapshot.

     Rows that still have work sitting in the outbox are preserved, so
     offline edits don't vanish from the screen mid-sync. `stillQueued` is
     the set of keys with outstanding queued work — anything else, even if
     it's flagged _pending, has already reached the server and must give way
     to the server's version, otherwise it would show a false "unsynced"
     badge forever and never pick up anyone else's changes. */
  function replaceAll(storeName, records, stillQueued) {
    return getAll(storeName).then(function (existing) {
      var keyPath = STORES[storeName];
      var queued = stillQueued || {};
      var keep = existing.filter(function (r) {
        return r._pending && queued[r[keyPath]];
      });
      var keptKeys = {};
      keep.forEach(function (r) { keptKeys[r[keyPath]] = true; });
      var merged = records.filter(function (r) { return !keptKeys[r[keyPath]]; }).concat(keep);
      return clear(storeName).then(function () { return putMany(storeName, merged); });
    });
  }

  /* ---------- meta ---------- */
  function setMeta(key, value) { return put('meta', { key: key, value: value }); }
  function getMeta(key) {
    return get('meta', key).then(function (r) { return r ? r.value : null; });
  }

  /* ---------- outbox ---------- */
  function enqueue(entry) {
    entry.id = entry.id || (global.crypto && crypto.randomUUID
      ? crypto.randomUUID()
      : 'ob-' + Date.now() + '-' + Math.random().toString(16).slice(2));
    entry.created_at = entry.created_at || new Date().toISOString();
    entry.tries = entry.tries || 0;
    return put('outbox', entry).then(function () { return entry; });
  }

  function outbox() {
    return getAll('outbox').then(function (rows) {
      return rows.sort(function (a, b) {
        return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
      });
    });
  }

  function wipeAll() {
    return open().then(function (db) {
      return Promise.all(Object.keys(STORES).map(function (name) {
        return new Promise(function (resolve) {
          var t = db.transaction(name, 'readwrite');
          t.objectStore(name).clear();
          t.oncomplete = resolve;
          t.onerror = resolve;
        });
      }));
    });
  }

  global.Store = {
    open: open,
    get: get,
    getAll: getAll,
    put: put,
    putMany: putMany,
    del: del,
    clear: clear,
    replaceAll: replaceAll,
    setMeta: setMeta,
    getMeta: getMeta,
    enqueue: enqueue,
    outbox: outbox,
    wipeAll: wipeAll
  };
})(window);
