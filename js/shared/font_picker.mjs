// ╔═══════════════════════════════════════════════════════════════╗
// ║  Pixaroma shared font picker popup                            ║
// ║  The dark dropdown that lists every bundled + drop-in font,    ║
// ║  each row previewed IN ITS OWN typeface.                       ║
// ╚═══════════════════════════════════════════════════════════════╝
//
// EXTRACTED from js/framework/text_editor.mjs (2026-08-16) so a SECOND consumer
// (Run Timer's clock font) reuses the exact same picker instead of growing a
// near-copy that drifts. The class names are deliberately UNCHANGED
// (.pix-to-popup*) so nothing about the Text Overlay / Watermark / Composer
// panels moves a pixel, and any stylesheet that already targets them still
// matches.
//
// Consumers: js/framework/text_editor.mjs (Text Overlay, Text Watermark,
// Composer text layers) and js/run_timer/index.js (clock font).
//
// Convention #14: this IS the custom dark dropdown - never a native <select>.

import { loadFontForLayer, refreshFontCatalog } from "../framework/fonts.mjs";

// NOTE: there is deliberately no shared labelForFont here. Each consumer wants a
// DIFFERENT fallback for an id that is not in the catalog (Text Overlay falls
// back to "Roboto", Run Timer to its built-in clock face), and a shared helper
// with one baked-in default would quietly give one of them the wrong answer.

/**
 * Open the font popup under `anchorEl`.
 *
 * opts:
 *   catalog   - the font catalog array (may be empty; the ↻ button refetches)
 *   currentId - the id to mark active
 *   onPick    - (id) => void
 *   onCatalog - (catalog) => void, called after a ↻ refresh
 *   extraTop  - optional [{id, label}] rows pinned ABOVE the catalog, for a
 *               consumer that has a "no font / built-in" choice (Run Timer).
 *               They are never given a preview typeface (they have no file).
 *   filter    - optional (catalog) => catalog, for a consumer that cannot use
 *               every face (Run Timer drops handwriting: it does not read as a
 *               clock). It is applied to the REFRESHED catalog too, or pressing
 *               the ↻ button would quietly bring the excluded fonts back.
 */
