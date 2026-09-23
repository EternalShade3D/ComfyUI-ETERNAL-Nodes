// Panorama 360 Viewer — ETERNAL pack frontend.
//
// Ported from pavel-zinchenko/comfyui-360-viewer (MIT, Copyright (c) 2026
// pavel-zinchenko) — see THIRD_PARTY_NOTICES.md at the pack root.
// The viewing maths (inverted sphere, lon/lat orbit, fov zoom) is unchanged.
//
// ── Styling follows the pack, not a fresh design ────────────────────────────
//   Tokens taken from Save 3D Pixaroma (js/save_3d/ui.mjs): 11px ui-sans-serif
//   chrome, #1d1d1d / rgba(0,0,0,.55) surfaces, 1px #444 borders, 4px radius on
//   small controls, hover = accent border (convention #13), our own dark popups,
//   never a native <select> (#14), SVG icons instead of text glyphs (#28), and the
//   viewport box = #262626 face + 1px #444 border + 4px radius.
//
// ── Sizing across BOTH renderers (Classic/LiteGraph and Nodes 2.0/Vue) ──────
//   They are not the same, and the pack documents why:
//     * Nodes 2.0 CSS-scales the whole node with the graph zoom. A WebGL canvas has
//       a FIXED backing store, so a plain devicePixelRatio render goes blurry when
//       the user zooms in. canvasBackingScale() sizes the backing store at
//       dpr x zoom (shared/nodes2.mjs) and installZoomRepaint() repaints when the
//       zoom changes, because a ResizeObserver never fires for a pure zoom change.
//     * canvasOnly: true keeps a widget out of the legacy Parameters tab, BUT in
//       Nodes 2.0 `shouldRenderAsVue = !canvasOnly` drops the widget from the node
//       body entirely (empty node). applyAdaptiveCanvasOnly() makes the flag a live
//       getter so it is right in both. Required, or this node has no viewer in
//       Nodes 2.0.
//     * Nodes 2.0 measures the node's minimum height by collapsing it, so a flex
//       widget root can spill its content under the frame mid-resize-drag.
//       installResizeFloor() pins a min-height for the duration of the gesture.
//     * The user can resize the node in both renderers. The container follows via a
//       ResizeObserver (renderer-agnostic) plus an explicit height in Classic,
//       where a DOM widget is laid out by computeSize and returning the node's own
//       height there ratchets node.size[1] down on every pass (see the warning in
//       tile_prompt_panel.js). Classic gets a written element height instead.
//
// ── Hardening on top of upstream (bug fixes only) ───────────────────────────
//   1. Pointer Events + setPointerCapture instead of window-level mousemove/mouseup.
//      Upstream added a fresh global listener set on every rebuild and never
//      removed them, so they accumulated for the life of the page.
//   2. Renderer + geometry + material + texture disposed on rebuild. Without this
//      every re-queue leaked a WebGL context (browsers cap out around 16 and then
//      the viewer silently goes black).
//   3. The animation loop stops on dispose instead of running forever per rebuild.
//   4. A CDN failure reports itself on the node instead of leaving a black box.

import { app } from "../../scripts/app.js";
import { getNodeScreenRect, placeBeside, makeDraggable, followNode } from "./shared/node_panel.mjs";
import {
  applyAdaptiveCanvasOnly,
  canvasBackingScale,
  installZoomRepaint,
  installResizeFloor,
  onRendererChange,
  isVueNodes,
  hideJsonWidget,
} from "./shared/index.mjs";

const THREE_CDN = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
const NODE_ID = "EternalViewer360";
const WIDGET_NAME = "panorama360";

// The widget's own floor. This ONE number sizes the DOM widget in BOTH renderers
// (the pack's recipe: "Nodes 2.0 sizes the body straight from getMinHeight; legacy
// refits via computeSize"). Nothing writes an explicit element height any more —
// that is what made the viewer spill out of the frame and cover its neighbours.
// The face instead fills whatever it is given (position:absolute).
const VIEW_MIN_H = 250;
// Classic-only node clamps. In Nodes 2.0 the rendered size lives in the Vue layout
// store and clamping node.size desyncs the two (Save 3D notes this).
const NODE_MIN_W = 380;
const NODE_MIN_H = 280;

// Unregistered ComfyUI settings ids (same persistence model the Pixaroma panels
// use): the node keeps reading one id, only the surface moved into our panel.
const SET = {
  minFov: "ETERNAL.Viewer360.MinFov",
  maxFov: "ETERNAL.Viewer360.MaxFov",
  zoom: "ETERNAL.Viewer360.ZoomSpeed",
  drag: "ETERNAL.Viewer360.DragSpeed",
  horizon: "ETERNAL.Viewer360.HorizonGuide",
  resetOnQueue: "ETERNAL.Viewer360.ResetOnQueue",
  invertY: "ETERNAL.Viewer360.InvertVertical",
  wheel: "ETERNAL.Viewer360.WheelMode",
};

const BG = { dark: 0x111111, black: 0x000000, grey: 0x555555, light: 0xdddddd };
const BG_HEX = { dark: "#111111", black: "#000000", grey: "#555555", light: "#dddddd" };

const DEFAULTS = {
  [SET.minFov]: "30",
  [SET.maxFov]: "140",
  [SET.zoom]: "0.05",
  [SET.drag]: "0.2",
  [SET.horizon]: true,
  [SET.resetOnQueue]: false,
  [SET.invertY]: false,
  [SET.wheel]: "panorama zoom",
};

// ── settings ────────────────────────────────────────────────────────────────

function readSetting(id) {
  try {
    const v = app.ui?.settings?.getSettingValue?.(id);
    if (v !== undefined && v !== null && v !== "") return v;
  } catch (_) {}
  return DEFAULTS[id];
}

function writeSetting(id, value) {
  try {
    app.ui.settings.setSettingValueAsync(id, value);
  } catch (_) {}
}

function cfg() {
  const num = (id) => {
    const n = Number(readSetting(id));
    return Number.isFinite(n) ? n : Number(DEFAULTS[id]);
  };
  let minFov = num(SET.minFov);
  let maxFov = num(SET.maxFov);
  if (minFov >= maxFov) {
    minFov = 30;
    maxFov = 140;
  }
  return {
    minFov,
    maxFov,
    zoom: num(SET.zoom) || 0.05,
    drag: num(SET.drag) || 0.2,
    horizon: readSetting(SET.horizon) !== false,
    resetOnQueue: readSetting(SET.resetOnQueue) === true,
    invertY: readSetting(SET.invertY) === true,
    canvasWheel: String(readSetting(SET.wheel)) === "canvas zoom",
  };
}

// ── node widget access ──────────────────────────────────────────────────────

function wget(node, name, fallback) {
  const w = node?.widgets?.find((x) => x.name === name);
  return w && w.value !== undefined ? w.value : fallback;
}

function wset(node, name, value) {
  const w = node?.widgets?.find((x) => x.name === name);
  if (!w) return;
  w.value = value;
  if (w.inputEl) w.inputEl.value = String(value);
  try {
    node.setDirtyCanvas?.(true, true);
  } catch (_) {}
}

// ── icons (SVG, never text glyphs) ──────────────────────────────────────────

const ICON = {
  // A real toothed gear. The previous icon was a circle with eight spokes, which reads
  // as a brightness/sun control rather than Settings (a reviewer asked to have it
  // swapped). Path taken verbatim from Feather icons, settings.svg (MIT).
  gear:
    '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<circle cx="12" cy="12" r="3"/>' +
    '<path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  reset:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13.4 2.2v3.4H10"/></svg>',
  play:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">' +
    '<path d="M5 3.2v9.6L12.6 8z"/></svg>',
  pause:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">' +
    '<path d="M4.6 3h2.7v10H4.6zM8.7 3h2.7v10H8.7z"/></svg>',
  full:
    '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" ' +
    'stroke-width="1.8" stroke-linecap="round"><path d="M6 2.6H2.6V6M10 2.6h3.4V6' +
    'M6 13.4H2.6V10M10 13.4h3.4V10"/></svg>',
};

// ── three.js ────────────────────────────────────────────────────────────────

let threePromise = null;

function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threePromise) {
    threePromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = THREE_CDN;
      s.onload = () => resolve(window.THREE);
      s.onerror = () => {
        threePromise = null;
        reject(new Error("three.js unreachable"));
      };
      document.head.appendChild(s);
    });
  }
  return threePromise;
}

