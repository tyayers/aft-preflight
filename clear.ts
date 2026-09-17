#!/usr/bin/env bun
/**
 * clear.ts - Clean and Rebuild Utility for AFT-Testpilot
 *
 * Removes compiled proxy TypeScript files, removes ALL YAML files across data/
 * (including data/deployments/, data/proxies/, data/products/, data/users/,
 * data/kvm/, and data/templates/), and invokes build.ts to generate a clean index.ts.
 *
 * Usage:
 *   bun run clear.ts                    # Default: Removes all YAMLs (including deployments) & proxies, then rebuilds
 *   bun run clear.ts --keep-deployments # Preserves data/deployments/ while cleaning extracted data and rebuilding
 */

import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const ROOT_DIR = process.cwd();
const PROXIES_DIR = path.join(ROOT_DIR, "proxies");
const DATA_DIR = path.join(ROOT_DIR, "data");
const DATA_PROXIES_DIR = path.join(DATA_DIR, "proxies");
const DATA_PRODUCTS_DIR = path.join(DATA_DIR, "products");
const DATA_USERS_DIR = path.join(DATA_DIR, "users");
const DATA_KVM_DIR = path.join(DATA_DIR, "kvm");
const DATA_TEMPLATES_DIR = path.join(DATA_DIR, "templates");
const DATA_DEPLOYMENTS_DIR = path.join(DATA_DIR, "deployments");
const DATA_TESTS_DIR = path.join(DATA_DIR, "tests");

const keepDeployments =
  process.argv.includes("--keep-deployments") ||
  process.argv.includes("--preserve-deployments") ||
  process.argv.includes("-k");

function removeFiles(dir: string, pattern?: RegExp): number {
  if (!fs.existsSync(dir)) return 0;
  let count = 0;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    if (!pattern || pattern.test(file)) {
      const fullPath = path.join(dir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isFile()) {
          fs.unlinkSync(fullPath);
          count++;
        }
      } catch (err: any) {
        console.warn(`[clear] Could not remove ${file}:`, err.message);
      }
    }
  }
  return count;
}

console.log("🧹 [clear] Cleaning proxies and YAML files (default: all)...");

// 1. Remove compiled proxy typescript classes in proxies/
const removedProxies = removeFiles(PROXIES_DIR, /\.(ts|js)$/);
console.log(`   - Removed ${removedProxies} compiled proxy files from proxies/`);

// 2. Remove extracted/generated YAML files in data subdirectories
const yamlRegex = /\.(ya?ml|json)$/i;
const removedDataProxies = removeFiles(DATA_PROXIES_DIR, yamlRegex);
const removedProducts = removeFiles(DATA_PRODUCTS_DIR, yamlRegex);
const removedUsers = removeFiles(DATA_USERS_DIR, yamlRegex);
const removedKvm = removeFiles(DATA_KVM_DIR, yamlRegex);
const removedTemplates = removeFiles(DATA_TEMPLATES_DIR, yamlRegex);
const removedTests = removeFiles(DATA_TESTS_DIR, yamlRegex);

console.log(`   - Removed ${removedDataProxies} YAMLs from data/proxies/`);
console.log(`   - Removed ${removedProducts} YAMLs from data/products/`);
console.log(`   - Removed ${removedUsers} YAMLs from data/users/`);
console.log(`   - Removed ${removedKvm} files from data/kvm/`);
console.log(`   - Removed ${removedTemplates} YAMLs from data/templates/`);
console.log(`   - Removed ${removedTests} files from data/tests/`);

if (!keepDeployments) {
  const removedDeployments = removeFiles(DATA_DEPLOYMENTS_DIR, yamlRegex);
  console.log(`   - Removed ${removedDeployments} YAMLs from data/deployments/ (default: all)`);
} else {
  console.log(`   - Preserving data/deployments/ (--keep-deployments specified)`);
}

// 3. Invoke build.ts to re-generate clean index.ts
console.log("\n🚀 [clear] Rebuilding clean index.ts via build.ts...");
const buildProc = spawnSync("bun", ["run", path.join(ROOT_DIR, "build.ts")], {
  stdio: "inherit",
  cwd: ROOT_DIR,
});

if (buildProc.status === 0) {
  console.log("✨ [clear] Clean rebuild completed successfully!");
} else {
  console.error(`❌ [clear] Build failed with exit code ${buildProc.status}`);
  process.exit(buildProc.status || 1);
}
