import { useEffect, useRef, useState } from "react";
import { KeyRound, CheckCircle2, Loader2, ShieldCheck, LogIn } from "lucide-react";
import { motion } from "framer-motion";
import type { ConnectorLinkData } from "@/lib/chat-store";

const PROVIDER_LABELS: Record<string, string> = {
  microsoft: "Microsoft",
  zoho: "Zoho",
};

interface Props {
  data: ConnectorLinkData;
  userEmail: string;
  userRole?: string;
  onLinked: (message: string) => void;
}

const inputClass =
  "w-full rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/10";

/**
 * "Connect your account" card for a per_user connector. Collects the caller's own
 * credential and stores it (encrypted server-side) via PUT /api/connectors/{id}/my-connection.
 * After linking, the user can re-ask their question and the operation runs under their credential.
 */
export function ConnectorLinkCard({ data, userEmail, userRole, onLinked }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [linked, setLinked] = useState(false);
  const [error, setError] = useState("");

  const isOauth = data.mode === "oauth";
  const provider = data.provider || "microsoft";
  const providerLabel = PROVIDER_LABELS[provider] || provider;
  const fields = data.fields || [];
  const missing = fields.some((f) => !values[f.name]?.trim());
  const handlerRef = useRef<((e: MessageEvent) => void) | null>(null);

  useEffect(
    () => () => {
      if (handlerRef.current) window.removeEventListener("message", handlerRef.current);
    },
    [],
  );

  // OAuth (SSO) sign-in: open the provider consent popup and wait for the callback message.
  const connectOauth = () => {
    if (saving || linked) return;
    setSaving(true);
    setError("");
    window.open(
      `/api/integrations/connect/${provider}?email=${encodeURIComponent(userEmail)}`,
      "connect-account",
      "width=520,height=680",
    );
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== "oauth-callback" || e.data.provider !== provider) return;
      window.removeEventListener("message", handler);
      handlerRef.current = null;
      setSaving(false);
      if (e.data.success) {
        setLinked(true);
        onLinked(
          `Your ${data.connector_name} account is connected. Ask your question again and I'll run it for you.`,
        );
      } else {
        setError(`Could not connect ${providerLabel}. Please try again.`);
      }
    };
    handlerRef.current = handler;
    window.addEventListener("message", handler);
  };

  const submit = async () => {
    if (missing || saving || linked) return;
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/connectors/${data.connector_id}/my-connection`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          ...(userEmail ? { "x-user-email": userEmail } : {}),
          ...(userRole ? { "x-user-role": userRole.toLowerCase() } : {}),
        },
        body: JSON.stringify({ config: values }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.detail || "Could not link your account.");
      setLinked(true);
      onLinked(
        `Your ${data.connector_name} account is connected. Ask your question again and I'll run it for you.`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not link your account.");
    } finally {
      setSaving(false);
    }
  };

  if (linked) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="mt-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 dark:border-emerald-800 dark:bg-emerald-950/20"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <CheckCircle2 className="h-4.5 w-4.5" />
        </span>
        <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          {data.connector_name} account connected
        </p>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 max-w-md overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg shadow-primary/[0.04]"
    >
      <div className="flex items-center gap-2.5 border-b border-border/60 bg-gradient-to-r from-primary/10 via-primary/[0.04] to-transparent px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <KeyRound className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-foreground">
            Connect {data.connector_name}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            Enter your own credential to use this connector.
          </p>
        </div>
      </div>

      <div className="space-y-3 p-4">
        {isOauth ? (
          <>
            <p className="text-xs text-muted-foreground">
              You'll sign in with your {providerLabel} account in a popup. No token to copy — your
              existing SSO handles it.
            </p>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span>Used only for your own requests.</span>
              </p>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={connectOauth}
                disabled={saving}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Waiting…
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4" /> Sign in with {providerLabel}
                  </>
                )}
              </motion.button>
            </div>
          </>
        ) : (
          <>
            {fields.map((f) => (
              <div key={f.name}>
                <label className="mb-1.5 block text-xs font-semibold text-foreground/80">{f.label}</label>
                <input
                  type={f.secret ? "password" : "text"}
                  value={values[f.name] || ""}
                  onChange={(e) => setValues((prev) => ({ ...prev, [f.name]: e.target.value }))}
                  className={inputClass}
                  autoComplete="off"
                  placeholder={f.label}
                />
              </div>
            ))}

            {error && <p className="text-xs text-destructive">{error}</p>}

            <div className="flex items-center justify-between gap-3 border-t border-border/50 pt-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span>Encrypted at rest — used only for your own requests.</span>
              </p>
              <motion.button
                type="button"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.97 }}
                onClick={submit}
                disabled={saving || missing}
                className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Connecting…
                  </>
                ) : (
                  "Connect"
                )}
              </motion.button>
            </div>
          </>
        )}
      </div>
    </motion.div>
  );
}
