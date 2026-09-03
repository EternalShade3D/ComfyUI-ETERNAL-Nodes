// ETERNAL node colors — every ETERNAL node spawns with brand colors.
//
// Why JS (not python): LiteGraph node colors (node.color = title bar,
// node.bgcolor = body) are frontend-only state, like Pixaroma's "Node
// Colors" picker writes them. Applying at node creation means every new
// ETERNAL node already carries the colors; the user can still recolor any
// node afterwards with the picker (we never overwrite user edits on
// existing nodes — we only set colors at spawn time).
//
// Title  #4a3fcf  (Eternal indigo)
// Body   #2a283e  (Eternal dark)
const TITLE = "#4a3fcf";
const BODY = "#2a283e";

// Any node whose comfyClass OR display name contains ETERNAL branding.
function isEternal(node) {
  const cls = String(node.constructor?.comfyClass || "");
  const disp = String(node.title || "");
  return cls.includes("Eternal") || disp.includes("ETERNAL") || disp.includes("Eternal");
}

app.registerExtension({
  name: "eternal.NodeColors",

  nodeCreated(node) {
    if (!isEternal(node)) return;
    // Only brand nodes that don't already carry explicit colors (workflow
    // reload: serialized nodes already have color/bgcolor fields set; we
    // respect whatever was saved — user recolors survive).
    if (!node.color && !node.bgcolor) {
      node.color = TITLE;
      node.bgcolor = BODY;
    }
  },
});