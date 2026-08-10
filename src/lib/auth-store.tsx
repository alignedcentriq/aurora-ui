import React, { createContext, useContext, useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";
import { cleanUrlParams } from "./utils";
import { getIdToken } from "./api-token";
import "./impersonation"; // installs the x-impersonate-role fetch patch on import

// Fast wrapper for fetch timeout
const fetchWithTimeout = async (url: string, options: RequestInit = {}, timeoutMs = 2000) => {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(id);
    return response;
  } catch (error) {
    clearTimeout(id);
    throw error;
  }
};

// Fast wrapper for promise timeout
const timeoutPromise = <T,>(promise: Promise<T>, ms: number, errorMsg = "Timeout"): Promise<T> => {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(errorMsg));
    }, ms);

    promise
      .then((res) => {
        clearTimeout(timer);
        resolve(res);
      })
      .catch((err) => {
        clearTimeout(timer);
        reject(err);
      });
  });
};

export type Role =
  | "Employee"
  | "HR"
  | "IT"
  | "PMO"
  | "Admin"
  | "Functional Manager"
  | "Super Admin";

export interface TeamMember {
  id: string;
  name: string;
  role: Role;
  department: string;
  avatar: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: Role; // EFFECTIVE role (the impersonated role while a Super Admin is testing)
  realRole?: Role; // true role; only differs from `role` while a Super Admin is test-impersonating
  scopes: string[]; // Feature-level scopes for scoped Admin; [] = full role access
  avatarUrl?: string;
  team?: TeamMember[];
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isInteracting: boolean;
  accessDenied: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
}

const ROLE_MAP: Record<string, Role> = {
  employee: "Employee",
  hr: "HR",
  it: "IT",
  pmo: "PMO",
  admin: "Admin",
  "functional manager": "Functional Manager",
  "super admin": "Super Admin",
};