// innerHTML here only ever receives literal strings defined in this file (icons and
// fixed hints) — never filenames, graph values or user input, so no injection surface.
function placeholder(container, html, bad) {
  container.innerHTML = '<div class="p360-msg' + (bad ? " bad" : "") + '">' + html + "</div>";
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ── the viewer ──────────────────────────────────────────────────────────────

function buildViewer(container, vp, imageUrl, node) {
  container._dispose360?.();
  // Only the sphere and its chip live inside the viewport; the control band above it
  // is built once by buildFace and survives every re-queue.
  for (const old of vp.querySelectorAll(".p360-chip")) old.remove();

  const THREE = window.THREE;
  const conf = cfg();
  const w = vp.clientWidth || 400;
  const h = vp.clientHeight || 300;

  const bgName = String(wget(node, "background", "dark") || "dark");

  // A widget value with a real fallback: a blank widget must never become NaN and
  // blank the view (the same failure the server rejected as "couldn't be converted").
  const num = (name, def) => {
    const v = Number(wget(node, name, def));
    return Number.isFinite(v) ? v : def;
  };

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(
    clamp(Number(wget(node, "fov", 100)) || 100, conf.minFov, conf.maxFov),
    w / h,
    0.1,
    1000
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(canvasBackingScale(w, h));
  renderer.setSize(w, h);
  renderer.domElement.style.cssText =
    "position:absolute;inset:0;display:block;width:100%;height:100%;touch-action:none;cursor:grab;";
  vp.appendChild(renderer.domElement);

  // ── colour management ──────────────────────────────────────────────────────
  // three.js r128. Without an explicit sRGB pair the file's raw values are drawn
  // while the browser treats the canvas as sRGB, so the panorama reads darker or
  // brighter than the file it came from. Decoding the texture as sRGB and encoding
  // the output back to sRGB makes the round trip an identity, and tone-mapping
  // exposure on top of it is a real brightness control (PSV and Pannellum ship one).
  const SRGB = THREE.sRGBEncoding;
  if (SRGB !== undefined && "outputEncoding" in renderer) renderer.outputEncoding = SRGB;
  if ("toneMapping" in renderer) renderer.toneMapping = THREE.LinearToneMapping;

  // Camera height (Z): a TRANSLATION of the viewpoint along the vertical axis, not a
  // rotation. Pitch tilts the gaze; this moves where the eye actually sits, so the
  // horizon sits above or below the middle of the view and the floor reads as being
  // under you rather than wrapped around you. krpano exposes the same thing as
  // view.ty. Moving the eye off-centre does distort the projection towards the poles
  // (inherent to leaving a sphere's centre), which is why the range stops at half the
  // radius instead of running to the edge.
  const R360 = 500;
  const geo = new THREE.SphereGeometry(R360, 60, 40);
  geo.scale(-1, 1, 1); // viewed from the inside
  const mat = new THREE.MeshBasicMaterial();
  const sphere = new THREE.Mesh(geo, mat);
  scene.add(sphere);

  const tex = new THREE.TextureLoader().load(
    imageUrl,
    (t) => {
      if (SRGB !== undefined && "encoding" in t) t.encoding = SRGB;
      mat.map = t;
      mat.needsUpdate = true;
      delete vp.dataset.p360error;
    },
    undefined,
    () => {
      // Never fail silently: without this the sphere simply stayed dark and there was
      // nothing on screen (or in the log) to say why.
      vp.dataset.p360error = imageUrl;
      placeholder(
        vp,
        "The preview image could not be loaded.<br>URL: " +
          imageUrl.replace(/&/g, "&amp;").replace(/</g, "&lt;"),
        true
      );
    }
  );
  vp.dataset.p360url = imageUrl;

  // Horizon guide: the equator, a level line for judging a tilted panorama.
  const ringGeo = new THREE.BufferGeometry();
  {
    const pts = [];
    for (let i = 0; i <= 96; i++) {
      const a = (i / 96) * Math.PI * 2;
      pts.push(new THREE.Vector3(Math.cos(a) * 480, 0, Math.sin(a) * 480));
    }
    ringGeo.setFromPoints(pts);
  }
  const ringMat = new THREE.LineBasicMaterial({ color: 0x8fe3b0, transparent: true, opacity: 0.45 });
  const ring = new THREE.Line(ringGeo, ringMat);
  ring.visible = conf.horizon;
  scene.add(ring);

  let alive = true;

  // ── POV: where the view opens ──────────────────────────────────────────────
  // The opening gaze (yaw + pitch, what Pannellum and Photo Sphere Viewer call the
  // "initial view") plus the camera HEIGHT on the vertical axis. Upstream hardcoded
  // lon = 180 / lat = 0, so every panorama opened on the MIDDLE of the image with no
  // way to correct it, and the eye sat dead centre with no way to move it.
  const pov = () => ({
    yaw: clamp(num("start_yaw", 180), 0, 360),
    pitch: clamp(num("start_pitch", 0), -90, 90),
    // z_offset is in PERCENT of the sphere radius: 10 = the eye sits a tenth of the
    // way out of the centre, along the vertical axis. The range runs to 99 because the
    // eye must stay INSIDE the sphere: at 100 it would sit on the surface itself.
    z: clamp(num("z_offset", 0), -99, 99),
  });
  let lon = pov().yaw;
  let lat = pov().pitch;
  let dragging = false;
  let pid = null;
  let ox = 0;
  let oy = 0;
  let auto = Number(wget(node, "auto_rotate", 0)) || 0;
  let lastT = performance.now();
  let saveT = null;

  const el = renderer.domElement;

  const paintBg = (name) => {
    const hex = BG_HEX[name] || BG_HEX.dark;
    vp.style.background = hex;
    scene.background = new THREE.Color(BG[name] !== undefined ? BG[name] : BG.dark);
  };
  paintBg(bgName);

  const readout = document.createElement("div");
  readout.className = "p360-chip";
  vp.appendChild(readout);

  const paintReadout = () => {
    const horiz = (
      2 *
      THREE.MathUtils.radToDeg(
        Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * camera.aspect)
      )
    ).toFixed(0);
    readout.textContent =
      "fov " + camera.fov.toFixed(0) + "° (" + horiz + "° wide)" + (auto > 0 ? " · auto " + auto + "°/s" : "");
    container._face?.sync?.(); // the band's fov box follows the live camera
  };

  const applyExposure = () => {
    const e = clamp(num("exposure", 1), 0.2, 3);
    if ("toneMappingExposure" in renderer) renderer.toneMappingExposure = e;
  };

  // --- two independent transforms ---------------------------------------------
  // The opening GAZE (yaw + pitch) and the camera HEIGHT (z) are separate transforms
  // and must stay separate. They used to be one function, so dragging the Height slider
  // re-applied the gaze as well and the view snapped back to the start angle every time
  // you moved the eye up or down. Height moves the sphere; the gaze moves the look
  // direction; neither touches the other.
  const applyView = () => {
    const p = pov();
    lon = p.yaw;
    lat = p.pitch;
  };

  const applyHeight = () => {
    const p = pov();
    // The eye rises, so the sphere drops: the horizon sinks out of the way and you look
    // around from a higher (or lower) vantage point instead of from the sphere's centre.
    const dy = (-p.z / 100) * R360;
    sphere.position.y = dy;
    ring.position.y = dy; // the level guide tracks the panorama's own horizon
  };

  const resetView = () => {
    const c = cfg();
    const p = pov();
    lon = p.yaw;
    lat = p.pitch;
    camera.fov = clamp(num("fov", 100), c.minFov, c.maxFov);
    camera.updateProjectionMatrix();
    applyExposure();
    applyPov();
    paintReadout();
  };

  // The controls (zoom stepper, Auto switch, reset / fullscreen / gear) live in the
  // face band that buildFace() drew above this viewport — nothing is duplicated here.

  el.addEventListener("pointerdown", (e) => {
    dragging = true;
    pid = e.pointerId;
    ox = e.clientX;
    oy = e.clientY;
    try {
      el.setPointerCapture(pid);
    } catch (_) {}
    el.style.cursor = "grabbing";
    e.stopPropagation();
  });

  el.addEventListener("pointermove", (e) => {
    if (!dragging || e.pointerId !== pid) return;
    const c = cfg();
    lon -= (e.clientX - ox) * c.drag;
    lat += (e.clientY - oy) * c.drag * (c.invertY ? -1 : 1);
    lat = clamp(lat, -85, 85);
    ox = e.clientX;
    oy = e.clientY;
  });

  const endDrag = (e) => {
    if (pid !== null && e.pointerId !== pid) return;
    dragging = false;
    el.style.cursor = "grab";
    if (pid !== null) {
      try {
        el.releasePointerCapture(pid);
      } catch (_) {}
    }
    pid = null;
  };
  el.addEventListener("pointerup", endDrag);
  el.addEventListener("pointercancel", endDrag);

  el.addEventListener(
    "wheel",
    (e) => {
      const c = cfg();
      // The wheel zooms the PANORAMA by default. With the "canvas zoom" setting the
      // event is handed to the graph instead, so the node never traps the canvas
      // (convention #17); Shift+wheel always zooms the panorama.
      if (c.canvasWheel && !e.shiftKey) {
        e.preventDefault();
        e.stopPropagation();
        app.canvas?.processMouseWheel?.(e);
        return;
      }
      camera.fov = clamp(camera.fov + e.deltaY * c.zoom, c.minFov, c.maxFov);
      camera.updateProjectionMatrix();
      paintReadout();
      // paintReadout refreshes the chip; sync() is what moves the node's own zoom
      // slider. Without it the slider kept the old value while the wheel zoomed.
      sync();
      // Write the framed fov back into the node, debounced: the view you framed is
      // the view the workflow saves, without a graph write per wheel tick.
      clearTimeout(saveT);
      saveT = setTimeout(() => wset(node, "fov", Math.round(camera.fov)), 500);
      e.stopPropagation();
      e.preventDefault();
    },
    { passive: false }
  );

  container._resize360 = () => {
    // In fullscreen the element fills the screen and the graph zoom no longer scales
    // it, so the box to measure is the fullscreen element itself and the pixel ratio is
    // the device's own: oversampling by the graph zoom there would only cost VRAM.
    const fs = document.fullscreenElement;
    const box = fs || container;
    const nw = box.clientWidth;
    const nh = box.clientHeight;
    if (nw < 10 || nh < 10) return;
    renderer.setPixelRatio(fs ? window.devicePixelRatio || 1 : canvasBackingScale(nw, nh));
    renderer.setSize(nw, nh);
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    paintReadout();
  };

  // The fullscreen element's box is only final a frame or two after the event, so
  // re-fit across a few frames instead of trusting the first one (which is what made
  // the view stay the wrong size until the window was resized by hand).
  const fsHandler = () => {
    requestAnimationFrame(() => container._resize360?.());
    setTimeout(() => container._resize360?.(), 150);
    setTimeout(() => container._resize360?.(), 400);
  };
  document.addEventListener("fullscreenchange", fsHandler);

  container._dispose360 = () => {
    alive = false;
    clearTimeout(saveT);
    document.removeEventListener("fullscreenchange", fsHandler);
    container._resize360 = null;
    container._dispose360 = null;
    container._v360 = null;
    try {
      tex.dispose();
      geo.dispose();
      mat.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      renderer.dispose();
    } catch (_) {}
    el.remove?.();
  };

  // Live control surface for the settings panel.
  container._v360 = {
    getFov: () => camera.fov,
    setFov: (v) => {
      const c = cfg();
      camera.fov = clamp(Number(v) || 100, c.minFov, c.maxFov);
      camera.updateProjectionMatrix();
      paintReadout();
    },
    reset: resetView,
    // Used by installZoomRepaint: a graph zoom re-sizes the backing store, nothing else.
    repaint: () => {
      container._resize360?.();
      paintReadout();
    },
    // Re-reads only the widgets that change how the sphere LOOKS, and deliberately
    // leaves the view exactly where it is. The auto-rotate toggle, the background and
    // the exposure all call this, and none of them may move the camera: applying the
    // POV here is what made switching Auto off snap the view back to the start angle
    // instead of simply stopping the drift.
    refresh: () => {
      const c = cfg();
      ring.visible = c.horizon;
      auto = Number(wget(node, "auto_rotate", 0)) || 0;
      paintBg(String(wget(node, "background", "dark") || "dark"));
      applyExposure();
      paintReadout();
    },
    // A row that moves the gaze must not touch the height, and vice versa.
    applyView,
    applyHeight,
    // Both at once: building the view, resetting it, and a graph re-run.
    applyPov: () => {
      applyView();
      applyHeight();
    },
  };

  if (conf.resetOnQueue) resetView();
  paintReadout();

  (function loop() {
    if (!alive) return;
    requestAnimationFrame(loop);
    const now = performance.now();
    const dt = Math.min((now - lastT) / 1000, 0.25);
    lastT = now;
    if (auto > 0 && !dragging) {
      lon += auto * dt;
      if (lon > 360) lon -= 360;
    }
    const phi = THREE.MathUtils.degToRad(90 - lat);
    const theta = THREE.MathUtils.degToRad(lon);
    camera.lookAt(
      Math.sin(phi) * Math.cos(theta),
      Math.cos(phi),
      Math.sin(phi) * Math.sin(theta)
    );
    renderer.render(scene, camera);
  })();
}

// ── the node face: every control drawn by us (the Pixaroma pattern) ─────────
//
// ComfyUI renders the Python schema's INT/FLOAT/COMBO inputs as ITS OWN widgets,
// and no stylesheet of ours can reach those — which is why this node looked nothing
// like the rest of the pack. They are hidden with hideJsonWidget() (hidden in BOTH
// renderers, still serialized into the workflow, still validated server-side) and
// re-drawn here in the pack's control language:
//   26px controls, #1d1d1d on a 1px #444 border with a 4px radius, accent on hover,
//   a stepper for the numeric value and the pack's 24x13 pill switch for the toggle.
function buildFace(node, container) {
  // MUST run here, not only from openPanel(): the face is built at node creation, and
  // while the stylesheet was injected only when the settings panel opened, every node
  // on a fresh page rendered with NO styles (default browser buttons, scattered) until
  // the user happened to open the panel once.
  injectCSS();

  const face = document.createElement("div");
  face.className = "p360-face";

  const band = document.createElement("div");
  band.className = "p360-band";

  const vp = document.createElement("div");
  vp.className = "p360-vp";

  let lastAuto = 8; // remembered so toggling Auto back on restores the speed you had
  // Set once the quick sliders exist. sync() calls this, so anything that changes the
  // camera through sync() (the wheel above all) also moves the sliders on the node.
  let qPump = null;

  const readFov = () => {
    const f = Number(wget(node, "fov", 100));
    return Number.isFinite(f) ? f : 100;
  };

  const sync = () => {
    const live = container._v360?.getFov?.();
    const f = Number.isFinite(live) ? live : readFov();
    val.textContent = fmtFov(f);
    qPump?.();
    const on = (Number(wget(node, "auto_rotate", 0)) || 0) > 0;
    sw.classList.toggle("on", on);
  };

  const applyFov = (v) => {
    const c = cfg();
    const f = clamp(Math.round(v), c.minFov, c.maxFov);
    wset(node, "fov", f);
    container._v360?.setFov(f);
    sync();
  };

  const bMinus = mk("button", "p360-step", "\u2212");
  bMinus.type = "button";
  bMinus.title = "Zoom out: wider field of view";
  bMinus.addEventListener("click", (e) => {
    e.stopPropagation();
    applyFov(readFov() + 5);
  });

  const val = mk("div", "p360-val", "");
  val.title =
    "Zoom: field of view in degrees, or 35 mm-equivalent focal length. Click for the full settings panel.";
  val.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel(node);
  });

  const bPlus = mk("button", "p360-step", "+");
  bPlus.type = "button";
  bPlus.title = "Zoom in: narrower field of view";
  bPlus.addEventListener("click", (e) => {
    e.stopPropagation();
    applyFov(readFov() - 5);
  });

  const sw = mk("button", "p360-sw", "");
  sw.type = "button";
  sw.title = "Auto-rotate: drift the view on its own";
  sw.innerHTML = "<i></i>Auto";
  sw.addEventListener("click", (e) => {
    e.stopPropagation();
    const on = (Number(wget(node, "auto_rotate", 0)) || 0) > 0;
    if (on) {
      lastAuto = Number(wget(node, "auto_rotate", 0)) || 8;
      wset(node, "auto_rotate", 0);
    } else {
      wset(node, "auto_rotate", lastAuto || 8);
    }
    container._v360?.refresh();
    sync();
  });

  const ib = (icon, title, onClick) => {
    const b = mk("button", "p360-ib");
    b.type = "button";
    b.title = title;
    b.innerHTML = icon;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      onClick();
    });
    return b;
  };

  const group = mk("div", "p360-grow");

  // A LABELLED Settings button, deliberately visible on the node face with no run
  // needed. The previous build only had a gear inside the WebGL view, so before the
  // first queue there was no viewer and therefore no gear — the only way in was the
  // right-click menu. Styled like the pack's Save button: accent text, fills on hover.
  const bSet = mk("button", "p360-set");
  bSet.type = "button";
  bSet.title = "Panorama 360 Viewer settings (zoom range, drag, horizon, background)";
  bSet.innerHTML = ICON.gear + "<span>Settings</span>";
  bSet.addEventListener("click", (e) => {
    e.stopPropagation();
    togglePanel(node);
  });

  group.append(
    ib(ICON.reset, "Reset view: back to the centre, at the node's fov", () => container._v360?.reset()),
    ib(ICON.full, "Fullscreen", (e) => {
      // Fullscreen the WIDGET HOST and not the viewport inside it. The renderer is
      // sized from the host's client box, so fullscreening the inner element left the
      // canvas at node size inside a fullscreen box: the screen went black.
      e?.stopPropagation?.();
      try {
        if (document.fullscreenElement) {
          document.exitFullscreen?.()?.catch?.(() => {});
        } else {
          container.requestFullscreen?.({ navigationUI: "hide" })?.catch?.(() => {});
        }
      } catch (_) {
        // A browser that refuses fullscreen must not take the click down with it.
      }
    }),
    bSet
  );

  // --- quick controls, ON the node -------------------------------------------
  // Zoom, drift speed and camera height: the three you touch constantly while
  // exploring a panorama. All three are node widgets, so they save with the workflow.
  // Zoom can read in degrees or in 35 mm-equivalent focal length. The camera's fov is
  // its VERTICAL field of view, so the mm figure comes from the vertical sensor height
  // (24 mm) rather than the 36 mm width: f = (24/2) / tan(fov/2). The unit is a display
  // choice only and never moves the view.
  const qRow = document.createElement("div");
  qRow.className = "p360-q";

  let unit = node.properties?.p360Unit === "mm" ? "mm" : "deg";
  const focalFromFov = (f) => 12 / Math.tan((clamp(f, 1, 179) * Math.PI) / 360);
  const fmtFov = (f) =>
    unit === "mm" ? focalFromFov(f).toFixed(1) + "mm" : f.toFixed(0) + "°";

  const qSlider = (title, name, min, max, step, apply) => {
    const wrap = document.createElement("div");
    wrap.className = "p360-qs";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = title;
    const inp = document.createElement("input");
    inp.type = "range";
    inp.min = String(min);
    inp.max = String(max);
    inp.step = String(step);
    const cur = Number(wget(node, name, min));
    inp.value = String(clamp(Number.isFinite(cur) ? cur : min, min, max));
    inp.title = title;
    // The graph listens for drags on its own canvas: a slider drag must not pan the node.
    inp.addEventListener("pointerdown", (ev) => ev.stopPropagation());
    const n = document.createElement("div");
    n.className = "n";
    const show = () => {
      const v = Number(inp.value);
      // Every readout carries its unit, so no number on the node is a guess: degrees or
      // mm for the zoom, degrees per second for the drift, percent of the sphere radius
      // for the height.
      n.textContent =
        name === "fov"
          ? fmtFov(v)
          : name === "auto_rotate"
            ? v + "°/s"
            : name === "z_offset"
              ? v + "%"
              : String(v);
    };
    inp.addEventListener("input", (ev) => {
      ev.stopPropagation();
      wset(node, name, Number(inp.value));
      apply(Number(inp.value));
      show();
    });
    show();
    const hd = document.createElement("div");
    hd.className = "hd";
    hd.append(t, n);
    wrap.append(hd, inp);
    return { wrap, input: inp, show };
  };

  const qFov = qSlider("Zoom", "fov", 30, 140, 1, (v) => {
    container._v360?.setFov(v);
    sync();
  });
  const qAuto = qSlider("Spin", "auto_rotate", 0, 60, 1, () => {
    // refresh() re-reads the drift speed and never moves the camera.
    container._v360?.refresh();
    sync();
  });
  const qZ = qSlider("Height", "z_offset", -99, 99, 1, () => container._v360?.applyHeight());

  qPump = () => {
    // The live camera is the truth here, not the widget: the wheel debounces its write
    // into the widget, so reading the widget would leave the slider a moment behind.
    const live = container._v360?.getFov?.();
    const zf = Number.isFinite(live) ? live : Number(wget(node, "fov", readFov()));
    if (Number.isFinite(zf)) {
      qFov.input.value = String(clamp(Math.round(zf), 30, 140));
      qFov.show();
    }
    const za = Number(wget(node, "auto_rotate", 0));
    if (Number.isFinite(za)) {
      qAuto.input.value = String(clamp(Math.round(za), 0, 60));
      qAuto.show();
    }
    const zz = Number(wget(node, "z_offset", 0));
    if (Number.isFinite(zz)) {
      qZ.input.value = String(clamp(Math.round(zz), -99, 99));
      qZ.show();
    }
  };

  const unitBtn = mk("button", "p360-unit", unit === "mm" ? "mm" : "° FOV");
  unitBtn.type = "button";
  unitBtn.title =
    "What the Zoom slider reads. ° FOV is the field of view in degrees; mm is the " +
    "35 mm-equivalent focal length (derived from the vertical field of view). Switching only " +
    "changes the numbers, never the view.";
  unitBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    unit = unit === "mm" ? "deg" : "mm";
    unitBtn.textContent = unit === "mm" ? "mm" : "° FOV";
    node.properties = node.properties || {};
    node.properties.p360Unit = unit;
    qFov.show();
    sync();
  });

  // The unit toggle belongs to the ZOOM control, so it sits in that control's header.
  // Left at the end of the row it read as if it belonged to whichever slider happened to
  // be last (the Height control), which is a placement rule broken, not a preference.
  const zoomHead = qFov.wrap.querySelector(".hd");
  if (zoomHead) zoomHead.insertBefore(unitBtn, zoomHead.querySelector(".n"));

  qRow.append(qFov.wrap, qAuto.wrap, qZ.wrap);

  band.append(bMinus, val, bPlus, sw, group);
  face.append(band, qRow, vp);
  container.appendChild(face);

  container._face = { sync, vp };
  sync();
  return vp;
}

