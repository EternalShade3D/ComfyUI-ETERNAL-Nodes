// Sweepable-target registry - lets a Pixaroma node advertise parameters that live in
// a serialized STATE BLOB instead of in LiteGraph widgets, so XY Plot Pixaroma can
// list them in its picker and drive them per cell.
//
// Why this exists: XY Plot builds its picker from each node's `widgets`. A node built
// the Resolution / Sizes way (Vue Compat #9) keeps its real parameters on
// node.properties and injects them into a HIDDEN input at queue time, so it has no
// widget to enumerate - LoRA Loader Pixaroma saw exactly that and never appeared in
// the picker at all. A provider fills the gap without either side importing the
// other's internals (XY Plot must not reach into js/lora_loader, and the node must
// not reach into js/xy_plot - editor isolation).
//
// A provider is registered once, at module load, from the NODE's own directory:
//
//   registerSweepProvider("PixaromaLoraLoader", {
//     owns(axis)                        -> boolean   // is this saved axis ours?
//     enumerate(node)                   -> entry[]   // pickable axes
//     lookup(node, axis)                -> entry|null
//     preview(node, axis)               -> string    // the "now: …" line
//     displayName(node, axis)           -> string    // the grid's axis title
//     note(node, axis)                  -> string    // OPTIONAL heads-up line
//     inject(entry, axis, value, node)  -> void      // patch the prompt entry
//   });
//
// `note` is the one hook that is optional: return a short sentence when something on
// the node that the axis does NOT sweep will still land in every square, and XY Plot
// draws it under the "now:" line. It exists because a state-blob node can hold a whole
// stack of settings behind one axis - the LoRA Loader's other switched-on rows are
// applied to every cell, which users read as "my second lora is being ignored" when it
// is in fact being applied everywhere. Return "" when there is nothing to say.
//
// An `entry` has the SAME shape XY Plot's own classifyWidget returns, so the whole
// downstream pipeline (value entry, rounding, snap, grid labels) is untouched:
//   { name, subField, label, type: "number"|"combo"|"text",
//     options?, step?, precision?, realStep?, cur }
// `name` is the axis identity that gets SERIALIZED into the saved workflow, so it
// must be stable across reloads and reorders (use a row id, never an index) and
// namespaced so it can never collide with a real widget name.

const _providers = new Map();

export function registerSweepProvider(comfyClass, provider) {
  if (!comfyClass || !provider) return;
  _providers.set(String(comfyClass), provider);
}

// The provider for a node, or null. Matches on comfyClass first (what ComfyUI sets
// on every backend node), falling back to node.type.
export function getSweepProvider(node) {
  if (!node) return null;
  return _providers.get(String(node.comfyClass || node.type || "")) || null;
}

// The provider that OWNS this saved axis, or null. Every XY Plot lookup tries the
// node's real widgets FIRST and only asks here when nothing matched, so a real
// widget always wins; `owns` is the second guard, keyed off the namespaced axis
// name, so a provider can never claim an unrelated axis on the same node.
export function sweepProviderFor(node, axis) {
  const p = getSweepProvider(node);
  if (!p || !axis) return null;
  try {
    return p.owns && p.owns(axis) ? p : null;
  } catch (_e) {
    return null;
  }
}

// Would ANY registered provider claim this axis? Lets a caller tell "a saved axis
// whose target node has vanished" apart from an ordinary widget axis, WITHOUT
// hard-coding a namespace convention here - each provider answers for itself. Used to
// warn instead of silently writing a meaningless key into the prompt.
export function anyProviderOwns(axis) {
  if (!axis) return false;
  for (const p of _providers.values()) {
    try {
      if (p.owns && p.owns(axis)) return true;
    } catch (_e) { /* a broken provider must not break the caller */ }
  }
  return false;
}
