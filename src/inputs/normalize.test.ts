import { describe, expect, it } from "vitest"

import { coerceValue, normalizeInputs } from "./normalize.ts"

describe("coerceValue", () => {
  it.each([
    ["true", true],
    ["false", false],
    ["", ""],
    ["True", "True"],
    ["FALSE", "FALSE"],
    ["1", "1"],
    ["0", "0"],
    ["yes", "yes"],
    [" true", " true"],
    ["true ", "true "],
  ])("boolean: %j -> %j", (raw, expected) => {
    expect(coerceValue(raw, "boolean")).toBe(expected)
  })

  it.each([
    ["3", 3],
    ["0", 0],
    ["-1", -1],
    ["1.5", 1.5],
    ["-0.25", -0.25],
    ["1e3", 1000],
    ["", ""],
    [" 1", " 1"],
    ["1 ", "1 "],
    ["01", "01"],
    ["+1", "+1"],
    [".5", ".5"],
    ["1.", "1."],
    ["0x10", "0x10"],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["1e999", "1e999"],
    ["abc", "abc"],
  ])("number: %j -> %j", (raw, expected) => {
    expect(coerceValue(raw, "number")).toBe(expected)
  })

  it.each(["string", "choice", "environment", undefined, "something-new"])(
    "never coerces %s inputs",
    (type) => {
      expect(coerceValue("true", type)).toBe("true")
      expect(coerceValue("3", type)).toBe("3")
      expect(coerceValue("", type)).toBe("")
    },
  )

  it("leaves non-string values untouched", () => {
    expect(coerceValue(true, "boolean")).toBe(true)
    expect(coerceValue(3, "number")).toBe(3)
    expect(coerceValue(null, "number")).toBeNull()
    const nested = { a: "true" }
    expect(coerceValue(nested, "boolean")).toBe(nested)
  })
})

describe("normalizeInputs", () => {
  it("coerces according to declared types", () => {
    const result = normalizeInputs({
      source: "workflow_dispatch",
      values: { environment: "production", dry_run: "true", replicas: "3", version: "1.2.3" },
      declaredTypes: {
        environment: "choice",
        dry_run: "boolean",
        replicas: "number",
        version: "string",
      },
    })
    expect(result).toEqual({
      source: "workflow_dispatch",
      values: { dry_run: true, environment: "production", replicas: 3, version: "1.2.3" },
    })
  })

  it("keeps strings when no declarations are available", () => {
    const result = normalizeInputs({
      source: "workflow_dispatch",
      values: { dry_run: "true", replicas: "3" },
    })
    expect(result.values).toEqual({ dry_run: "true", replicas: "3" })
  })

  it("does not coerce undeclared inputs even when others are declared", () => {
    const result = normalizeInputs({
      source: "workflow_dispatch",
      values: { a: "true", b: "true" },
      declaredTypes: { a: "boolean" },
    })
    expect(result.values).toEqual({ a: true, b: "true" })
  })

  it("distinguishes missing values from explicit empty strings", () => {
    const result = normalizeInputs({
      source: "workflow_dispatch",
      values: { present: "" },
      declaredTypes: { present: "boolean", absent: "boolean" },
    })
    expect(result.values).toEqual({ present: "" })
    expect("present" in result.values).toBe(true)
    expect("absent" in result.values).toBe(false)
  })

  it("sorts keys so serialization is deterministic", () => {
    const a = normalizeInputs({ source: "workflow_call", values: { b: 1, a: 2 } })
    const b = normalizeInputs({ source: "workflow_call", values: { a: 2, b: 1 } })
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(Object.keys(a.values)).toEqual(["a", "b"])
  })

  it("does not recurse into nested values", () => {
    const result = normalizeInputs({
      source: "repository_dispatch",
      values: { nested: { flag: "true", n: "3" }, list: ["true"] },
      declaredTypes: { nested: "boolean", list: "boolean" },
    })
    expect(result.values).toEqual({ nested: { flag: "true", n: "3" }, list: ["true"] })
  })

  it("treats a __proto__ key as plain data", () => {
    const values = JSON.parse('{"__proto__": "x", "a": "1"}') as Record<string, unknown>
    const result = normalizeInputs({ source: "workflow_call", values })
    expect(Object.getPrototypeOf(result.values)).toBe(Object.prototype)
    expect(Object.hasOwn(result.values, "__proto__")).toBe(true)
    expect(JSON.stringify(result.values)).toBe('{"__proto__":"x","a":"1"}')
  })

  it("is not fooled by declaration names inherited from Object.prototype", () => {
    const result = normalizeInputs({
      source: "workflow_dispatch",
      values: { constructor: "true" },
      declaredTypes: {},
    })
    expect(result.values).toEqual({ constructor: "true" })
  })

  it("does not mutate its input", () => {
    const values = { b: "true", a: "1" }
    const snapshot = structuredClone(values)
    normalizeInputs({ source: "workflow_dispatch", values, declaredTypes: { b: "boolean" } })
    expect(values).toEqual(snapshot)
  })
})
