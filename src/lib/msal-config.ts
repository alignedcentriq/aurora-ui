import { Configuration, LogLevel, PublicClientApplication } from "@azure/msal-browser";

export const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_MSAL_CLIENT_ID || "",
    authority: import.meta.env.VITE_MSAL_TENANT_ID
      ? `https://login.microsoftonline.com/${import.meta.env.VITE_MSAL_TENANT_ID}`
      : (import.meta.env.VITE_MSAL_AUTHORITY || "https://login.microsoftonline.com/common"),
    redirectUri: import.meta.env.VITE_MSAL_REDIRECT_URI || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"),
    navigateToLoginRequestUrl: true,
  },
  cache: {
    cacheLocation: "sessionStorage",
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) {
          return;
        }
        switch (level) {
          case LogLevel.Error:
            console.error(message);
            return;
          case LogLevel.Info:
            console.info(message);
            return;
          case LogLevel.Verbose:
            console.debug(message);
            return;
          case LogLevel.Warning:
            console.warn(message);
            return;
        }
      },
    },
  },
};

// MsalProvider is the sole initializer — do not call initialize() here.
export const msalInstance = new PublicClientApplication(msalConfig);

export const loginRequest = {
  scopes: ["User.Read","openid", "profile", "email"],
};
