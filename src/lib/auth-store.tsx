import { createContext, useContext, useEffect, useState } from "react";
import type { AccountInfo } from "@azure/msal-browser";
import { msalInstance, loginRequest } from "./msal-config";

interface AuthState {
  user: AccountInfo | null;
  isLoading: boolean;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  user: null,
  isLoading: true,
  login: () => {},
  logout: () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AccountInfo | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    msalInstance
      .initialize()
      .then(() => msalInstance.handleRedirectPromise())
      .then((response) => {
        if (response?.account) {
          msalInstance.setActiveAccount(response.account);
        }
        const active = msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
        setUser(active);
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, []);

  const login = () => {
    msalInstance.loginRedirect(loginRequest).catch(console.error);
  };

  const logout = () => {
    msalInstance.logoutRedirect().catch(console.error);
  };

  return (
    <AuthContext.Provider value={{ user, isLoading, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
