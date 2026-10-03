import { ConfigError } from "../errors.ts"
import { isPlainObject, type RawContext } from "../github/event.ts"
import type { DeclaredTypes, RawInputs } from "./types.ts"
import { loadDeclaredTypes } from "./workflow-file.ts"

export interface DetectOptions {
  /** Value of the `inputs` action input (expected `${{ toJSON(inputs) }}`). */
  inputsJson?: string | undefined
  /** Opt in to exposing `repository_dispatch` `client_payload`. */
  clientPayload?: boolean | undefined
}

export interface DetectDeps {
  loadDeclaredTypes: (raw: RawContext, warn: (message: string) => void) => DeclaredTypes | undefined
  warn: (message: string) => void
}

const defaultDeps: DetectDeps = {
  loadDeclaredTypes,
  warn: () => {},
}

type Adapter = (raw: RawContext, options: DetectOptions, deps: DetectDeps) => RawInputs | undefined

/**
 * Event adapters read inputs from the event payload. To support a new event,
 * add an entry here; the domain model, validation and summary do not change.
 */
const adapters: Readonly<Record<string, Adapter>> = {
  workflow_dispatch(raw, _options, deps) {
    const payloadInputs = raw.payload["inputs"]
    const values = isPlainObject(payloadInputs) ? payloadInputs : {}
    const declaredTypes = deps.loadDeclaredTypes(raw, deps.warn)
    return {
      source: "workflow_dispatch",
      values,
      ...(declaredTypes ? { declaredTypes } : {}),
    }
  },

  repository_dispatch(raw, options) {
    if (!options.clientPayload) return undefined
    const payload = raw.payload["client_payload"]
    if (!isPlainObject(payload)) return undefined
    return { source: "repository_dispatch", values: payload }
  },
}

/**
 * Parse the `inputs` action input. Returns undefined when not supplied
 * (empty or JSON `null`, which is what `toJSON(inputs)` yields outside
 * workflow_dispatch / workflow_call). Error messages never echo the content.
 */
export function parseInputsJson(text: string | undefined): Record<string, unknown> | undefined {
  if (text === undefined || text.trim() === "") return undefined

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ConfigError("The `inputs` action input is not valid JSON.")
  }
  if (parsed === null) return undefined
  if (!isPlainObject(parsed)) {
    throw new ConfigError("The `inputs` action input must be a JSON object.")
  }
  return parsed
}

/**
 * Select exactly one input source for this run.
 *
 * 1. `inputs` action input: already typed by GitHub. In a reusable workflow
 *    `github.event_name` is the caller's event, so anything other than
 *    `workflow_dispatch` is treated as `workflow_call`.
 * 2. Event adapter reading the event payload.
 * 3. No inputs.
 */
export function detectInputs(
  raw: RawContext,
  options: DetectOptions = {},
  deps: DetectDeps = defaultDeps,
): RawInputs {
  const typed = parseInputsJson(options.inputsJson)
  if (typed !== undefined) {
    return {
      source: raw.eventName === "workflow_dispatch" ? "workflow_dispatch" : "workflow_call",
      values: typed,
    }
  }

  const adapter = Object.hasOwn(adapters, raw.eventName) ? adapters[raw.eventName] : undefined
  return adapter?.(raw, options, deps) ?? { source: "none", values: {} }
}
