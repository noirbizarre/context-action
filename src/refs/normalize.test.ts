import { describe, expect, it } from "vitest"

import { loadEvent } from "../../test/fixtures/index.ts"
import { normalizeRefs, parseFullRef } from "./normalize.ts"

describe("parseFullRef", () => {
  it("parses branches, keeping slashes in the name", () => {
    expect(parseFullRef("refs/heads/main")).toEqual({
      name: "main",
      type: "branch",
      full: "refs/heads/main",
    })
    expect(parseFullRef("refs/heads/feature/login")?.name).toBe("feature/login")
  })

  it("parses tags", () => {
    expect(parseFullRef("refs/tags/v1.2.3")).toEqual({
      name: "v1.2.3",
      type: "tag",
      full: "refs/tags/v1.2.3",
    })
  })

  it("parses pull request refs", () => {
    expect(parseFullRef("refs/pull/42/merge")).toEqual({
      name: "42/merge",
      type: "pull_request",
      full: "refs/pull/42/merge",
    })
    expect(parseFullRef("refs/pull/42/head")?.name).toBe("42/head")
  })

  it.each([
    "",
    undefined,
    null,
    "main",
    "refs/heads/",
    "refs/tags/",
    "refs/remotes/origin/main",
    "refs/pull/abc/merge",
    "refs/pull/42",
    "refs/pull/42/other",
  ])("does not invent a ref from %j", (value) => {
    expect(parseFullRef(value)).toBeUndefined()
  })
})

describe("normalizeRefs", () => {
  it("push to a branch", () => {
    expect(normalizeRefs(loadEvent("push_branch"))).toEqual({
      ref: { name: "feature/login-page", type: "branch", full: "refs/heads/feature/login-page" },
    })
  })

  it("push of a tag", () => {
    expect(normalizeRefs(loadEvent("push_tag"))).toEqual({
      ref: { name: "v1.2.3", type: "tag", full: "refs/tags/v1.2.3" },
    })
  })

  it("pull request exposes ref, head and base separately", () => {
    expect(normalizeRefs(loadEvent("pull_request"))).toEqual({
      ref: { name: "42/merge", type: "pull_request", full: "refs/pull/42/merge" },
      head: {
        name: "feature/login",
        type: "branch",
        full: "refs/heads/feature/login",
        repository: "octo/repo",
      },
      base: { name: "main", type: "branch", full: "refs/heads/main", repository: "octo/repo" },
    })
  })

  it("fork pull request: head lives in another repository", () => {
    const result = normalizeRefs(loadEvent("pull_request_fork"))
    expect(result.head).toEqual({
      name: "patch-1",
      type: "branch",
      full: "refs/heads/patch-1",
      repository: "contributor/repo",
    })
    expect(result.base?.repository).toBe("octo/repo")
    expect(result.ref?.full).toBe("refs/pull/43/merge")
  })

  it("omits the head repository when GitHub does not provide it (deleted fork)", () => {
    const raw = loadEvent("pull_request_fork")
    const pr = raw.payload["pull_request"] as { head: { repo: unknown } }
    pr.head.repo = null
    expect(normalizeRefs(raw).head).toEqual({
      name: "patch-1",
      type: "branch",
      full: "refs/heads/patch-1",
    })
  })

  it("pull_request_target is handled like pull_request", () => {
    const raw = { ...loadEvent("pull_request"), eventName: "pull_request_target" }
    expect(normalizeRefs(raw).base?.name).toBe("main")
  })

  it("ignores pull_request payload on other events", () => {
    const raw = { ...loadEvent("pull_request"), eventName: "issue_comment" }
    expect(normalizeRefs(raw).head).toBeUndefined()
    expect(normalizeRefs(raw).base).toBeUndefined()
  })

  it("exposes nothing when nothing can be determined", () => {
    expect(normalizeRefs(loadEvent("unknown_event"))).toEqual({})
  })

  it("omits malformed head/base entries", () => {
    const raw = {
      ...loadEvent("pull_request"),
      payload: { pull_request: { head: { ref: 3 }, base: "main" } },
    }
    expect(normalizeRefs(raw).head).toBeUndefined()
    expect(normalizeRefs(raw).base).toBeUndefined()
  })
})
