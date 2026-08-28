import { app } from "/scripts/app.js";
import { isGraphLoading } from "./graph_loading.mjs";

// Tell ComfyUI that the user just changed something that gets SERIALIZED.
//
// WHY THIS EXISTS (measured 2026-08-07, from a Load Image Mini report:
// "every time i came back to the workflow, the image reset to your image and
// not the last image i use").
//
// ComfyUI's ChangeTracker snapshots the graph on MOUSEUP - a window-level
// `mouseup` listener plus a wrapped `LGraphCanvas.processMouseUp`, both calling
// `changeTracker.captureCanvasState()`. A NATIVE widget commits its value during
// the mousedown / processNodeWidgets pass, so by the time that mouseup snapshot
// runs the new value is already in the graph and the change IS recorded.
//
// A Pixaroma DOM control commits on `click`, which fires strictly AFTER mouseup.
// So core's snapshot always captures the PRE-change state, and the change is
// then never recorded by anything. Measured on a real click picking an image:
//     live widget = "BunnyExplorer.png"      tracker activeState = "Cat.jpeg"
//     workflow.isModified = false            (stayed false indefinitely)
// The identical click on ComfyUI's OWN LoadImage combo set isModified = true
// immediately - that control is the reference the asymmetry was measured against.
//
// It is NOT that the event is swallowed: the mouseup was verified to reach
// window in the bubble phase. It is purely that we commit one phase too late.
//
// User-visible consequence: the workflow is never marked modified, so ComfyUI
// shows no dirty dot and never offers to save on close - the user's picture
// silently reverts to whatever the workflow FILE shipped with the next time it
// is opened. The change is also not undoable with Ctrl+Z, for the same reason.
//
// Call this AFTER committing a change to serialized state (widget values,
// node.properties, slots, node.size) from a DOM event handler.
//
// NEVER call it on the load path: a capture written during a workflow load
// flags a clean workflow "modified" (Vue Compat #18/#19). The isGraphLoading()
// gate below enforces that even when a caller gets it wrong.

let _timer = null;

function activeChangeTracker() {
  // The workflow store changed homes between frontend versions; try both.
  try {
    return (
      app?.extensionManager?.workflow?.activeWorkflow?.changeTracker ||
      app?.workflowManager?.activeWorkflow?.changeTracker ||
      null
    );
  } catch {
    return null;
  }
}

function capture() {
  const ct = activeChangeTracker();
  if (!ct) return;
  // `captureCanvasState` is the current name. `checkState` is the pre-rename
  // alias - on a current build it only logs a deprecation warning and delegates
  // here, so prefer the new name and fall back only on an older frontend.
  if (typeof ct.captureCanvasState === "function") ct.captureCanvasState();
  else if (typeof ct.checkState === "function") ct.checkState();
}

// ── The pack-wide safety net ────────────────────────────────────────────────
//
// Every Pixaroma node drives its state from DOM clicks, so every one of them has
// the phase problem described above. Rather than hand-wiring a call into ~55
// nodes' write paths - where the real hazard is accidentally firing one on the
// LOAD path and flagging a clean workflow modified (Vue Compat #18/#19) - one
// passive listener covers all of them and cannot be wired in wrong.
//
// TWO non-obvious requirements, both load-bearing:
//
//  1. CAPTURE phase, not bubble. Our handlers call `e.stopPropagation()` all
//     over the place (the file dropdown's own row handler does), so a bubble
//     listener on document would simply never fire for exactly the controls
//     that matter.
//  2. Capture runs BEFORE the target's handler, i.e. before the value is
//     committed - which would snapshot the pre-change state all over again.
//     The 120ms debounce in notifyGraphChanged() is what resolves this: the
//     timer necessarily lands after the click handler has finished.
//
// This is additive and passive - it overrides nothing and calls only the same
// function core's own mouseup handler calls, so it cannot break another pack
// (see the "no global patches" rule). A capture that finds nothing changed is a
// no-op: ChangeTracker compares the serialized graph and returns without
// touching the undo queue or the modified flag.
//
// A `click` cannot fire during a workflow load, and notifyGraphChanged() gates
// on isGraphLoading() anyway, so this can never false-dirty a clean workflow.
let _netInstalled = false;

export function installPixaromaChangeNet() {
  if (_netInstalled || typeof document === "undefined") return;
  _netInstalled = true;
  const onUserAction = (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    // Only our own UI. Every Pixaroma element carries a `pix-` prefixed class,
    // including the popups we mount on document.body.
    if (!t.closest('[class*="pix-"]')) return;
    notifyGraphChanged();
  };
  // `change` covers the paths that never produce a click on our own UI: a
  // checkbox committed by keyboard, and the hidden <input type="file"> behind
  // the Upload button (its dialog is native, so the click lands outside us).
  document.addEventListener("click", onUserAction, true);
  document.addEventListener("change", onUserAction, true);
}

export function notifyGraphChanged() {
  if (isGraphLoading()) return;
  // Coalesce bursts. Holding PageUp/PageDown steps the picker many times a
  // second, and every capture deep-clones and deep-compares the whole graph.
  // A trailing timer keeps it to one capture per burst - which also makes a
  // held key one undo entry rather than dozens.
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _timer = null;
    if (isGraphLoading()) return; // a load started while we were waiting
    try {
      capture();
    } catch (e) {
      // Degrade to the old behaviour (change simply not tracked) rather than
      // throwing inside whatever user action called us.
      console.warn("[Pixaroma] could not notify ComfyUI of a graph change", e);
    }
  }, 120);
}
