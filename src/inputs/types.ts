export type InputSource = "workflow_dispatch" | "workflow_call" | "repository_dispatch" | "none"

export interface NormalizedInputs {
  /** Normalized values, keys sorted alphabetically. */
  values: Record<string, unknown>
  /** Where the values came from. Never conflate `repository_dispatch` with declared inputs. */
  source: InputSource
}

/** Declared workflow input types (`on.workflow_dispatch.inputs.<name>.type`). */
export type DeclaredType = "string" | "boolean" | "number" | "choice" | "environment"

/** Map of input name to declared type. Absent names are undeclared. */
export type DeclaredTypes = Readonly<Record<string, string>>

/** Raw, un-normalized inputs plus the information needed to normalize them. */
export interface RawInputs {
  source: InputSource
  values: Record<string, unknown>
  /**
   * Declared types. Only provided when `values` may carry stringified scalars
   * (workflow_dispatch event payload). Typed sources (`toJSON(inputs)`) omit it.
   */
  declaredTypes?: DeclaredTypes
}
