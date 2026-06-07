import React, { createContext, useContext, useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";

export type Role = "Employee" | "HR" | "IT" | "PMO" | "Admin" | "Functional Manager" | "Super Admin";

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
  role: Role;
  scopes: string[];       // Feature-level scopes for scoped Admin; [] = full role access
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
  setRole: (role: Role) => void;
}

const ROLE_MAP: Record<string, Role> = {
  "employee": "Employee",
  "hr": "HR",
  "it": "IT",
  "pmo": "PMO",
  "admin": "Admin",
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
      // Only update user state when not in the middle of an interaction
      if (inProgress === InteractionStatus.None) {
        if (accounts.length > 0) {
          const account = accounts[0];
          const idTokenClaims = account.idTokenClaims as any;
          const msalRole = idTokenClaims?.roles?.[0] || idTokenClaims?.extension_Role || "Employee";
          const email = account.username;

          console.log("✅ MSAL Authentication Successful!");
          console.log("👤 User Account Details:", account);
          console.log("🔑 ID Token Claims:", idTokenClaims);

          // Verify the user is on the backend allowlist before granting access.
          try {
            const res = await fetch("/api/me", {
              headers: { "x-user-email": email, "x-user-role": msalRole.toLowerCase() },
            });
            if (res.status === 403) {
              setAccessDenied(true);
              setIsLoading(false);
              return;
            }
          } catch {
            // Network error — allow through; backend will enforce on actual calls.
          }

          // Fetch DB role override + scopes from Access Management
          let effectiveRole: Role = ROLE_MAP[msalRole.toLowerCase()] ?? (msalRole as Role);
          let scopes: string[] = [];
          try {
            const accessRes = await fetch("/api/access/me", {
              headers: { "x-user-email": email, "x-user-role": msalRole.toLowerCase() },
            });
            if (accessRes.ok) {
              const accessData = await accessRes.json();
              if (accessData.has_override && accessData.role) {
                effectiveRole = ROLE_MAP[accessData.role.toLowerCase()] ?? effectiveRole;
                scopes = accessData.scopes || [];
              }
            }
          } catch {
            // Fall through with MSAL role
          }

          setUser((prev) => ({
            id: account.localAccountId,
            name: account.name || account.username || "User",
            email,
            role: effectiveRole,
            scopes,
            avatarUrl: prev?.avatarUrl, // preserve photo if already fetched
            team: [
              { id: "t1", name: "Alice Smith", role: "Employee", department: "Engineering", avatar: "AS" },
              { id: "t2", name: "Bob Jones", role: "Employee", department: "Engineering", avatar: "BJ" },
            ],
          }));
          setIsLoading(false);
        } else if (!hasAutoRedirected.current) {
          hasAutoRedirected.current = true;
          try {
            await instance.ssoSilent(loginRequest);
            // accounts will update, triggering another render
          } catch {
            try {
              await instance.loginRedirect(loginRequest);
              // navigates away — isLoading stays true (spinner shown)
            } catch (e: any) {
              if (e.name !== "BrowserAuthError" || e.errorCode !== "interaction_in_progress") {
                console.error("Auto-login failed:", e);
              }
              setIsLoading(false); // show fallback button
            }
          }
        }
      }
    };

    checkAccount();
  }, [accounts, inProgress, instance]);

  // Fetch actual profile photo from Microsoft Graph
  useEffect(() => {
    const fetchGraphPhoto = async () => {
      if (accounts.length > 0 && inProgress === InteractionStatus.None) {
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
            const url = URL.createObjectURL(blob);
            setUser((prev) => (prev ? { ...prev, avatarUrl: url } : prev));
          }
        } catch (error) {
          console.warn("Could not fetch profile photo from Graph:", error);
        }
      }
    };

    fetchGraphPhoto();
  }, [accounts, instance, inProgress]);

  const login = async () => {
    if (isInteracting) return;
    try {
      await instance.loginRedirect(loginRequest);
    } catch (e: any) {
      if (e.name !== "BrowserAuthError" || e.errorCode !== "interaction_in_progress") {
        console.error("Login failed:", e);
      }
    }
  };

  const logout = async () => {
    if (isInteracting) return;
    try {
      await instance.logoutRedirect();
      setUser(null);
    } catch (e: any) {
      if (e.name !== "BrowserAuthError" || e.errorCode !== "interaction_in_progress") {
        console.error("Logout failed:", e);
      }
    }
  };

  const setRole = (role: Role) => {
    setUser((prev) => (prev ? { ...prev, role } : null));
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, isInteracting, accessDenied, login, logout, setRole }}>
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
