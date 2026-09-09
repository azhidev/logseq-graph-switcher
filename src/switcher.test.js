import test from "node:test";
import assert from "node:assert/strict";
import { createGraphSwitcher } from "./switcher.js";
import { orderGraphEntries } from "./native-picker.js";

const flush = () => new Promise((resolve) => setImmediate(resolve));
function key(key, options = {}) {
  return {
    key, ctrlKey: true, altKey: false, metaKey: false, shiftKey: false,
    repeat: false, isComposing: false, consumed: false,
    preventDefault() { this.consumed = true; },
    stopImmediatePropagation() {},
    ...options,
  };
}
function picker(count = 3) {
  return {
    count, rendered: [], chosen: [], closed: 0, cleaned: 0,
    render(index) { this.rendered.push(index); },
    choose(index) { this.chosen.push(index); },
    close() { this.closed++; },
    cleanup() { this.cleaned++; },
  };
}
function setup(options = {}) {
  const view = picker();
  const messages = [];
  let opens = 0;
  const switcher = createGraphSwitcher({
    open: async () => { opens++; return view; },
    notify: (message) => messages.push(message),
    ...options,
  });
  return { switcher, view, messages, opens: () => opens };
}
const release = (switcher) => switcher.keyup(key("Control", { ctrlKey: false }));
const entries = (...paths) => paths.map((path) => ({ path }));

test("MRU sorts available alternatives, excludes current, and preserves unknown native order", () => {
  const native = entries("unknown2", "B", "A", "unknown1", "D", "C");
  const history = ["A", "D", "unavailable", "B", "C"];
  assert.deepEqual(orderGraphEntries(native, history), entries("D", "B", "C", "unknown2", "unknown1"));
  assert.deepEqual(native, entries("unknown2", "B", "A", "unknown1", "D", "C"));
  assert.deepEqual(history, ["A", "D", "unavailable", "B", "C"]);
});

test("without history, all graphs retain native order", () => {
  const native = entries("C", "A", "B");
  assert.deepEqual(orderGraphEntries(native, []), native);
  assert.deepEqual(orderGraphEntries([], ["A"]), []);
  assert.deepEqual(orderGraphEntries(entries("A"), ["A"]), []);
});

test("MRU snapshot keeps original entry identities and is independent of later history", () => {
  const native = entries("B", "A", "D", "C");
  const history = ["A", "D", "C", "B"];
  const snapshot = orderGraphEntries(native, history);
  assert.equal(snapshot[0], native[2]);
  assert.equal(snapshot[1], native[3]);
  assert.equal(snapshot[2], native[0]);
  history.unshift("B");
  native.reverse();
  assert.deepEqual(snapshot, entries("D", "C", "B"));
});

test("rows without paths remain usable after known graphs", () => {
  const native = [{ label: "missing path" }, { path: "B" }, { path: "", label: "empty path" }];
  assert.deepEqual(orderGraphEntries(native, ["A", "B"]), [native[1], native[0], native[2]]);
  assert.deepEqual(orderGraphEntries(native, []), native);
});

test("quick reverse release uses the frozen MRU order, including queued cycles", async () => {
  let resolve;
  const snapshot = orderGraphEntries(entries("B", "A", "D", "C"), ["A", "D", "C", "B"]);
  const view = picker(snapshot.length);
  const { switcher } = setup({ open: () => new Promise((done) => { resolve = done; }) });
  switcher.keydown(key("Tab", { shiftKey: true }));
  switcher.keydown(key("Tab", { shiftKey: true }));
  release(switcher);
  resolve(view);
  await flush();
  assert.deepEqual(view.rendered, [1]);
  assert.deepEqual(view.chosen.map((index) => snapshot[index].path), ["C"]);
});

test("cycle, wrap, reverse, and commit only on Ctrl release", async () => {
  const { switcher, view } = setup();
  switcher.keydown(key("Tab"));
  await flush();
  assert.deepEqual(view.rendered, [0]);
  switcher.keyup(key("Tab"));
  assert.deepEqual(view.chosen, []);
  for (let i = 0; i < 3; i++) switcher.keydown(key("Tab"));
  switcher.keydown(key("Tab", { shiftKey: true }));
  assert.deepEqual(view.rendered, [0, 1, 2, 0, 2]);
  release(switcher);
  release(switcher);
  assert.deepEqual(view.chosen, [2]);
});