// ── settings panel (Save 3D Pixaroma pattern) ───────────────────────────────

const CSS_ID = "eternal-p360-css";
let _panel = null;
let _panelNode = null;
let _stopFollow = null;
let _userMoved = false;

function injectCSS() {
  if (document.getElementById(CSS_ID)) return;
  const s = document.createElement("style");
  s.id = CSS_ID;
  s.textContent = `
    /* The node face is fully drawn by us (Pixaroma pattern): the native ComfyUI
       widgets for fov/auto_rotate/background/frame_index are HIDDEN with
       hideJsonWidget(), so nothing stock-styled is left in the body. */
    .p360-face { position:absolute; inset:0; display:flex; flex-direction:column; gap:7px;
      box-sizing:border-box; padding:4px 7px 7px; color:#ddd;
      font:12.5px ui-sans-serif,system-ui,sans-serif; overflow:hidden; }
    .p360-face > * { flex-shrink:0; }
    .p360-band { display:flex; align-items:center; gap:6px; }

    /* Quick controls: the three things you touch while looking around, on the node
       itself (zoom, drift speed, camera height), all bound to node widgets so they
       save with the workflow. */
    .p360-q { display:flex; align-items:flex-end; gap:10px; }
    .p360-qs { flex:1 1 0; min-width:0; display:flex; flex-direction:column; gap:2px; }
    .p360-qs .hd { display:flex; align-items:baseline; justify-content:space-between;
      gap:6px; }
    .p360-qs .hd .t { color:#8a8a8a; font-size:11.5px; }
    .p360-qs .hd .n { color:#ddd; font-variant-numeric:tabular-nums; margin-left:auto; }
    /* The track used to be left to the browser, whose unfilled half came out nearly
       black on this dark surface. Both halves are drawn here so the control reads as a
       slider and not as a line of text. */
    .p360-qs input[type=range] { -webkit-appearance:none; appearance:none; width:100%;
      min-width:0; height:20px; margin:0; background:transparent; cursor:pointer; }
    .p360-qs input[type=range]::-webkit-slider-runnable-track { height:6px; border-radius:3px;
      background:#3c3c48; border:1px solid #4a4a58; box-sizing:border-box; }
    .p360-qs input[type=range]::-webkit-slider-thumb { -webkit-appearance:none; appearance:none;
      width:16px; height:16px; margin-top:-5px; border-radius:50%; background:#8b6cf5;
      border:1px solid #b3a3ff; box-shadow:0 1px 3px rgba(0,0,0,.55); }
    .p360-qs input[type=range]:hover::-webkit-slider-thumb { background:#9d83ff; }
    .p360-qs input[type=range]::-moz-range-track { height:6px; border-radius:3px;
      background:#3c3c48; border:1px solid #4a4a58; box-sizing:border-box; }
    .p360-qs input[type=range]::-moz-range-thumb { width:16px; height:16px; border-radius:50%;
      background:#8b6cf5; border:1px solid #b3a3ff; }
    .p360-unit { width:62px; height:24px; flex:0 0 auto; box-sizing:border-box; margin:0;
      padding:0; background:#1d1d1d; border:1px solid #444; border-radius:4px; color:#aaa;
      cursor:pointer; font:600 11.5px ui-sans-serif,system-ui,sans-serif; }
    .p360-unit:hover { border-color:#8b6cf5; color:#ddd; }
    .p360-step { width:38px; height:34px; flex:0 0 auto; box-sizing:border-box; display:flex;
      align-items:center; justify-content:center; margin:0; padding:0; background:#1d1d1d;
      border:1px solid #444; border-radius:4px; color:#aaa; cursor:pointer;
      font:700 16px ui-sans-serif,system-ui,sans-serif; }
    .p360-step:hover { border-color:#8b6cf5; color:#ddd; }
    .p360-val { min-width:74px; height:34px; box-sizing:border-box; display:flex; align-items:center;
      justify-content:center; background:#1d1d1d; border:1px solid #444; border-radius:4px;
      color:#ddd; font-variant-numeric:tabular-nums; cursor:pointer; }
    .p360-val:hover { border-color:#8b6cf5; }
    .p360-sw { display:flex; align-items:center; gap:7px; flex:0 0 auto; background:none; border:0;
      margin:0; padding:0 5px; color:#cfcfcf; cursor:pointer;
      font:12.5px ui-sans-serif,system-ui,sans-serif; }
    .p360-sw i { width:32px; height:17px; border-radius:8px; background:rgba(255,255,255,.14);
      border:1px solid rgba(255,255,255,.18); position:relative; flex:none; box-sizing:border-box; }
    .p360-sw i::after { content:""; position:absolute; top:1px; left:1px; width:9px; height:9px;
      border-radius:50%; background:#bbb; transition:left .1s, background .1s; }
    .p360-sw i::after { width:13px; height:13px; }
    .p360-sw.on i { background:#8b6cf5; border-color:#8b6cf5; }
    .p360-sw.on i::after { left:18px; background:#fff; }
    .p360-ib { width:34px; height:34px; flex:0 0 auto; box-sizing:border-box; display:flex;
      align-items:center; justify-content:center; margin:0; padding:0; background:#1d1d1d;
      border:1px solid #444; border-radius:4px; color:#aaa; cursor:pointer;
      transition:background .1s,border-color .1s,color .1s; }
    .p360-ib:hover { border-color:#8b6cf5; color:#ddd; }
    .p360-ib.on { background:#8b6cf5; border-color:#8b6cf5; color:#fff; }
    .p360-ib svg { width:18px; height:18px; display:block; flex:none; pointer-events:none; }
    .p360-set { display:flex; align-items:center; gap:6px; height:34px; box-sizing:border-box;
      padding:0 12px; background:rgba(255,255,255,.05); border:1px solid rgba(255,255,255,.14);
      border-radius:6px; color:#8b6cf5; cursor:pointer; white-space:nowrap;
      font:600 12.5px ui-sans-serif,system-ui,sans-serif;
      transition:background .1s, border-color .1s, color .1s; }
    .p360-set span { color:#dcdce0; transition:color .1s; }
    .p360-set:hover { background:#8b6cf5; border-color:#8b6cf5; color:#fff; }
    .p360-set:hover span { color:#fff; }
    /* --- fullscreen -----------------------------------------------------------
       Pure CSS: :fullscreen matches whatever element went fullscreen, so the face
       restyles itself with no JS hook to keep in sync. The controls scale up for a
       screen instead of a node, move to the BOTTOM (column-reverse), float on a
       glass panel rather than a black bar, and keep clear of the screen edges. */
    :fullscreen .p360-face { flex-direction:column-reverse; padding:18px 20px 20px; gap:14px; }
    :fullscreen .p360-band, :fullscreen .p360-q {
      box-sizing:border-box; padding:12px 16px; border-radius:14px;
      background:rgba(20,20,26,.42); backdrop-filter:blur(16px) saturate(1.2);
      -webkit-backdrop-filter:blur(16px) saturate(1.2);
      border:1px solid rgba(255,255,255,.14); box-shadow:0 10px 34px rgba(0,0,0,.45); }
    :fullscreen .p360-band { gap:14px; }
    :fullscreen .p360-q { gap:22px; align-items:flex-end; }
    :fullscreen .p360-step { width:62px; height:56px; border-radius:8px;
      font:700 26px ui-sans-serif,system-ui,sans-serif; }
    :fullscreen .p360-val { min-width:132px; height:56px; border-radius:8px; font-size:21px; }
    :fullscreen .p360-sw { font:18px ui-sans-serif,system-ui,sans-serif; gap:12px; padding:0 8px; }
    :fullscreen .p360-sw i { width:54px; height:29px; }
    :fullscreen .p360-sw i::after { width:23px; height:23px; }
    :fullscreen .p360-sw.on i::after { left:29px; }
    :fullscreen .p360-ib { width:56px; height:56px; border-radius:8px; }
    :fullscreen .p360-ib svg { width:28px; height:28px; }
    :fullscreen .p360-set { height:56px; padding:0 22px; border-radius:8px;
      font:600 18px ui-sans-serif,system-ui,sans-serif; }
    :fullscreen .p360-qs input[type=range] { height:38px; }
    :fullscreen .p360-qs input[type=range]::-webkit-slider-runnable-track { height:10px;
      border-radius:5px; }
    :fullscreen .p360-qs input[type=range]::-webkit-slider-thumb { width:28px; height:28px;
      margin-top:-9px; }
    :fullscreen .p360-qs input[type=range]::-moz-range-track { height:10px; border-radius:5px; }
    :fullscreen .p360-qs input[type=range]::-moz-range-thumb { width:28px; height:28px; }
    :fullscreen .p360-qs .hd .t, :fullscreen .p360-qs .hd .n { font-size:17px; }
    :fullscreen .p360-unit { width:80px; height:52px; border-radius:8px;
      font:600 17px ui-sans-serif,system-ui,sans-serif; }
    :fullscreen .p360-chip { left:16px; bottom:14px; padding:6px 12px; font-size:15px;
      border-radius:8px; }

    /* One control language for the face: Settings is a button like the icon buttons,
       not a differently surfaced chip that reads as a stray text placeholder. */
    .p360-set { background:#1d1d1d; border:1px solid #444; }
    .p360-set:hover { border-color:#8b6cf5; }

    .p360-set svg { display:block; flex:none; pointer-events:none; }
    .p360-grow { margin-left:auto; display:flex; align-items:center; gap:6px; }
    .p360-vp { position:relative; flex:1 1 0; min-height:0; box-sizing:border-box;
      border:1px solid #444; border-radius:4px; overflow:hidden; background:#262626;
      cursor:grab; touch-action:none; }
    .p360-chip { position:absolute; left:9px; bottom:8px; padding:2px 7px; border-radius:4px;
      background:rgba(0,0,0,.55); color:#ddd; font-size:10.5px; white-space:nowrap; pointer-events:none; }
    .p360-msg { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
      text-align:center; padding:14px; box-sizing:border-box; color:#b0b0b0; font-size:11px;
      line-height:1.5; pointer-events:none; }
    .p360-msg.bad { color:#e8826f; }
    .p360-panel { position:fixed; z-index:10010; width:340px; max-width:94vw; background:#1a1a1a;
      border:1px solid #3a3a3a; border-radius:10px; box-shadow:0 18px 50px rgba(0,0,0,0.6);
      color:#d8d8d8; font:12px 'Segoe UI',-apple-system,sans-serif; overflow:hidden;
      max-height:88vh; display:flex; flex-direction:column; }
    .p360-h { flex:0 0 auto; display:flex; align-items:center; gap:8px; padding:10px 12px;
      background:#232323; border-bottom:1px solid #333; cursor:grab; user-select:none; }
    .p360-h .g { color:#8b6cf5; }
    .p360-h .n { color:#8b6cf5; font-weight:600; }
    .p360-h .x { margin-left:auto; color:#8a8a8a; cursor:pointer; padding:0 4px; }
    .p360-h .x:hover { color:#fff; }
    .p360-b { padding:14px 12px; display:flex; flex-direction:column; gap:12px; overflow-y:auto; min-height:0; }
    .p360-sec { display:flex; flex-direction:column; gap:10px; }
    .p360-sec > .t { color:#8a8a8a; font-size:11px; text-transform:uppercase; letter-spacing:0.5px; }
    .p360-row { display:flex; flex-direction:column; gap:5px; }
    .p360-row .lab { color:#cfcfcf; }
    .p360-row .sub { color:#8a8a8a; font-size:11px; margin-top:2px; }
    .p360-sl { display:flex; align-items:center; gap:8px; }
    .p360-sl input[type=range] { flex:1 1 auto; min-width:0; accent-color:#8b6cf5; }
    .p360-ctl { display:flex; align-items:center; justify-content:space-between; gap:7px;
      background:#1d1d1d; border:1px solid #444; border-radius:4px; padding:5px 8px;
      cursor:pointer; user-select:none; }
    .p360-ctl:hover { border-color:#8b6cf5; }
    .p360-num { color:#ddd; font-variant-numeric:tabular-nums; }
    .p360-tog { flex:0 0 auto; width:34px; height:18px; border-radius:9px; cursor:pointer;
      background:rgba(255,255,255,0.10); border:1px solid rgba(255,255,255,0.18); position:relative; }
    .p360-tog .knob { position:absolute; top:2px; left:2px; width:12px; height:12px; border-radius:50%;
      background:#bbb; transition:left .1s, background .1s; }
    .p360-tog.on { background:#8b6cf5; border-color:#8b6cf5; }
    .p360-tog.on .knob { left:18px; background:#fff; }
    .p360-pop { position:fixed; z-index:10040; background:#1a1a1a; border:1px solid #444; border-radius:5px;
      box-shadow:0 10px 30px rgba(0,0,0,0.6); padding:3px; max-height:50vh; overflow:auto; }
    .p360-pop i { display:block; padding:6px 12px; font-size:12px; color:#ccc; cursor:pointer;
      border-radius:3px; white-space:nowrap; font-style:normal; }
    .p360-pop i:hover { background:#2a2a2a; color:#fff; }
    .p360-pop i.on { color:#8b6cf5; }
    .p360-rule { height:1px; background:#333; margin:2px 0; }
    .p360-f { flex:0 0 auto; display:flex; gap:8px; padding:10px 12px; border-top:1px solid #333; background:#1f1f1f; }
    .p360-bt { border:1px solid #444; background:rgba(255,255,255,0.04); color:#d8d8d8; border-radius:5px;
      padding:5px 12px; font:12px 'Segoe UI',sans-serif; cursor:pointer; }
    .p360-bt:hover { border-color:#8b6cf5; color:#fff; }
    .p360-push { margin-left:auto; }
  `;
  document.head.appendChild(s);
}

