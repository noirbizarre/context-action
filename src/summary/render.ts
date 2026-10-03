import type { NormalizedContext } from "../context/types.ts"
import type { NormalizedRef } from "../refs/types.ts"
import type { ValidationResult } from "../schema/validate.ts"

const MAX_CELL_LENGTH = 200

function truncate(text: string): string {
  return text.length > MAX_CELL_LENGTH ? `${text.slice(0, MAX_CELL_LENGTH)}…` : text
}

/** Single-line plain text safe to place in a table cell or list item. */
function plain(text: string): string {
  return truncate(text.replaceAll(/\r?\n|\r/g, " "))
    .replaceAll("|", String.raw`\|`)
    .replaceAll("<", "&lt;")
}

/** Inline code span that cannot be broken out of by untrusted content. */
function code(text: string): string {
  const safe = truncate(text.replaceAll(/\r?\n|\r/g, " "))
    .replaceAll("`", "'")
    .replaceAll("|", String.raw`\|`)
  return `\`${safe}\``
}

function typeOf(value: unknown): string {
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  return typeof value
}

function displayValue(value: unknown): string {
  if (typeof value === "string") return value === "" ? '""' : value
  return JSON.stringify(value) ?? String(value)
}

function table(headers: readonly string[], rows: readonly (readonly string[])[]): string[] {
  return [
    `| ${headers.join(" | ")} |`,
    `|${headers.map(() => "---").join("|")}|`,
    ...rows.map((row) => `| ${row.join(" | ")} |`),
  ]
}

function describeRef(ref: NormalizedRef): string {
  return ref.repository ? `${code(ref.full)} (${code(ref.repository)})` : code(ref.full)
}

function renderReference(ctx: NormalizedContext): string[] {
  const { ref, head, base } = ctx.ref
  if (!ref && !head && !base) return ["_No reference could be determined for this event._"]

  const rows: string[][] = []
  if (ref) {
    rows.push(["Type", plain(ref.type)], ["Name", code(ref.name)], ["Ref", code(ref.full)])
  }
  if (head) rows.push(["Head", describeRef(head)])
  if (base) rows.push(["Base", describeRef(base)])
  return table(["Property", "Value"], rows)
}

function renderInputs(ctx: NormalizedContext): string[] {
  const entries = Object.entries(ctx.inputs.values)
  if (entries.length === 0) return ["_No inputs._"]
  return table(
    ["Name", "Value", "Type"],
    entries.map(([name, value]) => [code(name), code(displayValue(value)), typeOf(value)]),
  )
}

function renderValidation(validation: ValidationResult): string[] {
  switch (validation.status) {
    case "skipped":
      return ["– Skipped (no `schema` supplied)"]
    case "valid":
      return ["✓ Valid"]
    case "invalid":
      return [
        "✗ Invalid",
        "",
        ...validation.errors.map((error) => `- ${code(error.path)}: ${plain(error.message)}`),
      ]
    case "error":
      return ["✗ Invalid configuration", "", `- ${plain(validation.message)}`]
  }
}

/**
 * Render the Job Summary. Only explicitly selected normalized concepts are
 * included; the raw event payload and the `github` context never are.
 */
export function renderSummary(ctx: NormalizedContext, validation: ValidationResult): string {
  const lines = [
    "## Action Context",
    "",
    ...table(
      ["Property", "Value"],
      [
        ["Event", code(ctx.event)],
        ["Input source", code(ctx.inputs.source)],
      ],
    ),
    "",
    "### Inputs",
    "",
    ...renderInputs(ctx),
    "",
    "### Reference",
    "",
    ...renderReference(ctx),
    "",
    "### Validation",
    "",
    ...renderValidation(validation),
    "",
  ]
  return lines.join("\n")
}
