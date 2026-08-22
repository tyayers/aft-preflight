import type { ApigeeContext } from "../apigee";

export interface DataCaptureCollector {
  collectorName: string;
  ref?: string;
  defaultValue?: string;
}

export interface DataCaptureOptions {
  collectors: DataCaptureCollector[];
}

/**
 * DataCapture Policy implementation
 */
export async function dataCapture(options: DataCaptureOptions, context: ApigeeContext): Promise<void> {
  if (!options || !options.collectors) return;

  for (const col of options.collectors) {
    const val = (col.ref ? context.getVariable(col.ref) : undefined) ?? col.defaultValue ?? "";
    if (col.collectorName) {
      context.setVariable(`datacapture.${col.collectorName}`, val);
    }
  }
}
