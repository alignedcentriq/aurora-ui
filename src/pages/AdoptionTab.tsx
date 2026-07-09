// Feature Adoption — the "what's undiscovered?" view of the control plane.
// Makes growth measurable: which capabilities have low/zero reach across staff, so an
// internal nudge campaign can target blind spots ("80% have never used doc issuance").
// Denominator = the curated capability registry; numerator = distinct users in AiRequestLog.
// Rendered as the fourth tab of ObservabilityDashboard (Super Admin only).

import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useCallback } from "react";
import { Loader2, RefreshCw, Compass, TrendingUp, AlertCircle, Users, LayoutGrid } from "lucide-react";
import { cn } from "@/lib/utils";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

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
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-border/50">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
            <Compass className="h-6 w-6 text-primary" />
            Feature Adoption
          </h2>
          <p className="text-sm text-muted-foreground">
            Capability reach across staff over the trailing {data.window_days} days.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center rounded-lg border border-border bg-muted/30 p-1">
            {WINDOWS.map((w) => (
              <Button
                key={w}
                variant={windowDays === w ? "secondary" : "ghost"}
                size="sm"
                onClick={() => setWindowDays(w)}
                className={cn(
                  "h-8 px-4 text-xs font-medium transition-all",
                  windowDays === w ? "shadow-sm bg-background text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
                )}
              >
                {w}d
              </Button>
            ))}
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
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {[
          { label: "Total Staff", value: data.total_staff, icon: <Users className="h-4 w-4 text-muted-foreground" /> },
          {
            label: "Active Users",
            value: data.active_users,
            icon: <TrendingUp className="h-4 w-4 text-emerald-500" />,
          },
          { label: "Capabilities", value: data.feature_count, icon: <LayoutGrid className="h-4 w-4 text-blue-500" /> },
          {
            label: "Undiscovered",
            value: data.undiscovered_count,
            icon: <AlertCircle className={cn("h-4 w-4", data.undiscovered_count > 0 ? "text-destructive" : "text-emerald-500")} />,
            accent: data.undiscovered_count > 0,
          },
        ].map((c) => (
          <Card key={c.label} className={cn("overflow-hidden transition-all hover:shadow-sm", c.accent && "border-destructive/30 bg-destructive/5")}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                {c.label}
              </CardTitle>
              {c.icon}
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{c.value}</div>
              {c.accent && (
                <p className="text-xs text-destructive mt-1 font-medium">
                  Requires attention
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Feature adoption table */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle>Capability Reach</CardTitle>
          <CardDescription>
            Sorted most-undiscovered first to highlight blind spots.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-t border-border">
            <Table paginate itemsPerPage={10} className="w-full text-sm">
              <TableHeader className="bg-muted/40">
                <TableRow>
                  <TableHead className="px-6 py-3 font-semibold">Capability</TableHead>
                  <TableHead className="px-6 py-3 font-semibold">Category</TableHead>
                  <TableHead className="px-6 py-3 font-semibold">Reach (staff)</TableHead>
                  <TableHead className="px-6 py-3 font-semibold text-right">Users</TableHead>
                  <TableHead className="px-6 py-3 font-semibold text-right">Never used</TableHead>
                  <TableHead className="px-6 py-3 font-semibold text-right">Requests</TableHead>
                  <TableHead className="px-6 py-3 font-semibold text-right">Last used</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.features.map((f) => (
                  <TableRow key={f.key} className="hover:bg-muted/20">
                    <TableCell className="px-6 py-3 font-medium text-foreground">
                      <div className="flex items-center gap-2">
                        {f.title}
                        {f.users === 0 && (
                          <Badge variant="destructive" className="h-5 px-1.5 text-[10px] uppercase tracking-wider font-semibold">
                            Undiscovered
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-3 text-muted-foreground">{f.category}</TableCell>
                    <TableCell className="px-6 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-2 w-24 overflow-hidden rounded-full bg-secondary">
                          <div
                            className={cn("h-full rounded-full transition-all duration-500", barColor(f.adoption_pct_staff))}
                            style={{ width: `${Math.max(f.adoption_pct_staff, f.users > 0 ? 2 : 0)}%` }}
                          />
                        </div>
                        <span className="tabular-nums font-medium text-muted-foreground">
                          {f.adoption_pct_staff}%
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right tabular-nums">{f.users}</TableCell>
                    <TableCell className="px-6 py-3 text-right tabular-nums text-muted-foreground">
                      {denom ? f.never_used_staff : "—"}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right tabular-nums text-muted-foreground">
                      {f.requests}
                    </TableCell>
                    <TableCell className="px-6 py-3 text-right text-muted-foreground">
                      {fmtDate(f.last_used)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Unmapped traffic — registry blind spots */}
      {data.unmapped.length > 0 && (
        <Card className="border-dashed border-amber-200/50 dark:border-amber-900/50 bg-amber-50/10 dark:bg-amber-950/10">
          <CardHeader className="pb-4">
            <CardTitle className="flex items-center gap-2 text-amber-600 dark:text-amber-500">
              <AlertCircle className="h-5 w-5" />
              Unmapped Traffic
            </CardTitle>
            <CardDescription className="text-amber-600/80 dark:text-amber-500/80">
              Real usage with no capability claims yet. Extend the registry to cover these domains.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-t border-amber-200/50 dark:border-amber-900/50">
              <Table paginate itemsPerPage={10} className="w-full text-sm">
                <TableHeader className="bg-amber-100/50 dark:bg-amber-900/20">
                  <TableRow>
                    <TableHead className="px-6 py-3 font-semibold text-amber-700 dark:text-amber-400">Domain</TableHead>
                    <TableHead className="px-6 py-3 font-semibold text-amber-700 dark:text-amber-400">Sub-intent</TableHead>
                    <TableHead className="px-6 py-3 font-semibold text-right text-amber-700 dark:text-amber-400">Users</TableHead>
                    <TableHead className="px-6 py-3 font-semibold text-right text-amber-700 dark:text-amber-400">Requests</TableHead>
                    <TableHead className="px-6 py-3 font-semibold text-right text-amber-700 dark:text-amber-400">Last used</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.unmapped.map((b) => (
                    <TableRow
                      key={`${b.domain}:${b.sub_intent}`}
                      className="hover:bg-amber-100/30 dark:hover:bg-amber-900/30 border-amber-200/30 dark:border-amber-900/30"
                    >
                      <TableCell className="px-6 py-3 text-foreground font-medium">{b.domain || "—"}</TableCell>
                      <TableCell className="px-6 py-3 font-mono text-muted-foreground">
                        {b.sub_intent}
                      </TableCell>
                      <TableCell className="px-6 py-3 text-right tabular-nums">{b.users}</TableCell>
                      <TableCell className="px-6 py-3 text-right tabular-nums text-muted-foreground">
                        {b.requests}
                      </TableCell>
                      <TableCell className="px-6 py-3 text-right text-muted-foreground">
                        {fmtDate(b.last_used)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