const mk = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

function containerOf(node) {
  return node?.widgets?.find((w) => w.name === WIDGET_NAME)?.element || null;
}

let _popClose = null;

function closePop() {
  const fn = _popClose;
  _popClose = null;
  try {
    fn?.();
  } catch (_) {}
}

// A dropdown row, styled like the Pixaroma panels (never a native <select>).
// `get`/`set` let one row type serve both worlds: a ComfyUI setting (viewer
// defaults) or a node widget (values that must save with the workflow).
function comboRow(label, hint, options, get, set, onAfter) {
  const row = mk("div", "p360-row");
  const txt = mk("div");
  if (label) txt.appendChild(mk("div", "lab", label));
  if (hint) txt.appendChild(mk("div", "sub", hint));
  const ctl = mk("div", "p360-ctl");
  const val = mk("div", "p360-num", String(get()));
  const caret = mk("span", "", "▼");
  caret.style.color = "#8b6cf5";
  caret.style.fontSize = "9px";
  ctl.append(val, caret);

  ctl.addEventListener("click", (e) => {
    e.stopPropagation();
    closePop();
    const pop = mk("div", "p360-pop");
    const r = ctl.getBoundingClientRect();
    pop.style.left = r.left + "px";
    pop.style.top = r.bottom + 3 + "px";
    pop.style.minWidth = r.width + "px";
    for (const o of options) {
      const it = mk("i", String(o) === String(get()) ? "on" : "", String(o));
      it.addEventListener("click", (ev) => {
        ev.stopPropagation();
        set(o);
        val.textContent = String(o);
        pop.remove();
        onAfter?.(o);
      });
      pop.appendChild(it);
    }
    document.body.appendChild(pop);
    const pr = pop.getBoundingClientRect();
    if (pr.bottom > window.innerHeight - 8) pop.style.top = Math.max(8, r.top - pr.height - 3) + "px";
    if (pr.right > window.innerWidth - 8) pop.style.left = Math.max(8, window.innerWidth - pr.width - 8) + "px";
    const away = (ev) => {
      if (!pop.contains(ev.target)) close();
    };
    const esc = (ev) => {
      if (ev.key === "Escape") {
        ev.stopPropagation();
        close();
      }
    };
    const close = () => {
      pop.remove();
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("wheel", away, true);
      document.removeEventListener("keydown", esc, true);
      if (_popClose === close) _popClose = null;
    };
    _popClose = close;
    setTimeout(() => {
      document.addEventListener("pointerdown", away, true);
      document.addEventListener("wheel", away, true);
      document.addEventListener("keydown", esc, true);
    }, 0);
  });

  row.append(txt, ctl);
  return row;
}

