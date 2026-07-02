import { PublicClientApplication, Configuration, LogLevel } from "@azure/msal-browser";
import { cleanUrlParams } from "./utils";

const isBrowser = typeof window !== "undefined";

const tenantId = import.meta.env.VITE_MSAL_TENANT_ID;
const authority = tenantId
  ? `https://login.microsoftonline.com/${tenantId}`
  : import.meta.env.VITE_MSAL_AUTHORITY || "https://login.microsoftonline.com/common";

const msalConfig: Configuration = {
  auth: {
    clientId: import.meta.env.VITE_MSAL_CLIENT_ID || "",
    authority: authority,
    // App lives under /centriq on the shared host — the login redirect MUST return to
    // origin + BASE_URL, not the bare origin (which lands on a different app's catch-all).
    // NOTE: this exact URI must be registered as a redirect URI in the Azure app registration.
    redirectUri:
      import.meta.env.VITE_MSAL_REDIRECT_URI ||
      (isBrowser ? window.location.origin + import.meta.env.BASE_URL : ""),
  },
  cache: {
    cacheLocation: "sessionStorage",
  },
};

// Initialize only in the browser to avoid SSR window errors
export const msalInstance = isBrowser
  ? new PublicClientApplication(msalConfig)
  : (null as unknown as PublicClientApplication);

// Ensure MSAL processes the redirect before TanStack Router can intercept the URL hash
if (isBrowser && msalInstance) {
  msalInstance.initialize().then(() => {
    msalInstance
      .handleRedirectPromise()
      .then(() => {
        cleanUrlParams();
      })
      .catch(() => {
        // redirect error handled silently
        cleanUrlParams();
      });
  });
}
