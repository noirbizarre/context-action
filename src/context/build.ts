import type { RawContext } from "../github/event.ts"
import { detectInputs, type DetectDeps, type DetectOptions } from "../inputs/detect.ts"
import { normalizeInputs } from "../inputs/normalize.ts"
import { normalizeRefs } from "../refs/normalize.ts"
import type { NormalizedContext } from "./types.ts"

/** GitHub event/context -> adapters -> normalized domain model. */
export function buildContext(
  raw: RawContext,
  options: DetectOptions = {},
  deps?: DetectDeps,
): NormalizedContext {
  return {
    event: raw.eventName,
    inputs: normalizeInputs(detectInputs(raw, options, deps)),
    ref: normalizeRefs(raw),
  }
}