function toggleRow(label, hint, id, onAfter) {
  const row = mk("div", "p360-row");
  const txt = mk("div");
  txt.appendChild(mk("div", "lab", label));
  if (hint) txt.appendChild(mk("div", "sub", hint));
  const tog = mk("div", "p360-tog" + (readSetting(id) === true ? " on" : ""));
  tog.appendChild(mk("span", "knob"));
  tog.addEventListener("click", (e) => {
    e.stopPropagation();
    const next = readSetting(id) !== true;
    writeSetting(id, next);
    tog.classList.toggle("on", next);
    onAfter?.(next);
  });
  row.append(txt, tog);
  return row;
}

// A slider row bound to a NODE WIDGET, so the value saves with the workflow.
function sliderRow(label, hint, name, min, max, step, node, onInput) {
  const row = mk("div", "p360-row");
  const txt = mk("div");
  txt.appendChild(mk("div", "lab", label));
  if (hint) txt.appendChild(mk("div", "sub", hint));
  const line = mk("div", "p360-sl");
  const range = document.createElement("input");
  range.type = "range";
  range.min = String(min);
  range.max = String(max);
  range.step = String(step);
  range.value = String(wget(node, name, min));
  const box = mk("div", "p360-ctl");
  box.style.cursor = "default";
  const num = mk("div", "p360-num", String(wget(node, name, min)));
  box.appendChild(num);
  const push = (v) => {
    wset(node, name, v);
    num.textContent = String(v);
    onInput?.(v);
  };
  range.addEventListener("input", () => push(Number(range.value)));
  line.append(range, box);
  row.append(txt, line);
  row._refresh = () => {
    range.value = String(wget(node, name, min));
    num.textContent = String(wget(node, name, min));
  };
  return row;
}

