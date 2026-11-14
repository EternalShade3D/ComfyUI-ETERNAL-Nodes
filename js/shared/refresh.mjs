// One global "the user refreshed node definitions" signal for Pixaroma caches.
//
// ComfyUI's R key (Refresh Node Definitions) re-fetches /object_info and then calls
// node.refreshComboInNode?.(defs) on EVERY node instance in the graph (verified in
// frontend 1.45.21: reloadNodeDefs; it also runs automatically on WebSocket
// reconnect). Native combo widgets get fresh values from that pass - our custom DOM
// pickers do not, so any module whose cache should refresh on R registers a handler
// here, and each affected node TYPE installs the per-node hook below.
//
// Fire-and-forget by core's contract (the return value is discarded via a comma
// operator), so handlers must do their own async work and repaint - never rely on
// being awaited. Many nodes fire the hook in the same reloadNodeDefs pass; the
// microtask flag collapses them into ONE handler run.

const _handlers = new Set();
let _scheduled = false;

export function onNodeDefsRefresh(fn) {
  _handlers.add(fn);
}

export function runRefreshHandlers() {
  if (_scheduled) return;
  _scheduled = true;
  queueMicrotask(() => {
    _scheduled = false;
    for (const fn of _handlers) {
      try { fn(); } catch { /* one bad handler must not stop the rest */ }
    }
  });
}

// Install the official per-node hook on a node type (call from
// beforeRegisterNodeDef). Wraps any existing hook rather than replacing it.
export function installRefreshHook(nodeType) {
  const orig = nodeType.prototype.refreshComboInNode;
  nodeType.prototype.refreshComboInNode = function () {
    try { runRefreshHandlers(); } catch { /* never break core's refresh loop */ }
    return orig?.apply(this, arguments);
  };
}
