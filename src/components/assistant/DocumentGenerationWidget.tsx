import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { FileText, Loader2, AlertCircle, ExternalLink } from "lucide-react";

interface Props {
  userEmail: string;
  userRole: string;
}

/**
 * Embeds the Zoho People document / letter generation area in an iframe. Zoho
 * handles document generation natively (letter templates, mail-merge, e-sign), so
 * the user generates and downloads documents directly inside Zoho.
 *
 * Note: people.zoho.com may set X-Frame-Options / CSP frame-ancestors, which can
 * block the embed in some environments. We always surface an "Open in Zoho People"
 * fallback so the user has a working path regardless.
 */
export function DocumentGenerationWidget({ userEmail, userRole }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [frameError, setFrameError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/integrations/zoho/document-form", {
          headers: {
            "x-user-email": userEmail,
            "x-user-role": userRole.toLowerCase(),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          setError("Couldn't load Zoho People documents. Please try again.");
          return;
        }
        setUrl(data.url as string);
      } catch {
        setError("Could not reach the server. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [userEmail, userRole]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-sky-500" />
          <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            Generate Document · Zoho People
          </span>
        </div>
        {url && (
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-foreground transition-colors hover:bg-muted"
          >
            <ExternalLink className="h-3 w-3" />
            Open in Zoho People
          </a>
        )}
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2.5 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading Zoho People documents…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {url && !error && (
          <>
            <iframe
              src={url}
              title="Zoho People — Documents"
              className="h-[640px] w-full rounded-xl border border-border bg-background"
              sandbox="allow-same-origin allow-forms allow-popups allow-scripts allow-top-navigation-by-user-activation"
              onError={() => setFrameError(true)}
            />
            <p className="mt-2.5 text-[11px] text-muted-foreground">
              Generate your letter or document in Zoho People — pick the template, fill in the details, and download or e-sign it there.
            </p>
            {frameError && (
              <div className="mt-2 flex items-start gap-2 rounded-xl border border-amber-500/20 bg-amber-500/5 px-3 py-2.5 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                <span>
                  The page couldn't be embedded here.{" "}
                  <a href={url} target="_blank" rel="noopener noreferrer" className="font-semibold underline">
                    Open it in Zoho People
                  </a>{" "}
                  instead.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </motion.div>
  );
}
