// Return a new snapshot; unvisited graphs retain their native relative order.
export function orderGraphEntries(entries, recentPaths) {
  const ranks = new Map(recentPaths.map((path, index) => [path, index]));
  return entries
    .filter((entry) => !entry.path || entry.path !== recentPaths[0])
    .sort((a, b) => (ranks.get(a.path) ?? ranks.size) - (ranks.get(b.path) ?? ranks.size));
}

// Verified against Logseq 0.10.9 components/select.cljs and ui/auto-complete.
// The native row's mousedown handler publishes :graph/switch, retaining Logseq's
// save/persist checks. Never replace this with a raw current-repo state write.
export function createNativePicker(host, sdk) {
  const doc = host.document;
  let opening = false;
  let recentPaths = [];
  let generation = 0;

  async function rememberCurrent() {
    const request = ++generation;
    try {
      const graph = await sdk.App.getCurrentGraph();
      if (request !== generation || !graph?.path) return;
      recentPaths = [graph.path, ...recentPaths.filter((path) => path !== graph.path)];
    } catch {
      // If history is unavailable, unvisited graphs keep their native order.
    }
  }

  function visibleModal() {
    return [...doc.querySelectorAll('.cp__select, [role="dialog"], .ui__modal-panel')]
      .some((node) => node.getClientRects().length > 0);
  }

  async function open() {
    opening = true;
    const previousFocus = doc.activeElement;
    try {
      await sdk.App.invokeExternalCommand("logseq.graph/open");
      const deadline = Date.now() + 3000;
      let root;
      while (Date.now() < deadline) {
        root = doc.querySelector(".cp__select-main:has(.cp__select-results)");
        if (root) break;
        await new Promise((resolve) => host.setTimeout(resolve, 25));
      }
      const type = await sdk.App.getStateFromStore("ui/open-select");
      // getStateFromStore camel-cases keyword values in the Desktop SDK.
      if (!root?.isConnected || !["graphOpen", "graph-open"].includes(type)) {
        throw new Error("Graph switcher could not identify the native graph chooser. Use Alt+Shift+G instead.");
      }
      const entries = orderGraphEntries(
        [...root.querySelectorAll(".cp__select-results a.menu-link")].map((row) => ({
          row, path: row.querySelector(".tip code")?.textContent,
        })),
        recentPaths,
      );
      // React owns the native rows and their delegated selection handlers. Keep
      // them in place; only reorder plugin-owned copies and forward selections.
      const results = doc.createElement("div");
      results.className = "hold-graph-switcher-results";
      for (const entry of entries) {
        entry.view = entry.row.cloneNode(true);
        entry.view.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
          try {
            choose(entries.indexOf(entry));
          } catch (error) {
            close();
            sdk.UI.showMsg(error.message, "warning");
          }
        });
        results.append(entry.view);
      }
      const hint = doc.createElement("div");
      hint.className = "hold-graph-switcher-hint";
      hint.setAttribute("role", "status");
      hint.setAttribute("aria-live", "polite");
      root.prepend(hint, results);
      root.dataset.holdGraphSwitcher = "true";

      function cleanup() {
        hint.remove();
        results.remove();
        delete root.dataset.holdGraphSwitcher;
      }

      function close() {
        cleanup();
        if (root.isConnected) {
          // Escape is the native modal's cancellation path. It never switches.
          (root.querySelector("input") ?? root).dispatchEvent(new host.KeyboardEvent("keydown", {
            key: "Escape", code: "Escape", keyCode: 27, which: 27,
            bubbles: true, cancelable: true,
          }));
        }
        if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      }

      function choose(index) {
        const row = entries[index]?.row;
        if (!root.isConnected || !row?.isConnected || !root.contains(row)) {
          throw new Error("The selected graph is no longer available. Open the graph switcher again.");
        }
        cleanup();
        row.dispatchEvent(new host.MouseEvent("mousedown", {
          bubbles: true, cancelable: true, button: 0, buttons: 1,
        }));
      }

      return {
        count: entries.length,
        cleanup,
        close,
        choose,
        render(index) {
          if (!root.isConnected) throw new Error("The graph chooser was closed. Try Ctrl+Tab again.");
          entries.forEach(({ view }, i) => { view.dataset.holdSelected = String(i === index); });
          const view = entries[index].view;
          const label = view.querySelector("span > div > span")?.textContent ?? view.textContent;
          hint.textContent = `Switch graph (${index + 1}/${entries.length}): ${label} — release Ctrl to open · Shift+Tab reverses · Esc cancels`;
          view.scrollIntoView({ block: "nearest" });
        },
      };
    } finally {
      opening = false;
    }
  }

  return { open, rememberCurrent, canStart: () => !opening && !visibleModal() };
}
