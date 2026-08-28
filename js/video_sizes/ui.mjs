// Video Sizes ETERNAL - the node face.
//
// Layout (swapped per user spec on 2026-08-25):
//   band   (parked in the output-slot dead-space): Portrait / Landscape pills
//           with little ratio swatches + the gear. This is where the readout
//           used to be.
//   sizes  a single non-wrapping row of p-label chips (360p..1080p).
//   readout a Duration-style readout ("720p  [really 1280 x 736]") in the body,
//           where the orient row used to be.
//
// The band is OUT OF FLOW so the widget body height stays fixed (never measured
// live, or a clean workflow gets flagged "modified" - Vue Compat #18).

import { pixAsset } from "../shared/api_url.mjs";
import { ACC } from "../shared/node_settings.mjs";
import { readState, writeState, fmtReadout, VIDEO_PRESETS } from "./core.mjs";

const PAD = 6;
const GAP = 4;
const TAB_H = 24;
const READOUT_H = 18;

// Widget body = chips row + readout row. The band is out of flow, not counted.
export const WIDGET_H = PAD * 2 + TAB_H + GAP + READOUT_H;

export const DEFAULT_W = 320;
export const MIN_W = 285;

// Band covers the two slot rows below the first. Measured on the drawn node:
// output dots sit at node-local y 14 / 34 / 54 with 20px rows, so rows two and
// three span y=24 to y=64, and the widget root starts at y=70. 24 - 70 = -46.
const SLOT_BAND_H = 40;
const CLASSIC_BAND_TOP = -46;
const BAND_INSET = 7;
const LABEL_RESERVE = 58;

// Portrait = taller than wide; Landscape = wider than tall. Exact swatch px
// from user spec.
const ORIENT_SHAPE = { portrait: [7, 13], landscape: [13, 7] };

let _cssDone = false;

export function injectCSS() {
  if (_cssDone) return;
  _cssDone = true;
  const style = document.createElement("style");
  style.id = "pix-vs-css";
  style.textContent = `
    .pix-vs-root {
      position: relative;
      display: flex; flex-direction: column; gap: ${GAP}px;
      padding: ${PAD}px; box-sizing: border-box; width: 100%;
      font-family: inherit; user-select: none;
    }
    .pix-vs-band {
      display: flex; align-items: center; justify-content: flex-start; gap: 6px;
      box-sizing: border-box; height: ${SLOT_BAND_H}px;
      padding-left: ${BAND_INSET}px; padding-right: ${LABEL_RESERVE}px;
      background: transparent; pointer-events: none;
    }
    .pix-vs-band > * { pointer-events: auto; }
    .pix-vs-band.classic {
      position: absolute; left: 0; right: 0; top: ${CLASSIC_BAND_TOP}px;
    }
    .pix-vs-band.parked {
      position: absolute; inset: 0; height: auto;
    }

    .pix-vs-orient {
      display: flex; gap: 4px; flex: 1 1 auto; min-width: 0;
    }
    .pix-vs-gear {
      flex: none; width: 20px; height: 20px; padding: 0; margin: 0;
      display: flex; align-items: center; justify-content: center;
      background: none; border: none; cursor: pointer;
    }
    .pix-vs-gear::before {
      content: ""; display: block; width: 14px; height: 14px; background: #bbb;
      -webkit-mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
      mask: url("${pixAsset("icons/note/gear.svg")}") center/contain no-repeat;
    }
    .pix-vs-gear:hover::before { background: ${ACC}; }

    /* Duration Pixaroma readout style */
    .pix-dur-readout {
      min-height: ${READOUT_H}px; display: flex; align-items: center; gap: 5px;
      font-size: 11px; color: ${ACC}; white-space: nowrap; overflow: hidden;
      text-overflow: ellipsis;
    }
    .pix-dur-readout .dim { color: rgba(255,255,255,0.42); }

    .pix-vs-row { display: flex; gap: ${GAP}px; flex: none; }
    .pix-vs-chip, .pix-vs-pill {
      flex: 1 1 0; min-width: 0; box-sizing: border-box;
      display: flex; align-items: center; justify-content: center; gap: 4px;
      background: #1d1d1d; border: 1px solid #444; border-radius: 4px;
      color: #bbb; font-family: inherit; cursor: pointer; padding: 0 2px;
      white-space: nowrap; overflow: hidden;
    }
    .pix-vs-chip { height: ${TAB_H}px; font-size: 11px; }
    .pix-vs-pill { height: ${TAB_H}px; font-size: 11px; }
    .pix-vs-chip:hover, .pix-vs-pill:hover { border-color: ${ACC}; color: #ddd; }
    .pix-vs-chip.on, .pix-vs-chip.on:hover,
    .pix-vs-pill.on, .pix-vs-pill.on:hover {
      background: ${ACC}; border-color: ${ACC}; color: #fff;
    }
    /* ratio swatch, copied from Longest Side .pix-ls-shape */
    .pix-vs-shape {
      flex: none; box-sizing: border-box;
      border: 1px solid #999; border-radius: 1px;
    }
    .pix-vs-pill:hover .pix-vs-shape { border-color: #ddd; }
    .pix-vs-pill.on .pix-vs-shape { border-color: #fff; }
    .pix-vs-label { overflow: hidden; text-overflow: ellipsis; }
  `;
  document.head.appendChild(style);
}

