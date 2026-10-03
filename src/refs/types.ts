export type RefType = "branch" | "tag" | "pull_request"

export interface NormalizedRef {
  name: string
  type: RefType
  full: string
  /** `owner/repo` the ref lives in. Only set for pull request head/base when GitHub provides it. */
  repository?: string
}

export interface RefContext {
  /** Derived from `github.ref`; the workflow's primary ref. */
  ref?: NormalizedRef
  /** Pull request head. Never the same thing as `ref`. */
  head?: NormalizedRef
  /** Pull request base. */
  base?: NormalizedRef
}
