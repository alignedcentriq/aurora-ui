// Feedback Triage — the human-promotion gate of the eval flywheel (roadmap item 8).
// Clusters 👎 + escalations (ranked by frequency) and lets a Super Admin one-click promote a
// fix: a curated answer (seeds the semantic cache) or a routing correction (RouterExample).
// Rendered as the third tab of ObservabilityDashboard.

import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

const DOMAIN_BADGE: Record<string, string> = {
  hr: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  it_support: "bg-indigo-500/15 text-indigo-400 border border-indigo-500/20",
  admin: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  pmo: "bg-cyan-500/15 text-cyan-400 border border-cyan-500/20",
  general: "bg-violet-500/15 text-violet-400 border border-violet-500/20",
  functional_manager: "bg-pink-500/15 text-pink-400 border border-pink-500/20",
  ms365: "bg-sky-500/15 text-sky-400 border border-sky-500/20",
};
const TRIAGE_DOMAINS = [
  "hr",
  "it_support",
  "admin",
  "pmo",
  "ms365",
  "functional_manager",
  "general",
];

interface TriageSample {
  kind: "feedback" | "escalation";
  question: string;
  answer: string;
  note: string;
  when: string | null;
}
interface TriageCluster {
  cluster_id: string;
  representative_question: string;
  count: number;
  domain: string;
  feedback_ids: number[];
  escalation_ids: number[];
  samples: TriageSample[];
}

