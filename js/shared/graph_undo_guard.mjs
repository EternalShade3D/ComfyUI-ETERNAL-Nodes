// ╔══════════════════════════════════════════════════════════════════════╗
// ║  Shared Ctrl+Z / graph-undo guard for Pixaroma fullscreen editors.    ║
// ╚══════════════════════════════════════════════════════════════════════╝
//
// WHAT CTRL+Z ACTUALLY DOES (measured live on frontend 1.47.12, 2026-08-04).
// Do NOT re-derive this from the minified bundle - it costs an hour and the
// obvious readings are all wrong:
//
//   ChangeTracker.init() registers, at PAGE STARTUP:
//     window.addEventListener("keydown", handler, true)      // window, CAPTURE
//   and that handler's FIRST line is:
//     if (e.repeat || app.constructor.maskeditor_is_opended?.()) return;
//   then, inside a requestAnimationFrame:
//     changeTracker.undoRedo(e) -> undo()/redo() -> updateState()
//                               -> app.loadGraphData(previousState)
//
// Three consequences, each confirmed by experiment rather than by reading:
//   * A keydown listener we add LATER can never preempt it. ComfyUI's sits on
//     window+capture from startup, so it always runs first; a window-capture
//     listener of ours calling preventDefault + stopImmediatePropagation was
//     measured NOT to stop the undo (the rest of the chain died, the undo
//     still happened). This is why "just block the key" was abandoned.
//   * Ctrl+Z does NOT travel through the command store or through
//     LGraphCanvas.processKey. "Comfy.Undo" appears exactly ONCE in the whole
//     bundle - the Edit menu - and has no default keybinding. The old guard
//     here intercepted command.execute("Comfy.Undo"); that was dead code.
//   * app.graph.undo / app.graph.redo do not exist on this frontend at all
//     (typeof undefined), so the old guard's patches for them never installed.
//
// SO: `ComfyApp.maskeditor_is_opended` is a `static ... = null` slot whose one
// and only consumer is that handler. It is the sanctioned way for a fullscreen
// editor to say "I am open, leave the graph alone" - filling it is not a patch,
// it is the API. It is currently unclaimed (the modern mask editor moved to the
// dialog store), but we still wrap whatever we find and hand it back.
//
// WHY THIS REPLACED THE OLD GUARD (2026-08-04)
// The old version replaced app.loadGraphData with a function that did nothing,
// and neutered app.graph.configure / undo / redo, for the WHOLE PAGE while any
// Pixaroma editor was open. On a cloud platform where every node pack shares one
// browser page that meant nobody could load a workflow - not core, not another
// pack - which is why our nodes were reported as breaking other people's.
// Filling this slot blocks Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z just as completely
// while leaving loadGraphData and graph.configure entirely alone. Both halves
// verified live: 8x Ctrl+Z with an editor open left the graph untouched, and
// app.loadGraphData still loaded a workflow normally at the same time.
//
// Requirements carried over from the old guard - each was earned by a real bug:
//   1. SELF-HEAL (Vue Compat #2): an overlay torn down WITHOUT its cleanup
//      running (workflow tab closed mid-edit) must not leave us armed forever.
//   2. REFCOUNT: two editors can be open at once; closing one must not strip
//      the other's protection.
//   3. SINGLE SYSTEM: one shared module. Per-editor copies fought each other on
//      restore and bricked on cross-close. Do not go back to that.
//   4. GIVE THE SLOT BACK ONLY IF IT IS STILL OURS, so we can never clobber
//      another owner who claimed it while we were holding it.
//
// Usage (per editor) - unchanged, so no call site needs editing:
//   import { installGraphUndoGuard } from "../shared/graph_undo_guard.mjs";
//   this._undoGuardOff = installGraphUndoGuard(() => !!this.overlay?.isConnected);
//   // in close()/cleanup AND onRemoved:  this._undoGuardOff?.(); this._undoGuardOff = null;

const HOOK = "maskeditor_is_opended";

const _tokens = new Set(); // { isAlive: () => boolean }
let _installed = false;
let _prevHook = null; // whatever occupied the slot before us (normally null)
let _ourHook = null; // our own function, so we can prove the slot is still ours
let _fallbackOff = null; // only used when the slot is missing entirely

function _anyAlive() {
  for (const t of _tokens) {
    try {
      if (t.isAlive()) return true;
    } catch {
      /* a throwing isAlive counts as dead */
    }
  }
  return false;
}

function _release() {
  const C = window.app?.constructor;
  // Requirement 4: only hand the slot back if it still holds OUR function.
  if (C && _ourHook && C[HOOK] === _ourHook) C[HOOK] = _prevHook;
  _ourHook = null;
  _prevHook = null;
  try {
    _fallbackOff?.();
  } catch {
    /* never let teardown throw */
  }
  _fallbackOff = null;
  _installed = false;
  _tokens.clear();
}

// Fallback for a future frontend that drops the legacy slot. Deliberately the
// narrowest thing that still cannot affect workflow loading: the change
// tracker's own undo/redo entry point. Returning true means "handled", which is
// what the caller checks (`await i.undoRedo(e) || ...`), so undo and redo are
// swallowed and nothing else changes.
function _installFallback() {
  const ct = window.app?.extensionManager?.workflow?.activeWorkflow?.changeTracker;
  const proto = ct && Object.getPrototypeOf(ct);
  if (!proto || typeof proto.undoRedo !== "function") return null;
  const orig = proto.undoRedo;
  const patched = function (...args) {
    if (_anyAlive()) return true;
    if (proto.undoRedo === patched) proto.undoRedo = orig; // self-heal
    return orig.apply(this, args);
  };
  proto.undoRedo = patched;
  return () => {
    if (proto.undoRedo === patched) proto.undoRedo = orig;
  };
}

/**
 * Register a fullscreen editor with the shared graph-undo guard.
 * @param {() => boolean} isAlive returns true while this editor's overlay is in the DOM.
 * @returns {() => void} uninstall - call from the editor's close/cleanup AND onRemoved.
 */
export function installGraphUndoGuard(isAlive) {
  const app = window.app;
  if (!app || !app.constructor) return () => {};

  const token = { isAlive };
  _tokens.add(token);

  if (!_installed) {
    _installed = true;
    const C = app.constructor;

    if (HOOK in C) {
      _prevHook = C[HOOK] ?? null;
      _ourHook = function () {
        if (_anyAlive()) return true;
        // Requirement 1: every overlay is gone and nobody called uninstall.
        // Stand down right now, then answer exactly as the previous owner would.
        const prev = _prevHook;
        _release();
        try {
          return prev ? !!prev() : false;
        } catch {
          return false;
        }
      };
      C[HOOK] = _ourHook;
    } else {
      _fallbackOff = _installFallback();
    }
  }

  // Uninstall for THIS editor. Stands down only when the last registered editor
  // is gone. Idempotent, so calling it from close() and onRemoved is safe.
  return function uninstall() {
    _tokens.delete(token);
    if (_anyAlive()) return; // another editor is still open - keep the guard
    _release();
  };
}
