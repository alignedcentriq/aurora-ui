import { Fragment, useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-store";
import {
  ScrollText,
  ChevronDown,
  ChevronUp,
  Loader2,
  ArrowRight,
  Plus,
  Minus,
  PencilLine,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
  PaginationEllipsis,
} from "@/components/ui/pagination";
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
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";

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

const PAGE_SIZE = 15;

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

// Compact page list with ellipses: 1 … 4 5 [6] 7 8 … 20
function getPageList(current: number, total: number): (number | "ellipsis")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | "ellipsis")[] = [1];
  const start = Math.max(2, current - 1);
  const end = Math.min(total - 1, current + 1);
  if (start > 2) pages.push("ellipsis");
  for (let p = start; p <= end; p++) pages.push(p);
  if (end < total - 1) pages.push("ellipsis");
  pages.push(total);
  return pages;
}

function humanizeKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (Array.isArray(v)) return v.length ? v.map((x) => formatValue(x)).join(", ") : "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function valuesEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

type FieldStatus = "added" | "removed" | "changed" | "unchanged";

interface FieldDiff {
  key: string;
  oldValue: unknown;
  newValue: unknown;
  status: FieldStatus;
}

function diffValues(
  oldValue: Record<string, unknown> | null,
  newValue: Record<string, unknown> | null,
): FieldDiff[] {
  const keys = Array.from(
    new Set([...Object.keys(oldValue ?? {}), ...Object.keys(newValue ?? {})]),
  );
  return keys.map((key) => {
    const hasOld = oldValue != null && key in oldValue;
    const hasNew = newValue != null && key in newValue;
    const oldV = oldValue?.[key];
    const newV = newValue?.[key];
    let status: FieldStatus;
    if (!hasOld && hasNew) status = "added";
    else if (hasOld && !hasNew) status = "removed";
    else if (!valuesEqual(oldV, newV)) status = "changed";
    else status = "unchanged";
    return { key, oldValue: oldV, newValue: newV, status };
  });
}

const STATUS_META: Record<
  FieldStatus,
  { label: string; icon: typeof Plus; badge: "default" | "secondary" | "destructive" | "outline"; tint: string }
> = {
  added: { label: "Added", icon: Plus, badge: "default", tint: "text-emerald-600 dark:text-emerald-400" },
  removed: { label: "Removed", icon: Minus, badge: "destructive", tint: "text-red-600 dark:text-red-400" },
  changed: { label: "Changed", icon: PencilLine, badge: "secondary", tint: "text-amber-600 dark:text-amber-400" },
  unchanged: { label: "Unchanged", icon: ArrowRight, badge: "outline", tint: "text-muted-foreground" },
};

function ValuePill({ value, muted }: { value: unknown; muted?: boolean }) {
  const text = formatValue(value);
  return (
    <code
      className={
        "inline-block max-w-full break-words rounded-md border px-2 py-0.5 text-xs " +
        (muted
          ? "border-transparent bg-muted/50 text-muted-foreground line-through"
          : "border-border bg-background")
      }
    >
      {text}
    </code>
  );
}

function ChangeDetail({
  oldValue,
  newValue,
}: {
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
}) {
  const diffs = diffValues(oldValue, newValue);
  const isScalarPair = diffs.length === 0;

  // No structured fields — fall back to a simple before → after of the whole values.
  if (isScalarPair) {
    return (
      <div className="flex items-center gap-3 py-2 text-sm">
        <ValuePill value={oldValue} muted />
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <ValuePill value={newValue} />
      </div>
    );
  }

  return (
    <div className="divide-y divide-border/60 rounded-lg border border-border bg-background/60">
      {diffs.map((d) => {
        const meta = STATUS_META[d.status];
        const Icon = meta.icon;
        return (
          <div key={d.key} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
            <div className="flex w-40 shrink-0 items-center gap-1.5">
              <Icon className={"h-3.5 w-3.5 shrink-0 " + meta.tint} />
              <span className="truncate text-xs font-medium">{humanizeKey(d.key)}</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              {d.status === "added" ? (
                <ValuePill value={d.newValue} />
              ) : d.status === "removed" ? (
                <ValuePill value={d.oldValue} muted />
              ) : d.status === "unchanged" ? (
                <ValuePill value={d.newValue} />
              ) : (
                <>
                  <ValuePill value={d.oldValue} muted />
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <ValuePill value={d.newValue} />
                </>
              )}
            </div>
            <Badge variant={meta.badge} className="ml-auto text-[10px]">
              {meta.label}
            </Badge>
          </div>
        );
      })}
    </div>
  );
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
      const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
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
        <CardHeader className="pb-2 flex flex-row items-center justify-between gap-4">
          <CardTitle className="text-sm">Events</CardTitle>
          <ExportCsvButton
            rows={entries.map((e) => ({
              When: formatDate(e.created_at),
              Actor: e.actor_name || e.actor_email,
              "Actor Email": e.actor_email,
              Category: CATEGORY_LABEL[e.category] || e.category,
              Summary: e.summary,
              Target: e.target_name || e.target_id || "",
              Severity: e.severity,
            }))}
            filename="audit-trail-events.csv"
          />
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
                            <div className="py-3">
                              <div className="mb-2 flex items-center gap-2">
                                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                                  Change Detail
                                </p>
                                <Separator className="flex-1" />
                              </div>
                              <ChangeDetail oldValue={e.old_value} newValue={e.new_value} />
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

          {!loading && total > 0 && (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 border-t border-border/60 pt-4 sm:flex-row">
              <p className="text-xs text-muted-foreground">
                Showing{" "}
                <span className="font-medium text-foreground">
                  {(page - 1) * PAGE_SIZE + 1}
                </span>{" "}
                –{" "}
                <span className="font-medium text-foreground">
                  {Math.min(page * PAGE_SIZE, total)}
                </span>{" "}
                of <span className="font-medium text-foreground">{total}</span> events
              </p>
              {pages > 1 && (
                <Pagination className="mx-0 w-auto justify-end">
                  <PaginationContent>
                    <PaginationItem>
                      <PaginationPrevious
                        href="#"
                        onClick={(ev) => {
                          ev.preventDefault();
                          if (page > 1) setPage((p) => p - 1);
                        }}
                        className={
                          page <= 1 ? "pointer-events-none opacity-40" : "cursor-pointer"
                        }
                      />
                    </PaginationItem>
                    {getPageList(page, pages).map((p, i) =>
                      p === "ellipsis" ? (
                        <PaginationItem key={`e${i}`}>
                          <PaginationEllipsis />
                        </PaginationItem>
                      ) : (
                        <PaginationItem key={p}>
                          <PaginationLink
                            href="#"
                            isActive={p === page}
                            onClick={(ev) => {
                              ev.preventDefault();
                              setPage(p);
                            }}
                            className="cursor-pointer"
                          >
                            {p}
                          </PaginationLink>
                        </PaginationItem>
                      ),
                    )}
                    <PaginationItem>
                      <PaginationNext
                        href="#"
                        onClick={(ev) => {
                          ev.preventDefault();
                          if (page < pages) setPage((p) => p + 1);
                        }}
                        className={
                          page >= pages ? "pointer-events-none opacity-40" : "cursor-pointer"
                        }
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