const apiScope = import.meta.env.VITE_MSAL_API_SCOPE as string | undefined;
const loginRequest = {
  // Include the backend API scope (when configured) so group-gated content reveal can
  // acquire a validated access token without a second consent prompt.
  scopes: ["User.Read", "openid", "profile", ...(apiScope ? [apiScope] : [])],
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { instance, accounts, inProgress } = useMsal();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);

  const isInteracting = inProgress !== InteractionStatus.None;
  const hasAutoRedirected = React.useRef(false);

  useEffect(() => {
    const checkAccount = async () => {
      // 1. Dev Bypass / Mock Mode
      const isDev =
        window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
      const params = new URLSearchParams(window.location.search);
      const mockEmail =
        params.get("mock-email") ||
        localStorage.getItem("mock-email") ||
        (isDev ? "shivam.sharma@alignedautomation.com" : null);

      if (mockEmail) {
        if (params.get("mock-email")) localStorage.setItem("mock-email", mockEmail);

        // Role is always determined by the backend — DB override takes precedence over any local claim.
        let effectiveRole: Role = "Employee";
        let realRole: Role = "Employee";
        let scopes: string[] = [];
        let roleResolved = false;
        try {
          const accessRes = await fetchWithTimeout(
            "/api/access/me",
            {
              headers: { "x-user-email": mockEmail, "x-user-role": "employee" },
            },
            5000,
          );
          if (accessRes.ok) {
            const accessData = await accessRes.json();
            // Always use the backend-resolved role — /api/access/me returns the true
            // effective role whether it came from a DB override or the default.
            if (accessData.role) {
              effectiveRole = ROLE_MAP[accessData.role.toLowerCase()] ?? effectiveRole;
              scopes = accessData.scopes || [];
            }
            // real_role lets the Super Admin role-switcher stay visible while impersonating.
            realRole = ROLE_MAP[(accessData.real_role || accessData.role || "").toLowerCase()] ?? effectiveRole;
            roleResolved = true;
          }
        } catch {
          // Network error (e.g. backend busy) — preserve the existing role rather than
          // downgrading to Employee; the user will keep their current access until the
          // next successful /api/access/me call.
        }

        // Properly capitalize each word of the display name derived from the email
        // (e.g. "shivam.sharma" → "Shivam Sharma").
        const displayName = mockEmail
          .split("@")[0]
          .replace(/[._]/g, " ")
          .split(" ")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");

        // Load the cached avatar from localStorage (same as the MSAL path).
        // Validate it's a real data URL to discard any corrupted entries.
        const rawCached = localStorage.getItem(`avatar_${mockEmail}`);
        const cachedMockAvatar =
          rawCached && rawCached.startsWith("data:image/") ? rawCached : undefined;
        if (rawCached && !cachedMockAvatar) {
          // Evict the corrupted entry so a fresh fetch can succeed next time.
          localStorage.removeItem(`avatar_${mockEmail}`);
        }

        setUser((prev) => ({
          id: "mock-id",
          name: displayName,
          email: mockEmail,
          role: roleResolved ? effectiveRole : (prev?.role ?? effectiveRole),
          realRole: roleResolved ? realRole : (prev?.realRole ?? realRole),
          scopes: roleResolved ? scopes : (prev?.scopes ?? scopes),
          avatarUrl: prev?.avatarUrl || cachedMockAvatar,
          team: [
            {
              id: "t1",
              name: "Alice Smith",
              role: "Employee",
              department: "Engineering",
              avatar: "AS",
            },
            {
              id: "t2",
              name: "Bob Jones",
              role: "Employee",
              department: "Engineering",
              avatar: "BJ",
            },
          ],
        }));
        setIsLoading(false);
        return;
      }

      // Only update user state when not in the middle of an interaction
      if (inProgress === InteractionStatus.None) {
        if (accounts.length > 0) {
          cleanUrlParams();
          const account = accounts[0];
          const idTokenClaims = account.idTokenClaims as any;
          const msalRole = idTokenClaims?.roles?.[0] || idTokenClaims?.extension_Role || "Employee";
          const email = account.username;

          // Verify the user is on the backend allowlist before granting access.
          try {
            const res = await fetchWithTimeout(
              "/api/me",
              {
                headers: { "x-user-email": email, "x-user-role": msalRole.toLowerCase() },
              },
              2000,
            );
            if (res.status === 403) {
              setAccessDenied(true);
              setIsLoading(false);
              return;
            }
          } catch {
            // Network error — allow through; backend will enforce on actual calls.
          }

          // Fetch effective role + scopes from backend (DB override wins over MSAL claim).
          let effectiveRole: Role = ROLE_MAP[msalRole.toLowerCase()] ?? (msalRole as Role);
          let realRole: Role = effectiveRole;
          let scopes: string[] = [];
          let roleResolved = false;
          try {
            const accessRes = await fetchWithTimeout(
              "/api/access/me",
              {
                headers: { "x-user-email": email, "x-user-role": msalRole.toLowerCase() },
              },
              5000,
            );
            if (accessRes.ok) {
              const accessData = await accessRes.json();
              if (accessData.role) {
                effectiveRole = ROLE_MAP[accessData.role.toLowerCase()] ?? effectiveRole;
                scopes = accessData.scopes || [];
              }
              realRole = ROLE_MAP[(accessData.real_role || accessData.role || "").toLowerCase()] ?? effectiveRole;
              roleResolved = true;
            }
          } catch {
            // Network error — fall through; role preserved from prev state below
          }

          // Validate the cached avatar is a proper data URL before trusting it.
          // A corrupted/truncated entry would cause a broken <img> and onError fallback.
          const rawCachedAvatar = localStorage.getItem(`avatar_${email}`);
          const cachedAvatar =
            rawCachedAvatar && rawCachedAvatar.startsWith("data:image/")
              ? rawCachedAvatar
              : undefined;
          if (rawCachedAvatar && !cachedAvatar) {
            localStorage.removeItem(`avatar_${email}`);
          }
          setUser((prev) => ({
            id: account.localAccountId,
            name: account.name || account.username || "User",
            email,
            role: roleResolved ? effectiveRole : (prev?.role ?? effectiveRole),
            realRole: roleResolved ? realRole : (prev?.realRole ?? realRole),
            scopes: roleResolved ? scopes : (prev?.scopes ?? scopes),
            avatarUrl: prev?.avatarUrl || cachedAvatar,
            team: [
              {
                id: "t1",
                name: "Alice Smith",
                role: "Employee",
                department: "Engineering",
                avatar: "AS",
              },
              {
                id: "t2",
                name: "Bob Jones",
                role: "Employee",
                department: "Engineering",
                avatar: "BJ",
              },
            ],
          }));
          setIsLoading(false);
        } else if (!hasAutoRedirected.current) {
          hasAutoRedirected.current = true;
          try {
            await timeoutPromise(instance.ssoSilent(loginRequest), 2500, "SSO Silent Timeout");
            // accounts will update, triggering another render
          } catch {
            try {
              await instance.loginRedirect(loginRequest);
              // navigates away — isLoading stays true (spinner shown)
            } catch (e: any) {
              if (e.name !== "BrowserAuthError" || e.errorCode !== "interaction_in_progress") {
                // silent — auth failure will surface via fallback login button
              }
              setIsLoading(false); // show fallback button
            }
          }
        }
      }
    };

    checkAccount();
  }, [accounts, inProgress, instance]);

  // Guard: only fetch the Graph photo once per account to avoid race conditions
  // where a re-run of this effect overwrites an avatarUrl that was already set.
  const photoFetchedFor = React.useRef<string | null>(null);

  // Fetch actual profile photo from Microsoft Graph (production / real MSAL accounts)
  useEffect(() => {
    const fetchGraphPhoto = async () => {
      if (accounts.length > 0 && inProgress === InteractionStatus.None) {
        const email = accounts[0].username;

        // Skip if we already successfully fetched for this account.
        if (photoFetchedFor.current === email) return;

        try {
          const request = {
            scopes: ["User.Read"],
            account: accounts[0],
          };
          const response = await instance.acquireTokenSilent(request);

          const photoResponse = await fetch("https://graph.microsoft.com/v1.0/me/photo/$value", {
            headers: {
              Authorization: `Bearer ${response.accessToken}`,
            },
          });

          if (photoResponse.ok) {
            const blob = await photoResponse.blob();
            // Convert to base64 for persistent caching across refreshes / restarts.
            const reader = new FileReader();
            reader.onloadend = () => {
              const base64 = reader.result as string;
              // Guard against localStorage quota errors (5 MB limit).
              // If the write fails, fall back to an object URL so the avatar
              // still displays for the current session.
              let avatarUrl = base64;
              try {
                localStorage.setItem(`avatar_${email}`, base64);
              } catch {
                // QuotaExceededError — use an ephemeral object URL instead.
                avatarUrl = URL.createObjectURL(blob);
              }
              photoFetchedFor.current = email;
              setUser((prev) => (prev ? { ...prev, avatarUrl } : prev));
            };
            reader.readAsDataURL(blob);
          } else {
            // Non-OK response (e.g. 404 = no photo set) — mark as fetched so
            // we don't keep retrying on every effect re-run.
            photoFetchedFor.current = email;
          }
        } catch {
          // photo fetch failed — avatar stays unset; will retry on next mount.
        }
      }
    };

    fetchGraphPhoto();
  }, [accounts, instance, inProgress]);

  // Fetch profile photo via the backend proxy for mock / dev mode.
  // In mock mode, accounts.length is always 0, so the MS Graph effect above never
  // runs. The backend proxy uses app-only credentials to fetch from Graph, so it
  // works without a user-delegated token.
  useEffect(() => {
    const fetchMockPhoto = async () => {
      if (!user?.email) return;
      if (accounts.length > 0) return; // handled by the MSAL effect above
      if (photoFetchedFor.current === user.email) return; // already fetched
      if (user.avatarUrl) return; // already have a photo

      try {
        const photoResponse = await fetch(`/api/ms365/users/${encodeURIComponent(user.email)}/photo`);
        if (photoResponse.ok) {
          const blob = await photoResponse.blob();
          const reader = new FileReader();
          reader.onloadend = () => {
            const base64 = reader.result as string;
            let avatarUrl = base64;
            try {
              localStorage.setItem(`avatar_${user.email}`, base64);
            } catch {
              avatarUrl = URL.createObjectURL(blob);
            }
            photoFetchedFor.current = user.email;
            setUser((prev) => (prev ? { ...prev, avatarUrl } : prev));
          };
          reader.readAsDataURL(blob);
        } else {
          // No photo for this user — stop retrying.
          photoFetchedFor.current = user.email;
        }
      } catch {
        // Network error — will retry if the component re-renders.
      }
    };

    fetchMockPhoto();
  }, [user?.email, user?.avatarUrl, accounts.length]);

  // Auto-connect Microsoft 365 (Connected Accounts) once per tab session right
  // after SSO login, so mail/calendar/Teams/room-booking work without the user
  // clicking "Connect" in Settings. Runs in a hidden iframe with prompt=none —
  // Azure AD approves silently since the user already has an active AAD session
  // from MSAL login; if the org hasn't consented the scopes it just fails
  // invisibly and the user can still connect manually from Settings.
  useEffect(() => {
    if (accounts.length === 0 || inProgress !== InteractionStatus.None) return;
    const email = accounts[0].username;
    const flagKey = `ms365_auto_connect_${email}`;
    if (sessionStorage.getItem(flagKey)) return;
    sessionStorage.setItem(flagKey, "1");

    (async () => {
      try {
        const res = await fetchWithTimeout(
          "/api/integrations/status",
          { headers: { "x-user-email": email } },
          5000,
        );
        if (!res.ok) return;
        const statuses: { provider: string; connected: boolean }[] = await res.json();
        if (statuses.find((s) => s.provider === "microsoft")?.connected) return;

        const iframe = document.createElement("iframe");
        iframe.style.display = "none";
        iframe.src = `/api/integrations/connect/microsoft?email=${encodeURIComponent(email)}&silent=1`;
        document.body.appendChild(iframe);
        setTimeout(() => iframe.remove(), 8000);
      } catch {
        // silent — user can still connect manually from Settings
      }
    })();
  }, [accounts, inProgress]);

  // Pre-warm a TechElevate session once per tab, right after SSO login, so the
  // TechElevate tab and any server-side callers (PMO chat, manager dashboards) that
  // need this user's TechElevate JWT don't have to wait on a live browser round-trip.
  // Exchanges the same MSAL id_token TechElevate's own /auth/sso-login expects.
  useEffect(() => {
    if (accounts.length === 0 || inProgress !== InteractionStatus.None) return;
    const email = accounts[0].username;
    const flagKey = `te_auto_connect_${email}`;
    if (sessionStorage.getItem(flagKey)) return;
    sessionStorage.setItem(flagKey, "1");

    (async () => {
      try {
        const idToken = await getIdToken();
        if (!idToken) return;
        await fetchWithTimeout(
          "/api/portal/techelevate/connect",
          {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-user-email": email },
            body: JSON.stringify({ id_token: idToken }),
          },
          8000,
        );
      } catch {
        // silent — the TechElevate tab will prompt to connect if this didn't work
      }
    })();
  }, [accounts, inProgress]);

  const login = async () => {
    if (isInteracting) return;
    try {
      await instance.loginRedirect(loginRequest);
    } catch (e: any) {
      if (e.name !== "BrowserAuthError" || e.errorCode !== "interaction_in_progress") {
        // silent — login redirect failure
      }
    }
  };

  const logout = async () => {
    localStorage.removeItem("mock-email");
    if (isInteracting) return;
    try {
      if (user?.email) {
        localStorage.removeItem(`avatar_${user.email}`);
      }
      await instance.logoutRedirect();
      setUser(null);
    } catch (e: any) {
      if (e.name !== "BrowserAuthError" || e.errorCode !== "interaction_in_progress") {
        // silent — logout redirect failure
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{ user, isLoading, isInteracting, accessDenied, login, logout }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
};
