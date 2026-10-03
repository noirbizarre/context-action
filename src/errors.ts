/**
 * Raised for user configuration problems (malformed schema, malformed `inputs` JSON, ...).
 * Messages must never echo untrusted content such as raw input values.
 */
export class ConfigError extends Error {
  override readonly name = "ConfigError"
}
