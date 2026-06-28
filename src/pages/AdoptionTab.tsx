// Feature Adoption — the "what's undiscovered?" view of the control plane.
// Makes growth measurable: which capabilities have low/zero reach across staff, so an
// internal nudge campaign can target blind spots ("80% have never used doc issuance").
// Denominator = the curated capability registry; numerator = distinct users in AiRequestLog.
// Rendered as the fourth tab of ObservabilityDashboard (Super Admin only).

import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, RefreshCw, Compass, TrendingUp, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

interface Feature {
  key: string;
  title: string;
  category: string;
  domain: string;
  users: number;
  requests: number;
  last_used: string | null;
  adoption_pct_staff: number;
  adoption_pct_active: number;
  never_used_staff: number;
}
interface UnmappedBucket {
  domain: string;
  sub_intent: string;
  users: number;
  requests: number;
  last_used: string | null;
}
interface AdoptionData {
  window_days: number;
  total_staff: number;
  active_users: number;
  feature_count: number;
  undiscovered_count: number;
  features: Feature[];
  unmapped: UnmappedBucket[];
}

const WINDOWS = [30, 90, 180] as const;

function barColor(pct: number): string {
  if (pct <= 0) return "bg-rose-500";
  if (pct < 10) return "bg-amber-500";
  if (pct < 40) return "bg-sky-500";
  return "bg-emerald-500";
}

function fmtDate(iso: string | null): string {
  if (!iso) return "never";
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return "—";
  }
}

export function AdoptionTab() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [data, setData] = useState<AdoptionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [windowDays, setWindowDays] = useState<number>(90);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/observability/adoption?window_days=${windowDays}`, {
        headers: authHeaders,
      });
      const json = await res.json();
      setData(json && Array.isArray(json.features) ? json : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [authHeaders, windowDays]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex h-[40vh] items-center justify-center text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin" />
      </div>
    );
  }
  if (!data) {
    return <div className="text-muted-foreground">No adoption data available.</div>;
  }

  const denom = data.total_staff || 0;

  return (
    <div className="space-y-6">
      {/* Header + window selector */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Compass className="h-4 w-4 text-indigo-400" />
          Capability reach across staff — trailing {data.window_days} days. Sorted most-undiscovered
          first.
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-[var(--border)] overflow-hidden">
            {WINDOWS.map((w) => (
              <button
                key={w}
                onClick={() => setWindowDays(w)}
                className={cn(
                  "px-3 py-1.5 text-[12px] font-medium transition-colors",
                  windowDays === w
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {w}d
              </button>
            ))}
          </div>
          <button
            onClick={load}
            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </button>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Total staff", value: data.total_staff, icon: null },
          {
            label: "Active users",
            value: data.active_users,
            icon: <TrendingUp className="h-4 w-4 text-emerald-400" />,
          },
          { label: "Capabilities", value: data.feature_count, icon: null },
          {
            label: "Undiscovered",
            value: data.undiscovered_count,
            icon: <AlertCircle className="h-4 w-4 text-rose-400" />,
            accent: data.undiscovered_count > 0,
          },
        ].map((c) => (
          <div
            key={c.label}
            className={cn(
              "rounded-xl border border-[var(--border)] bg-card/50 p-4",
              c.accent && "border-rose-500/30 bg-rose-500/5",
            )}
          >
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                {c.label}
              </span>
              {c.icon}
            </div>
            <div className="mt-1 text-2xl font-bold text-foreground">{c.value}</div>
          </div>
        ))}
      </div>

      {/* Feature adoption table */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-[13px]">
          <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 font-semibold">Capability</th>
              <th className="px-4 py-2.5 font-semibold">Category</th>
              <th className="px-4 py-2.5 font-semibold">Reach (staff)</th>
              <th className="px-4 py-2.5 font-semibold text-right">Users</th>
              <th className="px-4 py-2.5 font-semibold text-right">Never used</th>
              <th className="px-4 py-2.5 font-semibold text-right">Requests</th>
              <th className="px-4 py-2.5 font-semibold text-right">Last used</th>
            </tr>
          </thead>
          <tbody>
            {data.features.map((f) => (
              <tr key={f.key} className="border-t border-[var(--border)] hover:bg-muted/20">
                <td className="px-4 py-2.5 font-medium text-foreground">
                  {f.title}
                  {f.users === 0 && (
                    <span className="ml-2 rounded-full bg-rose-500/15 px-2 py-0.5 text-[10px] font-semibold text-rose-400">
                      undiscovered
                    </span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-muted-foreground">{f.category}</td>
                <td className="px-4 py-2.5">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
                      <div
                        className={cn("h-full rounded-full", barColor(f.adoption_pct_staff))}
                        style={{ width: `${Math.max(f.adoption_pct_staff, f.users > 0 ? 2 : 0)}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-muted-foreground">
                      {f.adoption_pct_staff}%
                    </span>
                  </div>
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{f.users}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {denom ? f.never_used_staff : "—"}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                  {f.requests}
                </td>
                <td className="px-4 py-2.5 text-right text-muted-foreground">
                  {fmtDate(f.last_used)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Unmapped traffic — registry blind spots */}
      {data.unmapped.length > 0 && (
        <div>
          <h3 className="mb-2 text-[13px] font-semibold text-foreground">
            Unmapped traffic
            <span className="ml-2 font-normal text-muted-foreground">
              — real usage no capability claims yet (extend the registry to cover these)
            </span>
          </h3>
          <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
            <table className="w-full text-[13px]">
              <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th className="px-4 py-2.5 font-semibold">Domain</th>
                  <th className="px-4 py-2.5 font-semibold">Sub-intent</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Users</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Requests</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Last used</th>
                </tr>
              </thead>
              <tbody>
                {data.unmapped.map((b) => (
                  <tr
                    key={`${b.domain}:${b.sub_intent}`}
                    className="border-t border-[var(--border)] hover:bg-muted/20"
                  >
                    <td className="px-4 py-2.5 text-foreground">{b.domain || "—"}</td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-muted-foreground">
                      {b.sub_intent}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums">{b.users}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-muted-foreground">
                      {b.requests}
                    </td>
                    <td className="px-4 py-2.5 text-right text-muted-foreground">
                      {fmtDate(b.last_used)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
