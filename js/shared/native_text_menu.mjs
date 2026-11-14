// Let a text field inside a node body keep the BROWSER's right-click menu.
//
// Reported 2026-08-13 against Prompt Stack: "In Nodes 2.0, when right clicking
// on a text box, I don't get the standard text box context menu (copy, paste,
// etc.) but the whole node context window." Confirmed with a real right-click:
// Nodes 2.0 answers with Rename / Copy / Duplicate / Pin / Bypass instead of
// Cut / Copy / Paste, so there is no way to paste into the field with the mouse.
//
// Nodes 2.0 handles `contextmenu` on the node element that wraps our widget, so
// an event that reaches it opens the node menu. Stopping the event while it is
// still inside our own root leaves the browser to do what it normally does over
// an editable field. Everywhere ELSE on the node body the event is left alone,
// so right-clicking the padding, a button or a label still gets the node menu -
// which is what people expect and what every other Pixaroma node does.
//
// Save Image Pixaroma has carried this rule inline since it shipped (its root
// handler returns early for INPUT / TEXTAREA before taking the event over). This
// is the same rule as a helper so the other DOM-widget nodes can share one copy
// rather than each growing their own slightly different version.
//
// Classic needs it too: the canvas has its own contextmenu handling, and a node
// whose body is a DOM widget sits on top of it.

/**
 * @param {HTMLElement} root  the element passed to addDOMWidget
 * @returns {() => void} uninstall
 */
export function installNativeTextMenu(root) {
  if (!root || root._pixNativeTextMenu) return () => {};
  const onContextMenu = (e) => {
    const t = e.target;
    if (!t) return;
    const tag = t.tagName;
    // isContentEditable covers a rich-text body (Note) as well as inputs.
    if (tag !== "INPUT" && tag !== "TEXTAREA" && !t.isContentEditable) return;
    // A disabled or read-only field still deserves Copy / Select all, so no
    // extra condition here - anything the browser treats as text is text.
    e.stopPropagation();
  };
  // Bubble phase, on our own root: our handler runs while the event is still
  // inside the widget, before it can reach the node element above us.
  root.addEventListener("contextmenu", onContextMenu);
  root._pixNativeTextMenu = true;
  return () => {
    root.removeEventListener("contextmenu", onContextMenu);
    root._pixNativeTextMenu = false;
  };
}
