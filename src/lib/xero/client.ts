import "dotenv/config";

const XERO_TOKEN_URL = "https://identity.xero.com/connect/token";
const XERO_CONNECTIONS_URL = "https://api.xero.com/connections";
const XERO_API_BASE = "https://api.xero.com/api.xro/2.0";

/**
 * Custom connections use the OAuth2 client_credentials grant — no refresh
 * token, no per-user consent screen, single org by design. Just re-request
 * a token when it expires (~30 min) and cache it in memory in the meantime.
 *
 * Module-level cache: fine for the single long-running dev server process
 * this runs in today. Revisit if this ever runs across multiple serverless
 * instances, where each cold start would re-authenticate anyway.
 */
let tokenCache: { accessToken: string; expiresAt: number } | null = null;
let tenantCache: { tenantId: string; tenantName: string } | null = null;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set — see .env.example`);
  return value;
}

async function fetchAccessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 30_000) {
    return tokenCache.accessToken;
  }

  const clientId = requireEnv("XERO_CLIENT_ID");
  const clientSecret = requireEnv("XERO_CLIENT_SECRET");

  const res = await fetch(XERO_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({ grant_type: "client_credentials" }),
  });

  if (!res.ok) {
    throw new Error(`Xero token request failed (${res.status}): ${await res.text()}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  tokenCache = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return tokenCache.accessToken;
}

async function getTenantId(): Promise<string> {
  if (tenantCache) return tenantCache.tenantId;

  const accessToken = await fetchAccessToken();
  const res = await fetch(XERO_CONNECTIONS_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Xero /connections request failed (${res.status}): ${await res.text()}`);
  }

  const connections = (await res.json()) as { tenantId: string; tenantName: string }[];
  if (connections.length === 0) {
    throw new Error(
      "No Xero organisation is connected to this custom connection yet — connect one from developer.xero.com first.",
    );
  }

  // Custom connections are single-org by design (brief section 4) — the
  // first entry is the only entry.
  tenantCache = { tenantId: connections[0].tenantId, tenantName: connections[0].tenantName };
  return tenantCache.tenantId;
}

export async function getConnectedOrgName(): Promise<string> {
  await getTenantId();
  return tenantCache!.tenantName;
}

/** Authenticated request against the Xero Accounting API (api.xro/2.0). */
export async function xeroRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = await fetchAccessToken();
  const tenantId = await getTenantId();

  const res = await fetch(`${XERO_API_BASE}${path}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
      "Xero-tenant-id": tenantId,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Xero API request failed (${res.status}) ${path}: ${await res.text()}`);
  }

  return res.json() as Promise<T>;
}
