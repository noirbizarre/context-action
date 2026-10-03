import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import type { RawContext } from "../../src/github/event.ts"

const here = path.dirname(fileURLToPath(import.meta.url))

/** Checked-out workspace containing a workflow file and schemas. */
export const WORKSPACE = path.join(here, "workspace")

/** A workflow_dispatch workflow living in WORKSPACE. */
export const WORKFLOW_REF = "octo/repo/.github/workflows/deploy.yml@refs/heads/main"

export function loadEvent(name: string): RawContext {
  const file = path.join(here, "events", `${name}.json`)
  const data = JSON.parse(readFileSync(file, "utf8")) as Pick<
    RawContext,
    "eventName" | "ref" | "payload"
  >
  return {
    eventName: data.eventName,
    ref: data.ref,
    payload: data.payload,
    workflowRef: WORKFLOW_REF,
    workspace: WORKSPACE,
    repository: "octo/repo",
  }
}

/** The same deploy invocation as seen by a typed `toJSON(inputs)`. */
export const DEPLOY_TYPED_INPUTS = JSON.stringify({
  environment: "production",
  dry_run: true,
  replicas: 3,
  version: "1.2.3",
})
