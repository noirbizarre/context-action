import * as core from "@actions/core"

import { buildContext } from "./context/build.ts"
import type { NormalizedContext } from "./context/types.ts"
import { ConfigError } from "./errors.ts"
import { fromActionsContext, type RawContext } from "./github/event.ts"
import { loadDeclaredTypes } from "./inputs/workflow-file.ts"
import { normalizeRefs } from "./refs/normalize.ts"
import { loadSchema } from "./schema/load.ts"
import { validateInputs, type ValidationResult } from "./schema/validate.ts"
import { renderSummary } from "./summary/render.ts"

function fallbackContext(raw: RawContext): NormalizedContext {
  return {
    event: raw.eventName,
    inputs: { values: {}, source: "none" },
    ref: normalizeRefs(raw),
  }
}

function describeFailure(validation: ValidationResult): string | undefined {
  switch (validation.status) {
    case "invalid":
      return `Input validation failed with ${validation.errors.length} error(s). See the Job Summary.`
    case "error":
      return validation.message
    default:
      return undefined
  }
}

/**
 * Orchestrates the pipeline:
 * GitHub context -> adapters -> normalized model -> schema validation -> outputs / summary.
 * Never logs input values or event payloads.
 */
export async function run(): Promise<void> {
  const raw = fromActionsContext()
  let validation: ValidationResult
  let ctx: NormalizedContext

  try {
    ctx = buildContext(
      raw,
      {
        inputsJson: core.getInput("inputs"),
        clientPayload: core.getInput("client-payload").trim().toLowerCase() === "true",
      },
      { loadDeclaredTypes, warn: (message) => core.warning(message) },
    )
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    ctx = fallbackContext(raw)
    validation = { status: "error", message: error.message }
    return finish(ctx, validation)
  }

  try {
    const schema = loadSchema(core.getInput("schema"), raw.workspace ?? process.cwd())
    validation = validateInputs(schema, ctx.inputs.values)
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error
    validation = { status: "error", message: error.message }
  }

  return finish(ctx, validation)
}

async function finish(ctx: NormalizedContext, validation: ValidationResult): Promise<void> {
  const valid = validation.status === "valid" || validation.status === "skipped"

  core.setOutput("inputs", JSON.stringify(ctx.inputs.values))
  core.setOutput("context", JSON.stringify(ctx))
  core.setOutput("event", ctx.event)
  core.setOutput("ref", JSON.stringify(ctx.ref))
  core.setOutput("valid", valid ? "true" : "false")

  if (core.getInput("summary").trim().toLowerCase() !== "false") {
    try {
      await core.summary.addRaw(renderSummary(ctx, validation), true).write()
    } catch {
      core.warning("Could not write the Job Summary.")
    }
  }

  const failure = describeFailure(validation)
  if (failure !== undefined) core.setFailed(failure)
}
