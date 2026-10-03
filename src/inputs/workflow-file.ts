import { readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { parse } from "yaml"

import { isPlainObject, type RawContext } from "../github/event.ts"
import type { DeclaredTypes } from "./types.ts"

/**
 * Extract `on.workflow_dispatch.inputs.<name>.type` from workflow YAML text.
 * A declared input without an explicit `type` is a `string` (GitHub's default).
 * Throws on malformed YAML.
 */
export function parseDeclaredTypes(yamlText: string): DeclaredTypes {
  const doc: unknown = parse(yamlText)
  if (!isPlainObject(doc)) return {}

  const on = doc["on"]
  if (!isPlainObject(on)) return {}

  const dispatch = on["workflow_dispatch"]
  if (!isPlainObject(dispatch)) return {}

  const inputs = dispatch["inputs"]
  if (!isPlainObject(inputs)) return {}

  const types: Record<string, string> = {}
  for (const [name, declaration] of Object.entries(inputs)) {
    const type = isPlainObject(declaration) ? declaration["type"] : undefined
    types[name] = typeof type === "string" ? type : "string"
  }
  return types
}

/**
 * Resolve `GITHUB_WORKFLOW_REF` to a file inside the workspace.
 * Returns undefined when the reference belongs to another repository, is
 * malformed, or escapes the workspace.
 */
export function resolveWorkflowPath(
  workflowRef: string,
  workspace: string,
  repository: string | undefined,
): string | undefined {
  const at = workflowRef.indexOf("@")
  const location = at === -1 ? workflowRef : workflowRef.slice(0, at)
  const segments = location.split("/")
  if (segments.length < 3) return undefined

  const [owner, repo, ...rest] = segments
  if (repository !== undefined && `${owner}/${repo}` !== repository) return undefined

  const relative = rest.join("/")
  if (!relative.startsWith(".github/workflows/")) return undefined

  const resolved = path.resolve(workspace, relative)
  const root = path.resolve(workspace)
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return undefined
  return resolved
}

function isInside(root: string, target: string): boolean {
  return target === root || target.startsWith(root + path.sep)
}

/**
 * Load declared input types from the checked-out workflow file.
 * Never throws: on any problem a content-free warning is emitted and
 * `undefined` is returned, so values simply stay strings.
 */
export function loadDeclaredTypes(
  raw: Pick<RawContext, "workflowRef" | "workspace" | "repository">,
  warn: (message: string) => void,
): DeclaredTypes | undefined {
  const { workflowRef, workspace, repository } = raw
  if (!workflowRef || !workspace) {
    warn("Cannot locate the workflow file; workflow_dispatch inputs are kept as strings.")
    return undefined
  }

  const resolved = resolveWorkflowPath(workflowRef, workspace, repository)
  if (resolved === undefined) {
    warn("Workflow file is not in the workspace; workflow_dispatch inputs are kept as strings.")
    return undefined
  }

  try {
    const real = realpathSync(resolved)
    if (!isInside(realpathSync(workspace), real)) {
      warn("Workflow file is outside the workspace; workflow_dispatch inputs are kept as strings.")
      return undefined
    }
    return parseDeclaredTypes(readFileSync(real, "utf8"))
  } catch {
    warn(
      "Could not read or parse the workflow file (is the repository checked out?); " +
        "workflow_dispatch inputs are kept as strings.",
    )
    return undefined
  }
}
