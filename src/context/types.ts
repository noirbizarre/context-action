import type { NormalizedInputs } from "../inputs/types.ts"
import type { RefContext } from "../refs/types.ts"

export interface NormalizedContext {
  /** GitHub event name (`github.event_name`). */
  event: string
  inputs: NormalizedInputs
  ref: RefContext
}
