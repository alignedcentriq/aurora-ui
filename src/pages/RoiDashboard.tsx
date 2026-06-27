import { useAuth } from "@/lib/auth-store";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TrendingUp,
  Clock,
  Coins,
  Wallet,
  Inbox,
  Smile,
  Loader2,
  Download,
  Mail,
  Settings2,
  Power,
  Trash2,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { MetricChart } from "@/components/analytics/MetricChart";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

type Period = "7d" | "30d" | "90d";

interface RoiSummary {
  period: string;
  currency: string;
  hours_saved: number;
  value_saved: number;
  net_value: number;
  infra_cost: number;
  tokens_processed: number;
  requests_handled: number;
  deflection_count: number;
  satisfaction_pct: number | null;
  assumptions: Assumptions;
}

interface Assumptions {
  currency: string;
  hourly_cost: number;
  monthly_infra_cost: number;
  minutes_saved_per_request: Record<string, number>;
}

interface Digest {
  id: number;
  is_active: boolean;
  frequency: string;
  extra_config: { period?: string };
  recipients_json: any[];
  can_manage: boolean;
}

function useAuthHeaders() {
  const { user } = useAuth();
  return useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );
}

function money(v: number, currency: string) {
  const sym = currency === "INR" ? "₹" : "$";
  return `${sym}${Math.round(v).toLocaleString("en-IN")}`;
}

