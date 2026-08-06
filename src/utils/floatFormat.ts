// Printing a float32 back as the number someone typed.
//
// Every Parameter value lives in a Float32Array (the SharedArrayBuffer the
// script runtime reads), so `0.3` is stored as the nearest float32 and comes
// back out of the array as the double 0.30000001192092896. Printing that with
// String() is what put "0.30000001192092896" in the Param Editor's cells: the
// digits are real, but they are an artefact of the storage, not a value anyone
// entered.
//
// Rounding the display to a fixed number of decimals (`toFixed(3)`) hides the
// artefact but lies in the other direction — a gain of 2.5e-5 or a counter at
// 120000.5 both read as something they are not, and an editor that shows a
// value it will not write back is worse than a noisy one.
//
// So: the SHORTEST decimal string that still round-trips to the same float32.
// `0.3` prints as "0.3" because Math.fround(0.3) is exactly the stored value,
// while a value that genuinely needs nine digits still gets them. This is the
// same rule JS itself uses for doubles (String(0.3) === "0.3"), applied one
// precision down.

/**
 * Shortest decimal string that reads back as the same float32.
 *
 * `value` is expected to have come out of a Float32Array; a double that is not
 * float32-representable falls through the loop and is printed in full.
 */
export function formatFloat32(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  // Integers are already exact and already shortest — and this keeps -0 from
  // printing as "0" via the toPrecision path below.
  if (Number.isInteger(value)) return String(value);
  for (let precision = 1; precision <= 9; precision += 1) {
    const candidate = Number(value.toPrecision(precision));
    if (Math.fround(candidate) === value) return String(candidate);
  }
  return String(value);
}
