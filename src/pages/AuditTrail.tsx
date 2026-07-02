import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  ScrollText,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Loader2,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface AuditEntry {
  id: number;
  actor_email: string;
  actor_name: string | null;
  category: string;
  action_type: string;
  severity: string;
  target_type: string | null;
  target_id: string | null;
  target_name: string | null;
  summary: string;
  old_value: Record<string, unknown> | null;
  new_value: Record<string, unknown> | null;
  created_at: string | null;
}

const CATEGORY_LABEL: Record<string, string> = {
  role_assignment: "Role Assignment",
  role_definition: "Role Definition",
  access_grant: "Access Grant",
  automation: "Automation",
  settings: "Settings",
};

const SEVERITY_VARIANT: Record<string, "destructive" | "default" | "secondary"> = {
  high: "destructive",
  normal: "default",
  low: "secondary",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function AuditTrail() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<number | null>(null);

  const [category, setCategory] = useState("All");
  const [severity, setSeverity] = useState("All");
  const [actorEmail, setActorEmail] = useState("");
  const [actorEmailInput, setActorEmailInput] = useState("");

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (category !== "All") params.set("category", category);
      if (severity !== "All") params.set("severity", severity.toLowerCase());
      if (actorEmail) params.set("actor_email", actorEmail);

      const res = await fetch(`/api/activity/audit?${params}`, { headers: authHeaders });
      const data = await res.json();
      setEntries(data.entries || []);
      setTotal(data.total || 0);
      setPages(data.pages || 1);
    } catch {
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [page, category, severity, actorEmail, authHeaders]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    setPage(1);
  }, [category, severity, actorEmail]);

  return (
    <div className="flex flex-1 flex-col h-full overflow-y-auto bg-[#f5f7fa] dark:bg-background p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15">
          <ScrollText className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            Complete history of role, access, automation, and settings changes — who, what, when,
            before and after.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="w-48">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Category</label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All categories</SelectItem>
                {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-40">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Severity</label>
            <Select value={severity} onValueChange={setSeverity}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="All">All</SelectItem>
                <SelectItem value="high">High</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="low">Low</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-64">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              Actor email
            </label>
            <div className="flex gap-2">
              <Input
                placeholder="search actor…"
                value={actorEmailInput}
                onChange={(e) => setActorEmailInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && setActorEmail(actorEmailInput.trim())}
              />
            </div>
          </div>
          <button
            onClick={() => setActorEmail(actorEmailInput.trim())}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Apply
          </button>
          <span className="ml-auto text-xs text-muted-foreground">{total} total event(s)</span>
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Events</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No audit events match these filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>When</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Severity</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => {
                  const isOpen = expandedId === e.id;
                  const hasDetail = e.old_value || e.new_value;
                  return (
                    <Fragment key={e.id}>
                      <TableRow
                        className={hasDetail ? "cursor-pointer" : ""}
                        onClick={() => hasDetail && setExpandedId(isOpen ? null : e.id)}
                      >
                        <TableCell>
                          {hasDetail &&
                            (isOpen ? (
                              <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                            ) : (
                              <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            ))}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                          {formatDate(e.created_at)}
                        </TableCell>
                        <TableCell className="text-sm">
                          <div className="font-medium">{e.actor_name || e.actor_email}</div>
                          <div className="text-xs text-muted-foreground">{e.actor_email}</div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {CATEGORY_LABEL[e.category] || e.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{e.summary}</TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {e.target_name || e.target_id || "—"}
                        </TableCell>
                        <TableCell>
                          <Badge variant={SEVERITY_VARIANT[e.severity] || "default"}>
                            {e.severity}
                          </Badge>
                        </TableCell>
                      </TableRow>
                      {isOpen && hasDetail && (
                        <TableRow>
                          <TableCell colSpan={7} className="bg-muted/30">
                            <div className="grid grid-cols-2 gap-4 py-2">
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Before
                                </p>
                                <pre className="whitespace-pre-wrap break-all rounded-md bg-background p-2 text-xs">
                                  {e.old_value ? JSON.stringify(e.old_value, null, 2) : "—"}
                                </pre>
                              </div>
                              <div>
                                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  After
                                </p>
                                <pre className="whitespace-pre-wrap break-all rounded-md bg-background p-2 text-xs">
                                  {e.new_value ? JSON.stringify(e.new_value, null, 2) : "—"}
                                </pre>
                              </div>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {pages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-3">
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="rounded-md border border-border p-1.5 disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="text-xs text-muted-foreground">
                Page {page} of {pages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(pages, p + 1))}
                disabled={page >= pages}
                className="rounded-md border border-border p-1.5 disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
