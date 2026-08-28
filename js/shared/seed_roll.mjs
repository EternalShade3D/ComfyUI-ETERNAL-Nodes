// ---------------------------------------------------------------------------
// Rolling the seed of a node that has NO seed WIDGET.
//
// Pause Text's Regenerate walks the graph backwards and re-rolls every widget
// whose name matches /seed/i (js/pause_text/index.js::randomizeUpstreamSeeds).
// That covers Seed Pixaroma, KSampler and anything else built on native
// widgets, and it silently MISSES every node that keeps its seed in a hidden
// state blob instead (Vue Compat #9) - which is how AI Prompt and Video Prompt
// are built.
//
// Reported 2026-08-16: "the regenerate button in the text pause node doesn't
// seem to be able to trigger the upstream AI Prompt node's seed generator".
// Measured cause: with the seed mode on Fixed, AI Prompt's injected state is
// byte-identical between runs, so the model is cached and the same text comes
// back. On Random it already worked, because seedForRun rolls per run - which
// is why it looked intermittent.
//
// A node opts in by registering a roller. Keeping this as a registry rather
// than a list of class names inside Pause Text means neither node has to import
// the other, and a new state-blob node only edits its own directory.
// ---------------------------------------------------------------------------

const ROLLERS = new Map();

/**
 * Teach the seed walkers how to roll THIS node type's hidden seed.
 *
 * @param {string} comfyClass  exact class, as in NODE_CLASS_MAPPINGS
 * @param {(node: object) => boolean|void} fn  rolls the seed; return false to
 *        report "nothing rolled" (e.g. the node is in a mode that pins it)
 */
export function registerSeedRoller(comfyClass, fn) {
  if (typeof comfyClass === "string" && typeof fn === "function") {
    ROLLERS.set(comfyClass, fn);
  }
}

/**
 * Roll a hidden seed if this node type registered a way to.
 * Returns true only when something actually changed, so a caller can keep an
 * honest "no seed found upstream" count.
 *
 * Never throws: a broken roller in one node must not take down a Regenerate
 * that is also walking several healthy ones.
 */
export function rollNodeSeed(node) {
  const fn = node && ROLLERS.get(node.comfyClass);
  if (!fn) return false;
  try {
    return fn(node) !== false;
  } catch (e) {
    console.warn("[Pixaroma] seed roller failed for", node?.comfyClass, e);
    return false;
  }
}
