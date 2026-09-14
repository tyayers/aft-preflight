import { GoogleAuth } from "google-auth-library";

let cachedToken: { token: string; expiresAt: number } | null = null;

/**
 * Retrieves a Google Cloud access token using Application Default Credentials (ADC).
 * Falls back to gcloud CLI or environment variables if needed.
 */
export async function getGoogleAccessToken(forceRefresh: boolean = false): Promise<string> {
  const now = Date.now();
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > now + 60000) {
    return cachedToken.token;
  }

  // 1. Check explicit environment variables
  if (process.env.GOOGLE_ACCESS_TOKEN || process.env.GCP_ACCESS_TOKEN) {
    const token = (process.env.GOOGLE_ACCESS_TOKEN || process.env.GCP_ACCESS_TOKEN)!.trim();
    cachedToken = { token, expiresAt: now + 3600000 };
    return token;
  }

  // 2. Try GoogleAuth ADC via google-auth-library
  try {
    const auth = new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
    const client = await auth.getClient();
    const tokenResponse = await client.getAccessToken();
    const token = typeof tokenResponse === "string" ? tokenResponse : tokenResponse?.token;
    if (token) {
      const expiry = (client as any)?.credentials?.expiry_date || (now + 3500000);
      cachedToken = { token, expiresAt: expiry };
      return token;
    }
  } catch (err: any) {
    // ADC failed via library, proceed to fallback
  }

  // 3. Fallback to gcloud CLI
  try {
    const proc = Bun.spawnSync(["gcloud", "auth", "application-default", "print-access-token"], {
      stderr: "ignore",
    });
    if (proc.exitCode === 0) {
      const token = proc.stdout.toString().trim();
      if (token && !token.startsWith("ERROR") && !token.startsWith("WARNING")) {
        cachedToken = { token, expiresAt: now + 3500000 };
        return token;
      }
    }
  } catch {}

  try {
    const proc = Bun.spawnSync(["gcloud", "auth", "print-access-token"], {
      stderr: "ignore",
    });
    if (proc.exitCode === 0) {
      const token = proc.stdout.toString().trim();
      if (token && !token.startsWith("ERROR") && !token.startsWith("WARNING")) {
        cachedToken = { token, expiresAt: now + 3500000 };
        return token;
      }
    }
  } catch {}

  // 4. Default fallback
  return "mock-google-cloud-token";
}