export function openFontPopup(anchorEl, opts) {
  const { catalog = [], currentId = "", onPick, onCatalog, extraTop = [], filter } = opts || {};
  const sift = (c) => (typeof filter === "function" ? filter(c || []) : (c || []));
  injectFontPickerCSS();
  document.querySelector(".pix-to-popup")?.remove();
  const popup = document.createElement("div");
  popup.className = "pix-to-popup";
  const rect = anchorEl.getBoundingClientRect();
  popup.style.left = `${rect.left}px`;
  popup.style.top = "0px"; // real position set after measuring (below)
  popup.style.width = `${Math.max(rect.width, 200)}px`;

  // ── search row (filter + refresh) ──
  const searchRow = document.createElement("div");
  searchRow.className = "pix-to-popup-search";
  const mag = document.createElement("span");
  mag.className = "pix-to-popup-mag";
  mag.textContent = "⌕";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Filter fonts…";
  const refreshBtn = document.createElement("button");
  refreshBtn.type = "button";
  refreshBtn.className = "pix-to-popup-refresh";
  refreshBtn.title = "Rescan models/fonts for newly added fonts";
  refreshBtn.textContent = "↻";
  searchRow.append(mag, input, refreshBtn);
  popup.appendChild(searchRow);

  // ── scrollable list ──
  const list = document.createElement("div");
  list.className = "pix-to-popup-list";
  popup.appendChild(list);

  // ── footer hint: where a custom font has to go ──
  // Users kept asking where the fonts folder is: the refresh button's tooltip
  // said it, but a tooltip on a "↻" glyph is too easy to miss. The answer now
  // lives in the picker itself, which is where the question gets asked.
  // Path is the DEFAULT drop-in dir; a redirect via extra_model_paths.yaml is
  // covered in the Help browser's "Add your own fonts" guide (the list route
  // returns a bare array, so the real resolved dir is not available here).
  // Label and path are separate blocks so the path never wraps mid-word and the
  // whole thing stays two lines: a wrapped sentence took four, and this popup
  // is only 200px wide with a 340px cap it has to share with the list.
  const hint = document.createElement("div");
  hint.className = "pix-to-popup-hint";
  hint.title = "Put .ttf or .otf files in ComfyUI/models/fonts, then press ↻ to load them without restarting ComfyUI.";
  const hintLabel = document.createElement("div");
  hintLabel.textContent = "Your own fonts, then press ↻";
  const hintPath = document.createElement("code");
  hintPath.textContent = "ComfyUI/models/fonts";
  hint.append(hintLabel, hintPath);
  popup.appendChild(hint);

  // Lazy preview: load a row's own font only when it scrolls into view.
  let io = null;
  const buildList = (cat, query) => {
    list.innerHTML = "";
    if (io) { io.disconnect(); io = null; }
    io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const rowEl = en.target;
        io.unobserve(rowEl);
        const id = rowEl.dataset.fontId;
        const f = cat.find((x) => x.id === id);
        const w0 = f?.weights?.[0];
        if (!w0) continue;
        loadFontForLayer(f.id, w0.weight, w0.italic)
          .then(() => { rowEl.style.fontFamily = `"Pix-${f.id}", system-ui`; })
          .catch(() => {});
      }
    }, { root: list });

    const q = (query || "").trim().toLowerCase();
    const addRow = (id, label, preview) => {
      const item = document.createElement("div");
      item.className = "pix-to-popup-item" + (id === currentId ? " active" : "");
      item.textContent = label;
      item.dataset.fontId = id;
      item.addEventListener("click", (e) => {
        e.stopPropagation();
        onPick?.(id);
        dismiss();
      });
      list.appendChild(item);
      if (preview) io.observe(item);
      return item;
    };

    let shown = 0;
    // Pinned rows first (e.g. "Clock (default)"), then a separator.
    let pinned = 0;
    for (const x of extraTop) {
      if (q && !String(x.label).toLowerCase().includes(q)) continue;
      addRow(x.id, x.label, false);
      pinned++; shown++;
    }
    if (pinned) {
      const sep = document.createElement("div");
      sep.className = "pix-to-popup-sep";
      list.appendChild(sep);
    }

    let lastCat = null;
    for (const f of cat) {
      if (q && !f.label.toLowerCase().includes(q)) continue;
      if (lastCat && lastCat !== f.category) {
        const sep = document.createElement("div");
        sep.className = "pix-to-popup-sep";
        list.appendChild(sep);
      }
      lastCat = f.category;
      addRow(f.id, f.label, true);
      shown++;
    }
    if (shown === 0) {
      const empty = document.createElement("div");
      empty.className = "pix-to-popup-empty";
      empty.textContent = "(no matches)";
      list.appendChild(empty);
    }
  };

  let workingCat = sift(catalog);
  // Teardown: removes the popup + the observer. Reassigned after the popup is
  // in the DOM to the closer returned by attachPopupCloseListeners, which ALSO
  // detaches the document listeners (so no listener leak on row-click/Escape).
  let dismiss = () => { if (io) io.disconnect(); popup.remove(); };

  // Typing filters; keystrokes must not reach the canvas (pan/shortcuts).
  input.addEventListener("input", () => buildList(workingCat, input.value));
  input.addEventListener("keydown", (e) => {
    e.stopImmediatePropagation();
    if (e.key === "Escape") dismiss();
  });

  refreshBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    refreshBtn.disabled = true;
    try {
      workingCat = sift(await refreshFontCatalog());
      onCatalog?.(workingCat);
      buildList(workingCat, input.value);
    } catch (err) {
      console.warn("[font_picker] font refresh failed", err);
    } finally {
      refreshBtn.disabled = false;
    }
  });

  document.body.appendChild(popup);
  // Wire close + build rows AFTER the popup is connected: the IntersectionObserver
  // root (the scroll list) must be in the DOM for lazy previews to fire, and the
  // returned closer is the single teardown path that also detaches listeners.
  dismiss = attachPopupCloseListeners(popup, () => { if (io) io.disconnect(); popup.remove(); });
  buildList(workingCat, "");

  // Position: open downward; if it would overflow the viewport bottom, flip
  // above the anchor; clamp into the viewport as a last resort. Also clamp the
  // left edge so a narrow sidebar near the screen edge doesn't push it off.
  const vw = window.innerWidth, vh = window.innerHeight;
  const ph = Math.min(popup.offsetHeight, 340);
  let top = rect.bottom + 2;
  if (top + ph > vh - 8) {
    const above = rect.top - 2 - ph;
    top = above >= 8 ? above : Math.max(8, vh - 8 - ph);
  }
  let left = rect.left;
  if (left + popup.offsetWidth > vw - 8) left = Math.max(8, vw - 8 - popup.offsetWidth);
  popup.style.top = `${top}px`;
  popup.style.left = `${left}px`;
  setTimeout(() => input.focus(), 0);
  return dismiss;
}

