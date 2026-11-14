// Can a text encoder SEE, and can it HEAR? Two hints, from the filename alone.
//
// SHARED because it had already drifted. Video Prompt kept its own copy testing
// only /vl/i, so it marked `gemma4_e4b_it_fp8_scaled` "(no vision)" - a model
// this pack SHIPS presets for that read a video and describe what they hear.
// The user spotted it in the picker (2026-08-19). One concept, two copies, one
// of them stale: the fix is one home, not a better regex in two places.
//
// ⚠️ ComfyUI itself decides this from the file's CONTENTS, not its name
// (`detect_te_model` reads the state dict), which a picker listing filenames
// cannot do. So these stay HINTS: mark, never block. A renamed file is
// legitimate and must still be choosable.
//
// Being wrong in the direction of "no mark" is the safe way round: an unmarked
// text-only model wastes one run, while a model wrongly marked blind is one the
// user is told not to use when it would have worked - which is exactly the bug
// this module exists to stop.

/**
 * Does this look like a model that can read a PICTURE?
 *
 * Not just "vl": Gemma 4's tokenizer takes an `image` argument
 * (`comfy/text_encoders/gemma4.py` tokenize_with_weights) and so does Qwen3.5's,
 * and neither carries "vl" in its name.
 */
export function looksVision(name) {
  return /vl|gemma\W?4|qwen\W?3\.?5/i.test(String(name || ""));
}

/**
 * ...and can it HEAR?
 *
 * Gemma 4 is the only text encoder in ComfyUI whose tokenizer accepts an
 * `audio` argument. Every Qwen3-VL takes the audio, ignores it and answers
 * anyway - which is why this is worth marking POSITIVELY rather than trusting
 * a confident-sounding answer.
 */
export function looksAudio(name) {
  return /gemma\W?4/i.test(String(name || ""));
}