function closePanel() {
  closePop();
  if (_stopFollow) {
    try {
      _stopFollow();
    } catch (_) {}
  }
  _stopFollow = null;
  if (_panel) {
    try {
      _panel.remove();
    } catch (_) {}
  }
  _panel = null;
  _panelNode = null;
  _userMoved = false;
  document.removeEventListener("pointerdown", outsideClose, true);
  document.removeEventListener("keydown", escClose, true);
}

function outsideClose(e) {
  if (!_panel) return;
  if (_panel.contains(e.target)) return;
  // Any click inside the node's own face — including the Settings button that opened
  // the panel — must not dismiss it, or pressing Settings a second time would close
  // and instantly reopen instead of toggling.
  if (e.target.closest?.(".p360-face, .p360-pop")) return;
  closePanel();
}

function escClose(e) {
  if (e.key !== "Escape" || !_panel) return;
  if (document.querySelector(".p360-pop")) return;
  e.stopPropagation();
  closePanel();
}

function openPanel(node) {
  closePanel();
  injectCSS();
  const container = containerOf(node);
  const live = () => container?._v360;

  const panel = mk("div", "p360-panel");
  const head = mk("div", "p360-h");
  head.append(mk("span", "g", "⚙"), mk("span", "n", "Panorama 360 Viewer Eternal"));
  const x = mk("span", "x", "✕");
  x.addEventListener("click", closePanel);
  head.appendChild(x);

  const body = mk("div", "p360-b");

  const nodeSec = mk("div", "p360-sec");
  nodeSec.appendChild(mk("div", "t", "This node (saves with the workflow)"));
  nodeSec.appendChild(
    sliderRow(
      "Field of view",
      "The zoom the viewer opens at. Bigger = wider = further away. 100 is the usual default; 75 looks zoomed in.",
      "fov",
      30,
      140,
      1,
      node,
      (v) => live()?.setFov(v)
    )
  );
  nodeSec.appendChild(
    sliderRow(
      "Auto-rotate",
      "Degrees per second the view drifts on its own. 0 = off.",
      "auto_rotate",
      0,
      60,
      0.5,
      node,
      () => live()?.refresh()
    )
  );
  nodeSec.appendChild(
    comboRow(
      "Background",
      "Colour behind the sphere, visible at the poles.",
      ["dark", "black", "grey", "light"],
      () => String(wget(node, "background", "dark")),
      (v) => wset(node, "background", v),
      () => live()?.refresh()
    )
  );
  nodeSec.appendChild(
    sliderRow(
      "Start view: horizontal (yaw)",
      "Which part of the panorama the view opens on: 0/360 = the left edge of the image, 180 = its middle. Change it when the subject is not in the middle.",
      "start_yaw",
      0,
      360,
      5,
      node,
      () => live()?.applyView()
    )
  );
  nodeSec.appendChild(
    sliderRow(
      "Start view: vertical (pitch)",
      "Where the view opens vertically: 0 = horizon centred, negative = looking down at the floor, positive = up at the sky.",
      "start_pitch",
      -90,
      90,
      5,
      node,
      () => live()?.applyView()
    )
  );
  nodeSec.appendChild(
    sliderRow(
      "Camera height (Z axis)",
      "Slides the viewpoint up or down along the vertical axis, as a percent of the sphere radius: 100 would put the eye exactly on the sphere surface, so 99 slides the image almost all the way past you. Positive looks from above, negative from below. A translation, not a tilt, so the horizon itself rises or falls.",
      "z_offset",
      -99,
      99,
      1,
      node,
      () => live()?.applyHeight()
    )
  );
  nodeSec.appendChild(
    sliderRow(
      "Brightness (exposure)",
      "1.0 shows the file as it is; above 1 brightens, below 1 darkens. Affects the viewer only, not the image on the wire.",
      "exposure",
      0.2,
      3,
      0.05,
      node,
      () => live()?.refresh()
    )
  );

  const viewSec = mk("div", "p360-sec");
  viewSec.appendChild(mk("div", "t", "Viewer defaults (all 360 viewers)"));
  viewSec.appendChild(
    comboRow(
      "Zoom range: closest",
      "Lowest fov the wheel may reach (most zoomed in).",
      ["20", "30", "45", "60"],
      () => String(readSetting(SET.minFov)),
      (v) => writeSetting(SET.minFov, v),
      () => live()?.refresh()
    )
  );
  viewSec.appendChild(
    comboRow(
      "Zoom range: widest",
      "Highest fov the wheel may reach (furthest away).",
      ["110", "120", "140", "160"],
      () => String(readSetting(SET.maxFov)),
      (v) => writeSetting(SET.maxFov, v),
      () => live()?.refresh()
    )
  );
  viewSec.appendChild(
    comboRow(
      "Wheel zoom speed",
      "Degrees of fov per wheel notch.",
      ["0.02", "0.05", "0.1", "0.2"],
      () => String(readSetting(SET.zoom)),
      (v) => writeSetting(SET.zoom, v)
    )
  );
  viewSec.appendChild(
    comboRow(
      "Drag sensitivity",
      "Degrees of rotation per pixel dragged.",
      ["0.1", "0.2", "0.35", "0.5"],
      () => String(readSetting(SET.drag)),
      (v) => writeSetting(SET.drag, v)
    )
  );
  viewSec.appendChild(
    comboRow(
      "Wheel over the view",
      "What the wheel does with the cursor over the panorama. Shift+wheel always zooms the panorama.",
      ["panorama zoom", "canvas zoom"],
      () => String(readSetting(SET.wheel)),
      (v) => writeSetting(SET.wheel, v)
    )
  );
  viewSec.appendChild(
    toggleRow("Horizon guide", "Level line at the equator, to check a tilted panorama.", SET.horizon, () => live()?.refresh())
  );
  viewSec.appendChild(
    toggleRow("Invert vertical drag", "Drag up moves the view up instead of down.", SET.invertY)
  );
  viewSec.appendChild(
    toggleRow("Reset view on every run", "Start each new image centred instead of where you left it.", SET.resetOnQueue)
  );

  const rule = mk("div", "p360-rule");
  const foot = mk("div", "p360-f");
  const bReset = mk("button", "p360-bt", "Reset view");
  bReset.addEventListener("click", () => live()?.reset());
  const bSave = mk("button", "p360-bt", "Save view to node");
  bSave.title = "Write the fov you are looking at into the node, so the workflow opens there";
  bSave.addEventListener("click", () => {
    const f = live()?.getFov();
    if (f == null) return;
    wset(node, "fov", Math.round(f));
    for (const r of nodeSec.children) r._refresh?.();
    bSave.textContent = "Saved";
    setTimeout(() => {
      bSave.textContent = "Save view to node";
    }, 1200);
  });
  const bDone = mk("button", "p360-bt p360-push", "Done");
  bDone.addEventListener("click", closePanel);
  foot.append(bReset, bSave, bDone);

  body.append(nodeSec, rule, viewSec);
  panel.append(head, body, foot);
  document.body.appendChild(panel);

  placeBeside(panel, getNodeScreenRect(node));
  makeDraggable(panel, head, {
    ignoreSelector: ".x",
    onUserMove: () => {
      _userMoved = true;
    },
  });
  _stopFollow = followNode(panel, node, {
    isCurrent: () => _panel === panel && _panelNode === node,
    isUserMoved: () => _userMoved,
  });

  _panel = panel;
  _panelNode = node;

  setTimeout(() => {
    if (!_panel) return;
    document.addEventListener("pointerdown", outsideClose, true);
    document.addEventListener("keydown", escClose, true);
  }, 0);
}

