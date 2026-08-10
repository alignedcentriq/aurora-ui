import { msalInstance } from "./msal";

// Scope for the backend API (e.g. "api://<client-id>/access_as_user"). When unset (local
// dev with AZURE_JWT_ENABLED=false), getApiToken() returns null and callers simply omit the
// Bearer header — the backend falls back to header identity + DEV_REVEAL_DOMAINS.
const apiScope = import.meta.env.VITE_MSAL_API_SCOPE as string | undefined;

/**
 * Acquire an Azure AD access token for the backend API, used as a Bearer header on the
 * content-reveal endpoints (the one real security boundary). Returns null if no API scope
 * is configured or no account is signed in.
 */
export async function getApiToken(): Promise<string | null> {
  if (!apiScope || !msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  const request = { scopes: [apiScope], account: accounts[0] };
  try {
    const res = await msalInstance.acquireTokenSilent(request);
    return res.accessToken;
  } catch {
    try {
      const res = await msalInstance.acquireTokenPopup(request);
      return res.accessToken;
    } catch {
      return null;
    }
  }
}

/**
 * Acquire an Azure AD id_token for external SSO (TechElevate's /auth/sso-login, which
 * validates an Azure id_token and returns its own JWT). Returns null if MSAL is unavailable
 * or no account is signed in (e.g. local dev without MSAL).
 */
export async function getIdToken(): Promise<string | null> {
  if (!msalInstance) return null;
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length === 0) return null;
  // openid scope guarantees an id_token is issued without requiring API consent.
  const request = { scopes: ["openid", "profile", "email"], account: accounts[0] };
  try {
    const res = await msalInstance.acquireTokenSilent(request);
    return res.idToken ?? null;
  } catch {
    try {
      const res = await msalInstance.acquireTokenPopup(request);
      return res.idToken ?? null;
    } catch {
      return null;
    }
  }
}
