# Hold to Switch Graphs

An app-wide Logseq Desktop plugin for switching between local file graphs with **Ctrl+Tab**, using most-recently-used (MRU) ordering like GNOME's app switcher.

This is a standalone repository. It does not require the Logseq Starter Graph, its configuration, or its journal automation. It can live anywhere on disk, including inside another repository's ignored `plugins/` directory.

## Controls and behavior

- Hold **Ctrl**, press **Tab** to open the chooser, and press **Tab** again to cycle forward.
- **Ctrl+Shift+Tab** cycles backward. When opening in reverse, the last item is highlighted.
- Release **Ctrl** to open the highlighted graph. Releasing Tab alone does not switch; holding Tab does not auto-repeat.
- **Escape** or leaving the app cancels. Pointer selection also works.
- Available graphs are displayed and cycled in the same **most-recently-opened order**, excluding the current graph. The first Ctrl+Tab highlights the most recently visited other graph, allowing quick toggling between your last two graphs.
- Graphs without history follow known graphs, keeping their native relative order.
- The order stays fixed while the switcher is open. History updates only when a graph actually becomes current, including switches outside the plugin—not when highlighting, cancelling, or requesting a switch that Logseq declines.
- History is kept **in memory only** and resets when the plugin reloads.

This uses **Control** on macOS too, not Command. GNOME's Alt+Tab is untouched. Logseq's native **Alt+Shift+G** chooser remains available without the plugin.

## Install from source

Requirements: Logseq Desktop with plugin support and local file graphs, plus a supported Node.js LTS release (Node 22 or newer recommended) with npm.

1. Clone or download this repository and open a terminal in its root directory.
2. Install the pinned dependencies and build:

   ```sh
   npm ci
   npm run build
   ```

3. In Logseq Desktop, enable **Developer mode** in Settings → Advanced if necessary.
4. Open **Plugins → Load unpacked** and select this repository's root folder—the folder containing `package.json` and `index.html`, not `src/` or `dist/`.
5. Keep the plugin enabled when changing graphs. Disable it in Plugins to restore any other use of Ctrl+Tab.

Dependencies download from npm during setup. The plugin itself makes no runtime network requests. `node_modules/` and the generated `dist/` bundle are ignored by Git; build after cloning and after source updates, then reload the plugin in Logseq.

## Compatibility and switching safety

The plugin uses experimental Desktop host-document access for modifier-release events and targets native file-graph chooser markup inspected in Logseq **0.10.9**. Compatibility with other versions is not guaranteed. It is not a mobile, browser, OS-global, or embedded-webview shortcut.

The MRU presentation uses plugin-owned copies of the chooser rows. React-managed native rows remain in their original parent and order. Selecting a presentation row forwards a modifier-free `mousedown` to its original native row, retaining Logseq's normal switch action and save/persist checks; the plugin never writes current-graph state directly. Cleanup restores the native chooser. If the chooser cannot be identified, the plugin warns and leaves normal selection available.

**Automated fixture tests are not live Logseq Desktop validation.** They simulate chooser markup and delegated selection handlers, not React reconciliation or actual graph persistence.

## Development and tests

Run from this repository's root:

```sh
npm test
npm run build
```

For the browser fixture, install Chrome or Chromium and pass its executable path:

```sh
npm run test:browser -- /usr/bin/google-chrome
```

Use your browser's actual executable path if different. The fixture runs headlessly with a temporary profile and removes its temporary files afterward. It passes `--no-sandbox` for local fixture execution; it is not intended for browsing untrusted content. No browser package or driver download is required.

The fixture resolves source paths relative to its own location, so direct invocation also works from another working directory. Unit and browser tests cover MRU ordering, matching visual/keyboard order, current-graph exclusion, stable unknown ordering, external graph changes, frozen snapshots, cancellation, rejected switches, quick release/toggling, pointer forwarding, native node identity, cleanup, and unload.

### Desktop smoke test before release

Use disposable local graphs to verify behavior in your actual Logseq version:

1. Visit at least three graphs, including one switch through Logseq's native UI. Confirm MRU order and current-graph exclusion.
2. Quick-tap Ctrl+Tab repeatedly to toggle between the last two graphs. Check forward/reverse cycling, wraparound, and reverse activation.
3. Highlight several graphs, then cancel with Escape or window blur. Confirm cancellation neither switches graphs nor changes the next session's order.
4. Edit a block and switch graphs. Return and verify that Logseq saved the edit through its normal persistence flow.
5. Test pointer selection, plugin reload/disable, and the native Alt+Shift+G chooser afterward.

### Repository layout

- `src/index.js` — SDK integration, host events, graph-change hook, and styling.
- `src/native-picker.js` — in-memory history, MRU snapshots, and native chooser adapter.
- `src/switcher.js` — keyboard and asynchronous session state.
- `src/switcher.test.js` — unit tests.
- `scripts/validate_graph_switcher.cjs` — standalone Chrome/Chromium fixture.
- `index.html` — Logseq entry page loading the generated `dist/index.js`.

The package remains `private: true` to prevent accidental npm publication; this does not prevent hosting the repository or loading it as a Logseq plugin. No license has been selected yet; choose one before publishing for reuse.