function KpiCard({
  title,
  value,
  sub,
  icon: Icon,
  iconColor,
  loading,
}: {
  title: string;
  value: string | number;
  sub: string;
  icon: typeof TrendingUp;
  iconColor: string;
  loading?: boolean;
}) {
  return (
    <Card className="hover:shadow-lg transition-all">
      <CardContent className="p-6">
        <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-muted mb-4">
          <Icon className={cn("h-5 w-5", iconColor)} />
        </div>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-3.5 w-32" />
            <Skeleton className="h-3 w-24" />
          </div>
        ) : (
          <>
            <p className="text-3xl font-bold tracking-tight text-foreground">{value}</p>
            <p className="mt-1 text-[13px] text-muted-foreground">{title}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground/60">{sub}</p>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-[15px] font-semibold">{title}</CardTitle>
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function RoiDashboard() {
  const { user } = useAuth();
  const authHeaders = useAuthHeaders();
  const isAdmin = user?.role === "Admin" || user?.role === "Super Admin";

  const [period, setPeriod] = useState<Period>("30d");
  const [summary, setSummary] = useState<RoiSummary | null>(null);
  const [loading, setLoading] = useState(true);

  const [byDomain, setByDomain] = useState<any[]>([]);
  const [overTime, setOverTime] = useState<any[]>([]);
  const [satisfaction, setSatisfaction] = useState<any[]>([]);

  const [showSchedule, setShowSchedule] = useState(false);
  const [showAssumptions, setShowAssumptions] = useState(false);
  const [digests, setDigests] = useState<Digest[]>([]);

  const timeDim = period === "7d" ? "day" : period === "30d" ? "day" : "week";

  const query = useCallback(
    async (metric: string, dimension: string) => {
      const res = await fetch("/api/analytics/query", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ metric, dimension, period }),
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.series || [];
    },
    [authHeaders, period],
  );

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [s, dom, ot, sat] = await Promise.all([
        fetch(`/api/analytics/roi/summary?period=${period}`, { headers: authHeaders }).then((r) =>
          r.ok ? r.json() : null,
        ),
        query("requests", "domain"),
        query("requests", timeDim),
        query("helpful_pct", timeDim),
      ]);
      setSummary(s);
      setByDomain(dom);
      setOverTime(ot);
      setSatisfaction(sat);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, period, query, timeDim]);

  const fetchDigests = useCallback(async () => {
    const res = await fetch("/api/analytics/roi/digest", { headers: authHeaders });
    if (res.ok) setDigests(await res.json());
  }, [authHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);
  useEffect(() => {
    fetchDigests();
  }, [fetchDigests]);

  const exportPdf = async () => {
    const res = await fetch(`/api/analytics/roi/export.pdf?period=${period}`, {
      headers: authHeaders,
    });
    if (!res.ok) {
      alert("Export failed (Admin only).");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `roi-summary-${period}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleDigest = async (id: number, enabled: boolean) => {
    await fetch(`/api/analytics/roi/digest/${id}/toggle?enabled=${enabled}`, {
      method: "POST",
      headers: authHeaders,
    });
    fetchDigests();
  };

  const deleteDigest = async (id: number) => {
    await fetch(`/api/analytics/roi/digest/${id}`, { method: "DELETE", headers: authHeaders });
    fetchDigests();
  };

  const cur = summary?.currency || "INR";

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-background">
      {/* Header */}
      <div className="sticky top-0 z-30 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-6 py-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-emerald-400" />
            </div>
            <div>
              <h1 className="text-[20px] font-bold text-foreground">ROI Dashboard</h1>
              <p className="text-[12px] text-muted-foreground">
                What the assistant is worth — time saved, deflection & cost
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
              {(["7d", "30d", "90d"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "px-3.5 py-2 text-[13px] font-medium transition-colors",
                    period === p
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
            <button
              onClick={() => setShowSchedule(true)}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Mail className="h-3.5 w-3.5" />
              Schedule email
            </button>
            <button
              onClick={exportPdf}
              className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <Download className="h-3.5 w-3.5" />
              Export PDF
            </button>
            {isAdmin && (
              <button
                onClick={() => setShowAssumptions(true)}
                className="flex items-center gap-1.5 rounded-xl border border-[var(--border)] px-3.5 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Assumptions
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <KpiCard
            title="Hours Saved"
            value={summary ? summary.hours_saved.toLocaleString() : "—"}
            sub="time returned to staff"
            icon={Clock}
            iconColor="text-emerald-400"
            loading={loading}
          />
          <KpiCard
            title="Estimated Value"
            value={summary ? money(summary.value_saved, cur) : "—"}
            sub="hours × loaded cost"
            icon={Coins}
            iconColor="text-amber-400"
            loading={loading}
          />
          <KpiCard
            title="Net Value"
            value={summary ? money(summary.net_value, cur) : "—"}
            sub="value − infra cost"
            icon={TrendingUp}
            iconColor="text-indigo-400"
            loading={loading}
          />
          <KpiCard
            title="Infra Cost"
            value={summary ? money(summary.infra_cost, cur) : "—"}
            sub="server cost, this period"
            icon={Wallet}
            iconColor="text-cyan-400"
            loading={loading}
          />
          <KpiCard
            title="Requests Handled"
            value={summary ? summary.requests_handled.toLocaleString() : "—"}
            sub="manual touches deflected"
            icon={Inbox}
            iconColor="text-violet-400"
            loading={loading}
          />
          <KpiCard
            title="Satisfaction"
            value={summary?.satisfaction_pct != null ? `${summary.satisfaction_pct}%` : "—"}
            sub="helpful feedback"
            icon={Smile}
            iconColor="text-rose-400"
            loading={loading}
          />
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="Requests Over Time">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <MetricChart chartType="area" series={overTime} unit="count" />
            )}
          </ChartCard>
          <ChartCard title="Requests by Domain">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <MetricChart chartType="pie" series={byDomain} unit="count" />
            )}
          </ChartCard>
          <ChartCard title="Satisfaction Trend">
            {loading ? (
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            ) : (
              <MetricChart chartType="line" series={satisfaction} unit="pct" />
            )}
          </ChartCard>
          <ChartCard title="Active ROI Email Schedules">
            <DigestList digests={digests} onToggle={toggleDigest} onDelete={deleteDigest} />
          </ChartCard>
        </div>
      </div>

      {showSchedule && (
        <ScheduleDialog
          authHeaders={authHeaders}
          defaultEmail={user?.email || ""}
          period={period}
          onClose={() => setShowSchedule(false)}
          onSaved={() => {
            setShowSchedule(false);
            fetchDigests();
          }}
        />
      )}

      {showAssumptions && isAdmin && (
        <AssumptionsDialog
          authHeaders={authHeaders}
          current={summary?.assumptions}
          onClose={() => setShowAssumptions(false)}
          onSaved={() => {
            setShowAssumptions(false);
            fetchAll();
          }}
        />
      )}
    </div>
  );
}

function DigestList({
  digests,
  onToggle,
  onDelete,
}: {
  digests: Digest[];
  onToggle: (id: number, enabled: boolean) => void;
  onDelete: (id: number) => void;
}) {
  if (digests.length === 0) {
    return (
      <div className="flex items-center justify-center h-[200px] text-[13px] text-muted-foreground text-center px-4">
        No ROI email schedule yet. Use "Schedule email" — it stays off until you enable it.
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {digests.map((d) => (
        <div
          key={d.id}
          className="flex items-center justify-between rounded-xl border border-[var(--border)] px-4 py-3"
        >
          <div>
            <p className="text-[13px] font-medium text-foreground capitalize">
              {d.frequency} · {d.extra_config?.period || "30d"} summary
            </p>
            <p className="text-[11px] text-muted-foreground">
              {d.is_active ? "Active — sending on schedule" : "Disabled — not sending"} ·{" "}
              {(d.recipients_json || []).length} recipient(s)
            </p>
          </div>
          {d.can_manage && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => onToggle(d.id, !d.is_active)}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                  d.is_active
                    ? "bg-emerald-500/15 text-emerald-400"
                    : "bg-[var(--muted)] text-muted-foreground hover:text-foreground",
                )}
              >
                <Power className="h-3.5 w-3.5" />
                {d.is_active ? "On" : "Off"}
              </button>
              <button
                onClick={() => onDelete(d.id)}
                className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-400 transition-colors"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-card p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-[16px] font-semibold text-foreground">{title}</h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ScheduleDialog({
  authHeaders,
  defaultEmail,
  period,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  defaultEmail: string;
  period: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [frequency, setFrequency] = useState("monthly");
  const [recipients, setRecipients] = useState(defaultEmail);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const emails = recipients
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean)
        .map((email) => ({ type: "individual", email, name: email }));
      const res = await fetch("/api/analytics/roi/digest", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ period, frequency, recipients: emails }),
      });
      if (res.ok) onSaved();
      else alert("Could not create schedule.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Schedule ROI Email" onClose={onClose}>
      <p className="text-[12px] text-muted-foreground mb-4">
        Creates a recurring ROI digest (PDF attached). It stays <b>disabled</b> until you turn it on
        from the dashboard.
      </p>
      <label className="block text-[12px] font-medium text-foreground mb-1">Frequency</label>
      <select
        value={frequency}
        onChange={(e) => setFrequency(e.target.value)}
        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] mb-4"
      >
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      <label className="block text-[12px] font-medium text-foreground mb-1">
        Recipients (comma-separated)
      </label>
      <input
        value={recipients}
        onChange={(e) => setRecipients(e.target.value)}
        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] mb-4"
        placeholder="leader@company.com, cfo@company.com"
      />
      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Creating…" : "Create (disabled)"}
      </button>
    </Modal>
  );
}

function AssumptionsDialog({
  authHeaders,
  current,
  onClose,
  onSaved,
}: {
  authHeaders: Record<string, string>;
  current?: Assumptions;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [hourly, setHourly] = useState(current?.hourly_cost ?? 600);
  const [infra, setInfra] = useState(current?.monthly_infra_cost ?? 0);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const payload = {
        ...current,
        hourly_cost: Number(hourly),
        monthly_infra_cost: Number(infra),
      };
      const res = await fetch("/api/analytics/assumptions", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      if (res.ok) onSaved();
      else alert("Update failed (Admin only).");
    } finally {
      setSaving(false);
    }
  };

  const field = (label: string, val: number, set: (n: number) => void) => (
    <div className="mb-4">
      <label className="block text-[12px] font-medium text-foreground mb-1">{label}</label>
      <input
        type="number"
        value={val}
        onChange={(e) => set(Number(e.target.value))}
        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px]"
      />
    </div>
  );

  return (
    <Modal title="ROI Assumptions" onClose={onClose}>
      <p className="text-[12px] text-muted-foreground mb-4">
        Tune the cost model. Changes apply org-wide and recompute every ROI figure.
      </p>
      {field("Hourly loaded cost", hourly, setHourly)}
      {field("Monthly infrastructure cost", infra, setInfra)}
      <p className="text-[11px] text-muted-foreground/70 -mt-2 mb-4">
        Your server/GPU cost per month. Amortized across the selected period for Net Value.
      </p>
      <button
        onClick={save}
        disabled={saving}
        className="w-full rounded-xl bg-primary px-4 py-2.5 text-[13px] font-medium text-primary-foreground disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save assumptions"}
      </button>
    </Modal>
  );
}
