import type { ApigeeContext } from "../apigee";
import fs from "node:fs";
import path from "node:path";

export interface KeyValueStore {
  [mapIdentifier: string]: Record<string, any>;
}

// Global in-memory KVM store initialized from YAML on startup
export const globalKvmStore: KeyValueStore = {};

export interface KeyValueMapGet {
  key: string;
  assignTo: string;
  defaultValue?: string;
}

export interface KeyValueMapPut {
  key: string;
  value?: string;
  ref?: string;
}

export interface KeyValueMapOptions {
  mapIdentifier: string;
  get?: KeyValueMapGet[];
  put?: KeyValueMapPut[];
  delete?: string[];
  scope?: string;
}

import * as YAML from "yaml";

/**
 * Load local file-backed KVM entries if exists (./data/kvm/{mapIdentifier}.json, .yaml, or ./kvm/)
 */
function loadLocalFileKvm(mapIdentifier: string): Record<string, any> | null {
  const candidatePaths = [
    path.join(process.cwd(), "data", "kvm", `${mapIdentifier}.json`),
    path.join(process.cwd(), "data", "kvm", `${mapIdentifier}.yaml`),
    path.join(process.cwd(), "data", "kvm", `${mapIdentifier}.yml`),
    path.join(process.cwd(), "data", `${mapIdentifier}.json`),
    path.join(process.cwd(), "data", `${mapIdentifier}.yaml`),
    path.join(process.cwd(), "kvm", `${mapIdentifier}.json`),
  ];

  for (const p of candidatePaths) {
    if (fs.existsSync(p)) {
      try {
        const data = fs.readFileSync(p, "utf8");
        return p.endsWith(".json") ? JSON.parse(data) : YAML.parse(data);
      } catch {
        // continue
      }
    }
  }
  return null;
}

/**
 * KeyValueMapOperations Policy implementation
 * Provides local lightweight KVM storage and variable assignment
 */
export async function keyValueMapOperations(options: KeyValueMapOptions, context: ApigeeContext): Promise<void> {
  if (!options) return;

  const mapIdentifier = options.mapIdentifier || "default";
  if (!globalKvmStore[mapIdentifier]) {
    const fileKvm = loadLocalFileKvm(mapIdentifier);
    if (fileKvm) {
      globalKvmStore[mapIdentifier] = fileKvm;
    } else if (mapIdentifier === "AI-Config") {
      globalKvmStore[mapIdentifier] = {
        FailoverModel: "google/gemini-3.7-flash",
        PriceList: JSON.stringify({
          default: { requestPerMillionTokens: 1, responsePerMillionTokens: 3 },
          "google/gemini-3.7-flash": { requestPerMillionTokens: 0.15, responsePerMillionTokens: 0.6 },
          "google/gemini-3.5-flash-lite": { requestPerMillionTokens: 0.075, responsePerMillionTokens: 0.3 },
        }),
        GroupsLookup: "{}",
        Groups: "[]",
      };
    } else {
      globalKvmStore[mapIdentifier] = {};
    }
  }
  const map = globalKvmStore[mapIdentifier];

  // 1. PUT
  if (options.put) {
    for (const item of options.put) {
      if (item.key) {
        let val = item.value ?? "";
        if (item.ref) {
          val = context.getVariable(item.ref) ?? "";
        }
        map[item.key] = val;
      }
    }
  }

  // 2. DELETE
  if (options.delete) {
    for (const key of options.delete) {
      delete map[key];
    }
  }

  // 3. GET
  if (options.get) {
    for (const item of options.get) {
      if (item.key && item.assignTo) {
        let val = map[item.key];
        if (val === undefined) {
          // Check environment variable fallback: e.g. KVM_AICONFIG_FAILOVERMODEL
          const envKey = `KVM_${mapIdentifier.replace(/[^a-zA-Z0-9]/g, "_").toUpperCase()}_${item.key.toUpperCase()}`;
          if (process.env[envKey] !== undefined) {
            val = process.env[envKey];
          } else {
            val = item.defaultValue ?? "";
          }
        }
        context.setVariable(item.assignTo, val);
      }
    }
  }
}