// Shared close-listener wiring for our custom popups. Mirrors Load Image
// Pattern #14: mousedown/pointerdown/wheel/Esc all capture-phase. Wheel
// listener MUST gate on !popup.contains so users can scroll the list.
export function attachPopupCloseListeners(popup, closeFn) {
  const onDocDown = (e) => { if (!popup.contains(e.target)) doClose(); };
  const onWheel   = (e) => { if (!popup.contains(e.target)) doClose(); };
  const onKey     = (e) => { if (e.key === "Escape") doClose(); };
  function doClose() {
    document.removeEventListener("mousedown", onDocDown, true);
    document.removeEventListener("pointerdown", onDocDown, true);
    document.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("keydown", onKey, true);
    closeFn();
  }
  setTimeout(() => {
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("pointerdown", onDocDown, true);
    document.addEventListener("wheel", onWheel, true);
    document.addEventListener("keydown", onKey, true);
  }, 0);
  return doClose;
}

// ── CSS (once per page) ──────────────────────────────────────────────────────
// Moved verbatim out of text_editor.mjs's injectCSS. Both consumers call this;
// it is idempotent, so whichever panel opens first pays for it.
let _cssInjected = false;
export function injectFontPickerCSS() {
  if (_cssInjected || document.getElementById("pix-fontpicker-css")) { _cssInjected = true; return; }
  _cssInjected = true;
  const s = document.createElement("style");
  s.id = "pix-fontpicker-css";
  s.textContent = `
    /* Custom dropdown popup (positioned via body) */
    .pix-to-popup {
      position: fixed;
      z-index: 99999;
      background: #1d1d1d;
      border: 1px solid #444;
      border-radius: 4px;
      box-shadow: 0 4px 16px rgba(0,0,0,0.4);
      font: 13px ui-sans-serif, system-ui, sans-serif;
      color: #ddd;
      max-height: 340px;
      min-width: 160px;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }
    .pix-to-popup-search {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 8px;
      border-bottom: 1px solid #333;
      background: #1d1d1d;
      flex-shrink: 0;
    }
    .pix-to-popup-mag { color: #888; font-size: 14px; }
    .pix-to-popup-search input {
      flex: 1;
      min-width: 0;
      background: transparent;
      border: none;
      outline: none;
      color: #e0e0e0;
      font: 12px ui-sans-serif, system-ui, sans-serif;
    }
    .pix-to-popup-search input::placeholder { color: #777; }
    .pix-to-popup-refresh {
      background: rgba(255,255,255,0.06);
      color: #ccc;
      border: 1px solid rgba(255,255,255,0.14);
      border-radius: 4px;
      width: 22px;
      height: 22px;
      cursor: pointer;
      line-height: 1;
      font-size: 13px;
      flex-shrink: 0;
    }
    .pix-to-popup-refresh:hover { border-color: var(--pix-acc,#f66744); color: #fff; }
    .pix-to-popup-refresh:disabled { opacity: 0.5; cursor: default; }
    .pix-to-popup-list { overflow-y: auto; flex: 1; }
    .pix-to-popup-empty { padding: 10px 12px; color: #777; font: 12px ui-sans-serif, system-ui, sans-serif; }
    .pix-to-popup-item {
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid #2a2a2a;
    }
    .pix-to-popup-item:last-child { border-bottom: none; }
    .pix-to-popup-item:hover { background: #2a2a2a; }
    .pix-to-popup-item.active { color: var(--pix-acc,#f66744); font-weight: 600; }
    .pix-to-popup-sep { height: 1px; background: #333; margin: 4px 0; }
    /* Footer hint naming the drop-in fonts folder. flex-shrink:0 like the search
       row, so the scrollable list gives up the space instead of the hint. */
    .pix-to-popup-hint {
      padding: 6px 8px;
      border-top: 1px solid #333;
      background: #1d1d1d;
      color: #888;
      font: 11px ui-sans-serif, system-ui, sans-serif;
      line-height: 1.4;
      flex-shrink: 0;
    }
    .pix-to-popup-hint code {
      display: block;
      color: #bbb;
      font: 11px ui-monospace, "Consolas", monospace;
      word-break: break-all;
    }
  `;
  document.head.appendChild(s);
}
