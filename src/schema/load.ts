import { readFileSync, realpathSync } from "node:fs"
import path from "node:path"

import { ConfigError } from "../errors.ts"

/**
 * Load a JSON Schema from the `schema` action input.
 *
 * - Empty / whitespace: no schema (returns undefined).
 * - Starts with `{` after trimming: inline JSON.
 * - Otherwise: a path relative to the workspace, which must stay inside it.
 *
 * The schema is returned exactly as parsed; it is never modified.
 */
export function loadSchema(input: string | undefined, workspace: string): unknown {
  const text = input?.trim() ?? ""
  if (text === "") return undefined

  if (text.startsWith("{")) return parseJson(text, "The inline `schema`")
  return parseJson(readSchemaFile(text, workspace), `The schema file \`${text}\``)
}

function readSchemaFile(file: string, workspace: string): string {
  const root = path.resolve(workspace)
  const candidate = path.resolve(root, file)

  let realRoot: string
  let realFile: string
  try {
    realRoot = realpathSync(root)
    realFile = realpathSync(candidate)
  } catch {
    throw new ConfigError(`The schema file \`${file}\` could not be found in the workspace.`)
  }

  if (realFile !== realRoot && !realFile.startsWith(realRoot + path.sep)) {
    throw new ConfigError(`The schema file \`${file}\` must be located inside the workspace.`)
  }

  try {
    return readFileSync(realFile, "utf8")
  } catch {
    throw new ConfigError(`The schema file \`${file}\` could not be read.`)
  }
}

function parseJson(text: string, label: string): unknown {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new ConfigError(`${label} is not valid JSON.`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ConfigError(`${label} must be a JSON object.`)
  }
  return parsed
}
