# context-action

Normalize and validate complex GitHub Action context with JSON Schema.

`context-action` turns GitHub Actions concepts whose shape depends on the triggering event
(workflow inputs, git references) into one stable, machine-readable representation. It can
optionally validate the result with a standard JSON Schema and shows it in the Job Summary.

```yaml
- uses: noirbizarre/context-action@v1
  id: context
  with:
    inputs: ${{ toJSON(inputs) }}
    schema: .github/action-context.schema.json
```

## What problem does it solve?

- **Inputs are polymorphic.** `workflow_dispatch` inputs reach a JavaScript action as strings
  (`"true"`), `workflow_call` inputs are not in the event payload at all, and
  `repository_dispatch` has a free-form `client_payload`. The same logical invocation looks
  different depending on how it was triggered.
- **Refs are event-dependent.** `github.ref` may be a branch, a tag or `refs/pull/N/merge`;
  pull requests additionally have separate head and base branches (possibly in a fork).
- **Validation is ad hoc.** Shell `if` chains do not scale. JSON Schema is the standard answer.

## What it intentionally does not solve

- It does **not** wrap or mirror the `github.*` context. If GitHub already exposes a stable,
  directly usable value (`github.sha`, `github.actor`, `github.repository`, ...), use it.
- It does not replace `github.ref`; it only derives structure from it.
- It has no custom validation language: JSON Schema (via AJV) is the contract.
- It creates no per-input outputs: the normalized JSON object is the API.

## Supported events

| Event                 | Input source          | How                                                                                          |
| --------------------- | --------------------- | -------------------------------------------------------------------------------------------- |
| `workflow_dispatch`   | `workflow_dispatch`   | `inputs: ${{ toJSON(inputs) }}` (recommended), or event payload + workflow file declarations |
| `workflow_call`       | `workflow_call`       | `inputs: ${{ toJSON(inputs) }}` (required)                                                   |
| `repository_dispatch` | `repository_dispatch` | Opt in with `client-payload: true`; values are exposed as-is                                 |
| anything else         | `none`                | No inputs; refs are still derived                                                            |

Refs are derived for every event that has a `github.ref` (`push`, `pull_request`, `create`, ...).
`head`/`base` are additionally derived for `pull_request`, `pull_request_target`,
`pull_request_review` and `pull_request_review_comment`.

New events are added as a small adapter in `src/inputs/detect.ts`; the normalized model,
validation and summary do not change.

### Why `inputs: ${{ toJSON(inputs) }}`?

A JavaScript action cannot see declared input types. `${{ toJSON(inputs) }}` is evaluated by
GitHub and carries correctly typed values for both `workflow_dispatch` and `workflow_call`, so
both produce **identical** output. In a reusable workflow `github.event_name` is the _caller's_
event, so this input is also the only reliable signal that the run is a `workflow_call`.

Without it, `workflow_dispatch` falls back to the event payload (all strings) and reads the type
declarations (`on.workflow_dispatch.inputs.<name>.type`) from the checked-out workflow file
(`GITHUB_WORKFLOW_REF`). This requires `actions/checkout`; if the file cannot be read a warning
is emitted and values stay strings. `workflow_call` without the `inputs` input yields no inputs.

## Normalization rules

Inputs are normalized to `{ "values": {...}, "source": "..." }`. Rules, in order of precedence:

1. **`inputs` action input** is passed through unchanged (already typed by GitHub). No coercion.
   `workflow_dispatch` events get source `workflow_dispatch`, every other event `workflow_call`.
   `null`/empty means "not supplied". Invalid JSON or a non-object fails the action.
2. **`workflow_dispatch` payload fallback** coerces strictly by declared type:

   | Declared type                                 | Raw value                                               | Result           |
   | --------------------------------------------- | ------------------------------------------------------- | ---------------- |
   | `boolean`                                     | exactly `"true"` / `"false"`                            | `true` / `false` |
   | `boolean`                                     | anything else (`""`, `"True"`, `"1"`)                   | unchanged string |
   | `number`                                      | canonical JSON number (`"3"`, `"-1.5"`, `"1e3"`)        | number           |
   | `number`                                      | anything else (`""`, `" 1"`, `"01"`, `"0x10"`, `"NaN"`) | unchanged string |
   | `string`, `choice`, `environment`, undeclared | any                                                     | unchanged string |

