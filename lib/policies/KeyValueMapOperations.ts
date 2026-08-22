import type { ApigeeContext } from "../apigee";

export interface KeyValueStore {
  [mapIdentifier: string]: Record<string, any>;
}

// Global in-memory KVM store
export const globalKvmStore: KeyValueStore = {};

export interface KeyValueMapGet {
  key: string;
  assignTo: string;
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
}

/**
 * KeyValueMapOperations Policy implementation
 */
export async function keyValueMapOperations(options: KeyValueMapOptions, context: ApigeeContext): Promise<void> {
  if (!options) return;

  const mapIdentifier = options.mapIdentifier || "default";
  if (!globalKvmStore[mapIdentifier]) {
    globalKvmStore[mapIdentifier] = {};
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
        const val = map[item.key] ?? "";
        context.setVariable(item.assignTo, val);
      }
    }
  }
}
