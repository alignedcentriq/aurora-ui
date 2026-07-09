// Feedback Triage — the human-promotion gate of the eval flywheel (roadmap item 8).
// Clusters 👎 + escalations (ranked by frequency) and lets a Super Admin one-click promote a
// fix: a curated answer (seeds the semantic cache) or a routing correction (RouterExample).
// Rendered as the third tab of ObservabilityDashboard.

import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";

const DOMAIN_BADGE: Record<string, string> = {
  hr: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  it_support: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
  admin: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  pmo: "bg-cyan-500/15 text-cyan-400 border-cyan-500/20",
  general: "bg-violet-500/15 text-violet-400 border-violet-500/20",
  functional_manager: "bg-pink-500/15 text-pink-400 border-pink-500/20",
  ms365: "bg-sky-500/15 text-sky-400 border-sky-500/20",
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
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardContent className="p-5 space-y-3">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <Skeleton className="h-4 w-64" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-4/5" />
              <div className="flex gap-2 pt-2">
                <Skeleton className="h-9 w-32" />
                <Skeleton className="h-9 w-32" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-border/50">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight text-foreground flex items-center gap-2">
            Failure Clusters
          </h2>
          <p className="text-sm text-muted-foreground">
            {stats
              ? `${stats.untriaged_feedback} untriaged 👎 · ${stats.open_escalations} open escalations · `
              : ""}
            Ranked by frequency. Promote a fix to compound your eval set.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={load}
          className="h-10 gap-2 font-medium"
        >
          <RefreshCw className="h-4 w-4" /> Refresh
        </Button>
      </div>

      {toast && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm font-medium text-emerald-500 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {toast}
        </div>
      )}

      {clusters.length === 0 ? (
        <div className="flex h-[30vh] flex-col items-center justify-center gap-3 text-muted-foreground">
          <div className="rounded-full bg-emerald-500/10 p-4">
            <CheckCircle2 className="h-8 w-8 text-emerald-500" />
          </div>
          <p className="text-sm font-medium">Nothing to triage — the queue is clear.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {clusters.map((c) => {
            const form = openForm[c.cluster_id];
            const busyKey = busy === c.cluster_id;
            return (
              <Card key={c.cluster_id} className="overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                <CardContent className="p-5">
                  <div className="flex flex-col md:flex-row items-start justify-between gap-5">
                    <div className="min-w-0 flex-1 space-y-2.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="destructive" className="flex items-center gap-1.5 h-6 px-2.5 rounded-full bg-destructive/15 text-destructive hover:bg-destructive/25 border-transparent">
                          <AlertTriangle className="h-3 w-3" /> {c.count} failure{c.count > 1 ? "s" : ""}
                        </Badge>
                        <span className={cn("px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider border", DOMAIN_BADGE[c.domain] || DOMAIN_BADGE.general)}>
                          {c.domain}
                        </span>
                        {c.escalation_ids.length > 0 && (
                          <Badge variant="outline" className="h-6 px-2.5 rounded-full bg-amber-500/15 text-amber-500 border-amber-500/20">
                            {c.escalation_ids.length} escalation{c.escalation_ids.length > 1 ? "s" : ""}
                          </Badge>
                        )}
                      </div>
                      <p className="text-base font-medium text-foreground">
                        {c.representative_question}
                      </p>
                      {c.samples.length > 1 && (
                        <p className="truncate text-sm text-muted-foreground">
                          <span className="font-medium">+ variants:</span>{" "}
                          {c.samples
                            .slice(1, 4)
                            .map((s) => `"${s.question}"`)
                            .join(", ")}
                        </p>
                      )}
                    </div>
                    <div className="flex flex-wrap shrink-0 gap-2 w-full md:w-auto">
                      <Button
                        variant={form === "answer" ? "default" : "secondary"}
                        size="sm"
                        onClick={() => setOpenForm((p) => ({ ...p, [c.cluster_id]: "answer" }))}
                      >
                        Curate answer
                      </Button>
                      <Button
                        variant={form === "routing" ? "default" : "outline"}
                        size="sm"
                        onClick={() => {
                          setOpenForm((p) => ({ ...p, [c.cluster_id]: "routing" }));
                          setRouteTarget((p) => ({
                            ...p,
                            [c.cluster_id]: p[c.cluster_id] || { domain: c.domain, sub_intent: "" },
                          }));
                        }}
                      >
                        Fix routing
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        disabled={busyKey}
                        onClick={() =>
                          act(
                            "dismiss",
                            { feedback_ids: c.feedback_ids, escalation_ids: c.escalation_ids },
                            c.cluster_id,
                          )
                        }
                        className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        Dismiss
                      </Button>
                    </div>
                  </div>

                  {form === "answer" && (
                    <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                      <label className="text-sm font-medium text-foreground">
                        Curated answer <span className="text-muted-foreground font-normal">(served instantly for near-identical questions)</span>
                      </label>
                      <Textarea
                        value={answerText[c.cluster_id] || ""}
                        onChange={(e) =>
                          setAnswerText((p) => ({ ...p, [c.cluster_id]: e.target.value }))
                        }
                        rows={3}
                        placeholder="Write the correct, grounded answer…"
                        className="resize-none"
                      />
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => closeForm(c.cluster_id)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
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
                          className="gap-2"
                        >
                          {busyKey && <Loader2 className="h-4 w-4 animate-spin" />} Promote to curated
                        </Button>
                      </div>
                    </div>
                  )}

                  {form === "routing" && (
                    <div className="mt-4 rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                      <label className="text-sm font-medium text-foreground">
                        Correct route for this question
                      </label>
                      <div className="flex flex-col sm:flex-row gap-3">
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
                          className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                        >
                          {TRIAGE_DOMAINS.map((d) => (
                            <option key={d} value={d}>
                              {d}
                            </option>
                          ))}
                        </select>
                        <Input
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
                          className="flex-1"
                        />
                      </div>
                      <div className="flex justify-end gap-2 pt-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => closeForm(c.cluster_id)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
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
                          className="gap-2"
                        >
                          {busyKey && <Loader2 className="h-4 w-4 animate-spin" />} Promote routing fix
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
