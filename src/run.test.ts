import { beforeEach, describe, expect, it, vi } from "vitest"

import { DEPLOY_TYPED_INPUTS, loadEvent } from "../test/fixtures/index.ts"
import type { RawContext } from "./github/event.ts"

const state = vi.hoisted(() => ({
  inputs: {} as Record<string, string>,
  outputs: {} as Record<string, string>,
  summary: undefined as string | undefined,
  failed: undefined as string | undefined,
  warnings: [] as string[],
  raw: undefined as unknown,
}))

vi.mock("@actions/core", () => ({
  getInput: (name: string) => state.inputs[name] ?? "",
  setOutput: (name: string, value: string) => {
    state.outputs[name] = value
  },
  setFailed: (message: string) => {
    state.failed = message
  },
  warning: (message: string) => {
    state.warnings.push(message)
  },
  summary: {
    addRaw(text: string) {
      state.summary = text
      return this
    },
    write: async () => undefined,
  },
}))

vi.mock("./github/event.ts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./github/event.ts")>()),
  fromActionsContext: () => state.raw,
}))

const { run } = await import("./run.ts")

async function execute(event: RawContext | string, inputs: Record<string, string> = {}) {
  state.raw = typeof event === "string" ? loadEvent(event) : event
  state.inputs = inputs
  await run()
  const out = state.outputs
  return {
    out,
    inputs: JSON.parse(out["inputs"] ?? "null") as unknown,
    context: JSON.parse(out["context"] ?? "null") as unknown,
    ref: JSON.parse(out["ref"] ?? "null") as unknown,
  }
}

