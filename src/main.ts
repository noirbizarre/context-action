import * as core from "@actions/core"

import { run } from "./run.ts"

run().catch((error: unknown) => {
  core.setFailed(error instanceof Error ? error.message : "Unexpected error")
})
