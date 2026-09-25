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

export const DEFAULT_AI_CONFIG: Record<string, any> = {
  FailoverModel: "google/gemini-3.7-flash",
  PriceList: JSON.stringify({
    default: { requestPerMillionTokens: 1, responsePerMillionTokens: 3 },
    "google/gemini-3.7-flash": { requestPerMillionTokens: 0.15, responsePerMillionTokens: 0.6 },
    "google/gemini-3.5-flash-lite": { requestPerMillionTokens: 0.075, responsePerMillionTokens: 0.3 },
  }),
  GroupsLookup: "{}",
  Groups: "[]",
};

/**
 * Convert camelCase or PascalCase to UPPER_SNAKE_CASE (e.g. GeminiApiKey -> GEMINI_API_KEY)
 */
export function toUpperSnakeCase(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .toUpperCase();
}

/**
 * Checks if an environment variable is set for the KVM key being accessed.
 * Checks candidate names in priority order:
 * 1. Exact key match: process.env[key] (e.g. var2, GEMINI_API_KEY)
 * 2. Upper snake-case of key: process.env[toUpperSnakeCase(key)] (e.g. GeminiApiKey -> GEMINI_API_KEY)
 * 3. Uppercase conversion: process.env[key.toUpperCase()]
 * 4. Placeholder reference inside mapVal (e.g. "{GEMINI_API_KEY}" -> GEMINI_API_KEY)
 * 5. KVM namespaced env var: KVM_<MAP>_<KEY> (e.g. KVM_AI_CONFIG_GEMINI_API_KEY, KVM_AICONFIG_FAILOVERMODEL)
 */
export function getEnvVariableForKey(key: string, mapIdentifier?: string, mapVal?: any): string | undefined {
  if (!key) return undefined;

  const candidates: string[] = [];

  // 1. Exact key as requested (e.g. "GEMINI_API_KEY", "var2")
  candidates.push(key);

  // 2. Upper snake-case (e.g. "GeminiApiKey" -> "GEMINI_API_KEY")
  const snakeKey = toUpperSnakeCase(key);
  if (!candidates.includes(snakeKey)) {
    candidates.push(snakeKey);
  }

  // 3. Uppercase alphanumeric (e.g. "GEMINIAPIKEY")
  const upperKey = key.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
  if (!candidates.includes(upperKey)) {
    candidates.push(upperKey);
  }

  // 4. Template placeholder inside mapVal (e.g. mapVal is "{GEMINI_API_KEY}")
  if (typeof mapVal === "string") {
    const trimmed = mapVal.trim();
    const match = trimmed.match(/^\{([^{}]+)\}$/);
    if (match && match[1]) {
      const innerKey = match[1].trim();
      if (!candidates.includes(innerKey)) {
        candidates.push(innerKey);
      }
      const innerSnake = toUpperSnakeCase(innerKey);
      if (!candidates.includes(innerSnake)) {
        candidates.push(innerSnake);
      }
    }
  }

  // 5. Namespaced KVM environment variables
  if (mapIdentifier) {
    const cleanMap = mapIdentifier.replace(/[^a-zA-Z0-9_]/g, "_").toUpperCase();
    const kvmSnake = `KVM_${cleanMap}_${snakeKey}`;
    if (!candidates.includes(kvmSnake)) {
      candidates.push(kvmSnake);
    }
    const kvmUpper = `KVM_${cleanMap}_${upperKey}`;
    if (!candidates.includes(kvmUpper)) {
      candidates.push(kvmUpper);
    }
    const rawMap = mapIdentifier.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const kvmRaw = `KVM_${rawMap}_${upperKey}`;
    if (!candidates.includes(kvmRaw)) {
      candidates.push(kvmRaw);
    }
  }

  for (const cand of candidates) {
    if (process.env[cand] !== undefined) {
      return process.env[cand];
    }
  }

  return undefined;
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
    if (mapIdentifier === "AI-Config") {
      globalKvmStore[mapIdentifier] = {
        ...DEFAULT_AI_CONFIG,
        ...(fileKvm || {}),
      };
    } else if (fileKvm) {
      globalKvmStore[mapIdentifier] = fileKvm;
    } else {
      globalKvmStore[mapIdentifier] = {};
    }
  } else if (mapIdentifier === "AI-Config") {
    // Ensure default AI-Config fields exist if missing
    for (const [k, v] of Object.entries(DEFAULT_AI_CONFIG)) {
      if (globalKvmStore[mapIdentifier][k] === undefined) {
        globalKvmStore[mapIdentifier][k] = v;
      }
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
        const mapVal = map[item.key] ?? (mapIdentifier === "AI-Config" ? DEFAULT_AI_CONFIG[item.key] : undefined);
        const envVal = getEnvVariableForKey(item.key, mapIdentifier, mapVal);

        let val: any;
        if (envVal !== undefined) {
          // Use environment variable value at runtime
          val = envVal;
        } else if (mapVal !== undefined) {
          // Normal set value in KVM
          val = mapVal;
        } else {
          // Default fallback
          val = item.defaultValue ?? "";
        }

        context.setVariable(item.assignTo, val);
      }
    }
  }
}
