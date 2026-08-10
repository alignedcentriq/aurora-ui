import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "@/lib/auth-store";
import { LogIn, Loader2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

interface LoginEntry {
  id: number;
  actor_email: string;
  actor_name: string | null;
  created_at: string | null;
}

const PAGE_SIZE = 20;

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

export function LoginHistory() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [entries, setEntries] = useState<LoginEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState(1);
  const [loading, setLoading] = useState(true);

  const [actorEmail, setActorEmail] = useState("");
  const [actorEmailInput, setActorEmailInput] = useState("");

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({
        page: String(page),
        limit: String(PAGE_SIZE),
        category: "login",
      });
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
  }, [page, actorEmail, authHeaders]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  useEffect(() => {
    setPage(1);
  }, [actorEmail]);

  return (
    <div className="flex flex-1 flex-col h-full overflow-y-auto bg-[#f5f7fa] dark:bg-background p-6">
      <div className="mb-5 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/15">
          <LogIn className="h-5 w-5 text-amber-500" />
        </div>
        <div>
          <p className="text-sm text-muted-foreground">
            Every user login, who and when. Super Admin only — never surfaced in the
            Activity bell, never notified to anyone.
          </p>
        </div>
      </div>

      <Card className="mb-4">
        <CardContent className="flex flex-wrap items-end gap-3 pt-4">
          <div className="w-64">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">
              User email
            </label>
            <Input
              placeholder="search user…"
              value={actorEmailInput}
              onChange={(e) => setActorEmailInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && setActorEmail(actorEmailInput.trim())}
            />
          </div>
          <button
            onClick={() => setActorEmail(actorEmailInput.trim())}
            className="h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
          >
            Apply
          </button>
          <span className="ml-auto text-xs text-muted-foreground">{total} total login(s)</span>
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader className="pb-2 flex-row items-center justify-between">
          <CardTitle className="text-sm">Logins</CardTitle>
          <ExportCsvButton
            rows={entries.map((e) => ({
              When: formatDate(e.created_at),
              User: e.actor_name || e.actor_email,
              Email: e.actor_email,
            }))}
            filename="login-history.csv"
          />
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : entries.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">
              No logins match these filters.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>When</TableHead>
                  <TableHead>User</TableHead>
                  <TableHead>Email</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatDate(e.created_at)}
                    </TableCell>
                    <TableCell className="text-sm font-medium">
                      {e.actor_name || e.actor_email}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {e.actor_email}
                    </TableCell>
                  </TableRow>
                ))}
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
                of <span className="font-medium text-foreground">{total}</span> logins
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
