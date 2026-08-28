// A themed yes/no dialog, usable from anywhere in the pack.
//
// WHY THIS EXISTS AND WHY IT IS NOT window.confirm. A native dialog is the one UI
// primitive a host can simply REFUSE, and it refuses SILENTLY:
//   - Electron (ComfyUI Desktop) does not implement window.prompt at all;
//   - Chromium suppresses confirm/alert for a document whose visibilityState is
//     "hidden", which a non-displayed Electron pane is - MEASURED 2026-08-17:
//     `window.confirm(...)` returned false in 1ms with nothing shown.
// So `if (!window.confirm(...)) return;` is an unconditional silent early
// return, and that has produced three separate "the button does nothing"
// reports in this pack. Never gate a Pixaroma action on a native dialog.
//
// This is the PROVEN shape already copy-pasted into find_replace / prompt_multi
// / prompt_stack as a local `pixConfirm`, lifted here so a fifth consumer does
// not become a fifth copy. Those three are deliberately left alone for now (a
// release was imminent when this was extracted); folding them onto this module
// is mechanical and belongs to the pack-wide native-dialog sweep.
//
// ⚠️ ONE DELIBERATE DIFFERENCE from those copies: Enter is decided from FOCUS.
// They resolve TRUE on Enter whichever button has focus, so tabbing to Cancel
// and pressing Enter performs the action - which on a destructive confirm is the
// bug that deleted a user's preset in AI Prompt (see .claude/patterns/
// ai-prompt.md 19d). Do not "simplify" that back.

import { BRAND } from "./utils.mjs";

const CSS_ID = "pixaroma-confirm-dialog-css";

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const style = document.createElement("style");
  style.id = CSS_ID;
  // z-index sits above the fullscreen editor shell (framework/theme.mjs uses
  // 11000 for .pxf-overlay), so a confirm raised from INSIDE an editor is
  // visible and clickable over it.
  style.textContent = `
    .pix-cfm-back { position:fixed; inset:0; z-index:12000;
      background:rgba(0,0,0,.62); display:flex; align-items:center;
      justify-content:center; }
    .pix-cfm { width:min(430px,92vw); background:#232325; border:1px solid #3a3a3c;
      border-radius:8px; color:#e0e0e0; font:12px 'Segoe UI', sans-serif;
      box-shadow:0 12px 34px rgba(0,0,0,.55); overflow:hidden; }
    .pix-cfm-title { padding:11px 14px; background:#2a2a2c;
      border-bottom:1px solid #1c1c1e; font-size:13px; font-weight:600; }
    .pix-cfm-msg { padding:13px 14px 2px; font-size:12px; line-height:1.5;
      color:#b9b9b9; white-space:pre-wrap; }
    .pix-cfm-actions { display:flex; gap:8px; justify-content:flex-end;
      padding:14px; }
    .pix-cfm-btn { background:rgba(255,255,255,.05);
      border:1px solid rgba(255,255,255,.13); color:rgba(255,255,255,.72);
      border-radius:4px; padding:6px 16px; font-size:11.5px; cursor:pointer;
      font-family:'Segoe UI', sans-serif; }
    .pix-cfm-btn:hover { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-cfm-btn.primary { background:${BRAND}; border-color:${BRAND}; color:#fff; }
    .pix-cfm-btn:focus-visible { outline:2px solid ${BRAND}; outline-offset:2px; }
  `;
  document.head.appendChild(style);
}

/**
 * Ask a yes/no question. Resolves true ONLY if the user really said yes.
 *
 * Dismissing it any way at all - Cancel, Escape, the backdrop - resolves false,
 * so a caller can always write `if (!await pixConfirm(...)) return;`.
 *
 * Pass `danger: true` when yes DESTROYS something. It focuses Cancel instead of
 * OK, so the keyboard default is the safe answer - the same reasoning that made
 * Enter read the focused button rather than always meaning yes.
 *
 * @param {{title?:string, message?:string, okText?:string, cancelText?:string,
 *          danger?:boolean}} o
 * @returns {Promise<boolean>}
 */
export function pixConfirm({ title, message, okText = "OK", cancelText = "Cancel",
                             danger = false } = {}) {
  injectCSS();
  return new Promise((resolve) => {
    const back = document.createElement("div");
    back.className = "pix-cfm-back";
    const box = document.createElement("div");
    box.className = "pix-cfm";

    const titleEl = document.createElement("div");
    titleEl.className = "pix-cfm-title";
    titleEl.textContent = title || "Confirm";
    box.appendChild(titleEl);

    if (message) {
      const msgEl = document.createElement("div");
      msgEl.className = "pix-cfm-msg";
      msgEl.textContent = message;      // textContent: a caller's text is never HTML
      box.appendChild(msgEl);
    }

    const actions = document.createElement("div");
    actions.className = "pix-cfm-actions";
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "pix-cfm-btn";
    cancelBtn.textContent = cancelText;
    const okBtn = document.createElement("button");
    okBtn.type = "button";
    okBtn.className = "pix-cfm-btn primary";
    okBtn.textContent = okText;
    actions.append(cancelBtn, okBtn);
    box.appendChild(actions);
    back.appendChild(box);
    document.body.appendChild(back);

    let done = false;
    const finish = (val) => {
      if (done) return;                 // Cancel, Escape and the backdrop can all
      done = true;                      // fire for one dismissal
      window.removeEventListener("keydown", onKey, true);
      back.remove();
      resolve(val);
    };
    const onKey = (e) => {
      // stopImmediatePropagation so the HOST does not also act on the key: an
      // editor with its own Escape-to-close would otherwise close underneath the
      // question the moment you dismissed it.
      if (e.key === "Escape") {
        e.preventDefault(); e.stopImmediatePropagation(); finish(false); return;
      }
      if (e.key !== "Enter") return;
      e.preventDefault(); e.stopImmediatePropagation();
      // Enter means the FOCUSED button, not always yes - see the header note.
      finish(document.activeElement !== cancelBtn);
    };
    window.addEventListener("keydown", onKey, true);
    back.addEventListener("mousedown", (e) => {
      if (e.target !== back) return;
      // Ignore the second press of a double-click: the backdrop appears under
      // the cursor synchronously, so a double-click on the control that OPENED
      // this would otherwise dismiss it before it could be read.
      if (e.detail > 1) return;
      finish(false);
    });
    cancelBtn.addEventListener("click", () => finish(false));
    okBtn.addEventListener("click", () => finish(true));
    queueMicrotask(() => (danger ? cancelBtn : okBtn).focus());
  });
}
