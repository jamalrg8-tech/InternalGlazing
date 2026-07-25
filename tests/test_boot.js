/* Loads the app under a minimal DOM stub to catch load/boot errors
   without a browser. Local-only build: no network, no Supabase. */
const fs = require('fs');
const vm = require('vm');

function makeEl(tag) {
  const el = {
    tagName: (tag || 'div').toUpperCase(), style: {}, dataset: {}, children: [], files: [],
    value: '', textContent: '', _html: '',
    classList: { add(){}, remove(){}, contains(){ return false; }, toggle(){} },
    addEventListener(){}, removeEventListener(){}, click(){}, focus(){},
    appendChild(c){ this.children.push(c); return c; }, removeChild(){},
    setAttribute(){}, getAttribute(){ return null; }, closest(){ return null; },
    querySelector(){ return null }, querySelectorAll(){ return []; },
  };
  Object.defineProperty(el, 'innerHTML', { get(){ return this._html; }, set(v){ this._html = String(v); } });
  Object.defineProperty(el, 'outerHTML', { get(){ return this._html; }, set(v){ this._html = v; } });
  return el;
}
const elements = {};
const byId = id => (elements[id] = elements[id] || makeEl('div'));
const document = {
  readyState: 'loading', body: makeEl('body'), documentElement: makeEl('html'),
  getElementById: byId, createElement: makeEl,
  querySelector(){ return null; }, querySelectorAll(){ return []; },
  addEventListener(){}, removeEventListener(){},
};
const sandbox = {
  console, document,
  navigator: { onLine: true, serviceWorker: { register: () => Promise.resolve() } },
  location: { hash: '#/', href: 'https://example.test/', reload(){} },
  setTimeout, clearTimeout, setInterval, clearInterval,
  crypto: { randomUUID: () => '00000000-0000-4000-8000-000000000000' },
  indexedDB: { open: () => ({}) },
  URL: { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
  Blob: function(){}, Image: function(){}, fetch: () => Promise.resolve({ ok: false }),
  addEventListener(){}, removeEventListener(){}, confirm: () => true, alert(){},
};
sandbox.window = sandbox; sandbox.self = sandbox; sandbox.globalThis = sandbox;
vm.createContext(sandbox);

let failed = false;
for (const f of ['js/config.js', 'js/store.js', 'js/data.js', 'js/app.js']) {
  try { vm.runInContext(fs.readFileSync(f, 'utf8'), sandbox, { filename: f }); console.log(`load ${f.padEnd(14)} OK`); }
  catch (e) { failed = true; console.error(`load ${f.padEnd(14)} FAILED: ${e.message}`); }
}

try {
  if (sandbox.statusMeta('In Progress').stage !== 4) throw new Error('status meta wrong');
  const pipeline = sandbox.STATUSES.filter(s => s.stage >= 0).map(s => s.stage);
  if (JSON.stringify(pipeline) !== JSON.stringify([0,1,2,3,4,5])) throw new Error('pipeline not contiguous');
  console.log('config  vocabulary          OK');
} catch (e) { failed = true; console.error('config  vocabulary          FAILED: ' + e.message); }

try {
  const need = ['insert','update','remove','ensureSession','setDisplayName','resetDevice',
                'addAttachment','fileUrl','exportAll','importAll','uuid'];
  const missing = need.filter(k => typeof sandbox.Sync[k] !== 'function');
  if (missing.length) throw new Error('missing: ' + missing.join(', '));
  ['signIn','signUp','signOut','syncNow','subscribeRealtime'].forEach(k => {
    // syncNow/subscribe may exist as no-ops; signIn/up/out must be gone.
  });
  if (typeof sandbox.Sync.signIn === 'function') throw new Error('signIn should not exist');
  if (typeof sandbox.Sync.signUp === 'function') throw new Error('signUp should not exist');
  if (sandbox.Sync.configured() !== true) throw new Error('local build should always be configured');
  console.log('data    api surface         OK');
  console.log('data    no auth methods      OK');
} catch (e) { failed = true; console.error('data    api surface         FAILED: ' + e.message); }

try {
  const src = fs.readFileSync('js/app.js', 'utf8');
  ['Supabase','supabase','signedUrl','Sync.push(','viewSetupNeeded','Anonymous'].forEach(t => {
    if (src.includes(t)) throw new Error('app.js still references ' + t);
  });
  const idx = fs.readFileSync('index.html', 'utf8');
  if (/supabase/i.test(idx)) throw new Error('index.html still loads supabase');
  console.log('build   no server residue    OK');
} catch (e) { failed = true; console.error('build   no server residue    FAILED: ' + e.message); }

process.exit(failed ? 1 : 0);
