import { PublicClientApplication, Configuration, LogLevel } from "@azure/msal-browser";

const isBrowser = typeof window !== "undefined";

const tenantId = import.meta.env.VITE_MSAL_TENANT_ID;
const authority = tenantId 
  ? `https://login.microsoftonline.com/${tenantId}` 
  : (import.meta.env.VITE_MSAL_AUTHORITY || "https://login.microsoftonline.com/common");

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_MSAL_CLIENT_ID || "",
    authority: authority,
    redirectUri: import.meta.env.VITE_MSAL_REDIRECT_URI || (isBrowser ? window.location.origin : ""),
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message, containsPii) => {
        if (containsPii) return;
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
          default:
            return;
        }
      },
    },
  },
};

// Initialize only in the browser to avoid SSR window errors
export const msalInstance = isBrowser 
  ? new PublicClientApplication(msalConfig) 
  : (null as unknown as PublicClientApplication);

// Ensure MSAL processes the redirect before TanStack Router can intercept the URL hash
if (isBrowser && msalInstance) {
  msalInstance.initialize().then(() => {
    msalInstance.handleRedirectPromise().catch((e) => {
      console.error("MSAL Redirect Error:", e);
    });
  });
}