test("quick release waits for native picker to mount", async () => {
  let resolve;
  const view = picker();
  const { switcher } = setup({ open: () => new Promise((done) => { resolve = done; }) });
  switcher.keydown(key("Tab"));
  switcher.keydown(key("Tab"));
  release(switcher);
  assert.deepEqual(view.chosen, []);
  resolve(view);
  await flush();
  assert.deepEqual(view.chosen, [1]);
});

test("Escape cancels, even if Ctrl is subsequently released", async () => {
  const { switcher, view } = setup();
  switcher.keydown(key("Tab"));
  await flush();
  switcher.keydown(key("Escape"));
  release(switcher);
  assert.equal(view.closed, 1);
  assert.deepEqual(view.chosen, []);
});

test("cancel before opening finishes cleans up the late modal without switching", async () => {
  let resolve;
  const view = picker();
  const { switcher } = setup({ open: () => new Promise((done) => { resolve = done; }) });
  switcher.keydown(key("Tab"));
  release(switcher);
  switcher.cancel();
  resolve(view);
  await flush();
  assert.equal(view.closed, 1);
  assert.deepEqual(view.chosen, []);
});

test("blur/unload cancels and disposed listeners do nothing", async () => {
  const { switcher, view, opens } = setup();
  switcher.keydown(key("Tab"));
  await flush();
  switcher.destroy();
  release(switcher);
  switcher.keydown(key("Tab"));
  assert.equal(opens(), 1);
  assert.equal(view.closed, 1);
  assert.deepEqual(view.chosen, []);
});

test("no alternatives leaves the current graph unchanged", async () => {
  const view = picker(0);
  const { switcher, messages } = setup({ open: async () => view });
  switcher.keydown(key("Tab"));
  release(switcher);
  await flush();
  assert.equal(messages.length, 1);
  assert.equal(view.closed, 1);
  assert.deepEqual(view.chosen, []);
});

test("reverse activation starts at the last row of the MRU snapshot", async () => {
  const view = picker(4);
  const { switcher } = setup({ open: async () => view });
  switcher.keydown(key("Tab", { shiftKey: true }));
  await flush();
  release(switcher);
  assert.deepEqual(view.rendered, [3]);
  assert.deepEqual(view.chosen, [3]);
});

test("one alternative wraps to itself", async () => {
  const view = picker(1);
  const { switcher } = setup({ open: async () => view });
  switcher.keydown(key("Tab"));
  await flush();
  switcher.keydown(key("Tab", { shiftKey: true }));
  release(switcher);
  assert.deepEqual(view.chosen, [0]);
});

test("plain Tab, Alt-Tab, Meta-Tab and IME input are not intercepted", () => {
  const { switcher, opens } = setup();
  for (const options of [{ ctrlKey: false }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    const event = key("Tab", options);
    switcher.keydown(event);
    assert.equal(event.consumed, false);
  }
  assert.equal(opens(), 0);
});

test("does not take over another modal", () => {
  const { switcher, opens } = setup({ canStart: () => false });
  const event = key("Tab");
  switcher.keydown(event);
  assert.equal(event.consumed, false);
  assert.equal(opens(), 0);
});

test("holding Tab does not auto-repeat and one of two held Ctrl keys is not a release", async () => {
  const { switcher, view } = setup();
  switcher.keydown(key("Tab"));
  await flush();
  switcher.keydown(key("Tab", { repeat: true }));
  switcher.keyup(key("Control", { ctrlKey: true }));
  assert.deepEqual(view.rendered, [0]);
  assert.deepEqual(view.chosen, []);
  release(switcher);
  assert.deepEqual(view.chosen, [0]);
});

test("native mouse selection is allowed without a second keyboard commit", async () => {
  const { switcher, view } = setup();
  switcher.keydown(key("Tab"));
  await flush();
  switcher.cancel(false);
  release(switcher);
  assert.equal(view.cleaned, 1);
  assert.equal(view.closed, 0);
  assert.deepEqual(view.chosen, []);
});

test("failed native opening reports an error and can be retried", async () => {
  const { switcher, messages } = setup({ open: async () => { throw new Error("Unavailable"); } });
  switcher.keydown(key("Tab"));
  await flush();
  release(switcher);
  assert.deepEqual(messages, ["Unavailable"]);
});
