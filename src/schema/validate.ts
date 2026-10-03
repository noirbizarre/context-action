import { Ajv } from "ajv"
import Ajv2019 from "ajv/dist/2019.js"
import Ajv2020 from "ajv/dist/2020.js"
import type { ErrorObject } from "ajv"
import addFormats from "ajv-formats"

import { ConfigError } from "../errors.ts"

export interface ValidationIssue {
  /** JSON pointer into the normalized inputs; `/` is the root. */
  path: string
  message: string
}

export type ValidationResult =
  | { status: "skipped" }
  | { status: "valid" }
  | { status: "invalid"; errors: ValidationIssue[] }
  /** The schema (or its configuration) could not be used. */
  | { status: "error"; message: string }

const DRAFT_2020 = "https://json-schema.org/draft/2020-12/schema"
const DRAFT_2019 = "https://json-schema.org/draft/2019-09/schema"
const DRAFT_07 = "http://json-schema.org/draft-07/schema"

type AjvInstance =
  | InstanceType<typeof Ajv>
  | InstanceType<typeof Ajv2019>
  | InstanceType<typeof Ajv2020>

function createAjv(schema: unknown): AjvInstance {
  const declared =
    typeof schema === "object" && schema !== null && "$schema" in schema
      ? (schema as { $schema: unknown })["$schema"]
      : undefined

  const options = { allErrors: true, logger: false } as const

  if (declared === undefined) return new Ajv2020(options)
  if (typeof declared === "string") {
    const id = declared.replace(/#$/, "")
    if (id === DRAFT_2020) return new Ajv2020(options)
    if (id === DRAFT_2019) return new Ajv2019(options)
    if (id === DRAFT_07) return new Ajv(options)
  }
  throw new ConfigError("Unsupported `$schema`. Supported drafts: 2020-12, 2019-09 and draft-07.")
}

function escapePointer(segment: string): string {
  return segment.replaceAll("~", "~0").replaceAll("/", "~1")
}

function describeValue(value: unknown): string {
  return typeof value === "string" ? `\`${value}\`` : `\`${JSON.stringify(value)}\``
}

export function formatError(error: ErrorObject): ValidationIssue {
  let path = error.instancePath
  const params = error.params as Record<string, unknown>
  // Never echo offending data: messages are built from schema-side parameters only.
  let message = error.message ?? "is invalid"

  switch (error.keyword) {
    case "required":
      path += `/${escapePointer(String(params["missingProperty"]))}`
      message = "is required"
      break
    case "additionalProperties":
      path += `/${escapePointer(String(params["additionalProperty"]))}`
      message = "is not allowed (additional property)"
      break
    case "enum": {
      const allowed = params["allowedValues"]
      message = Array.isArray(allowed)
        ? `must be one of ${allowed.map(describeValue).join(", ")}`
        : "must be one of the allowed values"
      break
    }
    case "type":
      message = `must be ${Array.isArray(params["type"]) ? params["type"].join(" or ") : String(params["type"])}`
      break
    case "format":
      message = `must match the "${String(params["format"])}" format`
      break
    case "pattern":
      message = `must match the expected format (\`${String(params["pattern"])}\`)`
      break
    default:
      break
  }

  return { path: path === "" ? "/" : path, message }
}

/**
 * Validate normalized input values against a JSON Schema.
 *
 * No schema means success. The schema is cloned before compilation and no
 * mutating Ajv option (`useDefaults`, `coerceTypes`, `removeAdditional`) is
 * enabled, so neither schema nor data is ever modified.
 */
export function validateInputs(schema: unknown, values: Record<string, unknown>): ValidationResult {
  if (schema === undefined) return { status: "skipped" }

  try {
    const ajv = createAjv(schema)
    addFormats(ajv)
    const validate = ajv.compile(structuredClone(schema) as object)

    if (validate(values)) return { status: "valid" }
    // Sorted by path so the report does not depend on keyword order in the schema.
    const errors = (validate.errors ?? [])
      .map(formatError)
      .toSorted((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    return { status: "invalid", errors }
  } catch (error) {
    if (error instanceof ConfigError) return { status: "error", message: error.message }
    const detail = error instanceof Error ? error.message : "unknown error"
    return { status: "error", message: `Malformed schema: ${detail}` }
  }
}
