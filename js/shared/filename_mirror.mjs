// Browser MIRRORS of the Python filename pipeline, shared by every Pixaroma
// node that shows a live "Will save as" line.
//
// Extracted from js/save_image/state.mjs + js/save_image/index.js on 2026-08-10
// when Save Video Pixaroma was built. There must only ever be ONE copy: this
// mirror took three review rounds to get right, and a second copy would drift
// from the Python and from itself. The comments below ARE the record of those
// rounds - do not trim them.
//
// Keep in lockstep with nodes/_save_helpers.py (_expand_date_tokens,
// _safe_prefix, _sanitize_segment) and node_save_image.py (_expand_native_tokens).

// JS mirror of nodes/_save_helpers.py::_expand_date_tokens - ComfyUI-native
// %date:FMT% codes, case-sensitive, zero-padded to the token length, with
// H/HH kept as an hour alias and unknown runs (e.g. a lone 'yyy') literal.
export function resolveDateTokens(s) {
  if (typeof s !== "string" || !s.includes("%date:")) return s;
  const d = new Date();
  const pad = (v, len) => String(v).padStart(len, "0");
  return s.replace(/%date:([^%]+)%/g, (_m, f) =>
    f.replace(/dd?|MM?|hh?|HH?|mm?|ss?|yyy?y?/g, (t) => {
      if (t === "yyyy") return pad(d.getFullYear(), 4);
      if (t === "yy") return String(d.getFullYear()).slice(-2);
      if (t === "yyy") return t; // literal, like native ComfyUI
      const c = t[0];
      if (c === "M") return pad(d.getMonth() + 1, t.length);
      if (c === "d") return pad(d.getDate(), t.length);
      if (c === "h" || c === "H") return pad(d.getHours(), t.length);
      if (c === "m") return pad(d.getMinutes(), t.length);
      if (c === "s") return pad(d.getSeconds(), t.length);
      return t;
    })
  );
}

// JS mirror of nodes/node_save_image.py::_expand_native_tokens - ComfyUI's
// native %year% %month% %day% %hour% %minute% %second% tokens.
export function expandNativeTokens(s) {
  if (typeof s !== "string" || !s.includes("%")) return s;
  const d = new Date();
  const p = (v, len) => String(v).padStart(len, "0");
  return s
    .replace(/%year%/g, p(d.getFullYear(), 4))
    .replace(/%month%/g, p(d.getMonth() + 1, 2))
    .replace(/%day%/g, p(d.getDate(), 2))
    .replace(/%hour%/g, p(d.getHours(), 2))
    .replace(/%minute%/g, p(d.getMinutes(), 2))
    .replace(/%second%/g, p(d.getSeconds(), 2));
}

// Mirror of the Python cleanup for a wired `name` value: strip a known media
// extension ("cat.png" -> "cat") and then either neutralize the path
// separators (default) or keep them, when "Keep folders from the wired name" is
// on - same branch as node_save_image.py::save, so the "Will save as" line shows
// the folders a run would really create.
export function cleanInputName(v, keepFolders = false) {
  if (v == null) return "";
  const s = String(v)
    .trim()
    .replace(/\.(png|jpe?g|webp|gif|bmp|tiff?|avif|mp4|mov|webm|mkv|m4v)$/i, "");
  return keepFolders ? s.replace(/\\/g, "/") : s.replace(/[\\/]/g, "_");
}

// Normalize a folder path: backslash -> forward slash, trim, drop a trailing
// slash (but keep a bare drive root as "X:/"). Same rules as Load Images from
// Folder so native-dialog returns compare cleanly against typed paths.
export function normalizePath(p) {
  if (!p) return "";
  let s = String(p).trim().replace(/\\/g, "/").replace(/\/+$/, "");
  if (/^[A-Za-z]:$/.test(s)) s += "/"; // "D:" -> "D:/"
  return s;
}

// Display mirror of the Python sanitizer - keep in lockstep with _safe_prefix +
// _sanitize_segment in nodes/_save_helpers.py. Returns "" where Python returns
// None, so each caller supplies its OWN fallback (Save Image uses
// "image_%counter%", Save Video "Video_%counter%") rather than this function
// guessing which node called it.
//
// The "Will save as" line is the one thing these nodes tell users to trust, so
// every gap between the two sides is a lie about where their file goes. A first
// pass covered only some of the rules, and a review found the rest by running
// both sides on the same inputs. MEASURED disagreements, all fixed here (Python
// left, old preview right):
//     "/myfolder/name_%counter%"  image_001.png    myfolder\name_001.png
//     "../up/name_%counter%"      image_001.png    ..\up\name_001.png
//     "shot_%counter%."           shot_001.png     shot_001..png
//     "_%counter%"                001.png          _001.png
//     "%input%" unwired           image_001.png    .png
//
// Deliberately NOT mirrored, because the trigger is vanishingly narrow and each
// adds surface to this hot path: the Windows reserved-device-name suffix (a
// segment resolving to exactly CON/NUL/COM1/...), control characters inside a
// wired name, and the 256/100 char length caps.
//
// And one more, found in review round 3: the .trim() below is NOT a perfect
// stand-in for Python's str.strip(), because the two languages disagree on what
// counts as whitespace. JS trims U+FEFF and Python does not; Python strips
// U+0085 and \x1c-\x1f and JS does not. Since the trim now gates the reject
// tests, those characters at a pattern's very edge can flip the accept/reject
// decision in EITHER direction - e.g. "\uFEFF.." previews the fallback while the
// node really writes a file named "\uFEFF.png". Closing it means hand-rolling
// Python's isspace() class in a function that runs on every keystroke, which is
// more new surface than the bug is worth. Contained either way: this only
// affects the NAME inside an already-approved folder, never which folder is
// written to.
export function sanitizePrefixMirror(input) {
  // The leading .trim() mirrors _safe_prefix's `s.strip()`, and it has to come
  // BEFORE the two reject tests below, exactly as it does in Python. Without it
  // a single leading space smuggled a rejected pattern past both checks: " ..",
  // once split, is not === "..", and " /x" does not startsWith("/"), so the
  // per-segment loop quietly tidied the space away and the preview promised a
  // path the node would never write. MEASURED before the fix:
  //     " /secret"     node writes image_001.png   preview said secret.png
  //     " ../secret"   node writes image_001.png   preview said secret.png
  // Found in the second review round - the first round's fix was correct about
  // WHAT to reject and wrong about WHEN, which no amount of testing the
  // untrimmed inputs would have shown.
  let s = String(input ?? "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/[<>:"|?*]/g, "_")
    .replace(/_{2,}/g, "_");
  // _safe_prefix refuses the WHOLE pattern for these two, rather than tidying
  // them - the caller then falls back to its own default.
  const segs = s.split("/");
  if (s.startsWith("/") || segs.some((p) => p === "..")) return "";
  return segs
    // loop until stable: edge spaces, edge underscores and trailing dots can
    // shadow each other, exactly as the Python comment describes ("test._"
    // needs two passes)
    .map((seg) => {
      let prev = null;
      let cur = seg;
      while (prev !== cur) {
        prev = cur;
        cur = cur.trim().replace(/^_+|_+$/g, "").replace(/[. ]+$/, "");
      }
      return cur;
    })
    .filter(Boolean) // Python drops empty segments (trailing / doubled slashes)
    .join("/");
}
