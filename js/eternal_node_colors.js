// ETERNAL node colors — every ETERNAL node spawns with brand colors.
//
// Why JS (not python): LiteGraph node colors (node.color = title bar,
// node.bgcolor = body) are frontend-only state, exactly the fields Pixaroma's
// "Node Colors" picker writes. Setting them at node creation means every NEW
// ETERNAL node already carries the brand colors.
//
// User recolors survive: on workflow load, the serialized color/bgcolor are
// applied AFTER nodeCreated fires, so anything saved in the workflow (or set
// later with the Pixaroma picker) always wins over these spawn defaults.
//
// Title  #4a3fcf  (Eternal indigo)
// Body   #2a283e  (Eternal dark)
import { app } from "../../scripts/app.js";

const TITLE = "#4a3fcf";
const BODY = "#2a283e";

function isEternal(node) {
  const cls = String(node.constructor?.comfyClass || "");
  return cls.includes("Eternal") || cls.includes("ETERNAL");
}

app.registerExtension({
  name: "eternal.NodeColors",

  nodeCreated(node) {
    if (!isEternal(node)) return;
    node.color = TITLE;
    node.bgcolor = BODY;
  },
});