function togglePanel(node) {
  if (_panel && _panelNode === node) closePanel();
  else openPanel(node);
}

// ── widget repair ───────────────────────────────────────────────────────────
//
// A workflow saved while this node had FEWER widgets loads the new ones BLANK:
// ComfyUI maps the stored values positionally and leaves the rest empty. A blank
// INT never reaches this node's code, because the server rejects the prompt with
// "The value  for Panorama 360 Viewer's fov couldn't be converted to INT."
// So every unusable value falls back to the schema default on load and on create,
// and a value you set is kept as-is.

const DEFAULT_WIDGETS = {
  frame_index: 0,
  fov: 100,
  auto_rotate: 0,
  background: "dark",
  exposure: 1,
  start_yaw: 180,
  start_pitch: 0,
  z_offset: 0,
};

function widgetUsable(v) {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (typeof v === "number") return Number.isFinite(v);
  return true;
}

function sanitizeWidgets(node) {
  if (!node?.widgets) return;
  for (const name of Object.keys(DEFAULT_WIDGETS)) {
    const w = node.widgets.find((x) => x.name === name);
    if (!w || widgetUsable(w.value)) continue;
    const v = DEFAULT_WIDGETS[name];
    w.value = v;
    if (w.inputEl) w.inputEl.value = String(v);
  }
  try {
    node.setDirtyCanvas?.(true, true);
  } catch (_) {}
}

