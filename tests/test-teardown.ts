import { afterAll } from "bun:test";
import { clearAndRebuild } from "../clear";

// Clean up all data/ files and run build.ts after tests finish to return the runtime to its clean baseline state
afterAll(async () => {
  console.log("\n🧹 [test-teardown] Cleaning up data/ test artifacts and restoring runtime state...");
  await clearAndRebuild({ silent: false, keepDeployments: true });
}, 30000);