function buildRows(node, sizeRow, orientContainer, refresh) {
  const st = readState(node);

  sizeRow.textContent = "";
  VIDEO_PRESETS.forEach(([label], i) => {
    const b = document.createElement("button");
    b.className = "pix-vs-chip" + (i === st.selected ? " on" : "");
    b.dataset.idx = String(i);
    b.title = `${label} — ${VIDEO_PRESETS[i][1]} × ${VIDEO_PRESETS[i][2]} (16:9)`;
    b.textContent = label;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { ...readState(node), selected: i });
      refresh();
      node.graph?.setDirtyCanvas?.(true, true);
    });
    sizeRow.appendChild(b);
  });

  orientContainer.textContent = "";
  for (const [o, label] of [["portrait", "Portrait"], ["landscape", "Landscape"]]) {
    const b = document.createElement("button");
    b.className = "pix-vs-pill" + (st.orientation === o ? " on" : "");
    b.dataset.o = o;
    b.title = o === "portrait" ? "Taller than wide" : "Wider than tall";

    const sw = document.createElement("span");
    sw.className = "pix-vs-shape";
    sw.style.width = `${ORIENT_SHAPE[o][0]}px`;
    sw.style.height = `${ORIENT_SHAPE[o][1]}px`;

    const lab = document.createElement("span");
    lab.className = "pix-vs-label";
    lab.textContent = label;

    b.append(sw, lab);
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      writeState(node, { ...readState(node), orientation: o });
      refresh();
      node.graph?.setDirtyCanvas?.(true, true);
    });
    orientContainer.appendChild(b);
  }
}

export function buildFace(node, { onGear }) {
  injectCSS();

  const root = document.createElement("div");
  root.className = "pix-vs-root";

  const band = document.createElement("div");
  band.className = "pix-vs-band";

  const orient = document.createElement("div");
  orient.className = "pix-vs-orient";

  const gear = document.createElement("button");
  gear.className = "pix-vs-gear";
  gear.title = "Video Sizes settings";
  gear.addEventListener("click", (e) => { e.stopPropagation(); onGear?.(node); });

  band.append(orient, gear);

  const sizeRow = document.createElement("div");
  sizeRow.className = "pix-vs-row pix-vs-sizes";

  const readout = document.createElement("div");
  readout.className = "pix-dur-readout";

  root.append(sizeRow, readout);

  function refresh() {
    const st = readState(node);
    const r = fmtReadout(st);
    // Safe: r.label is from our own fixed VIDEO_PRESETS list, r.w/r.h are
    // integers. No user or external input. Mirrors Duration Pixaroma readout.
    readout.innerHTML =
      `<span>${r.label}</span><span class="dim">[really ${r.w} x ${r.h}]</span>`;
    buildRows(node, sizeRow, orient, refresh);
  }

  refresh();
  return { root, band, refresh };
}
