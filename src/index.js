import "@logseq/libs";
import { createGraphSwitcher } from "./switcher.js";
import { createNativePicker } from "./native-picker.js";

async function main() {
  const sdk = logseq;
  // Modifier keyup is not exposed by the shortcut SDK. Desktop host access is
  // experimental and deliberately isolated in this optional app-wide plugin.
  const host = sdk.Experiments.ensureHostScope();
  const doc = host.document;
  const picker = createNativePicker(host, sdk);
  const switcher = createGraphSwitcher({
    ...picker,
    notify: (message) => sdk.UI.showMsg(message, "warning"),
  });
  const style = doc.createElement("style");
  style.textContent = `
    .cp__select[data-hold-graph-switcher="true"] .input-wrap,
    .cp__select[data-hold-graph-switcher="true"] .cp__select-results { display: none; }
    .cp__select[data-hold-graph-switcher="true"] .hold-graph-switcher-results {
      max-height: 60vh; overflow-y: auto;
    }
    .cp__select[data-hold-graph-switcher="true"] .hold-graph-switcher-results > .menu-link {
      display: block;
    }
    .cp__select[data-hold-graph-switcher="true"] .hold-graph-switcher-hint {
      padding: .85rem 1rem; font-size: .85rem; line-height: 1.6;
      color: var(--ls-secondary-text-color); border-bottom: 1px solid var(--ls-border-color);
    }
    .cp__select[data-hold-graph-switcher="true"] .menu-link {
      margin: .2rem .4rem; padding: .7rem .8rem; border-radius: .5rem;
      border: 2px solid transparent; background: transparent;
    }
    .cp__select[data-hold-graph-switcher="true"] .menu-link[data-hold-selected="true"] {
      border-color: var(--ls-link-text-color); background: var(--ls-tertiary-background-color);
    }
    .cp__select[data-hold-graph-switcher="true"] .tip code {
      opacity: .65; overflow-wrap: anywhere; white-space: normal;
    }
  `;
  doc.head.append(style);
  const blur = () => switcher.cancel();
  const visibility = () => { if (doc.hidden) switcher.cancel(); };
  const mouse = () => switcher.cancel(false); // Let native pointer selection/cancel run.
  host.addEventListener("keydown", switcher.keydown, true);
  host.addEventListener("keyup", switcher.keyup, true);
  host.addEventListener("blur", blur);
  doc.addEventListener("visibilitychange", visibility);
  doc.addEventListener("mousedown", mouse, true);
  const unsubscribe = sdk.App.onCurrentGraphChanged(() => {
    switcher.cancel(false);
    void picker.rememberCurrent();
  });
  sdk.beforeunload(async () => {
    switcher.destroy();
    unsubscribe();
    host.removeEventListener("keydown", switcher.keydown, true);
    host.removeEventListener("keyup", switcher.keyup, true);
    host.removeEventListener("blur", blur);
    doc.removeEventListener("visibilitychange", visibility);
    doc.removeEventListener("mousedown", mouse, true);
    style.remove();
  });
  await picker.rememberCurrent();
}

logseq.ready(main).catch((error) => {
  console.error("[hold-to-switch-graphs]", error);
  logseq.UI.showMsg("Hold to Switch Graphs requires Desktop host access. The native Alt+Shift+G chooser still works.", "warning");
});
