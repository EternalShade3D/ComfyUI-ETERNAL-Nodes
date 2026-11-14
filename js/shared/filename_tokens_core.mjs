// Pure resolver for ComfyUI-style %NodeName.widgetName% filename references.
// NO imports on purpose, so this is unit-testable in plain Node (see
// D:\Claude Tests\_filename_token_test.mjs).
//
// Mirrors ComfyUI core's own applyTextReplacements (verified against the
// frontend bundle, June 2026): find a node by its "Node name for S&R" property
// (falling back to its title), read a VISIBLE widget of the given name, and
// sanitize the value the same way (filesystem-illegal chars -> "_").
//
// Tokens that are NOT exactly `NodeName.widget` are left UNTOUCHED so the Python
// side (folder_paths.get_save_image_path / _safe_prefix / _expand_date_tokens)
// can expand or keep them: %date:...%, %year%, %month%, %width%, %height%, and
// any reference to a node/widget that doesn't exist all pass through verbatim.

const ILLEGAL = /[/?<>\\:*|"\x00-\x1f\x7f]/g;

// Same 2-part rule ComfyUI uses: a token resolves ONLY when it splits into
// exactly NodeName.widgetName on a single dot. Anything else (no dot, or two+
// dots) is left for Python / kept literal.
export function resolveFilenameTokens(value, nodes) {
  if (typeof value !== "string" || value.indexOf("%") === -1) return value;
  const list = Array.isArray(nodes) ? nodes : [];
  return value.replace(/%([^%]+)%/g, (match, token) => {
    const parts = token.split(".");
    if (parts.length !== 2) return match; // date:/width/year/... -> leave for Python
    const name = parts[0];
    const field = parts[1];
    let node = list.find(
      (n) => n && n.properties && n.properties["Node name for S&R"] === name
    );
    if (!node) node = list.find((n) => n && n.title === name);
    if (!node) return match; // unknown node -> leave the token literal
    const w = node.widgets && node.widgets.find((x) => x && x.name === field);
    if (!w) return match; // no such widget -> leave the token literal
    const v = w.value == null ? "" : String(w.value);
    return v.replace(ILLEGAL, "_");
  });
}
