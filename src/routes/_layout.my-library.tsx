import { createFileRoute, Link } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo } from "react";
import { Library, Loader2, RefreshCw, RotateCw, Clock, BookOpen, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_layout/my-library")({
  component: MyLibrary,
});

interface BorrowRequest {
  id: number;
  ticket_id: string;
  book_id: number;
  book_title: string;
  book_author: string;
  status: string;
  notes: string;
  admin_remarks: string;
  requested_at: string;
  approved_at: string | null;
  returned_at: string | null;
  due_date: string | null;
  extension_count?: number;
}

interface MyExtension {
  id: number;
  request_id: number;
  ticket_id: string;
  book_title: string;
  book_author: string;
  additional_days: number;
  reason: string;
  status: string;
  admin_remarks: string;
  previous_due: string | null;
  new_due_date: string | null;
  current_due_date: string | null;
  requested_at: string;
  actioned_at: string | null;
}

const STATUS_BADGE: Record<string, string> = {
  Pending: "bg-amber-500/15 text-amber-400 border-amber-500/20",
  Approved: "bg-emerald-500/15 text-emerald-400 border-emerald-500/20",
  Rejected: "bg-rose-500/15 text-rose-400 border-rose-500/20",
  Returned: "bg-zinc-500/15 text-zinc-400 border-zinc-500/20",
  Overdue: "bg-rose-600/15 text-rose-300 border-rose-600/30",
};

function isOverdue(req: BorrowRequest): boolean {
  if (req.status !== "Approved" || !req.due_date) return false;
  return new Date(req.due_date) < new Date(new Date().toDateString());
}

