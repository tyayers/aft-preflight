import { getGoogleAccessToken, getGoogleProjectId } from "./googleAuth";

/**
 * Converts a standard JavaScript value to a Firestore REST API Value object.
 * Does not use any Firebase or Firestore SDKs.
 */
export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) {
    return { nullValue: null };
  }
  if (typeof val === "boolean") {
    return { booleanValue: val };
  }
  if (typeof val === "number") {
    if (Number.isInteger(val)) {
      return { integerValue: String(val) };
    }
    return { doubleValue: val };
  }
  if (typeof val === "string") {
    // If it is a valid ISO 8601 date string, store as Firestore timestampValue
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z?$/.test(val)) {
      return { timestampValue: val.endsWith("Z") ? val : val + "Z" };
    }
    return { stringValue: val };
  }
  if (val instanceof Date) {
    return { timestampValue: val.toISOString() };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === "object") {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

/**
 * Converts a Firestore REST API Value object back into a standard JavaScript value.
 */
export function fromFirestoreValue(val: any): any {
  if (!val) return null;
  if ("stringValue" in val) return val.stringValue;
  if ("integerValue" in val) return parseInt(val.integerValue, 10);
  if ("doubleValue" in val) return val.doubleValue;
  if ("booleanValue" in val) return val.booleanValue;
  if ("timestampValue" in val) return val.timestampValue;
  if ("nullValue" in val) return null;
  if ("mapValue" in val) {
    const res: Record<string, any> = {};
    if (val.mapValue?.fields) {
      for (const [k, v] of Object.entries(val.mapValue.fields)) {
        res[k] = fromFirestoreValue(v);
      }
    }
    return res;
  }
  if ("arrayValue" in val) {
    return (val.arrayValue?.values || []).map(fromFirestoreValue);
  }
  return null;
}

export function decodeFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [k, v] of Object.entries(fields || {})) {
    result[k] = fromFirestoreValue(v);
  }
  return result;
}

export interface AnalyticsRecord {
  id?: string;
  traceId?: string;
  timestamp?: string;
  proxyName?: string;
  verb?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  model?: string;
  provider?: string;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  cost?: number;
  targetUrl?: string;
  targetStatus?: number;
  targetDurationMs?: number;
  aiVariables?: Record<string, any>;
  [key: string]: any;
}

export class AnalyticsManager {
  private static readonly COLLECTION = "apigee_analytics";

  /**
   * Saves an analytics record to the Firebase (default) database in the project
   * in the "apigee_analytics" collection using the public REST API.
   */
  public static async saveRecord(data: Partial<AnalyticsRecord>): Promise<{ id: string; name: string }> {
    const projectId = await getGoogleProjectId();
    const token = await getGoogleAccessToken();

    const record: Record<string, any> = {
      timestamp: data.timestamp || new Date().toISOString(),
      ...data,
    };

    const docFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(record)) {
      if (v !== undefined) {
        docFields[k] = toFirestoreValue(v);
      }
    }

    const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${this.COLLECTION}`;
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ fields: docFields }),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      throw new Error(`Failed to save analytics record to Firestore (${resp.status}): ${errText}`);
    }

    const created = await resp.json();
    const docId = created.name ? created.name.split("/").pop() : "";
    return {
      id: docId,
      name: created.name,
    };
  }

  /**
   * Retrieves the last records (up to limit, default 500) from the "apigee_analytics"
   * collection in the Firebase (default) database using the public REST API.
   */
  public static async getRecentRecords(limit: number = 500): Promise<AnalyticsRecord[]> {
    const projectId = await getGoogleProjectId();
    const token = await getGoogleAccessToken();

    // 1. Try runQuery with orderBy timestamp DESCENDING
    try {
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
      const queryResp = await fetch(queryUrl, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          structuredQuery: {
            from: [{ collectionId: this.COLLECTION }],
            orderBy: [{ field: { fieldPath: "timestamp" }, direction: "DESCENDING" }],
            limit,
          },
        }),
      });

      if (queryResp.ok) {
        const queryResults = await queryResp.json();
        const records = (Array.isArray(queryResults) ? queryResults : [])
          .filter((item: any) => item.document && item.document.fields)
          .map((item: any) => {
            const fields = decodeFirestoreFields(item.document.fields);
            const docId = item.document.name ? item.document.name.split("/").pop() : undefined;
            return {
              id: docId,
              ...fields,
            };
          });

        return records;
      }
    } catch (err) {
      console.warn("Firestore runQuery with orderBy failed, falling back to unordered query:", err);
    }

    // 2. Fallback: query without orderBy or list documents, and sort in memory
    try {
      const listUrl = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${this.COLLECTION}?pageSize=${Math.min(limit, 500)}`;
      const listResp = await fetch(listUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (listResp.ok) {
        const listData = await listResp.json();
        const documents = listData.documents || [];
        const records = documents.map((doc: any) => {
          const fields = decodeFirestoreFields(doc.fields || {});
          const docId = doc.name ? doc.name.split("/").pop() : undefined;
          return {
            id: docId,
            ...fields,
          };
        });

        // Sort descending by timestamp in memory
        records.sort((a: any, b: any) => {
          const tA = new Date(a.timestamp || 0).getTime();
          const tB = new Date(b.timestamp || 0).getTime();
          return tB - tA;
        });

        return records.slice(0, limit);
      }
    } catch (err) {
      console.error("Firestore list documents fallback failed:", err);
    }

    return [];
  }

  /**
   * Deletes a record from "apigee_analytics" using the public REST API.
   */
  public static async deleteRecord(docIdOrName: string): Promise<boolean> {
    const projectId = await getGoogleProjectId();
    const token = await getGoogleAccessToken();
    const docPath = docIdOrName.startsWith("projects/")
      ? docIdOrName
      : `projects/${projectId}/databases/(default)/documents/${this.COLLECTION}/${docIdOrName}`;
    const url = `https://firestore.googleapis.com/v1/${docPath}`;

    const resp = await fetch(url, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    return resp.ok;
  }
}

