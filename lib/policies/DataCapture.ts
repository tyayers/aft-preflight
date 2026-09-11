import type { ApigeeContext } from "../apigee";

export interface DataCaptureCollector {
  collectorName: string;
  ref?: string;
  defaultValue?: string;
}

export interface DataCaptureOptions {
  policyName?: string;
  collectors: DataCaptureCollector[];
  continueOnError?: boolean;
}

// In-memory data store for captured data metrics
export const capturedDataMetrics: Array<{
  timestamp: number;
  policyName?: string;
  metrics: Record<string, any>;
}> = [];

/**
 * DataCapture Policy implementation
 * Lightweight local collector for analytics and data capture
 */
export async function dataCapture(options: DataCaptureOptions, context: ApigeeContext): Promise<void> {
  if (!options || !options.collectors) return;

  const captured: Record<string, any> = {};

  for (const col of options.collectors) {
    let val = (col.ref ? context.getVariable(col.ref) : undefined) ?? col.defaultValue ?? "";
    if (val === undefined || val === null) {
      val = col.defaultValue ?? "";
    }
    if (col.collectorName) {
      context.setVariable(`datacapture.${col.collectorName}`, val);
      captured[col.collectorName] = val;
    }
  }

  capturedDataMetrics.push({
    timestamp: Date.now(),
    policyName: options.policyName || "DataCapture",
    metrics: captured,
  });
}
