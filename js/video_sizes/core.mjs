// Video Sizes ETERNAL - shared state + helpers (imported by index.js and settings.mjs).
//
// Adapted from Pixaroma Sizes (core.mjs): state lives on
// node.properties.videoSizesState (LiteGraph serializes it natively) and is
// injected into the hidden VideoSizesState input by the graphToPrompt hook in
// index.js. JS computes the final oriented + snapped width and height and stores
// them as state.w / state.h so Python just reads them back.
//
// Difference from Sizes: the preset list is a FIXED set of video p-names
// (360p..1080p) rather than a user-editable free list. No add/remove/reorder.

import { app } from "/scripts/app.js";
import { globalAccent } from "../shared/node_settings.mjs";

export const BRAND = "#f66744";
export const STATE_PROP = "videoSizesState";
export const HIDDEN_INPUT = "VideoSizesState"; // matches the Python INPUT_TYPES key
export const ACCENT_SETTING = "ETERNAL.VideoSizes.AccentColor";

// p-label -> [width, height] at 16:9. snap rounds each at send time.
export const VIDEO_PRESETS = [
  ["360p", 608, 352],
  ["480p", 864, 480],
  ["540p", 960, 544],
  ["576p", 1056, 608],
  ["720p", 1280, 736],
  ["768p", 1344, 768],
  ["1080p", 1920, 1088],
];

export const SNAP_OPTIONS = [0, 8, 16, 32, 64];

export const DEFAULT_STATE = {
  version: 1,
  selected: 4,            // 720p
  orientation: "landscape", // "portrait" | "landscape"
  snap: 32,               // 0 = off; else 8 / 16 / 32 / 64
  accent: null,
  w: 1280,
  h: 736,
};

function clampDim(n) {
  return Math.max(64, Math.min(16384, Math.round(n)));
}

export function snapDim(n, step) {
  if (!step) return Math.round(n);
  return Math.round(n / step) * step;
}

// Orientation forces which of the two numbers is width vs height: portrait =
// taller (min, max), landscape = wider (max, min).
export function orient(pair, orientation) {
  const a = Number(pair?.[0]) || 0;
  const b = Number(pair?.[1]) || 0;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  return orientation === "landscape" ? [hi, lo] : [lo, hi];
}

// The [w, h] for a preset index, oriented (no snap yet).
export function presetPair(idx, orientation) {
  const i = Math.max(0, Math.min(idx, VIDEO_PRESETS.length - 1));
  return [VIDEO_PRESETS[i][1], VIDEO_PRESETS[i][2]];
}

// Final output for a state: orient the selected preset, then snap both dims.
export function finalWH(state) {
  let idx = state.selected | 0;
  if (idx < 0 || idx >= VIDEO_PRESETS.length) idx = 0;
  let [w, h] = orient([VIDEO_PRESETS[idx][1], VIDEO_PRESETS[idx][2]], state.orientation);
  w = clampDim(snapDim(w, state.snap));
  h = clampDim(snapDim(h, state.snap));
  return [w, h];
}

// Format the selected preset for the on-node readout (oriented + snapped).
export function fmtReadout(state) {
  let idx = state.selected | 0;
  if (idx < 0 || idx >= VIDEO_PRESETS.length) idx = 0;
  let [w, h] = orient([VIDEO_PRESETS[idx][1], VIDEO_PRESETS[idx][2]], state.orientation);
  w = clampDim(snapDim(w, state.snap));
  h = clampDim(snapDim(h, state.snap));
  return { label: VIDEO_PRESETS[idx][0], w, h, text: `${VIDEO_PRESETS[idx][0]} · ${w} × ${h}` };
}

export function readState(node) {
  const v = node.properties?.[STATE_PROP];
  if (typeof v === "string" && v) {
    try {
      const parsed = JSON.parse(v);
      const st = { ...DEFAULT_STATE, ...parsed };
      if (st.selected < 0 || st.selected >= VIDEO_PRESETS.length) st.selected = 0;
      if (st.orientation !== "landscape") st.orientation = "portrait";
      if (!SNAP_OPTIONS.includes(st.snap)) st.snap = 32;
      const [w, h] = finalWH(st);
      st.w = w; st.h = h;
      return st;
    } catch { /* fall through to default */ }
  }
  return { ...DEFAULT_STATE, w: 1280, h: 736 };
}

// Merge + normalize + recompute the final w/h, then persist.
export function writeState(node, state) {
  if (!node.properties) node.properties = {};
  const st = { ...DEFAULT_STATE, ...state };
  if (st.selected < 0 || st.selected >= VIDEO_PRESETS.length) st.selected = 0;
  if (st.orientation !== "landscape") st.orientation = "portrait";
  if (!SNAP_OPTIONS.includes(st.snap)) st.snap = 32;
  const [w, h] = finalWH(st);
  st.w = w; st.h = h;
  node.properties[STATE_PROP] = JSON.stringify(st);
  return st;
}

export function accentOf(node) {
  const st = readState(node);
  if (st.accent) return st.accent;
  try {
    const g = app.ui?.settings?.getSettingValue(ACCENT_SETTING);
    if (g) return g;
  } catch { /* ignore */ }
  return globalAccent() || BRAND;
}
