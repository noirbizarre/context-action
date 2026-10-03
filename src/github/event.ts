import { context } from "@actions/github"

/**
 * The minimal, GitHub-specific slice of the Actions context this action consumes.
 * It is the only boundary between `@actions/github` and the normalized domain model.
 * `payload` is untrusted and only ever read through narrow, explicit accessors.
 */
export interface RawContext {
  eventName: string
  /** `github.ref` (may be empty for events without a ref). */
  ref: string
  payload: Record<string, unknown>
  /** `GITHUB_WORKFLOW_REF`, e.g. `owner/repo/.github/workflows/x.yml@refs/heads/main`. */
  workflowRef: string | undefined
  /** `GITHUB_WORKSPACE`. */
  workspace: string | undefined
  /** `GITHUB_REPOSITORY`, e.g. `owner/repo`. */
  repository: string | undefined
}

export function fromActionsContext(): RawContext {
  return {
    eventName: context.eventName,
    ref: context.ref ?? "",
    payload: (context.payload ?? {}) as Record<string, unknown>,
    workflowRef: process.env["GITHUB_WORKFLOW_REF"] || undefined,
    workspace: process.env["GITHUB_WORKSPACE"] || undefined,
    repository: process.env["GITHUB_REPOSITORY"] || undefined,
  }
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
