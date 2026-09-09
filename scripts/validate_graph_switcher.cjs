// Exercises the actual plugin entry point in Chrome with a simulated native chooser.
// Delegated events check native node identity, but this is NOT React or Logseq Desktop.
// Run from the plugin repository: npm run test:browser -- /usr/bin/google-chrome
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { execFileSync } = require("node:child_process");
const chrome = process.argv[2];
assert.ok(chrome, "Pass Chrome/Chromium's executable path");
const dir = path.resolve(__dirname, "../src");
const code = ["switcher.js", "native-picker.js", "index.js"].map((file) =>
  fs.readFileSync(path.join(dir, file), "utf8").replace(/^import .*;\n/gm, "").replace(/^export /gm, "")
).join("\n");
const temp = fs.mkdtempSync(path.join(os.tmpdir(), "logseq-graph-switcher-"));
const html = `<!doctype html><meta charset="utf-8">
<style>:root { --ls-border-color: #ccc; --ls-link-text-color: teal; --ls-tertiary-background-color: #ddd; }
.cp__select { width: 480px; padding: 1rem; } .menu-link { display:block; padding:4px; } .tip { display:block; }</style>
<input id="editor"><pre id="result"></pre>
<script>
let current = 'A';
let graphs = ['A', 'B', 'C'];
let state = null;
let changed = () => {};
let unload;
let chooserType = 'graphOpen';
let rejectNext = false;
let scenario = 'startup';
const selected = [], attempts = [], notices = [], dialogs = [], browserErrors = [];
window.addEventListener('error', event => browserErrors.push(event.error?.stack || event.message));
window.addEventListener('unhandledrejection', event => browserErrors.push(String(event.reason?.stack || event.reason)));
function closeNative() {
  document.querySelector('.cp__select')?.remove();
  state = null;
}
document.addEventListener('keydown', event => { if (event.key === 'Escape') closeNative(); });
window.logseq = {
  Experiments: { ensureHostScope: () => window },
  UI: { showMsg: message => notices.push(message) },
  App: {
    getCurrentGraph: async () => ({ name: current, path: '/graphs/' + current }),
    getStateFromStore: async () => state,
    onCurrentGraphChanged: callback => { changed = callback; return () => { changed = () => {}; }; },
    invokeExternalCommand: async command => {
      if (command !== 'logseq.graph/open') throw new Error('Wrong native command');
      setTimeout(() => {
        state = chooserType;
        const root = document.createElement('div');
        root.className = 'cp__select cp__select-main';
        root.innerHTML = '<div class="input-wrap"><input class="cp__select-input"></div><div class="cp__select-results"></div>';
        const results = root.querySelector('.cp__select-results');
        const identities = new Map();
        // Deliberately include the current graph: exclusion belongs to the plugin.
        for (const name of graphs) {
          const row = document.createElement('a');
          row.className = 'menu-link';
          row.innerHTML = '<span><div><span>' + name + '</span><div class="tip"><code>/graphs/' + name + '</code></div></div></span>';
          identities.set(row, name);
          results.append(row);
        }
        const record = {
          root, results, rows: [...results.children], identities,
          nativeChildren: [...root.children],
          nativeChildrenHTML: [...root.children].map(node => node.outerHTML),
          nativeNodes: new Set(root.querySelectorAll('*')),
          originalHTML: [...results.children].map(row => row.outerHTML),
          mutations: [],
        };
        record.observer = new MutationObserver(records => record.mutations.push(...records));
        record.observer.observe(root, { childList: true, subtree: true });
        dialogs.push(record);
        // Model a delegated native/React-root listener, not listeners copied onto clones.
        root.addEventListener('mousedown', event => {
          const row = event.target.closest?.('.menu-link');
          if (!row) return;
          check(identities.has(row), 'native delegate received a clone instead of an ORIGINAL row');
          check(event.target === row, 'forwarded mousedown target is not the original row itself');
          check(event.bubbles && event.cancelable && event.button === 0 && event.buttons === 1,
            'forwarded mousedown is not a bubbling, cancelable primary-button event');
          check(!event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey,
            'modifiers leaked into native selection');
          assertNative(record, true);
          const name = identities.get(row);
          const rejected = rejectNext;
          rejectNext = false;
          attempts.push({ name, rejected });
          if (rejected) return; // Native save/persist checks may refuse a switch without a changed hook.
          selected.push(name);
          current = name;
          closeNative();
          changed();
        });
        document.body.append(root);
        root.querySelector('input').focus();
      }, 25);
    },
  },
  beforeunload: callback => { unload = callback; },
  ready: callback => Promise.resolve().then(callback),
};
${code}
</script><script>
const check = (ok, message) => { if (!ok) throw new Error(scenario + ': ' + message); };
const same = (actual, expected, message) => check(JSON.stringify(actual) === JSON.stringify(expected),
  message + ' — expected ' + JSON.stringify(expected) + ', got ' + JSON.stringify(actual));
const wait = async (ms = 80) => {
  await new Promise(resolve => setTimeout(resolve, ms));
  check(browserErrors.length === 0, 'browser error: ' + browserErrors.join('; '));
};
const down = (key, extra = {}) => window.dispatchEvent(new KeyboardEvent('keydown', {
  key, ctrlKey: true, bubbles: true, cancelable: true, ...extra,
}));
const up = () => window.dispatchEvent(new KeyboardEvent('keyup', {
  key: 'Control', ctrlKey: false, bubbles: true, cancelable: true,
}));
const graphName = row => row.querySelector('.tip code')?.textContent.replace('/graphs/', '');
function displayed(node) {
  const rect = node.getBoundingClientRect();
  if (!node.isConnected || rect.width <= 0 || rect.height <= 0) return false;
  for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
    const style = getComputedStyle(ancestor);
    if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
  }
  return true;
}
function visualRows(root) {
  return [...root.querySelectorAll('.menu-link')].filter(displayed).sort((a, b) => {
    const ar = a.getBoundingClientRect(), br = b.getBoundingClientRect();
    return ar.top - br.top || ar.left - br.left;
  });
}
function assertNative(record, connected = record.root.isConnected) {
  const { root, results, rows, nativeChildren } = record;
  check(root.isConnected === connected, 'unexpected native root connectivity');
  check(results.parentNode === root, 'native results moved to another parent');
  check(results.children.length === rows.length, 'native results child count changed');
  rows.forEach((row, index) => {
    check(row.parentNode === results && results.children[index] === row, 'native row identity/parent/order changed');
    check(row.isConnected === connected, 'native row disconnected while chooser is connected');
    check(row.outerHTML === record.originalHTML[index], 'native row content/attributes changed');
  });
  nativeChildren.forEach((node, index) => {
    check(node.outerHTML === record.nativeChildrenHTML[index],
      'native subtree changed: hiding must use CSS, not inline styles/hidden attributes or DOM edits');
  });
  const remaining = [...root.children].filter(node => nativeChildren.includes(node));
  check(remaining.length === nativeChildren.length && remaining.every((node, index) => node === nativeChildren[index]),
    'native root children changed order');
  record.mutations.push(...record.observer.takeRecords());
  for (const mutation of record.mutations) {
    check(!record.nativeNodes.has(mutation.target), 'native subtree was mutated (even if later restored)');
    check(![...mutation.removedNodes].some(node => record.nativeNodes.has(node)),
      'native node was temporarily removed/reparented');
  }
}
function assertClean(record) {
  assertNative(record);
  const { root } = record;
  check(!root.querySelector('.hold-graph-switcher-results, .hold-graph-switcher-hint'), 'presentation/hint survived cleanup');
  for (const node of [root, ...root.querySelectorAll('*')]) {
    check(![...node.attributes].some(attribute => attribute.name.startsWith('data-hold-')), 'plugin attribute survived cleanup');
  }
  if (root.isConnected) {
    check(displayed(root.querySelector('.input-wrap')), 'native input visibility not restored');
    same(visualRows(root).map(graphName), record.rows.map(graphName), 'native visibility/order not restored');
  }
}
function assertPresentation(record, expected, index = 0) {
  assertNative(record, true);
  const { root, rows } = record;
  check(root.dataset.holdGraphSwitcher === 'true', 'active marker missing');
  check(getComputedStyle(root.querySelector('.input-wrap')).display === 'none', 'switcher input styling missing');
  check(root.querySelectorAll('.hold-graph-switcher-results').length === 1, 'expected one presentation list');
  check(root.querySelectorAll('.hold-graph-switcher-hint').length === 1, 'expected one hint');
  const presentation = root.querySelector('.hold-graph-switcher-results');
  check(!record.results.contains(presentation), 'presentation must be outside the hidden native results');
  check(rows.every(row => !displayed(row)), 'original rows are still visually displayed');
  const clones = [...presentation.querySelectorAll('.menu-link')];
  same(clones.map(graphName).sort(), [...expected].sort(), 'presentation membership/current exclusion');
  for (const clone of clones) {
    const original = rows.find(row => graphName(row) === graphName(clone));
    check(original && clone !== original && clone.innerHTML === original.innerHTML, 'presentation is not a clone of native content');
  }
  const visible = visualRows(root);
  same(visible.map(graphName), expected, 'visually displayed MRU order (bounding rectangles)');
  visible.forEach((row, i) => {
    check(presentation.contains(row), 'a displayed row is not presentation-owned');
    if (i) check(row.getBoundingClientRect().top >= visible[i - 1].getBoundingClientRect().bottom - 0.5,
      'visual rows overlap or are not ordered vertically');
  });
  const marked = [...root.querySelectorAll('[data-hold-selected="true"]')];
  check(marked.length === 1 && marked[0] === visible[index], 'keyboard highlight does not match visual MRU index ' + index);
}
async function open(expected, reverse = false) {
  const count = dialogs.length;
  down('Tab', { shiftKey: reverse });
  await wait();
  check(dialogs.length === count + 1, 'opening did not create exactly one native chooser');
  const record = dialogs[dialogs.length - 1];
  assertPresentation(record, expected, reverse ? expected.length - 1 : 0);
  return record;
}
async function cancel(record, blur = false) {
  const count = attempts.length;
  if (blur) window.dispatchEvent(new Event('blur'));
  else down('Escape');
  up();
  await wait();
  check(attempts.length === count && !document.querySelector('.cp__select'), 'cancel switched or left a chooser open');
  assertClean(record);
}
async function release(record, name) {
  const count = attempts.length, successes = selected.length;
  up();
  await wait();
  check(attempts.length === count + 1 && selected.length === successes + 1 && current === name,
    'modifier release did not commit exactly once to ' + name);
  check(attempts[attempts.length - 1].name === name, 'wrong original row received keyboard dispatch');
  assertClean(record);
}
async function external(name) {
  const count = attempts.length;
  current = name;
  changed();
  await wait(0);
  check(attempts.length === count, 'external graph change triggered a native selection');
}
async function quick(name, reverse = false) {
  const count = attempts.length, successes = selected.length, opened = dialogs.length;
  down('Tab', { shiftKey: reverse });
  up();
  await wait();
  check(dialogs.length === opened + 1 && attempts.length === count + 1 && selected.length === successes + 1 && current === name,
    'quick release did not choose exactly once: ' + name);
  check(!document.querySelector('.cp__select'), 'quick release left the chooser open');
  assertClean(dialogs[dialogs.length - 1]);
}
(async () => {
  await wait();
  document.querySelector('#editor').focus();
  scenario = 'initial forward cycle and release';
  let record = await open(['B', 'C']);
  down('Tab');
  assertPresentation(record, ['B', 'C'], 1);
  window.dispatchEvent(new KeyboardEvent('keyup', { key: 'Tab', ctrlKey: true }));
  check(attempts.length === 0, 'switched before modifier release');
  await release(record, 'C');

  scenario = 'startup history and graph-change hook';
  graphs = ['B', 'C', 'A'];
  record = await open(['A', 'B']);
  await release(record, 'A');

  scenario = 'external history, known MRU vs native order, stable unknown order';
  graphs = ['U2', 'B', 'A', 'U1', 'D', 'C', 'E'];
  for (const name of ['C', 'B', 'D', 'A']) await external(name);
  const order = ['D', 'B', 'C', 'U2', 'U1', 'E'];
  record = await open(order);
  for (let index = 1; index <= order.length; index++) {
    down('Tab');
    assertPresentation(record, order, index % order.length);
  }
  down('Tab', { shiftKey: true });
  assertPresentation(record, order, order.length - 1);
  down('Tab', { repeat: true });
  assertPresentation(record, order, order.length - 1);
  for (let step = 1; step <= order.length; step++) {
    down('Tab', { shiftKey: true });
    assertPresentation(record, order, (order.length - 1 - step + order.length) % order.length);
  }
  await cancel(record);

  scenario = 'reverse initial selection, cancellation does not update history';
  record = await open(order, true);
  await cancel(record);
  record = await open(order);
  down('Tab');
  assertPresentation(record, order, 1);
  await cancel(record, true);
  record = await open(order);
  await cancel(record);

  scenario = 'rejected native switch does not change history; cleanup restores native UI';
  record = await open(order);
  down('Tab'); down('Tab');
  assertPresentation(record, order, 2);
  rejectNext = true;
  let count = attempts.length, successes = selected.length;
  up(); await wait();
  check(attempts.length === count + 1 && attempts[attempts.length - 1].name === 'C' && attempts[attempts.length - 1].rejected,
    'native rejection was not exercised');
  check(current === 'A' && selected.length === successes, 'rejection changed current graph');
  assertClean(record); // The rejected chooser stays connected, making restored CSS observable.
  check(record.root.isConnected, 'rejected native chooser was unexpectedly closed');
  closeNative();
  record = await open(order);
  await cancel(record);

  scenario = 'quick MRU release and repeated two-graph toggling';
  await quick('D');
  await quick('A');
  await quick('D');
  await quick('A');
  record = await open(order);
  await cancel(record);

  scenario = 'quick reverse release selects the last presentation row';
  await quick('E', true);
  record = await open(['A', 'D', 'B', 'C', 'U2', 'U1']);
  await release(record, 'A');
  const afterE = ['E', 'D', 'B', 'C', 'U2', 'U1'];

  scenario = 'cancel before asynchronous chooser mount';
  count = attempts.length;
  const opened = dialogs.length;
  down('Tab'); down('Escape'); up(); await wait();
  check(dialogs.length === opened + 1 && !document.querySelector('.cp__select') && attempts.length === count,
    'late modal survived cancellation or committed');
  assertClean(dialogs[dialogs.length - 1]);
  record = await open(afterE);
  await cancel(record);

  scenario = 'presentation pointer forwards sanitized mousedown to original, once';
  record = await open(afterE);
  const pointerRow = visualRows(record.root)[3]; // C is not the keyboard-highlighted E.
  count = attempts.length; successes = selected.length;
  pointerRow.querySelector('.tip code').dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true, cancelable: true, button: 0, buttons: 1,
    ctrlKey: true, shiftKey: true, altKey: true, metaKey: true,
  }));
  up(); await wait();
  check(attempts.length === count + 1 && selected.length === successes + 1 && current === 'C', 'pointer selected wrong row or double-committed');
  assertClean(record);
  record = await open(['A', 'E', 'D', 'B', 'U2', 'U1']);
  await release(record, 'A');

  scenario = 'external graph change cancels active presentation and restores native handlers';
  record = await open(['C', 'E', 'D', 'B', 'U2', 'U1']);
  down('Tab');
  await external('B'); // No native close: inspect cleanup on the still-connected chooser.
  up(); await wait();
  assertClean(record);
  check(record.root.isConnected, 'external change closed the native chooser rather than only cleaning up');
  count = attempts.length;
  const originalD = record.rows.find(row => graphName(row) === 'D');
  originalD.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, buttons: 1 }));
  await wait();
  check(attempts.length === count + 1 && current === 'D', 'original delegated native handler was not preserved');
  assertClean(record);
  record = await open(['B', 'A', 'C', 'E', 'U2', 'U1']);
  await cancel(record);

  scenario = 'full in-memory history survives more than twenty graphs';
  for (let i = 0; i < 25; i++) await external('H' + i);
  // D/B/A/C/E are now older than twenty visits. Unknown Z2/Z1 must remain after them.
  graphs = ['Z2', 'H0', 'E', 'C', 'H24', 'A', 'H23', 'Z1', 'B', 'D'];
  const longOrder = ['H23', 'H0', 'D', 'B', 'A', 'C', 'E', 'Z2', 'Z1'];
  record = await open(longOrder);
  for (let index = 1; index < longOrder.length; index++) {
    down('Tab');
    assertPresentation(record, longOrder, index);
  }
  await cancel(record);
  record = await open(longOrder);
  await cancel(record);

  scenario = 'only current graph and genuinely empty chooser';
  count = attempts.length;
  for (const names of [[current], []]) {
    graphs = names;
    const noticeCount = notices.length;
    down('Tab'); up(); await wait();
    check(attempts.length === count && notices.slice(noticeCount).some(message => message.includes('No other')),
      'empty chooser switched or did not notify');
    check(!document.querySelector('.cp__select'), 'empty chooser was not closed');
    assertClean(dialogs[dialogs.length - 1]);
  }

  scenario = 'wrong native dialog is not taken over';
  graphs = ['A', 'B']; chooserType = 'graphRemove';
  down('Tab'); up(); await wait();
  record = dialogs[dialogs.length - 1];
  check(attempts.length === count && record.root.isConnected, 'wrong modal switched or was closed');
  assertClean(record);
  closeNative(); chooserType = 'graphOpen';

  scenario = 'per-open adapter snapshot remains fixed when history changes';
  // The entrypoint deliberately cancels on changed(). Exercise the actual adapter
  // separately to test snapshot immutability without that lifecycle cancellation.
  const adapter = createNativePicker(window, logseq);
  current = 'A'; await adapter.rememberCurrent();
  current = 'C'; await adapter.rememberCurrent();
  current = 'B'; await adapter.rememberCurrent();
  current = 'D'; await adapter.rememberCurrent();
  graphs = ['B', 'D', 'U2', 'A', 'U1', 'C'];
  const picker = await adapter.open();
  record = dialogs[dialogs.length - 1];
  picker.render(0);
  const snapshot = ['B', 'C', 'A', 'U2', 'U1'];
  assertPresentation(record, snapshot);
  current = 'A'; await adapter.rememberCurrent();
  for (let index = 0; index < snapshot.length; index++) {
    picker.render(index);
    assertPresentation(record, snapshot, index);
  }
  rejectNext = true;
  count = attempts.length;
  picker.choose(1); // Snapshot index 1 is C; re-sorting against the new history would choose B.
  await wait();
  check(attempts.length === count + 1 && attempts[attempts.length - 1].name === 'C' && attempts[attempts.length - 1].rejected,
    'commit mapping changed after the per-open snapshot was captured');
  picker.cleanup(); picker.cleanup();
  assertClean(record);
  closeNative();
  const nextPicker = await adapter.open();
  record = dialogs[dialogs.length - 1];
  nextPicker.render(0);
  assertPresentation(record, ['D', 'B', 'C', 'U2', 'U1']);
  nextPicker.close();
  assertClean(record);

  scenario = 'unload cleans an active chooser and removes listeners';
  await external('A');
  record = await open(['D', 'B', 'C', 'U2', 'U1']);
  count = attempts.length;
  await unload();
  assertClean(record);
  check(!document.querySelector('.cp__select'), 'active chooser survived unload');
  const dialogCount = dialogs.length;
  down('Tab'); up(); await wait();
  check(dialogs.length === dialogCount && attempts.length === count && !document.querySelector('.cp__select'), 'listeners remained after unload');
  for (const dialog of dialogs) {
    assertClean(dialog);
    dialog.observer.disconnect();
  }
  check(notices.length === 3, 'unexpected plugin warning: ' + notices.join('; '));
  document.querySelector('#result').textContent = encodeURIComponent(JSON.stringify({
    passed: true, selections: selected, nativeDispatches: attempts.length, dialogs: dialogs.length,
  }));
})().catch(error => {
  document.querySelector('#result').textContent = encodeURIComponent(JSON.stringify({ error: error.stack || error.message }));
});
</script>`;
try {
  const file = path.join(temp, "switcher.html");
  fs.writeFileSync(file, html);
  const output = execFileSync(chrome, [
    "--headless", "--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage",
    "--window-size=1200,2400",
    `--user-data-dir=${path.join(temp, "profile")}`, "--no-first-run",
    "--virtual-time-budget=15000", "--dump-dom", pathToFileURL(file).href,
  ], { encoding: "utf8", timeout: 30000, stdio: ["ignore", "pipe", "pipe"] });
  const match = output.match(/<pre id="result">([^<]+)<\/pre>/);
  assert.ok(match, "Browser did not return results (fixture did not finish within the virtual-time budget)");
  const result = JSON.parse(decodeURIComponent(match[1]));
  assert.equal(result.error, undefined, result.error);
  assert.equal(result.passed, true);
  console.log(`PASS: simulated native-chooser Chrome fixture (${result.dialogs} dialogs, ${result.nativeDispatches} native dispatches): visual/keyboard MRU, current exclusion, unknown order, external changes, full history, snapshots, cycling/reverse/wrap, cancellation, rejection, quick toggling/release, pointer identity/sanitization, native DOM/handler restoration, empty/wrong modal, unload. Not a React/Desktop integration test.`);
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
