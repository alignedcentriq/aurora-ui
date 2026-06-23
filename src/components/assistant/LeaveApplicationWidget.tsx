import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import { Palmtree, Loader2, AlertCircle, ExternalLink } from "lucide-react";

interface Props {
  userEmail: string;
  userRole: string;
}

/**
 * Deep-links the employee into the Zoho People apply-leave form (opens in a new tab).
 *
 * We do NOT embed Zoho in an iframe: people.zoho.com sends X-Frame-Options /
 * CSP frame-ancestors, so any embed is blocked by the browser and shows a raw
 * "people.zoho.com refused to connect" page (and an iframe's onError does not
 * fire for that, so it can't be detected reliably). Zoho People owns the leave
 * workflow — the assistant only hands the user a deep-link to the right page.
 */
export function LeaveApplicationWidget({ userEmail, userRole }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/integrations/zoho/leave-form", {
          headers: {
            "x-user-email": userEmail,
            "x-user-role": userRole.toLowerCase(),
          },
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data.url) {
          setError("Couldn't load the Zoho People leave form. Please try again.");
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
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Palmtree className="h-3.5 w-3.5 text-emerald-500" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Apply for Leave · Zoho People
        </span>
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2.5 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading the Zoho People leave form…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {url && !error && (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Leave is applied directly in Zoho People. Open the form below, then enter your
              leave type, dates, and reason and submit it there.
            </p>
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-2.5 text-sm font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/20 dark:text-emerald-400"
            >
              <ExternalLink className="h-4 w-4" />
              Open the Zoho People leave form
            </a>
          </div>
        )}
      </div>
    </motion.div>
  );
}
