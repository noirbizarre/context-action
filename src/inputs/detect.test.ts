import { describe, expect, it, vi } from "vitest"

import { loadEvent, DEPLOY_TYPED_INPUTS } from "../../test/fixtures/index.ts"
import { ConfigError } from "../errors.ts"
import { detectInputs, parseInputsJson, type DetectDeps } from "./detect.ts"
import { normalizeInputs } from "./normalize.ts"
import { loadDeclaredTypes } from "./workflow-file.ts"

const deps = (): DetectDeps => ({ loadDeclaredTypes, warn: vi.fn<(message: string) => void>() })

const normalized = (name: string, options = {}, d = deps()) =>
  normalizeInputs(detectInputs(loadEvent(name), options, d))

describe("parseInputsJson", () => {
  it.each([undefined, "", "  ", "null"])("treats %j as not supplied", (text) => {
    expect(parseInputsJson(text)).toBeUndefined()
  })

  it("parses objects, including empty ones", () => {
    expect(parseInputsJson('{"a":1}')).toEqual({ a: 1 })
    expect(parseInputsJson("{}")).toEqual({})
  })

  it.each(["{not json", "[1]", '"str"', "3", "true"])("rejects %j", (text) => {
    expect(() => parseInputsJson(text)).toThrow(ConfigError)
  })

  it("never echoes the content in error messages", () => {
    expect(() => parseInputsJson('{"token": "ghp_supersecret"')).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining("ghp_") }),
    )
  })
})

describe("detectInputs", () => {
  it("workflow_dispatch: strings + declarations from the workflow file", () => {
    expect(normalized("workflow_dispatch_deploy")).toEqual({
      source: "workflow_dispatch",
      values: { dry_run: true, environment: "production", replicas: 3, version: "1.2.3" },
    })
  })

  it("workflow_dispatch: string inputs", () => {
    expect(normalized("workflow_dispatch_strings")).toEqual({
      source: "workflow_dispatch",
      values: { name: "release-42", version: "1.2.3" },
    })
  })

  it("workflow_dispatch: choice input", () => {
    expect(normalized("workflow_dispatch_choice").values).toEqual({ environment: "production" })
  })

  it("workflow_dispatch: boolean inputs", () => {
    expect(normalized("workflow_dispatch_boolean").values).toEqual({
      dry_run: true,
      verbose: "false", // not declared in the fixture workflow, so never guessed
    })
  })

  it("workflow_dispatch: explicit empty strings stay empty strings", () => {
    expect(normalized("workflow_dispatch_empty_string").values).toEqual({
      dry_run: "",
      environment: "production",
      replicas: "",
      version: "",
    })
  })

  it("workflow_dispatch: missing inputs stay absent", () => {
    const values = normalized("workflow_dispatch_missing").values
    expect(values).toEqual({ environment: "production" })
    expect("dry_run" in values).toBe(false)
  })

  it("workflow_dispatch: no inputs at all", () => {
    expect(normalized("workflow_dispatch_no_inputs")).toEqual({
      source: "workflow_dispatch",
      values: {},
    })
  })

  it("workflow_dispatch without a readable workflow file keeps strings and warns", () => {
    const d = deps()
    const raw = { ...loadEvent("workflow_dispatch_deploy"), workspace: "/nonexistent" }
    const result = normalizeInputs(detectInputs(raw, {}, d))
    expect(result.values).toEqual({
      dry_run: "true",
      environment: "production",
      replicas: "3",
      version: "1.2.3",
    })
    expect(d.warn).toHaveBeenCalledTimes(1)
  })

  it("workflow_dispatch: typed `inputs` takes precedence and is passed through", () => {
    const d = deps()
    const result = normalized("workflow_dispatch_deploy", { inputsJson: DEPLOY_TYPED_INPUTS }, d)
    expect(result).toEqual({
      source: "workflow_dispatch",
      values: { dry_run: true, environment: "production", replicas: 3, version: "1.2.3" },
    })
    expect(d.warn).not.toHaveBeenCalled()
  })

  it("typed `inputs` on a non-dispatch event is workflow_call", () => {
    expect(normalized("workflow_call", { inputsJson: DEPLOY_TYPED_INPUTS })).toEqual({
      source: "workflow_call",
      values: { dry_run: true, environment: "production", replicas: 3, version: "1.2.3" },
    })
  })

  it("typed `inputs` is never coerced", () => {
    const result = normalized("workflow_call", { inputsJson: '{"dry_run":"true","n":"3"}' })
    expect(result.values).toEqual({ dry_run: "true", n: "3" })
  })

  it("an empty typed `inputs` object is still a workflow_call", () => {
    expect(normalized("workflow_call", { inputsJson: "{}" })).toEqual({
      source: "workflow_call",
      values: {},
    })
  })

  it("`toJSON(inputs)` of null means not supplied", () => {
    expect(normalized("push_branch", { inputsJson: "null" })).toEqual({
      source: "none",
      values: {},
    })
  })

  it("workflow_call without `inputs` has no source", () => {
    expect(normalized("workflow_call")).toEqual({ source: "none", values: {} })
  })

  it("repository_dispatch client_payload is opt-in", () => {
    expect(normalized("repository_dispatch")).toEqual({ source: "none", values: {} })
  })

  it("repository_dispatch keeps provenance and never coerces or recurses", () => {
    expect(normalized("repository_dispatch", { clientPayload: true })).toEqual({
      source: "repository_dispatch",
      values: { count: "3", dry_run: "true", environment: "production", nested: { a: "1" } },
    })
  })

  it("repository_dispatch without a client_payload object has no source", () => {
    const raw = { ...loadEvent("repository_dispatch"), payload: { client_payload: "x" } }
    expect(detectInputs(raw, { clientPayload: true }, deps()).source).toBe("none")
  })

  it("`inputs` action input wins over client_payload", () => {
    const result = normalized("repository_dispatch", {
      clientPayload: true,
      inputsJson: '{"a":1}',
    })
    expect(result).toEqual({ source: "workflow_call", values: { a: 1 } })
  })

  it("unknown events have no inputs", () => {
    expect(normalized("unknown_event")).toEqual({ source: "none", values: {} })
  })

  it("does not treat Object.prototype names as events", () => {
    const raw = { ...loadEvent("unknown_event"), eventName: "constructor" }
    expect(detectInputs(raw, {}, deps()).source).toBe("none")
  })

  it("never uses unrelated payload content", () => {
    expect(JSON.stringify(normalized("workflow_call"))).not.toContain("must never appear")
  })
})

describe("equivalence", () => {
  it("workflow_dispatch and workflow_call produce identical normalized values", () => {
    const dispatch = normalized("workflow_dispatch_deploy")
    const dispatchTyped = normalized("workflow_dispatch_deploy", {
      inputsJson: DEPLOY_TYPED_INPUTS,
    })
    const call = normalized("workflow_call", { inputsJson: DEPLOY_TYPED_INPUTS })

    expect(JSON.stringify(dispatch.values)).toBe(JSON.stringify(call.values))
    expect(JSON.stringify(dispatchTyped.values)).toBe(JSON.stringify(call.values))
    expect(dispatch.values).toEqual(call.values)
    expect(call.values).toEqual({
      dry_run: true,
      environment: "production",
      replicas: 3,
      version: "1.2.3",
    })
  })
})
