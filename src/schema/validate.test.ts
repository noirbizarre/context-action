import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { WORKSPACE } from "../../test/fixtures/index.ts"
import { ConfigError } from "../errors.ts"
import { loadSchema } from "./load.ts"
import { validateInputs } from "./validate.ts"

const INLINE = `{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "type": "object",
  "properties": {
    "environment": { "type": "string", "enum": ["staging", "production"] },
    "dry_run": { "type": "boolean" }
  },
  "required": ["environment"],
  "additionalProperties": false
}`

describe("loadSchema", () => {
  it.each([undefined, "", "   \n"])("returns no schema for %j", (input) => {
    expect(loadSchema(input, WORKSPACE)).toBeUndefined()
  })

  it("parses an inline schema", () => {
    expect(loadSchema(INLINE, WORKSPACE)).toEqual(JSON.parse(INLINE))
  })

  it("parses an inline schema with leading whitespace", () => {
    expect(loadSchema(`\n  ${INLINE}\n`, WORKSPACE)).toEqual(JSON.parse(INLINE))
  })

  it("reads a schema file from the workspace", () => {
    const schema = loadSchema(".github/action-context.schema.json", WORKSPACE) as {
      required: string[]
    }
    expect(schema.required).toEqual(["environment"])
  })

  it("rejects malformed inline JSON", () => {
    expect(() => loadSchema('{ "type": ', WORKSPACE)).toThrow(ConfigError)
    expect(() => loadSchema('{ "type": ', WORKSPACE)).toThrow(/inline `schema` is not valid JSON/)
  })

  it("rejects a malformed JSON file", () => {
    expect(() => loadSchema("schemas/malformed.json", WORKSPACE)).toThrow(/not valid JSON/)
  })

  it("rejects a missing file", () => {
    expect(() => loadSchema("schemas/nope.json", WORKSPACE)).toThrow(/could not be found/)
  })

  it("rejects paths escaping the workspace", () => {
    expect(() => loadSchema("../../../package.json", WORKSPACE)).toThrow(ConfigError)
    expect(() => loadSchema("/etc/passwd", WORKSPACE)).toThrow(ConfigError)
  })

  it("rejects symlinks pointing outside the workspace", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "ca-out-"))
    writeFileSync(path.join(outside, "s.json"), "{}")
    const ws = mkdtempSync(path.join(tmpdir(), "ca-ws-"))
    mkdirSync(path.join(ws, "d"))
    symlinkSync(path.join(outside, "s.json"), path.join(ws, "d", "link.json"))
    expect(() => loadSchema("d/link.json", ws)).toThrow(/inside the workspace/)
  })
})

