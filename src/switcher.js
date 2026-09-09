// Keyboard state is separate from the native-picker adapter so async opening,
// cancellation, and modifier release can be tested without a live graph.
export function createGraphSwitcher({ open, canStart = () => true, notify }) {
  let active = null;
  let disposed = false;
  const wrap = (index, count) => ((index % count) + count) % count;
  const consume = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  function render(session) {
    if (session.picker) {
      session.index = wrap(session.index, session.picker.count);
      session.picker.render(session.index);
    }
  }

  function commit(session) {
    if (active !== session || !session.picker) return;
    active = null;
    try {
      session.picker.choose(session.index);
    } catch (error) {
      session.picker.close();
      notify(error.message);
    }
  }

  async function start(direction) {
    const session = { index: direction < 0 ? -1 : 0, picker: null, released: false };
    active = session;
    try {
      const picker = await open();
      if (disposed || active !== session) {
        picker.close();
        return;
      }
      if (!picker.count) {
        active = null;
        picker.close();
        notify("No other local graph is available. Add one in Logseq's graph menu first.");
        return;
      }
      session.picker = picker;

      render(session);
      // A quick tap can release Ctrl before Logseq has mounted its modal.
      if (session.released) commit(session);
    } catch (error) {
      if (active === session) {
        cancel();
        notify(error.message);
      }
    }
  }

  function cancel(close = true) {
    const session = active;
    active = null;
    if (close) session?.picker?.close();
    else session?.picker?.cleanup();
  }

  function keydown(event) {
    if (disposed || event.isComposing) return;
    const cycle = event.ctrlKey && !event.altKey && !event.metaKey && event.key === "Tab";
    if (cycle) {
      if (!active && !canStart()) return;
      consume(event);
      if (event.repeat) return;
      if (!active) void start(event.shiftKey ? -1 : 1);
      else if (!active.released) {
        active.index += event.shiftKey ? -1 : 1;
        try {
          render(active);
        } catch (error) {
          cancel();
          notify(error.message);
        }
      }
      return;
    }
    if (!active) return;
    if (event.key === "Escape") {
      consume(event);
      cancel();
    } else if (event.key !== "Control" && event.key !== "Shift") {
      // Do not type into the chooser or run editing shortcuts while selecting.
      consume(event);
    }
  }

  function keyup(event) {
    if (!active) return;
    if (event.key === "Control" && !event.ctrlKey) {
      consume(event);
      active.released = true;
      commit(active);
    }
  }

  return {
    keydown,
    keyup,
    cancel,
    destroy() {
      disposed = true;
      cancel();
    },
  };
}
