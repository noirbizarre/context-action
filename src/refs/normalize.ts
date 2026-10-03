import { isPlainObject, type RawContext } from "../github/event.ts"
import type { NormalizedRef, RefContext } from "./types.ts"

const HEADS = "refs/heads/"
const TAGS = "refs/tags/"
const PULL = "refs/pull/"
const PULL_REF = /^(\d+)\/(merge|head)$/

/**
 * Parse a fully-qualified git ref. Returns undefined for anything that cannot
 * be classified reliably (empty, unknown namespace, empty name).
 */
export function parseFullRef(full: string | undefined | null): NormalizedRef | undefined {
  if (!full) return undefined

  if (full.startsWith(HEADS)) {
    const name = full.slice(HEADS.length)
    return name ? { name, type: "branch", full } : undefined
  }
  if (full.startsWith(TAGS)) {
    const name = full.slice(TAGS.length)
    return name ? { name, type: "tag", full } : undefined
  }
  if (full.startsWith(PULL)) {
    const name = full.slice(PULL.length)
    return PULL_REF.test(name) ? { name, type: "pull_request", full } : undefined
  }
  return undefined
}

function branchRef(name: unknown, repository: unknown): NormalizedRef | undefined {
  if (typeof name !== "string" || name === "") return undefined
  const ref: NormalizedRef = { name, type: "branch", full: `${HEADS}${name}` }
  if (typeof repository === "string" && repository !== "") ref.repository = repository
  return ref
}

/** Events whose payload carries a `pull_request` object with distinct head/base refs. */
const PULL_REQUEST_EVENTS: ReadonlySet<string> = new Set([
  "pull_request",
  "pull_request_target",
  "pull_request_review",
  "pull_request_review_comment",
])

function pullRequestSide(pr: Record<string, unknown>, side: "head" | "base") {
  const node = pr[side]
  if (!isPlainObject(node)) return undefined
  const repo = isPlainObject(node["repo"]) ? node["repo"]["full_name"] : undefined
  return branchRef(node["ref"], repo)
}

/**
 * Derive normalized refs. `github.ref` itself is untouched; this only adds
 * structure. Fields are omitted whenever they cannot be determined reliably.
 */
export function normalizeRefs(raw: Pick<RawContext, "eventName" | "ref" | "payload">): RefContext {
  const result: RefContext = {}

  const primary = parseFullRef(raw.ref)
  if (primary) result.ref = primary

  if (PULL_REQUEST_EVENTS.has(raw.eventName)) {
    const pr = raw.payload["pull_request"]
    if (isPlainObject(pr)) {
      const head = pullRequestSide(pr, "head")
      const base = pullRequestSide(pr, "base")
      if (head) result.head = head
      if (base) result.base = base
    }
  }

  return result
}