describe("validateInputs", () => {
  const inline = () => loadSchema(INLINE, WORKSPACE)

  it("succeeds when no schema is supplied", () => {
    expect(validateInputs(undefined, { anything: "goes" })).toEqual({ status: "skipped" })
  })

  it("succeeds on valid values (inline schema)", () => {
    expect(validateInputs(inline(), { environment: "production", dry_run: true })).toEqual({
      status: "valid",
    })
  })

  it("succeeds on valid values (file schema)", () => {
    const schema = loadSchema(".github/action-context.schema.json", WORKSPACE)
    expect(
      validateInputs(schema, {
        dry_run: true,
        environment: "production",
        replicas: 3,
        version: "1.2.3",
      }),
    ).toEqual({ status: "valid" })
  })

  it("validates normalized types: a stringified boolean is invalid", () => {
    expect(validateInputs(inline(), { environment: "staging", dry_run: "true" })).toEqual({
      status: "invalid",
      errors: [{ path: "/dry_run", message: "must be boolean" }],
    })
  })

  it("reports every error with actionable messages", () => {
    const result = validateInputs(inline(), { environment: "dev", extra: 1 })
    expect(result).toEqual({
      status: "invalid",
      errors: [
        { path: "/environment", message: "must be one of `staging`, `production`" },
        { path: "/extra", message: "is not allowed (additional property)" },
      ],
    })
  })

  it("reports missing required properties at their own path", () => {
    expect(validateInputs(inline(), {})).toEqual({
      status: "invalid",
      errors: [{ path: "/environment", message: "is required" }],
    })
  })

  it("reports root-level errors on `/`", () => {
    expect(validateInputs({ type: "object", minProperties: 1 }, {})).toEqual({
      status: "invalid",
      errors: [{ path: "/", message: "must NOT have fewer than 1 properties" }],
    })
  })

  it("does not echo offending values", () => {
    const result = validateInputs(inline(), { environment: "sup3r-s3cret-value" })
    expect(JSON.stringify(result)).not.toContain("sup3r-s3cret-value")
  })

  it("supports JSON Schema formats", () => {
    const schema = {
      type: "object",
      properties: {
        when: { type: "string", format: "date" },
        site: { type: "string", format: "uri" },
        mail: { type: "string", format: "email" },
      },
    }
    expect(
      validateInputs(schema, { when: "2026-10-03", site: "https://example.com", mail: "a@b.co" }),
    ).toEqual({ status: "valid" })

    expect(validateInputs(schema, { when: "yesterday", site: "nope", mail: "x" })).toEqual({
      status: "invalid",
      errors: [
        { path: "/mail", message: 'must match the "email" format' },
        { path: "/site", message: 'must match the "uri" format' },
        { path: "/when", message: 'must match the "date" format' },
      ],
    })
  })

  it("explains pattern failures", () => {
    const schema = { properties: { version: { type: "string", pattern: "^\\d+$" } } }
    expect(validateInputs(schema, { version: "x" })).toEqual({
      status: "invalid",
      errors: [{ path: "/version", message: "must match the expected format (`^\\d+$`)" }],
    })
  })

  it("escapes JSON pointer segments", () => {
    const result = validateInputs({ additionalProperties: false }, { "a/b~c": 1 })
    expect(result).toEqual({
      status: "invalid",
      errors: [{ path: "/a~1b~0c", message: "is not allowed (additional property)" }],
    })
  })

  it.each([
    ["draft-07", "http://json-schema.org/draft-07/schema#"],
    ["draft-07 without #", "http://json-schema.org/draft-07/schema"],
    ["2019-09", "https://json-schema.org/draft/2019-09/schema"],
    ["2020-12", "https://json-schema.org/draft/2020-12/schema"],
  ])("supports $schema %s", (_label, $schema) => {
    const schema = { $schema, type: "object", required: ["a"] }
    expect(validateInputs(schema, { a: 1 })).toEqual({ status: "valid" })
    expect(validateInputs(schema, {}).status).toBe("invalid")
  })

  it("rejects an unsupported $schema draft", () => {
    expect(
      validateInputs({ $schema: "http://json-schema.org/draft-04/schema#", type: "object" }, {}),
    ).toEqual({
      status: "error",
      message: "Unsupported `$schema`. Supported drafts: 2020-12, 2019-09 and draft-07.",
    })
  })

  it("reports a malformed schema as an error, not a validation failure", () => {
    const result = validateInputs({ type: "not-a-type" }, {})
    expect(result.status).toBe("error")
  })

  it("reports unknown keywords (strict mode)", () => {
    const schema = loadSchema("schemas/unknown-keyword.json", WORKSPACE)
    const result = validateInputs(schema, {})
    expect(result.status).toBe("error")
    expect(result).toMatchObject({ message: expect.stringContaining("bogusKeyword") })
  })

  it("does not resolve remote references", () => {
    const result = validateInputs({ $ref: "https://example.invalid/schema.json" }, {})
    expect(result.status).toBe("error")
  })

  it("never modifies the schema or the values (no defaults, coercion or stripping)", () => {
    const schema = {
      type: "object",
      properties: { n: { type: "number", default: 1 }, s: { type: "string" } },
      additionalProperties: false,
    }
    const values = { s: "x", extra: 1 }
    const schemaBefore = structuredClone(schema)
    const valuesBefore = structuredClone(values)

    validateInputs(schema, values)
    expect(schema).toEqual(schemaBefore)
    expect(values).toEqual(valuesBefore)

    // "3" is not coerced to a number
    expect(validateInputs(schema, { n: "3" }).status).toBe("invalid")
  })
})