function MyLibrary() {
  const { user } = useAuth();
  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const [requests, setRequests] = useState<BorrowRequest[]>([]);
  const [extensions, setExtensions] = useState<MyExtension[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);

  const [extModal, setExtModal] = useState<BorrowRequest | null>(null);
  const [extDays, setExtDays] = useState(7);
  const [extReason, setExtReason] = useState("");
  const [extSubmitting, setExtSubmitting] = useState(false);
  const [bookToReturn, setBookToReturn] = useState<BorrowRequest | null>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [r, e] = await Promise.all([
        fetch(`/api/portal/library/my-requests`, { headers: authHeaders }),
        fetch(`/api/portal/library/my-extensions`, { headers: authHeaders }),
      ]);
      setRequests((await r.json()) || []);
      setExtensions((await e.json()) || []);
    } catch {
      toast.error("Failed to load your library");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const borrowed = requests.filter((r) => r.status === "Approved");
  const pending = requests.filter((r) => r.status === "Pending");
  const history = requests.filter((r) => r.status === "Rejected" || r.status === "Returned");

  const returnBook = async (req: BorrowRequest) => {
    setActing(req.ticket_id);
    try {
      const res = await fetch(`/api/portal/library/requests/${encodeURIComponent(req.ticket_id)}/return`, {
        method: "PUT",
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Return failed");
      toast.success(`Returned "${req.book_title}"`);
      fetchAll();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Return failed");
    } finally {
      setActing(null);
    }
  };

  const openExtension = (req: BorrowRequest) => {
    setExtModal(req);
    setExtDays(7);
    setExtReason("");
  };

  const submitExtension = async () => {
    if (!extModal) return;
    if (extDays < 1 || extDays > 30) {
      toast.error("Additional days must be between 1 and 30");
      return;
    }
    setExtSubmitting(true);
    try {
      const res = await fetch(
        `/api/portal/library/requests/${encodeURIComponent(extModal.ticket_id)}/extension`,
        {
          method: "POST",
          headers: authHeaders,
          body: JSON.stringify({ additional_days: extDays, reason: extReason }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Extension failed");
      toast.success(`Extension requested (+${extDays} day${extDays === 1 ? "" : "s"})`);
      setExtModal(null);
      fetchAll();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Extension failed");
    } finally {
      setExtSubmitting(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 py-6 border-b border-[var(--border)] shrink-0">
        <div>
          <h1 className="text-[20px] font-semibold text-foreground flex items-center gap-2">
            <Library className="h-5 w-5 text-primary" /> My Library
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5">
            Track your borrows, requests, and extensions.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            to="/books"
            className="rounded-lg px-3 py-1.5 text-[13px] font-medium bg-primary/10 text-primary hover:bg-primary/15 transition-colors"
          >
            Browse Library →
          </Link>
          <button
            onClick={fetchAll}
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5 inline mr-1.5" />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 py-6 space-y-8">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <>
            <Section title="Currently Borrowed" count={borrowed.length} icon={BookOpen}>
              {borrowed.length === 0 ? (
                <Empty text="You don't have any active borrows right now." />
              ) : (
                <div className="space-y-3">
                  {borrowed.map((r) => {
                    const overdue = isOverdue(r);
                    return (
                      <div
                        key={r.id}
                        className="rounded-xl border border-[var(--border)] bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-semibold text-foreground text-[14px]">{r.book_title}</span>
                            <Badge label={overdue ? "Overdue" : "Issued"} status={overdue ? "Overdue" : "Approved"} />
                            {(r.extension_count ?? 0) > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                · Extended {r.extension_count}×
                              </span>
                            )}
                          </div>
                          <div className="text-[12px] text-muted-foreground mt-0.5">
                            {r.book_author && <span>{r.book_author} · </span>}
                            <span className="font-mono">{r.ticket_id}</span>
                            {r.approved_at && <span> · Issued {r.approved_at.slice(0, 10)}</span>}
                            {r.due_date && <span> · Due {r.due_date}</span>}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            onClick={() => openExtension(r)}
                            disabled={acting === r.ticket_id}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 transition-colors"
                          >
                            <Clock className="h-3.5 w-3.5" /> Request Extension
                          </button>
                          <button
                            onClick={() => setBookToReturn(r)}
                            disabled={acting === r.ticket_id}
                            className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12.5px] font-medium bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20 transition-colors"
                          >
                            {acting === r.ticket_id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <RotateCw className="h-3.5 w-3.5" />
                            )}
                            Return
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Section>

            <Section title="Pending Requests" count={pending.length}>
              {pending.length === 0 ? (
                <Empty text="No requests are awaiting admin approval." />
              ) : (
                <div className="space-y-2">
                  {pending.map((r) => (
                    <RequestRow key={r.id} req={r} />
                  ))}
                </div>
              )}
            </Section>

            <Section title="Extension Requests" count={extensions.filter((e) => e.status === "Pending").length}>
              {extensions.length === 0 ? (
                <Empty text="You haven't requested any extensions." />
              ) : (
                <div className="space-y-2">
                  {extensions.map((e) => (
                    <div
                      key={e.id}
                      className="rounded-xl border border-[var(--border)] bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-foreground text-[14px]">{e.book_title}</span>
                          <Badge status={e.status} />
                          <span className="text-[11px] text-muted-foreground">
                            +{e.additional_days} day{e.additional_days === 1 ? "" : "s"}
                          </span>
                        </div>
                        <div className="text-[12px] text-muted-foreground mt-0.5">
                          <span className="font-mono">{e.ticket_id}</span>
                          {e.reason && <span> · {e.reason}</span>}
                          {e.status === "Approved" && e.new_due_date && (
                            <span> · New due {e.new_due_date}</span>
                          )}
                          {e.admin_remarks && <span> · {e.admin_remarks}</span>}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            {history.length > 0 && (
              <Section title="History" count={history.length}>
                <div className="space-y-2">
                  {history.map((r) => (
                    <RequestRow key={r.id} req={r} />
                  ))}
                </div>
              </Section>
            )}
          </>
        )}
      </div>

      {/* Extension modal */}
      {extModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="bg-card border border-[var(--border)] rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">Request Extension</h2>
                <p className="text-[12.5px] text-muted-foreground mt-0.5">
                  {extModal.book_title} · {extModal.ticket_id}
                </p>
              </div>
              <button
                onClick={() => setExtModal(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Additional days (1-30)</label>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={extDays}
                  onChange={(e) => setExtDays(parseInt(e.target.value, 10) || 0)}
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                />
              </div>
              <div>
                <label className="text-[12px] font-medium text-muted-foreground">Reason (optional)</label>
                <textarea
                  rows={3}
                  value={extReason}
                  onChange={(e) => setExtReason(e.target.value)}
                  placeholder="Why do you need more time?"
                  className="mt-1 w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40 resize-none"
                />
              </div>
              <p className="text-[11.5px] text-muted-foreground">
                Current due date: <span className="font-medium">{extModal.due_date || "—"}</span> · Admin will review your request.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => setExtModal(null)}
                className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={submitExtension}
                disabled={extSubmitting}
                className="flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[13px] font-medium bg-primary/15 text-primary hover:bg-primary/25 transition-colors"
              >
                {extSubmitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Submit Request
              </button>
            </div>
          </div>
        </div>
      )}

      <AlertDialog open={!!bookToReturn} onOpenChange={(open) => !open && setBookToReturn(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Return Book</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to return "{bookToReturn?.book_title}"?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (bookToReturn) {
                  returnBook(bookToReturn);
                  setBookToReturn(null);
                }
              }}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Return Book
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Section({
  title,
  count,
  icon: Icon,
  children,
}: {
  title: string;
  count: number;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-muted-foreground/70 mb-3 flex items-center gap-2">
        {Icon && <Icon className="h-3.5 w-3.5" />} {title}{" "}
        <span className="text-foreground/70">({count})</span>
      </h2>
      {children}
    </section>
  );
}

function Empty({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] py-6 text-center text-[13px] text-muted-foreground">
      {text}
    </div>
  );
}

function Badge({ status, label }: { status: string; label?: string }) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[11px] font-medium border",
        STATUS_BADGE[status] || "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
      )}
    >
      {label || status}
    </span>
  );
}

function RequestRow({ req }: { req: BorrowRequest }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-card px-4 py-3 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-foreground text-[14px]">{req.book_title}</span>
          <Badge status={req.status} />
        </div>
        <div className="text-[12px] text-muted-foreground mt-0.5">
          <span className="font-mono">{req.ticket_id}</span>
          {req.requested_at && <span> · Requested {req.requested_at.slice(0, 10)}</span>}
          {req.due_date && req.status !== "Rejected" && <span> · Due {req.due_date}</span>}
          {req.returned_at && <span> · Returned {req.returned_at.slice(0, 10)}</span>}
          {req.admin_remarks && <span> · {req.admin_remarks}</span>}
        </div>
      </div>
    </div>
  );
}
