import { describe, expect, it } from "vitest"

import { loadEvent } from "../../test/fixtures/index.ts"
import { buildContext } from "../context/build.ts"
import type { NormalizedContext } from "../context/types.ts"
import { renderSummary } from "./render.ts"

const ctx = (
  inputs: NormalizedContext["inputs"],
  event = "workflow_dispatch",
): NormalizedContext => ({
  event,
  inputs,
  ref: { ref: { name: "main", type: "branch", full: "refs/heads/main" } },
})

describe("renderSummary", () => {
  it("renders a valid workflow_dispatch context", () => {
    const md = renderSummary(
      ctx({
        source: "workflow_dispatch",
        values: { environment: "production", dry_run: true },
      }),
      { status: "valid" },
    )
    expect(md).toBe(
      [
        "## Action Context",
        "",
        "| Property | Value |",
        "|---|---|",
        "| Event | `workflow_dispatch` |",
        "| Input source | `workflow_dispatch` |",
        "",
        "### Inputs",
        "",
        "| Name | Value | Type |",
        "|---|---|---|",
        "| `environment` | `production` | string |",
        "| `dry_run` | `true` | boolean |",
        "",
        "### Reference",
        "",
        "| Property | Value |",
        "|---|---|",
        "| Type | branch |",
        "| Name | `main` |",
        "| Ref | `refs/heads/main` |",
        "",
        "### Validation",
        "",
        "✓ Valid",
        "",
      ].join("\n"),
    )
  })

  it("lists actionable validation errors", () => {
    const md = renderSummary(ctx({ source: "workflow_call", values: {} }), {
      status: "invalid",
      errors: [
        { path: "/environment", message: "must be one of `staging`, `production`" },
        { path: "/", message: "must NOT have fewer than 1 properties" },
      ],
    })
    expect(md).toContain(
      [
        "### Validation",
        "",
        "✗ Invalid",
        "",
        "- `/environment`: must be one of `staging`, `production`",
        "- `/`: must NOT have fewer than 1 properties",
      ].join("\n"),
    )
  })

  it("reports schema configuration errors", () => {
    const md = renderSummary(ctx({ source: "none", values: {} }), {
      status: "error",
      message: "The inline `schema` is not valid JSON.",
    })
    expect(md).toContain("✗ Invalid configuration")
    expect(md).toContain("- The inline `schema` is not valid JSON.")
  })

  it("reports skipped validation and empty inputs", () => {
    const md = renderSummary(ctx({ source: "none", values: {} }), { status: "skipped" })
    expect(md).toContain("_No inputs._")
    expect(md).toContain("– Skipped (no `schema` supplied)")
  })

  it("distinguishes empty strings and shows non-scalar types", () => {
    const md = renderSummary(
      ctx({ source: "repository_dispatch", values: { a: "", n: 3, o: { x: 1 }, l: [1], z: null } }),
      { status: "skipped" },
    )
    expect(md).toContain('| `a` | `""` | string |')
    expect(md).toContain("| `n` | `3` | number |")
    expect(md).toContain('| `o` | `{"x":1}` | object |')
    expect(md).toContain("| `l` | `[1]` | array |")
    expect(md).toContain("| `z` | `null` | null |")
  })

  it("neutralizes markdown in untrusted names and values", () => {
    const md = renderSummary(
      ctx({
        source: "repository_dispatch",
        values: { "na`me|x": "a|b`c\n| injected | row |\n## heading <img src=x>" },
      }),
      { status: "skipped" },
    )
    const row = md.split("\n").find((line) => line.includes("na'me"))
    expect(row).toBeDefined()
    // single line, balanced code spans, escaped pipes
    expect(row).toBe(
      "| `na'me\\|x` | `a\\|b'c \\| injected \\| row \\| ## heading <img src=x>` | string |",
    )
  })

  it("truncates very long values", () => {
    const md = renderSummary(ctx({ source: "workflow_call", values: { big: "x".repeat(5000) } }), {
      status: "skipped",
    })
    expect(md.length).toBeLessThan(1500)
    expect(md).toContain("…")
  })

  it("renders pull request head and base without confusing them with ref", () => {
    const context = buildContext(loadEvent("pull_request_fork"))
    const md = renderSummary(context, { status: "skipped" })
    expect(md).toContain("| Ref | `refs/pull/43/merge` |")
    expect(md).toContain("| Head | `refs/heads/patch-1` (`contributor/repo`) |")
    expect(md).toContain("| Base | `refs/heads/main` (`octo/repo`) |")
  })

  it("says so when no reference can be determined", () => {
    const md = renderSummary(buildContext(loadEvent("unknown_event")), { status: "skipped" })
    expect(md).toContain("_No reference could be determined for this event._")
  })

  it("never prints unselected payload content", () => {
    const md = renderSummary(buildContext(loadEvent("push_branch")), { status: "skipped" })
    expect(md).not.toContain("secret-ish")
    expect(md).not.toContain("commits")
  })
})