const SCHEMA = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "environment": { "type": "string", "enum": ["staging", "production"] },
    "dry_run": { "type": "boolean" }
  },
  "required": ["environment"],
  "additionalProperties": false
}`

const DEPLOY = { dry_run: true, environment: "production", replicas: 3, version: "1.2.3" }

beforeEach(() => {
  state.inputs = {}
  state.outputs = {}
  state.summary = undefined
  state.failed = undefined
  state.warnings = []
})

describe("outputs", () => {
  it("workflow_dispatch (strings typed via the workflow file)", async () => {
    const result = await execute("workflow_dispatch_deploy")
    expect(result.out["inputs"]).toBe(
      '{"dry_run":true,"environment":"production","replicas":3,"version":"1.2.3"}',
    )
    expect(result.out["event"]).toBe("workflow_dispatch")
    expect(result.out["valid"]).toBe("true")
    expect(result.context).toEqual({
      event: "workflow_dispatch",
      inputs: { source: "workflow_dispatch", values: DEPLOY },
      ref: { ref: { name: "main", type: "branch", full: "refs/heads/main" } },
    })
    expect(state.failed).toBeUndefined()
  })

  it("workflow_dispatch and workflow_call yield byte-identical `inputs` output", async () => {
    const dispatch = await execute("workflow_dispatch_deploy", { inputs: DEPLOY_TYPED_INPUTS })
    const dispatchOut = dispatch.out["inputs"]
    const call = await execute("workflow_call", { inputs: DEPLOY_TYPED_INPUTS })
    expect(call.out["inputs"]).toBe(dispatchOut)
    expect(call.inputs).toEqual(DEPLOY)
    expect((call.context as { inputs: { source: string } }).inputs.source).toBe("workflow_call")
    expect(call.out["event"]).toBe("push") // caller's event, left as GitHub reports it
  })

  it("repository_dispatch exposes client_payload only when opted in", async () => {
    const off = await execute("repository_dispatch")
    expect(off.inputs).toEqual({})
    expect((off.context as { inputs: { source: string } }).inputs.source).toBe("none")

    const on = await execute("repository_dispatch", { "client-payload": "true" })
    expect(on.inputs).toEqual({
      count: "3",
      dry_run: "true",
      environment: "production",
      nested: { a: "1" },
    })
    expect((on.context as { inputs: { source: string } }).inputs.source).toBe("repository_dispatch")
  })

  it("push branch / push tag / pull request / fork pull request refs", async () => {
    expect((await execute("push_branch")).ref).toEqual({
      ref: { name: "feature/login-page", type: "branch", full: "refs/heads/feature/login-page" },
    })
    expect((await execute("push_tag")).ref).toEqual({
      ref: { name: "v1.2.3", type: "tag", full: "refs/tags/v1.2.3" },
    })
    expect((await execute("pull_request")).ref).toMatchObject({
      ref: { type: "pull_request", full: "refs/pull/42/merge" },
      head: { name: "feature/login", repository: "octo/repo" },
      base: { name: "main", repository: "octo/repo" },
    })
    expect((await execute("pull_request_fork")).ref).toMatchObject({
      head: { name: "patch-1", repository: "contributor/repo" },
      base: { name: "main", repository: "octo/repo" },
    })
  })

  it("unknown event: valid JSON, empty values, no failure", async () => {
    const result = await execute("unknown_event")
    expect(result.out["inputs"]).toBe("{}")
    expect(result.out["ref"]).toBe("{}")
    expect(result.out["event"]).toBe("some_future_event")
    expect(result.out["valid"]).toBe("true")
    expect(state.failed).toBeUndefined()
  })

  it("never leaks unselected payload content into outputs or summary", async () => {
    await execute("workflow_call", { inputs: DEPLOY_TYPED_INPUTS })
    const everything = JSON.stringify(state.outputs) + (state.summary ?? "")
    expect(everything).not.toContain("must never appear")
  })
})

describe("schema validation", () => {
  it("no schema: valid, validation skipped", async () => {
    const result = await execute("workflow_dispatch_choice")
    expect(result.out["valid"]).toBe("true")
    expect(state.summary).toContain("– Skipped")
  })

  it("inline schema: success", async () => {
    await execute("workflow_dispatch_choice", { schema: SCHEMA })
    expect(state.outputs["valid"]).toBe("true")
    expect(state.summary).toContain("✓ Valid")
    expect(state.failed).toBeUndefined()
  })

  it("file schema: success", async () => {
    await execute("workflow_dispatch_deploy", { schema: ".github/action-context.schema.json" })
    expect(state.outputs["valid"]).toBe("true")
    expect(state.failed).toBeUndefined()
  })

  it("failure: sets valid=false, fails the action, lists errors; outputs stay valid JSON", async () => {
    const result = await execute("workflow_dispatch_missing", {
      schema: SCHEMA,
      inputs: '{"environment":"dev","dry_run":"true"}',
    })
    expect(result.out["valid"]).toBe("false")
    expect(result.inputs).toEqual({ dry_run: "true", environment: "dev" })
    expect(state.failed).toMatch(/2 error\(s\)/)
    expect(state.summary).toContain("✗ Invalid")
    expect(state.summary).toContain("- `/dry_run`: must be boolean")
    expect(state.summary).toContain("- `/environment`: must be one of `staging`, `production`")
  })

  it("file schema failure (staging only)", async () => {
    await execute("workflow_dispatch_choice", { schema: "schemas/strict-staging.json" })
    expect(state.outputs["valid"]).toBe("false")
    expect(state.failed).toBeDefined()
  })

  it("malformed inline schema JSON fails with a clear summary", async () => {
    const result = await execute("workflow_dispatch_choice", { schema: '{ "type": ' })
    expect(result.out["valid"]).toBe("false")
    expect(state.failed).toBe("The inline `schema` is not valid JSON.")
    expect(state.summary).toContain("✗ Invalid configuration")
    expect(JSON.parse(result.out["inputs"] ?? "")).toEqual({ environment: "production" })
  })

  it("malformed schema file", async () => {
    await execute("workflow_dispatch_choice", { schema: "schemas/malformed.json" })
    expect(state.outputs["valid"]).toBe("false")
    expect(state.failed).toMatch(/not valid JSON/)
  })

  it("semantically malformed schema", async () => {
    await execute("workflow_dispatch_choice", { schema: '{"type": "bogus"}' })
    expect(state.outputs["valid"]).toBe("false")
    expect(state.failed).toMatch(/Malformed schema/)
  })
})

describe("malformed `inputs` JSON", () => {
  it("fails without echoing the content, and still emits valid JSON outputs", async () => {
    const result = await execute("workflow_dispatch_choice", { inputs: '{"token": "ghp_secret' })
    expect(state.failed).toBe("The `inputs` action input is not valid JSON.")
    expect(result.out["valid"]).toBe("false")
    expect(result.inputs).toEqual({})
    expect(result.ref).toEqual({ ref: { name: "main", type: "branch", full: "refs/heads/main" } })
    const observable = [state.outputs, state.summary, state.failed, state.warnings]
    expect(JSON.stringify(observable)).not.toContain("ghp_secret")
  })
})

describe("options", () => {
  it("summary: false skips the Job Summary", async () => {
    await execute("workflow_dispatch_choice", { summary: "false" })
    expect(state.summary).toBeUndefined()
    expect(state.outputs["valid"]).toBe("true")
  })

  it("warns (without content) when the workflow file cannot be read", async () => {
    await execute({ ...loadEvent("workflow_dispatch_deploy"), workspace: "/nonexistent" })
    expect(state.warnings).toHaveLength(1)
    expect(JSON.parse(state.outputs["inputs"] ?? "")).toMatchObject({ dry_run: "true" })
  })
})
