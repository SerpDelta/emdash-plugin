/**
 * OAuth via serpdelta.com proxy.
 *
 * The plugin never touches the Google client secret.
 * serpdelta.com handles code exchange and token refresh.
 */

const SERPDELTA_API = "https://serpdelta.com/api/plugin";

export interface TokenPayload {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix ms
}

/**
 * Build the URL that starts the OAuth flow.
 * Redirects to serpdelta.com, which redirects to Google,
 * which redirects back to serpdelta.com, which redirects
 * back to the plugin callback with tokens.
 */
export function buildConnectUrl(
  pluginCallbackUrl: string,
  state: string,
): string {
  const params = new URLSearchParams({
    callback_url: pluginCallbackUrl,
    state,
  });
  return `${SERPDELTA_API}/connect?${params.toString()}`;
}

/**
 * Parse tokens from the callback query string.
 * serpdelta.com redirects back with access_token, refresh_token, expires_in, state.
 */
export function parseCallbackTokens(
  url: URL,
): { tokens: TokenPayload; state: string } | null {
  const accessToken = url.searchParams.get("access_token");
  const refreshToken = url.searchParams.get("refresh_token");
  const expiresIn = url.searchParams.get("expires_in");
  const state = url.searchParams.get("state");

  if (!accessToken || !refreshToken || !expiresIn || !state) {
    return null;
  }

  return {
    tokens: {
      accessToken,
      refreshToken,
      expiresAt: Date.now() + parseInt(expiresIn, 10) * 1000,
    },
    state,
  };
}

/**
 * Refresh an access token via serpdelta.com proxy.
 */
export async function refreshAccessToken(
  refreshToken: string,
  fetchFn: typeof fetch,
): Promise<{ accessToken: string; expiresAt: number }> {
  const res = await fetchFn(`${SERPDELTA_API}/refresh`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token refresh failed: ${res.status} ${text}`);
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  return {
    accessToken: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
}

/**
 * Get a valid access token, refreshing if needed.
 */
export async function getValidToken(
  tokens: TokenPayload,
  fetchFn: typeof fetch,
  saveFn: (updated: TokenPayload) => Promise<void>,
): Promise<string> {
  const bufferMs = 5 * 60 * 1000;
  if (tokens.expiresAt - bufferMs > Date.now()) {
    return tokens.accessToken;
  }

  const refreshed = await refreshAccessToken(tokens.refreshToken, fetchFn);
  const updated: TokenPayload = {
    ...tokens,
    accessToken: refreshed.accessToken,
    expiresAt: refreshed.expiresAt,
  };
  await saveFn(updated);
  return updated.accessToken;
}
