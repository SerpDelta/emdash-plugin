/**
 * Google OAuth 2.0 helpers for EmDash plugin context.
 * Uses ctx.http.fetch() — no Node.js APIs.
 */

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

const SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/webmasters.readonly",
];

export interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
  email?: string;
}

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
  id_token?: string;
}

export function buildAuthUrl(
  clientId: string,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export async function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  fetchFn: typeof fetch,
): Promise<TokenResponse> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }

  return (await res.json()) as TokenResponse;
}

export async function refreshAccessToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetchFn(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
    }).toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as TokenResponse;
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

export async function getValidToken(
  tokens: TokenPayload,
  clientId: string,
  clientSecret: string,
  fetchFn: typeof fetch,
  saveFn: (updated: TokenPayload) => Promise<void>,
): Promise<string> {
  // 5-minute buffer before expiry
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expiresAt - bufferMs > Date.now()) {
    return tokens.accessToken;
  }

  const refreshed = await refreshAccessToken(
    tokens.refreshToken,
    clientId,
    clientSecret,
    fetchFn,
  );

  const updated: TokenPayload = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  };
  await saveFn(updated);
  return updated.accessToken;
}
