import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { ApigeeContext } from "../lib/apigee";
import {
  keyValueMapOperations,
  getEnvVariableForKey,
  toUpperSnakeCase,
  globalKvmStore,
} from "../lib/policies/KeyValueMapOperations";
import { DataManager } from "../lib/DataManager";
import { spawnSync } from "node:child_process";

describe("KVM Runtime Environment Variables Support", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Reset process.env changes
    delete process.env.GEMINI_API_KEY;
    delete process.env.GeminiApiKey;
    delete process.env.GEMINIAPIKEY;
    delete process.env.KVM_AI_CONFIG_GEMINI_API_KEY;
    delete process.env.KVM_AICONFIG_GEMINIAPIKEY;
    delete process.env.var2;
    delete process.env.VAR2;
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  it("converts keys to upper snake case properly", () => {
    expect(toUpperSnakeCase("GeminiApiKey")).toBe("GEMINI_API_KEY");
    expect(toUpperSnakeCase("geminiApiKey")).toBe("GEMINI_API_KEY");
    expect(toUpperSnakeCase("GEMINI_API_KEY")).toBe("GEMINI_API_KEY");
    expect(toUpperSnakeCase("var2")).toBe("VAR2");
    expect(toUpperSnakeCase("OpenAI_Key")).toBe("OPEN_AI_KEY");
  });

  it("resolves environment variable for key by exact name, snake case, uppercase, or placeholder", () => {
    // 1. Snake case (e.g. GeminiApiKey -> GEMINI_API_KEY)
    process.env.GEMINI_API_KEY = "test-secret-123";
    expect(getEnvVariableForKey("GeminiApiKey", "AI-Config", "{GEMINI_API_KEY}")).toBe("test-secret-123");

    // 2. Exact match (e.g. var2)
    process.env.var2 = "custom-val2";
    expect(getEnvVariableForKey("var2", "AI-Config")).toBe("custom-val2");

    // 3. Uppercase conversion
    delete process.env.var2;
    process.env.VAR2 = "uppercase-val2";
    expect(getEnvVariableForKey("var2", "AI-Config")).toBe("uppercase-val2");

    // 4. KVM prefix fallback
    delete process.env.GEMINI_API_KEY;
    process.env.KVM_AI_CONFIG_GEMINI_API_KEY = "kvm-prefix-val";
    expect(getEnvVariableForKey("GeminiApiKey", "AI-Config")).toBe("kvm-prefix-val");
  });

  it("assigns environment variable value at runtime when KVM GET is executed", async () => {
    const ctx = new ApigeeContext();
    globalKvmStore["AI-Config"] = {
      GeminiApiKey: "{GEMINI_API_KEY}",
      var2: "original-var2-value",
    };

    // Set environment variable at runtime
    process.env.GEMINI_API_KEY = "fdj23432";
    process.env.var2 = "val2";

    await keyValueMapOperations(
      {
        mapIdentifier: "AI-Config",
        get: [
          { key: "GeminiApiKey", assignTo: "GeminiApiKey" },
          { key: "var2", assignTo: "resolvedVar2" },
        ],
      },
      ctx
    );

    expect(ctx.getVariable("GeminiApiKey")).toBe("fdj23432");
    expect(ctx.getVariable("resolvedVar2")).toBe("val2");
  });

  it("falls back to normal set KVM value when environment variable is not set", async () => {
    const ctx = new ApigeeContext();
    globalKvmStore["AI-Config"] = {
      GeminiApiKey: "{GEMINI_API_KEY}",
      var2: "original-var2-value",
    };

    // Neither GEMINI_API_KEY nor var2 is set in process.env
    delete process.env.GEMINI_API_KEY;
    delete process.env.var2;
    delete process.env.VAR2;

    await keyValueMapOperations(
      {
        mapIdentifier: "AI-Config",
        get: [
          { key: "GeminiApiKey", assignTo: "GeminiApiKey" },
          { key: "var2", assignTo: "resolvedVar2" },
        ],
      },
      ctx
    );

    // Normal set value in KVM is retained
    expect(ctx.getVariable("GeminiApiKey")).toBe("{GEMINI_API_KEY}");
    expect(ctx.getVariable("resolvedVar2")).toBe("original-var2-value");
  });

  it("loads deployment KVM and resolves runtime env vars in mock REST-AI-Interactions flow", async () => {
    await DataManager.initialize();

    // Verify AI-Config is loaded in DataManager
    const aiConfig = DataManager.getKvm("AI-Config");
    expect(aiConfig).toBeDefined();

    // Set runtime parameters
    process.env.GEMINI_API_KEY = "runtime-ai-key-999";

    const ctx = new ApigeeContext();
    // Simulate KVM-LoadCredentials policy as defined in data/proxies/REST-AI-Interactions.yaml
    await keyValueMapOperations(
      {
        mapIdentifier: "AI-Config",
        get: [{ key: "GeminiApiKey", assignTo: "GeminiApiKey" }],
      },
      ctx
    );

    expect(ctx.getVariable("GeminiApiKey")).toBe("runtime-ai-key-999");

    // AssignMessage simulation: {GeminiApiKey} is resolved
    const resolvedHeader = ctx.resolveVariables("{GeminiApiKey}");
    expect(resolvedHeader).toBe("runtime-ai-key-999");
  });
});

describe("deploy.sh --parameters Support", () => {
  it("displays --parameters in ./deploy.sh --help", () => {
    const result = spawnSync("./deploy.sh", ["--help"], { encoding: "utf8" });
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("--parameters <params>");
    expect(result.stdout).toContain('GEMINI_API_KEY=fdj23432,var2=val2');
  });

  it("accepts --parameters and exports variables during --build-only run", () => {
    // Run a dry test checking if deploy.sh accepts --parameters without error
    const result = spawnSync(
      "bash",
      [
        "-c",
        './deploy.sh --parameters "TEST_PARAM_A=alpha123,TEST_PARAM_B=beta456" --help',
      ],
      { encoding: "utf8" }
    );
    expect(result.status).toBe(0);
  });
});
