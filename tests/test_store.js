/* Exercises the local data layer against a real IndexedDB
   (fake-indexeddb). No network anywhere. */
const fs = require('fs');
const vm = require('vm');
require('fake-indexeddb/auto');

const sandbox = {
  console, indexedDB, IDBKeyRange, setTimeout, clearTimeout,
  navigator: { onLine: true },
  crypto: { randomUUID: () => 'id-' + Math.random().toString(16).slice(2) },
  document: { addEventListener(){}, getElementById: () => null },
  URL: { createObjectURL: () => 'blob:local', revokeObjectURL(){} },
  addEventListener(){}, location: { hash: '#/' },
};
sandbox.window = sandbox; sandbox.self = sandbox;
vm.createContext(sandbox);
for (const f of ['js/config.js', 'js/store.js', 'js/data.js']) {
  vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f });
}
const { Store, Sync } = sandbox;

let fail = 0;
const check = (n, c, e) => c ? console.log('  PASS  ' + n) : (fail++, console.error('  FAIL  ' + n + (e ? ' — ' + e : '')));

(async () => {
  console.log('\nDevice identity');
  const s1 = await Sync.ensureSession();
  check('session has a stable id', !!s1.user.id);
  const s2 = await Sync.ensureSession();
  check('same id on next open', s2.user.id === s1.user.id, s2.user.id + ' vs ' + s1.user.id);
  await Sync.setDisplayName('Ramesh Kumar');
  const prof = await Store.get('profiles', s1.user.id);
  check('display name saved to profile', prof && prof.full_name === 'Ramesh Kumar');

  console.log('\nLocal writes');
  const site = await Sync.insert('sites', { name: 'Villa 16, Cluster 38', main_contractor: 'GTS' });
  const act = await Sync.insert('activities', {
    site_id: site.id, category: 'Shower Partition',
    scope_description: '5x bathroom partitions', status: 'LPO Pending'
  });
  check('insert returns an id', !!act.id);
  const readBack = await Store.get('activities', act.id);
  check('readable immediately', readBack && readBack.scope_description === '5x bathroom partitions');

  await Sync.update('activities', act.id, { status: 'In Progress' });
  check('update applied', (await Store.get('activities', act.id)).status === 'In Progress');

  console.log('\nUpdate log');
  await Sync.insert('activity_updates', { activity_id: act.id, update_text: 'Frame measured' });
  await Sync.insert('activity_updates', { activity_id: act.id, update_text: 'Glass ordered' });
  check('both notes kept', (await Store.getAll('activity_updates')).length === 2);

  console.log('\nTeam (composite key, no id column)');
  await Sync.insert('activity_team', { activity_id: act.id, user_id: 'u1', role_on_job: 'Installer' });
  const team = await Store.getAll('activity_team');
  check('stored under composite key', team.length === 1 && team[0].key === act.id + '|u1');
  check('no id field on team row', team[0].id === undefined);
  await Sync.removeTeamMember(act.id, 'u1');
  check('removal works', (await Store.getAll('activity_team')).length === 0);

  console.log('\nAttachments stay local');
  const fakeFile = { name: 'snag.jpg', type: 'image/jpeg' };
  const at = await Sync.addAttachment(act.id, fakeFile, 'Snag', s1.user.id);
  check('attachment row created', !!at.id && at.blob_id === at.id);
  check('blob stored on device', !!(await Store.get('blobs', at.blob_id)));
  const url = await Sync.fileUrl(at);
  check('fileUrl resolves a local url', url === 'blob:local');

  console.log('\nExport / import round trip');
  const dump = await Sync.exportAll();
  check('export names the app', dump.app === 'glazing-tracker');
  check('export carries the site', dump.data.sites.some(s => s.id === site.id));
  check('export excludes photo blobs', !dump.data.attachments || dump.data.attachments.every(a => !a.blob));

  await Store.wipeAll();
  check('wiped', (await Store.getAll('sites')).length === 0);

  await Sync.importAll(dump, 'replace');
  check('import restores sites', (await Store.getAll('sites')).some(s => s.id === site.id));
  check('import restores activities', (await Store.getAll('activities')).some(a => a.id === act.id));

  console.log('\nImport rejects a foreign file');
  let rejected = false;
  await Sync.importAll({ app: 'something-else', data: {} }, 'replace').catch(() => { rejected = true; });
  check('foreign backup refused', rejected);

  console.log('\nMerge keeps existing rows');
  await Sync.insert('sites', { id: 'keep-me', name: 'Manually added' });
  await Sync.importAll(dump, 'merge');
  check('merged import keeps the manual row', !!(await Store.get('sites', 'keep-me')));

  console.log('\nReset clears everything');
  await Sync.resetDevice();
  check('reset empties sites', (await Store.getAll('sites')).length === 0);
  check('reset empties profiles', (await Store.getAll('profiles')).length === 0);

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'All local data tests passed'));
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('crashed:', e); process.exit(1); });
