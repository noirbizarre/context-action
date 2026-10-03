import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, expect, it, vi } from "vitest"

import { WORKFLOW_REF, WORKSPACE } from "../../test/fixtures/index.ts"
import { loadDeclaredTypes, parseDeclaredTypes, resolveWorkflowPath } from "./workflow-file.ts"

describe("parseDeclaredTypes", () => {
  it("reads declared types and defaults missing ones to string", () => {
    const yaml = `
on:
  workflow_dispatch:
    inputs:
      a: { type: boolean }
      b: { type: number }
      c: { type: choice, options: [x, y] }
      d: { description: no type }
`
    expect(parseDeclaredTypes(yaml)).toEqual({
      a: "boolean",
      b: "number",
      c: "choice",
      d: "string",
    })
  })

  it.each([
    ["on as a string", "on: workflow_dispatch"],
    ["on as a list", "on: [push, workflow_dispatch]"],
    ["workflow_dispatch without inputs", "on:\n  workflow_dispatch:\n"],
    ["no on", "name: x"],
    ["empty document", ""],
    ["scalar document", "42"],
    ["only workflow_call", "on:\n  workflow_call:\n    inputs:\n      a: { type: boolean }"],
  ])("returns no declarations for %s", (_label, yaml) => {
    expect(parseDeclaredTypes(yaml)).toEqual({})
  })

  it("throws on malformed YAML", () => {
    expect(() => parseDeclaredTypes("on: [unclosed")).toThrow(/flow sequence/i)
  })
})

describe("resolveWorkflowPath", () => {
  it("resolves a same-repository workflow inside the workspace", () => {
    expect(resolveWorkflowPath(WORKFLOW_REF, "/ws", "octo/repo")).toBe(
      path.join("/ws", ".github/workflows/deploy.yml"),
    )
  })

  it.each([
    ["another repository", "other/repo/.github/workflows/x.yml@refs/heads/main"],
    ["not under .github/workflows", "octo/repo/scripts/x.yml@refs/heads/main"],
    ["traversal", "octo/repo/.github/workflows/../../../etc/passwd@refs/heads/main"],
    ["too short", "octo/repo"],
  ])("rejects %s", (_label, ref) => {
    expect(resolveWorkflowPath(ref, "/ws", "octo/repo")).toBeUndefined()
  })
})

describe("loadDeclaredTypes", () => {
  it("loads declarations from the checked-out workflow", () => {
    const warn = vi.fn<(message: string) => void>()
    const types = loadDeclaredTypes(
      { workflowRef: WORKFLOW_REF, workspace: WORKSPACE, repository: "octo/repo" },
      warn,
    )
    expect(types).toEqual({
      environment: "choice",
      dry_run: "boolean",
      replicas: "number",
      version: "string",
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it.each([
    ["missing ref", { workflowRef: undefined, workspace: WORKSPACE, repository: "octo/repo" }],
    ["missing workspace", { workflowRef: WORKFLOW_REF, workspace: undefined, repository: "o/r" }],
    ["other repo", { workflowRef: WORKFLOW_REF, workspace: WORKSPACE, repository: "x/y" }],
    [
      "file not found",
      {
        workflowRef: "octo/repo/.github/workflows/nope.yml@refs/heads/main",
        workspace: WORKSPACE,
        repository: "octo/repo",
      },
    ],
  ])("warns and returns undefined: %s", (_label, raw) => {
    const warn = vi.fn<(message: string) => void>()
    expect(loadDeclaredTypes(raw, warn)).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it("rejects a workflow symlinked outside the workspace and malformed YAML", () => {
    const outside = mkdtempSync(path.join(tmpdir(), "ca-outside-"))
    writeFileSync(path.join(outside, "evil.yml"), "on:\n  workflow_dispatch:\n")
    const ws = mkdtempSync(path.join(tmpdir(), "ca-ws-"))
    mkdirSync(path.join(ws, ".github/workflows"), { recursive: true })
    symlinkSync(path.join(outside, "evil.yml"), path.join(ws, ".github/workflows/link.yml"))
    writeFileSync(path.join(ws, ".github/workflows/bad.yml"), "on: [unclosed")

    const warn = vi.fn<(message: string) => void>()
    const base = { workspace: ws, repository: "octo/repo" }
    expect(
      loadDeclaredTypes({ ...base, workflowRef: "octo/repo/.github/workflows/link.yml@r" }, warn),
    ).toBeUndefined()
    expect(
      loadDeclaredTypes({ ...base, workflowRef: "octo/repo/.github/workflows/bad.yml@r" }, warn),
    ).toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(2)
  })
})
