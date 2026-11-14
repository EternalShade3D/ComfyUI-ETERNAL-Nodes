// Reading a LiteGraph slot's type WITHOUT tripping over ComfyUI's multi-type inputs.
//
// A slot type used to be one name ("FLOAT") or the wildcard ("*"). Since ComfyUI's
// V3 schema API it can also be a COMMA-JOINED list of every name the slot accepts:
// `io.MultiType.Input("value", [io.Float, io.Int, io.Boolean])` reaches the browser
// as the literal string "FLOAT,INT,BOOLEAN" (comfy_api/latest/_io.py, MultiType
// .get_io_type -> ",".join(...)). Core's own Math Expression node is built that way.
//
// Reading that string as ONE name is a silent, expensive failure: an exact-equality
// check says it is not a value input, and the node then SEVERS a wire the user just
// drew. LiteGraph itself is fine with the connection (its isValidConnection splits
// on the comma), so the wire attaches and disappears a tick later - which reads as
// "it will not connect" with no error to search for. Control Panel and Dropdown both
// did this until 2026-08-03.
//
// Pure module on purpose: no ComfyUI imports, so it is unit-testable outside the app.

// What a single control should become when a slot accepts several types at once.
// FLOAT leads because a decimal slider is the most expressive control and every
// multi-type numeric input that accepts INT accepts FLOAT too; STRING and COMBO
// trail because a slot offering them alongside a number is really a number slot.
export const DEFAULT_NARROW_ORDER = ["FLOAT", "INT", "BOOLEAN", "STRING", "COMBO"];

/** "FLOAT,INT,BOOLEAN" -> ["FLOAT","INT","BOOLEAN"]; "FLOAT" -> ["FLOAT"]; "" -> []. */
export function slotTypeList(type) {
  // A slot type is normally a string, but LiteGraph tolerates a number (0 is the
  // historical "any" for some forks) and our own code sometimes hands over
  // undefined for a slot that has not been typed yet.
  if (type == null) return [];
  return String(type)
    .split(",")
    .map((x) => x.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * True for the wildcard slot and for an untyped one - both accept anything.
 *
 * EVERY falsy value counts, not just null/"". The call sites this replaced all
 * read the type as `String(slot.type || "")`, so 0 - which LiteGraph uses as a
 * wildcard in places - collapsed to "" and was accepted. Treating it as the
 * literal type "0" instead would make a node sever a wire it used to allow,
 * which is the exact bug this module exists to stop.
 */
export function isWildcardType(type) {
  if (!type) return true;
  const s = String(type).trim();
  return s === "" || s === "*";
}

/**
 * Would a slot of `slotType` accept a value of `ourType`?
 * Either side may be a wildcard or a comma-joined multi-type.
 */
export function slotAccepts(slotType, ourType) {
  if (isWildcardType(slotType) || isWildcardType(ourType)) return true;
  const accepts = slotTypeList(slotType);
  const ours = slotTypeList(ourType);
  return ours.some((o) => accepts.includes(o));
}

/**
 * Collapse a possibly-multi slot type down to the ONE type a single control
 * should adopt. Returns "" for a wildcard/untyped slot, so callers keep their
 * existing "no type" branch. A single-type slot is returned unchanged (upper-cased),
 * which is why this can be dropped in at a read site without touching the
 * comparisons underneath it.
 */
export function narrowSlotType(slotType, order = DEFAULT_NARROW_ORDER) {
  if (isWildcardType(slotType)) return "";
  const list = slotTypeList(slotType);
  if (list.length <= 1) return list[0] || "";
  for (const want of order) if (list.includes(want)) return want;
  return list[0];
}
