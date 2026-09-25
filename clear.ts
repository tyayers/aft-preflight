#!/usr/bin/env bun
/**
 * clear.ts - Clean and Rebuild Utility for AFT-Preflight & Bungee Runtime
 *
 * Removes compiled proxy TypeScript files, removes extracted data across data/
 * (including data/proxies/, data/products/, data/users/, data/kvm/, data/templates/,
 * data/tests/, and data/temp/), while leaving data/deployments/ untouched by default.
 * Then invokes build.ts to generate a clean index.ts.
 *
 * Usage:
 *   bun run clear.ts                      # Default: Preserves data/deployments/, removes generated files & rebuilds
 *   bun run clear.ts --clean-deployments  # Optional: Also removes data/deployments/
 */

import fs from "fs";
import path from "path";
import { runBuild } from "./build";

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
const DATA_TEMP_DIR = path.join(DATA_DIR, "temp");

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
        // ignore
      }
    }
  }
  return count;
}

export interface ClearOptions {
  keepDeployments?: boolean; // Defaults to true
  cleanDeployments?: boolean;
  silent?: boolean;
}

export async function clearAndRebuild(options: ClearOptions = {}): Promise<{ success: boolean; count: number }> {
  const log = (msg: string) => {
    if (!options.silent) console.log(msg);
  };

  log("🧹 [clear] Cleaning proxies and YAML files...");

  // 1. Remove all compiled proxy typescript classes in proxies/
  const removedProxies = removeFiles(PROXIES_DIR, /\.(ts|js)$/);
  log(`   - Removed ${removedProxies} proxy files from proxies/`);

  // 2. Remove extracted/generated YAML files in data subdirectories
  const yamlRegex = /\.(ya?ml|json)$/i;
  const removedDataProxies = removeFiles(DATA_PROXIES_DIR, yamlRegex);
  const removedProducts = removeFiles(DATA_PRODUCTS_DIR, yamlRegex);
  const removedUsers = removeFiles(DATA_USERS_DIR, yamlRegex);
  const removedKvm = removeFiles(DATA_KVM_DIR, yamlRegex);
  const removedTemplates = removeFiles(DATA_TEMPLATES_DIR, yamlRegex);
  const removedTests = removeFiles(DATA_TESTS_DIR, yamlRegex);
  const removedTemp = removeFiles(DATA_TEMP_DIR);

  log(`   - Removed ${removedDataProxies} YAMLs from data/proxies/`);
  log(`   - Removed ${removedProducts} YAMLs from data/products/`);
  log(`   - Removed ${removedUsers} YAMLs from data/users/`);
  log(`   - Removed ${removedKvm} files from data/kvm/`);
  log(`   - Removed ${removedTemplates} YAMLs from data/templates/`);
  log(`   - Removed ${removedTests} files from data/tests/`);
  if (removedTemp > 0) {
    log(`   - Removed ${removedTemp} files from data/temp/`);
  }

  // Preserves data/deployments/ by default unless explicitly asked to clean
  const shouldCleanDeployments = options.cleanDeployments || options.keepDeployments === false;
  if (shouldCleanDeployments) {
    const removedDeployments = removeFiles(DATA_DEPLOYMENTS_DIR, yamlRegex);
    log(`   - Removed ${removedDeployments} YAMLs from data/deployments/ (--clean-deployments specified)`);
  } else {
    log(`   - Preserving data/deployments/ (directory is not cleaned)`);
  }

  // 3. Invoke build.ts to re-generate clean index.ts
  log("\n🚀 [clear] Rebuilding clean index.ts via build.ts...");
  const buildResult = await runBuild();
  log("✨ [clear] Clean rebuild completed successfully!");
  return buildResult;
}

if (import.meta.main) {
  const cleanDeployments =
    process.argv.includes("--clean-deployments") ||
    process.argv.includes("--wipe-deployments") ||
    process.argv.includes("--all");

  const keepDeployments = !cleanDeployments;

  clearAndRebuild({ keepDeployments, cleanDeployments })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ [clear] Clean failed:", err);
      process.exit(1);
    });
}