export function FeedbackTriageTab() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [clusters, setClusters] = useState<TriageCluster[]>([]);
  const [stats, setStats] = useState<{
    untriaged_feedback: number;
    open_escalations: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [openForm, setOpenForm] = useState<Record<string, "answer" | "routing">>({});
  const [answerText, setAnswerText] = useState<Record<string, string>>({});
  const [routeTarget, setRouteTarget] = useState<
    Record<string, { domain: string; sub_intent: string }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/observability/feedback-triage/clusters?days=60", {
        headers: authHeaders,
      });
      const data = await res.json();
      setClusters(data.clusters || []);
      setStats(data.stats || null);
    } catch {
      setClusters([]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  const closeForm = (id: string) =>
    setOpenForm((p) => {
      const n = { ...p };
      delete n[id];
      return n;
    });

  const act = async (path: string, body: unknown, key: string) => {
    setBusy(key);
    try {
      const res = await fetch(`/api/observability/feedback-triage/${path}`, {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.success) {
        flash(data.message || "Done.");
        closeForm(key);
        await load();
      } else {
        flash(data.message || "Action failed.");
      }
    } catch {
      flash("Request failed.");
    } finally {
      setBusy(null);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3 p-1">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl border border-border bg-card p-4 space-y-2">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <Skeleton className="h-4 w-64" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-4/5" />
            <div className="flex gap-2 pt-1">
              <Skeleton className="h-7 w-32 rounded-lg" />
              <Skeleton className="h-7 w-32 rounded-lg" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold text-foreground">
            Failure clusters awaiting triage
          </h2>
          <p className="text-[12px] text-muted-foreground">
            {stats
              ? `${stats.untriaged_feedback} untriaged 👎 · ${stats.open_escalations} open escalations · `
              : ""}
            ranked by frequency. Promote a fix to compound your eval set.
          </p>
        </div>
        <button
          onClick={load}
          className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Refresh
        </button>
      </div>

      {toast && (
        <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 text-[13px] text-emerald-400">
          {toast}
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="flex h-[30vh] flex-col items-center justify-center gap-2 text-muted-foreground">
          <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          <p className="text-[14px]">Nothing to triage — the queue is clear.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {clusters.map((c) => {
            const form = openForm[c.cluster_id];
            const busyKey = busy === c.cluster_id;
            return (
              <div
                key={c.cluster_id}
                className="rounded-xl border border-[var(--border)] bg-card/50 p-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1.5 flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/15 px-2 py-0.5 text-[11px] font-semibold text-rose-400">
                        <AlertTriangle className="h-3 w-3" /> {c.count} failure
                        {c.count > 1 ? "s" : ""}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[11px]",
                          DOMAIN_BADGE[c.domain] || DOMAIN_BADGE.general,
                        )}
                      >
                        {c.domain}
                      </span>
                      {c.escalation_ids.length > 0 && (
                        <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] text-amber-400">
                          {c.escalation_ids.length} escalation
                          {c.escalation_ids.length > 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    <p className="truncate text-[14px] font-medium text-foreground">
                      {c.representative_question}
                    </p>
                    {c.samples.length > 1 && (
                      <p className="mt-1 truncate text-[12px] text-muted-foreground">
                        + variants:{" "}
                        {c.samples
                          .slice(1, 4)
                          .map((s) => `"${s.question}"`)
                          .join(", ")}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <button
                      onClick={() => setOpenForm((p) => ({ ...p, [c.cluster_id]: "answer" }))}
                      className="rounded-lg bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20"
                    >
                      Curate answer
                    </button>
                    <button
                      onClick={() => {
                        setOpenForm((p) => ({ ...p, [c.cluster_id]: "routing" }));
                        setRouteTarget((p) => ({
                          ...p,
                          [c.cluster_id]: p[c.cluster_id] || { domain: c.domain, sub_intent: "" },
                        }));
                      }}
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
                    >
                      Fix routing
                    </button>
                    <button
                      disabled={busyKey}
                      onClick={() =>
                        act(
                          "dismiss",
                          { feedback_ids: c.feedback_ids, escalation_ids: c.escalation_ids },
                          c.cluster_id,
                        )
                      }
                      className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-muted-foreground hover:text-rose-400"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>

                {form === "answer" && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-background/50 p-3">
                    <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
                      Curated answer (served instantly for near-identical questions)
                    </label>
                    <textarea
                      value={answerText[c.cluster_id] || ""}
                      onChange={(e) =>
                        setAnswerText((p) => ({ ...p, [c.cluster_id]: e.target.value }))
                      }
                      rows={3}
                      placeholder="Write the correct, grounded answer…"
                      className="w-full rounded-lg border border-[var(--border)] bg-background p-2.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                    />
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => closeForm(c.cluster_id)}
                        className="px-3 py-1.5 text-[12px] text-muted-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={busyKey || !(answerText[c.cluster_id] || "").trim()}
                        onClick={() =>
                          act(
                            "promote-answer",
                            {
                              query: c.representative_question,
                              answer: answerText[c.cluster_id],
                              domain: c.domain,
                              feedback_ids: c.feedback_ids,
                              escalation_ids: c.escalation_ids,
                            },
                            c.cluster_id,
                          )
                        }
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {busyKey && <Loader2 className="h-3 w-3 animate-spin" />} Promote to curated
                      </button>
                    </div>
                  </div>
                )}

                {form === "routing" && (
                  <div className="mt-3 rounded-lg border border-[var(--border)] bg-background/50 p-3">
                    <label className="mb-1.5 block text-[12px] font-medium text-muted-foreground">
                      Correct route for this question
                    </label>
                    <div className="flex gap-2">
                      <select
                        value={routeTarget[c.cluster_id]?.domain || c.domain}
                        onChange={(e) =>
                          setRouteTarget((p) => ({
                            ...p,
                            [c.cluster_id]: {
                              ...(p[c.cluster_id] || { sub_intent: "" }),
                              domain: e.target.value,
                            },
                          }))
                        }
                        className="rounded-lg border border-[var(--border)] bg-background px-2.5 py-1.5 text-[13px] text-foreground"
                      >
                        {TRIAGE_DOMAINS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                      <input
                        value={routeTarget[c.cluster_id]?.sub_intent || ""}
                        onChange={(e) =>
                          setRouteTarget((p) => ({
                            ...p,
                            [c.cluster_id]: {
                              ...(p[c.cluster_id] || { domain: c.domain }),
                              sub_intent: e.target.value,
                            },
                          }))
                        }
                        placeholder="sub_intent (e.g. create_ticket)"
                        className="flex-1 rounded-lg border border-[var(--border)] bg-background px-2.5 py-1.5 text-[13px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                      />
                    </div>
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        onClick={() => closeForm(c.cluster_id)}
                        className="px-3 py-1.5 text-[12px] text-muted-foreground"
                      >
                        Cancel
                      </button>
                      <button
                        disabled={busyKey || !(routeTarget[c.cluster_id]?.sub_intent || "").trim()}
                        onClick={() =>
                          act(
                            "promote-routing",
                            {
                              utterance: c.representative_question,
                              domain: routeTarget[c.cluster_id]?.domain || c.domain,
                              sub_intent: routeTarget[c.cluster_id]?.sub_intent,
                              feedback_ids: c.feedback_ids,
                              escalation_ids: c.escalation_ids,
                            },
                            c.cluster_id,
                          )
                        }
                        className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[12px] font-medium text-primary-foreground disabled:opacity-50"
                      >
                        {busyKey && <Loader2 className="h-3 w-3 animate-spin" />} Promote routing
                        fix
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