// ── fit the view to the node ────────────────────────────────────────────────
//
// The widget is sized by getMinHeight in both renderers and the face fills it with
// position:absolute, so a taller node grows the sphere for free: Nodes 2.0 lays the
// body out as flex, Classic gives the widget the height it reported. No pixel height
// is written on the element any more — that was what pushed the viewer out of the
// frame. Classic additionally CLAMPS the node so the frame can never be dragged
// smaller than its content (the Save 3D pattern).
function clampNodeSize(node) {
  if (!node?.size || isVueNodes()) return;
  if (node.size[0] < NODE_MIN_W) node.size[0] = NODE_MIN_W;
  if (node.size[1] < NODE_MIN_H) node.size[1] = NODE_MIN_H;
}

// ComfyUI's Nodes 2.0 node body renders an inline preview of a node's IMAGE output,
// which put a flat equirectangular copy of the panorama under the sphere. This node
// draws that image itself, in 3D, so the flat copy is redundant: hide it. Selector
// driven and a no-op when it finds nothing (legacy renderer, or before a first run).
function hideInlinePreview(node) {
  if (!node?.id) return;
  const root = document.querySelector('[data-node-id="' + node.id + '"]');
  if (!root) return;
  for (const img of root.querySelectorAll('img[src*="/view?"]')) {
    const box = img.closest("div");
    if (box && box !== root) box.style.display = "none";
  }
}

// ── extension ───────────────────────────────────────────────────────────────

app.registerExtension({
  name: "ETERNAL.Panorama360Viewer",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData.name !== NODE_ID) return;
    // Belt and braces: the stylesheet is also injected from buildFace(), but a node
    // restored from a workflow must never depend on that call order.
    injectCSS();

    // Loaded from a workflow: repair blanks left by an older widget layout, so a
    // node saved before fov/auto_rotate/background existed can still queue.
    const origOnConfigure = nodeType.prototype.onConfigure;
    nodeType.prototype.onConfigure = function (info) {
      origOnConfigure?.call(this, info);
      sanitizeWidgets(this);
      clampNodeSize(this);
      hideInlinePreview(this);
    };

    const origOnNodeCreated = nodeType.prototype.onNodeCreated;
    nodeType.prototype.onNodeCreated = function () {
      origOnNodeCreated?.call(this);
      sanitizeWidgets(this);

      this.imgs = null; // suppress any generic image preview drawing
      this.onDrawBackground = function () {};

      const container = document.createElement("div");
      container.style.cssText =
        "position:relative;width:100%;height:100%;box-sizing:border-box;overflow:hidden;" +
        "min-height:" + VIEW_MIN_H + "px;";

      const widget = this.addDOMWidget(WIDGET_NAME, WIDGET_NAME, container, {
        serialize: false,
        hideOnZoom: false,
        getMinHeight: () => VIEW_MIN_H,
      });
      // Two different flags: options.serialize keeps it out of the PROMPT, the
      // top-level one keeps it out of the saved WORKFLOW (widgets_values).
      widget.serialize = false;
      // Required in Nodes 2.0: without it the widget is dropped from the node body
      // (shouldRenderAsVue = !canvasOnly) and the node renders empty.
      applyAdaptiveCanvasOnly(widget);
      widget.computeLayoutSize = () => ({ minHeight: VIEW_MIN_H, minWidth: 1 });

      // Draw the face ourselves and HIDE the schema widgets: ComfyUI would otherwise
      // render its own sliders and dropdowns in the body, which no CSS of ours can
      // reach and which made this node look foreign beside the rest of the pack.
      const vp = buildFace(this, container);
      for (const name of Object.keys(DEFAULT_WIDGETS)) hideJsonWidget(this.widgets, name);
      placeholder(vp, "Queue the node to load the 360&deg; view");

      this.setSize([460, 470]);
      clampNodeSize(this);
      hideInlinePreview(this);

      // Deliberately NO onDrawForeground wrapper here. It was added to clamp the node
      // on the first painted frame, but it also inserts this node into the per-frame
      // draw chain of EVERY other extension: the console filled with another pack's
      // "Cannot read properties of undefined (reading 'save')" repeating every frame,
      // with this node's hook at the top of the stack. onResize + onConfigure + the
      // initial setSize cover the clamp, so the draw hook is not worth its cost.

      // Nodes 2.0 drags the node's minimum height from a live collapse measurement;
      // pin the floor for the duration of the gesture so the view cannot spill.
      try {
        this._p360FloorOff = installResizeFloor(container, () => VIEW_MIN_H);
      } catch (_) {}
      // A graph zoom changes only the CSS scale, so no ResizeObserver fires: the
      // backing store has to be re-sized explicitly (Nodes 2.0 blur fix).
      try {
        this._p360ZoomOff = installZoomRepaint(this, null, () => container._v360?.repaint(), "_p360Raf");
      } catch (_) {}
      // Renderer-agnostic size tracking: whatever moves the container, the view follows.
      try {
        this._p360Ro = new ResizeObserver(() => requestAnimationFrame(() => container._resize360?.()));
        this._p360Ro.observe(vp);
      } catch (_) {}
      // Flipping the Nodes 2.0 setting without a reload changes how the body is laid
      // out (flex vs explicit height), so re-apply on the switch.
      try {
        this._p360RenderOff = onRendererChange(() => {
          clampNodeSize(this);
          hideInlinePreview(this);
          requestAnimationFrame(() => container._resize360?.());
        });
      } catch (_) {}

      const origOnResize = this.onResize?.bind(this);
      this.onResize = function (size) {
        origOnResize?.(size);
        clampNodeSize(this);
        requestAnimationFrame(() => container._resize360?.());
      };

      const origOnRemoved = this.onRemoved?.bind(this);
      this.onRemoved = function () {
        container._dispose360?.();
        if (_panelNode === this) closePanel();
        try {
          this._p360Ro?.disconnect();
        } catch (_) {}
        try {
          this._p360FloorOff?.();
        } catch (_) {}
        try {
          this._p360ZoomOff?.();
        } catch (_) {}
        try {
          this._p360RenderOff?.();
        } catch (_) {}
        origOnRemoved?.();
      };

      const origMenu = this.getExtraMenuOptions?.bind(this);
      this.getExtraMenuOptions = function (canvas, options) {
        origMenu?.(canvas, options);
        options.push(null, {
          content: "⚙ Panorama 360 Viewer settings",
          callback: () => openPanel(this),
        });
      };
    };

    const origOnExecuted = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (output) {
      origOnExecuted?.call(this, output);

      const images = output?.images;
      if (!images?.length) return;
      const img = images[0];

      const url =
        "/view?filename=" +
        encodeURIComponent(img.filename) +
        "&type=" +
        encodeURIComponent(img.type || "temp") +
        "&subfolder=" +
        encodeURIComponent(img.subfolder || "") +
        "&t=" +
        Date.now();

      const container = containerOf(this);
      if (!container) return;
      // The message belongs INSIDE the viewport: writing it to the widget root would
      // wipe the control band that buildFace() drew.
      const vp = container._face?.vp || container;

      loadThree()
        .then(() => {
          buildViewer(container, vp, url, this);
          // Nodes 2.0 spawns its own flat preview of the IMAGE output; hide it once the
          // 3D view is up, and again shortly after because it appears asynchronously.
          hideInlinePreview(this);
          requestAnimationFrame(() => hideInlinePreview(this));
          setTimeout(() => hideInlinePreview(this), 400);
          setTimeout(() => hideInlinePreview(this), 1500);
        })
        .catch(() => {
          placeholder(
            vp,
            "three.js could not be loaded from the CDN.<br>The viewer needs internet access on first use.",
            true
          );
        });
    };
  },
});