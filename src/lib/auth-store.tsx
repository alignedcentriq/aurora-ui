import React, { createContext, useContext, useState, useEffect } from "react";
import { useMsal } from "@azure/msal-react";
import { InteractionStatus } from "@azure/msal-browser";

export type Role = "Employee" | "HR" | "IT" | "PMO" | "Admin" | "Functional Manager";

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
  avatarUrl?: string;
  team?: TeamMember[];
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isInteracting: boolean;
  login: () => Promise<void>;
  logout: () => Promise<void>;
  setRole: (role: Role) => void;
}

const loginRequest = {
  scopes: ["User.Read", "openid", "profile"],
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { instance, accounts, inProgress } = useMsal();
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  const isInteracting = inProgress !== InteractionStatus.None;

  useEffect(() => {
    const checkAccount = () => {
      // Only update user state when not in the middle of an interaction
      if (inProgress === InteractionStatus.None) {
        if (accounts.length > 0) {
          const account = accounts[0];
          const idTokenClaims = account.idTokenClaims as any;
          const role = idTokenClaims?.roles?.[0] || idTokenClaims?.extension_Role || "Employee";
          
          console.log("✅ MSAL Authentication Successful!");
          console.log("👤 User Account Details:", account);
          console.log("🔑 ID Token Claims:", idTokenClaims);
          
          setUser({
            id: account.localAccountId,
            name: account.name || account.username || "User",
            email: account.username,
            role: role as Role,
            avatarUrl: "/avatar.png",
            team: [
              { id: "t1", name: "Alice Smith", role: "Employee", department: "Engineering", avatar: "AS" },
              { id: "t2", name: "Bob Jones", role: "Employee", department: "Engineering", avatar: "BJ" },
            ],
          });
        } else {
          setUser(null);
        }
        setIsLoading(false);
      }
    };

    checkAccount();
  }, [accounts, inProgress]);

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
    <AuthContext.Provider value={{ user, isLoading, isInteracting, login, logout, setRole }}>
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