3. **`repository_dispatch`** (opt-in) exposes `client_payload` (a plain object) as-is with source
   `repository_dispatch`. It is never coerced and never recursed into, and it is never labelled
   as declared workflow inputs.
4. Otherwise: `{ "values": {}, "source": "none" }`.

Additional guarantees: arbitrary strings stay strings; a missing input stays absent while an
explicit `""` stays `""`; keys are sorted so output is deterministic; no recursive type guessing.

## Reference normalization

```json
{
  "ref": { "name": "42/merge", "type": "pull_request", "full": "refs/pull/42/merge" },
  "head": {
    "name": "patch-1",
    "type": "branch",
    "full": "refs/heads/patch-1",
    "repository": "contributor/repo"
  },
  "base": { "name": "main", "type": "branch", "full": "refs/heads/main", "repository": "octo/repo" }
}
```

- `ref` is parsed from `github.ref`: `refs/heads/*` is a `branch`, `refs/tags/*` a `tag`,
  `refs/pull/N/(merge|head)` a `pull_request`. Anything else is omitted.
- `head` / `base` come from the pull request payload and are never presented as the primary
  `ref`. `repository` is included only when GitHub provides it, so fork PRs are identifiable
  (`head.repository != base.repository`).
- Fields that cannot be determined reliably are omitted. `ref` is `{}` when nothing is derivable.

## JSON Schema validation

The schema describes the **normalized inputs object** (the `inputs` output), not the raw event.
AJV is used with draft 2020-12 by default; `$schema` may select 2019-09 or draft-07. Formats are
supported through `ajv-formats`. AJV runs in strict mode (unknown keywords are errors), and the
schema and data are never modified (no defaults, coercion or property stripping).

From a file in the workspace (must be inside it; requires `actions/checkout`):

```yaml
- uses: noirbizarre/context-action@v1
  with:
    inputs: ${{ toJSON(inputs) }}
    schema: .github/action-context.schema.json
```

Inline (anything starting with `{`):

```yaml
- uses: noirbizarre/context-action@v1
  with:
    inputs: ${{ toJSON(inputs) }}
    schema: |
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "type": "object",
        "properties": {
          "environment": { "type": "string", "enum": ["staging", "production"] },
          "dry_run": { "type": "boolean" }
        },
        "required": ["environment"],
        "additionalProperties": false
      }
```

- No schema: validation is skipped and `valid` is `true`.
- Invalid values: `valid` is `false`, errors are listed in the Job Summary and the action fails.
- Malformed schema, malformed JSON, missing file, unsupported `$schema` or remote `$ref`: the
  action fails with a message describing the problem.

## Action inputs

| Input            | Description                                                           | Default |
| ---------------- | --------------------------------------------------------------------- | ------- |
| `inputs`         | Typed workflow inputs: `${{ toJSON(inputs) }}`                        |         |
| `schema`         | Path to a JSON Schema file in the workspace, or an inline JSON Schema |         |
| `client-payload` | `true` to expose `repository_dispatch` `client_payload` as inputs     | `false` |
| `summary`        | `false` to skip the Job Summary                                       | `true`  |

## Outputs

| Output    | Description                                                                 |
| --------- | --------------------------------------------------------------------------- |
| `inputs`  | Normalized input values as JSON (the object the schema validates)           |
| `context` | `{ "event", "inputs": { "values", "source" }, "ref": {...} }` as JSON       |
| `event`   | `github.event_name`                                                         |
| `ref`     | Normalized references as JSON (`ref`, `head`, `base`; omitted when unknown) |
| `valid`   | `"true"` or `"false"`                                                       |

JSON outputs are always valid JSON (`{}` when empty). Consume them with `fromJSON`:

```yaml
- run: echo "Deploying to ${{ fromJSON(steps.context.outputs.inputs).environment }}"
```

