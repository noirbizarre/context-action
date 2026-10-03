import type { DeclaredTypes, NormalizedInputs, RawInputs } from "./types.ts"

const NUMBER_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/

/**
 * Coerce a single value according to its declared type.
 *
 * Only string values are ever considered, and only when the declared type is
 * `boolean` or `number`. Anything that is not an exact canonical representation
 * stays a string: there is no trimming, no case folding, no empty-string coercion.
 */
export function coerceValue(value: unknown, declaredType: string | undefined): unknown {
  if (typeof value !== "string") return value

  if (declaredType === "boolean") {
    if (value === "true") return true
    if (value === "false") return false
    return value
  }

  if (declaredType === "number") {
    if (NUMBER_PATTERN.test(value)) {
      const parsed = Number(value)
      if (Number.isFinite(parsed)) return parsed
    }
    return value
  }

  return value
}

/**
 * Normalize raw inputs into the stable representation.
 *
 * Deterministic: keys are sorted so the serialized JSON is identical for
 * equivalent invocations regardless of source. Never recurses into values.
 */
export function normalizeInputs(raw: RawInputs): NormalizedInputs {
  const declared: DeclaredTypes = raw.declaredTypes ?? {}
  const entries = Object.entries(raw.values)
    .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]): [string, unknown] => [
      key,
      coerceValue(value, Object.hasOwn(declared, key) ? declared[key] : undefined),
    ])

  // Object.fromEntries defines own properties, so a `__proto__` key stays plain data.
  return { values: Object.fromEntries(entries), source: raw.source }
}
