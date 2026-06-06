import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Loader2, RefreshCw, Send, CalendarClock } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";

export const Route = createFileRoute("/_layout/project-update")({
  component: ProjectUpdatePage,
});

const STATUS_BADGE: Record<string, string> = {
  submitted: "bg-amber-500/15 text-amber-400 border border-amber-500/20",
  approved: "bg-emerald-500/15 text-emerald-400 border border-emerald-500/20",
  rejected: "bg-rose-500/15 text-rose-400 border border-rose-500/20",
};

interface Submission {
  id: number;
  activity_type: string;
  project_name: string | null;
  expected_end_date: string | null;
  duration_text: string | null;
  details: string | null;
  status: string;
  filled_at: string | null;
  approved_by_email: string | null;
  approved_at: string | null;
  decision_reason: string | null;
}

function ProjectUpdatePage() {
  const { user } = useAuth();

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const [options, setOptions] = useState<string[]>([]);
  const [period, setPeriod] = useState("");
  const [activity, setActivity] = useState("");
  const [projectName, setProjectName] = useState("");
  const [endDate, setEndDate] = useState("");
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<Submission[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(async () => {
    try {
      const res = await fetch("/api/project-update/config", { headers: authHeaders });
      const data = await res.json();
      setOptions(data.activity_options || []);
      setPeriod(data.period || "");
      setActivity((prev) => prev || (data.activity_options?.[0] ?? ""));
    } catch {
      toast.error("Failed to load form");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/project-update/me", { headers: authHeaders });
      setHistory(await res.json());
    } catch {
      /* non-fatal */
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email]);

  useEffect(() => {
    loadConfig();
    loadHistory();
  }, [loadConfig, loadHistory]);

  const isProject = activity === "Project";

  const submit = async () => {
    if (!activity) return;
    if (isProject && !projectName.trim()) {
      toast.error("Project name is required");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/project-update/submit", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          activity_type: activity,
          project_name: isProject ? projectName.trim() : null,
          expected_end_date: isProject && endDate ? endDate : null,
          details: details.trim() || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed");
      flyBanner("Update submitted for approval");
      setProjectName("");
      setEndDate("");
      setDetails("");
      loadHistory();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to submit");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground">Project Update</h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Tell us what you're working on. Your reporting manager approves it before it updates
            your allocation.
          </p>
        </div>
        {period && (
          <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
            <CalendarClock className="h-3.5 w-3.5" />
            {period}
          </div>
        )}
      </div>

      <div className="flex-1 overflow-auto px-8 py-6">
        <div className="max-w-2xl space-y-5">
          {/* Form card */}
          <div className="rounded-xl border border-[var(--border)] bg-white/[0.02] p-6 space-y-4">
            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                What are you working on?
              </label>
              <select
                value={activity}
                onChange={(e) => setActivity(e.target.value)}
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              >
                {options.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            </div>

            {isProject && (
              <>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                    Project name
                  </label>
                  <input
                    value={projectName}
                    onChange={(e) => setProjectName(e.target.value)}
                    placeholder="e.g. Centriq AI Platform"
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div>
                  <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                    How long? (expected end date)
                  </label>
                  <input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
              </>
            )}

            <div>
              <label className="block text-[12px] font-medium text-muted-foreground mb-1.5">
                Details {!isProject && "(optional)"}
              </label>
              <textarea
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                rows={3}
                placeholder={
                  isProject
                    ? "Your role / what you're doing on this project"
                    : activity === "Learning"
                      ? "What are you learning?"
                      : "Describe the PoC"
                }
                className="w-full rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2 text-[14px] text-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
              />
            </div>

            <div className="flex justify-end">
              <button
                onClick={submit}
                disabled={submitting || !activity}
                className="flex items-center gap-2 rounded-lg px-4 py-2 text-[13px] font-medium bg-primary text-primary-foreground hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                {submitting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                Submit for approval
              </button>
            </div>
          </div>

          {/* History */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[14px] font-semibold text-foreground">Your submissions</h2>
              <button onClick={loadHistory} className="flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors">
                <RefreshCw className="h-3.5 w-3.5" />
                Refresh
              </button>
            </div>
            {loading ? (
              <div className="flex h-24 items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
            ) : history.length === 0 ? (
              <div className="flex h-24 items-center justify-center text-[13px] text-muted-foreground">No submissions yet</div>
            ) : (
              <div className="space-y-2">
                {history.map((s) => (
                  <div key={s.id} className="rounded-lg border border-[var(--border)]/60 bg-white/[0.02] px-4 py-3">
                    <div className="flex items-center justify-between">
                      <div className="text-[13px] font-medium text-foreground">
                        {s.activity_type}{s.project_name ? ` · ${s.project_name}` : ""}
                      </div>
                      <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-medium capitalize", STATUS_BADGE[s.status] ?? "bg-zinc-500/10 text-zinc-400")}>
                        {s.status}
                      </span>
                    </div>
                    <div className="text-[11px] text-muted-foreground mt-1">
                      Submitted {s.filled_at ? new Date(s.filled_at).toLocaleDateString() : "—"}
                      {s.approved_by_email && s.status !== "submitted" && (
                        <> · {s.status === "approved" ? "Approved" : "Rejected"} by {s.approved_by_email}</>
                      )}
                    </div>
                    {s.status === "rejected" && s.decision_reason && (
                      <div className="text-[11px] text-rose-400 mt-1">Reason: {s.decision_reason}</div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
