import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import {
  toFirestoreValue,
  fromFirestoreValue,
  decodeFirestoreFields,
  AnalyticsManager,
} from "../lib/analytics";
import { getGoogleAccessToken, getGoogleProjectId } from "../lib/googleAuth";

describe("Apigee Analytics & Firestore Public REST API Integration", () => {
  it("converts JavaScript primitives and objects to Firestore values and back", () => {
    const original = {
      str: "hello world",
      intNum: 42,
      floatNum: 3.14159,
      boolTrue: true,
      boolFalse: false,
      isoDate: "2026-09-19T06:40:00.000Z",
      nullVal: null,
      arrayVal: ["apple", 123, true],
      nestedMap: {
        aiModel: "gemini-3.7-flash",
        promptTokens: 150,
      },
    };

    const firestoreFields: Record<string, any> = {};
    for (const [k, v] of Object.entries(original)) {
      firestoreFields[k] = toFirestoreValue(v);
    }

    expect(firestoreFields.str).toEqual({ stringValue: "hello world" });
    expect(firestoreFields.intNum).toEqual({ integerValue: "42" });
    expect(firestoreFields.floatNum).toEqual({ doubleValue: 3.14159 });
    expect(firestoreFields.boolTrue).toEqual({ booleanValue: true });
    expect(firestoreFields.boolFalse).toEqual({ booleanValue: false });
    expect(firestoreFields.isoDate).toEqual({ timestampValue: "2026-09-19T06:40:00.000Z" });
    expect(firestoreFields.nullVal).toEqual({ nullValue: null });
    expect(firestoreFields.arrayVal.arrayValue.values).toHaveLength(3);
    expect(firestoreFields.nestedMap.mapValue.fields.aiModel).toEqual({ stringValue: "gemini-3.7-flash" });

    const decoded = decodeFirestoreFields(firestoreFields);
    expect(decoded.str).toBe(original.str);
    expect(decoded.intNum).toBe(original.intNum);
    expect(decoded.floatNum).toBeCloseTo(3.14159, 4);
    expect(decoded.boolTrue).toBe(true);
    expect(decoded.boolFalse).toBe(false);
    expect(decoded.isoDate).toBe(original.isoDate);
    expect(decoded.nullVal).toBeNull();
    expect(decoded.arrayVal).toEqual(["apple", 123, true]);
    expect(decoded.nestedMap.aiModel).toBe("gemini-3.7-flash");
    expect(decoded.nestedMap.promptTokens).toBe(150);
  });

  it("saves an analytics record to Firestore public REST API and retrieves it", async () => {
    const testTraceId = `test-analytics-${Date.now()}`;
    const testRecord = {
      traceId: testTraceId,
      proxyName: "REST-AI-GenerateContent",
      verb: "POST",
      path: "/v1/projects/cloud32x/locations/global/publishers/google/models/gemini-3.7-flash:generateContent",
      statusCode: 200,
      durationMs: 345,
      timestamp: new Date().toISOString(),
      model: "gemini-3.7-flash",
      provider: "google",
      promptTokens: 250,
      completionTokens: 110,
      totalTokens: 360,
      cost: 0.00028,
      targetUrl: "https://aiplatform.googleapis.com",
      aiVariables: {
        "ai.model": "gemini-3.7-flash",
        "ai.provider": "google",
        "ai.prompt_tokens": 250,
        "ai.completion_tokens": 110,
        "ai.total_tokens": 360,
        "ai.method": "generateContent",
      },
    };

    // Save record
    let saved: any;
    try {
      saved = await AnalyticsManager.saveRecord(testRecord);
    } catch (err: any) {
      if (err.message && (err.message.includes("403") || err.message.includes("PERMISSION_DENIED"))) {
        console.warn("Skipping remote Firestore live persistence assertion due to lack of GCP permissions:", err.message);
        return;
      }
      throw err;
    }
    expect(saved.id).toBeDefined();
    expect(saved.name).toContain("apigee_analytics");

    try {
      // Retrieve records
      const records = await AnalyticsManager.getRecentRecords(10);
      expect(Array.isArray(records)).toBe(true);
      expect(records.length).toBeGreaterThan(0);

      const found = records.find((r) => r.traceId === testTraceId);
      expect(found).toBeDefined();
      expect(found?.proxyName).toBe("REST-AI-GenerateContent");
      expect(found?.model).toBe("gemini-3.7-flash");
      expect(found?.promptTokens).toBe(250);
      expect(found?.aiVariables?.["ai.provider"]).toBe("google");
    } finally {
      // Clean up test document using public REST DELETE
      if (saved?.name) {
        const token = await getGoogleAccessToken();
        await fetch(`https://firestore.googleapis.com/v1/${saved.name}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
      }
    }
  }, 15000);
});