Prefer passing outputs through `env:` rather than interpolating them into shell scripts
(see [Security](#security-considerations)).

## Job Summary

```markdown
## Action Context

| Property     | Value               |
| ------------ | ------------------- |
| Event        | `workflow_dispatch` |
| Input source | `workflow_dispatch` |

### Inputs

| Name          | Value        | Type    |
| ------------- | ------------ | ------- |
| `environment` | `production` | string  |
| `dry_run`     | `true`       | boolean |

### Reference

| Property | Value             |
| -------- | ----------------- |
| Type     | branch            |
| Name     | `main`            |
| Ref      | `refs/heads/main` |

### Validation

✓ Valid
```

On failure the Validation section shows `✗ Invalid` followed by one line per error, e.g.
``- `/environment`: must be one of `staging`, `production` ``. Values are truncated, and
markdown in untrusted names/values is neutralized.

## Complete example

```yaml
name: Deploy

on:
  workflow_dispatch:
    inputs:
      environment:
        type: choice
        required: true
        options:
          - staging
          - production
      dry_run:
        type: boolean
        default: false

jobs:
  deploy:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v7

      - uses: noirbizarre/context-action@v1
        id: context
        with:
          inputs: ${{ toJSON(inputs) }}
          schema: .github/action-context.schema.json

      - env:
          INPUTS: ${{ steps.context.outputs.inputs }}
        run: echo "$INPUTS"
```

### Reusable workflow

```yaml
on:
  workflow_call:
    inputs:
      environment: { type: string, required: true }
      dry_run: { type: boolean, default: false }

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: noirbizarre/context-action@v1
        id: context
        with:
          inputs: ${{ toJSON(inputs) }}
```

This produces exactly the same `inputs` output as the equivalent `workflow_dispatch` run.

### `repository_dispatch`

```yaml
on:
  repository_dispatch:
    types: [deploy]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: noirbizarre/context-action@v1
        id: context
        with:
          client-payload: true
          schema: |
            { "type": "object", "properties": { "environment": { "type": "string" } }, "required": ["environment"] }
```

The result has `inputs.source == "repository_dispatch"`; values are exactly what the sender
supplied (for instance `"true"` stays a string unless your schema says otherwise).

## Security considerations

- All event data is untrusted. Only explicitly selected normalized concepts (event name, inputs,
  refs) are read; the `github` context and event payload are never dumped to logs or the summary.
- Input values are never logged. Error messages never echo raw `inputs` content, and validation
  errors never include the offending value.
- The schema file must resolve (including symlinks) to a path inside the workspace. The workflow
  file used for type declarations must be a `.github/workflows/` file of the current repository
  inside the workspace. Remote `$ref`s are not fetched.
- GitHub masks secrets in logs but **not** in Job Summaries or outputs. Do not pass secrets as
  workflow inputs; if inputs may be sensitive, set `summary: false`.
- Outputs are plain strings controlled by whoever triggered the run. Never interpolate
  `${{ steps.x.outputs.* }}` directly into `run:` scripts; pass them through `env:`.
- Markdown in names and values is neutralized in the summary (code spans, escaped pipes, no
  newlines, truncation at 200 characters).

## Limitations

- `workflow_call` inputs need `inputs: ${{ toJSON(inputs) }}`; without it the action reports
  source `none`.
- The `workflow_dispatch` fallback reads the workflow file from the checked-out ref, which may
  differ from the ref the run was triggered on. Prefer `toJSON(inputs)`.
- `client_payload` is exposed as-is; no declared types exist for it.
- Only inputs and refs are normalized. Other event concepts are intentionally left to `github.*`.
- Output values are limited by GitHub's output size limits.

## Development

```sh
pnpm install
pnpm check      # typecheck, lint (oxlint), format check (oxfmt), tests (vitest)
pnpm build      # bundle to dist/index.js (tsdown); dist/ is committed and checked in CI
```

Releases: publish a `vX.Y.Z` release; the `Release` workflow moves the `vX` tag.

## License

MIT
