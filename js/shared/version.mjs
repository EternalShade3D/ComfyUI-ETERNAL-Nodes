// ╔═══════════════════════════════════════════════════════════════╗
// ║  Which version am I on                                         ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// "Which version are you on" is the first question any support answer needs, so
// it belongs on screen rather than behind a button on another page. Lived in
// js/help_browser/actions.mjs until the Workflows panel wanted the same footer;
// nothing about it is help-specific.

// The constant lives in the barrel. Imported directly rather than via the
// barrel re-exporting this file, which would be a cycle.
import { PIXAROMA_JS_VERSION } from "./index.mjs";

/** Short form, for a footer chip. This is the form people are asked for. */
export function versionShort() {
  return `Pixaroma ${PIXAROMA_JS_VERSION}`;
}

/** The same thing in two pieces, so a footer can colour the NAME without
 *  colouring the number with it. One string cannot be two colours. */
export function versionParts() {
  return { name: "Pixaroma", number: PIXAROMA_JS_VERSION };
}

/** The full line worth pasting into a support question. Every part is optional
 *  and guarded: a missing one must not cost the reader the parts that are
 *  there. The renderer is read fresh each time, since it can be switched
 *  without reloading the page. */
export function versionLine() {
  const bits = [`Pixaroma ${PIXAROMA_JS_VERSION}`];
  try {
    const fe = window.__COMFYUI_FRONTEND_VERSION__;
    if (fe) bits.push(`frontend ${fe}`);
  } catch { /* optional */ }
  try {
    bits.push(window.LiteGraph?.vueNodesMode ? "Nodes 2.0" : "Classic nodes");
  } catch { /* optional */ }
  try {
    if (navigator.platform) bits.push(navigator.platform);
  } catch { /* optional */ }
  return bits.join(" / ");
}
