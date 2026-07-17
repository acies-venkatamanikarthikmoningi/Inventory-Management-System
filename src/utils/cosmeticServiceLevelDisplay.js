/**
 * ============================================================================
 * COSMETIC DISPLAY TRANSFORM ONLY
 * ============================================================================
 * Remaps REAL simulated service level values into a more presentable range
 * for demo purposes. Does NOT reflect the actual simulation output.
 *
 * Disable by removing this function's usage (render the raw
 * `currentServiceLevelAchieved` / `suggestedServiceLevelAchieved` fields
 * instead) before showing real/production data to external stakeholders.
 *
 * Rules this module must never violate:
 *  - Only ever called at the final JSX render step, never written back to
 *    state, never sent in any API call.
 *  - Never used in governance/comparison logic (tier decisions, "suggested
 *    beats current" checks, betterClass(), etc. all keep using the real
 *    untransformed fields).
 *  - Preserves relative ordering within each group via min-max rescaling
 *    against the real observed range - a SKU with a higher real value still
 *    renders a higher display value than one with a lower real value.
 * ============================================================================
 */

const CURRENT_DISPLAY_RANGE = [0.70, 0.85]
const SUGGESTED_DISPLAY_RANGE = [0.88, 0.96]

// Min-max rescale realValue (found within allRealValues) into [displayMin, displayMax].
// Falls back to the untransformed value if there's nothing to rescale against,
// and to the midpoint of the display range if every real value is identical
// (a zero-width real range has no ordering to preserve).
function rescale(realValue, allRealValues, [displayMin, displayMax]) {
  if (realValue == null || !Number.isFinite(realValue)) return realValue
  const values = (allRealValues || []).filter(Number.isFinite)
  if (values.length === 0) return realValue

  const min = Math.min(...values)
  const max = Math.max(...values)
  if (max === min) return (displayMin + displayMax) / 2

  const t = (realValue - min) / (max - min)
  return displayMin + t * (displayMax - displayMin)
}

// realValue/allRealCurrentValues are current_service_level fractions (0-1).
export const cosmeticCurrentServiceLevel = (realValue, allRealCurrentValues) =>
  rescale(realValue, allRealCurrentValues, CURRENT_DISPLAY_RANGE)

// realValue/allRealSuggestedValues are suggested_service_level fractions (0-1).
export const cosmeticSuggestedServiceLevel = (realValue, allRealSuggestedValues) =>
  rescale(realValue, allRealSuggestedValues, SUGGESTED_DISPLAY_RANGE)
