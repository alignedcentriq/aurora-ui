import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import { Plus, Pencil, Trash2, Loader2, RefreshCw, ExternalLink, Link2, Sparkles, ToggleLeft, ToggleRight } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
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

interface AppLink {
  id: number;
  name: string;
  url: string;
  purpose: string;
  capabilities: string;
  trigger_keywords: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string | null;
  updated_at: string | null;
  has_embedding: boolean;
}

const SUGGESTIONS = [
  {
    name: "Paymo Reimbursements",
    url: "https://paymo.centriq.corp/reimbursements",
    purpose: "Submit expense claims, track reimbursement approvals, and manage corporate card expenses.",
    capabilities: "create expense reports, upload receipts, track approval status, view history",
  },
  {
    name: "IT Service Desk",
    url: "https://helpdesk.centriq.corp",
    purpose: "Raise tickets for hardware issues, software licenses, network access, or account lockouts.",
    capabilities: "create support tickets, track ticket status, chat with IT agent, request access",
  },
  {
    name: "Bookshelf Buddy",
    url: "https://library.centriq.corp",
    purpose: "Browse company library, borrow books, suggest new arrivals, and manage book returns.",
    capabilities: "search library catalog, check availability, borrow books, request purchase",
  },
];

type FormState = { name: string; url: string; purpose: string; capabilities: string; trigger_keywords: string };
const EMPTY_FORM: FormState = { name: "", url: "", purpose: "", capabilities: "", trigger_keywords: "" };

export function UrlLibrary() {
  const { user } = useAuth();
  const [apps, setApps] = useState<AppLink[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [toggling, setToggling] = useState<Set<number>>(new Set());

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/url-library", { headers: authHeaders });
      if (!res.ok) throw new Error("Failed to load apps");
      setApps(await res.json());
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to load apps");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.email, user?.role]);

  useEffect(() => {
    if (user?.role === "Super Admin") load();
  }, [user?.role, load]);

  if (user?.role !== "Super Admin") {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Access restricted to the Admin team.
      </div>
    );
  }

  const toggleActive = async (app: AppLink) => {
    setToggling((prev) => new Set(prev).add(app.id));
    try {
      const res = await fetch(`/api/admin/url-library/${app.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ is_active: !app.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, is_active: !app.is_active } : a)));
      toast.success(app.is_active ? "App deactivated" : "App activated");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setToggling((prev) => { const s = new Set(prev); s.delete(app.id); return s; });
    }
  };

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (app: AppLink) => {
    setEditId(app.id);
    setForm({
      name: app.name,
      url: app.url,
      purpose: app.purpose,
      capabilities: app.capabilities || "",
      trigger_keywords: app.trigger_keywords || "",
    });
    setDialogOpen(true);
  };

  const handleAddSuggestion = (sug: typeof SUGGESTIONS[0]) => {
    setForm({ ...sug, trigger_keywords: "" });
    setEditId(null);
    setDialogOpen(true);
  };

  const valid =
    form.name.trim().length > 0 &&
    form.url.trim().length > 0 &&
    form.purpose.trim().length > 0;

  const save = async () => {
    if (!valid) return;
    setSaving(true);
    try {
      const isEdit = editId !== null;
      const res = await fetch(
        isEdit ? `/api/admin/url-library/${editId}` : "/api/admin/url-library",
        {
          method: isEdit ? "PUT" : "POST",
          headers: authHeaders,
          body: JSON.stringify({
            name: form.name.trim(),
            url: form.url.trim(),
            purpose: form.purpose.trim(),
            capabilities: form.capabilities.trim(),
            trigger_keywords: form.trigger_keywords.trim(),
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Save failed");
      toast.success(isEdit ? "App updated" : "App added");
      setDialogOpen(false);
      await load();
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (deleteId === null) return;
    const id = deleteId;
    setDeleteId(null);
    try {
      const res = await fetch(`/api/admin/url-library/${id}`, {
        method: "DELETE",
        headers: authHeaders,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Delete failed");
      }
      toast.success("App deleted");
      setApps((prev) => prev.filter((a) => a.id !== id));
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-[#f5f7fa] dark:bg-background">
      {/* Header */}
      <div className="flex items-center justify-between px-8 py-5 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
        <div>
          <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
            Assets & Config
          </p>
          <h1 className="text-[22px] font-bold text-[#0f172a] dark:text-white tracking-tight flex items-center gap-2">
            URL Library
          </h1>
          <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5">
            Register company apps, portals, and websites. Centriq surfaces the right link in chat
            when a user's question matches — no code change needed for new apps.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            disabled={loading}
            className="flex h-9 w-9 items-center justify-center rounded-xl border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card text-[#64748b] dark:text-white/60 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.04] transition-colors"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded-xl bg-[#00a29a] dark:bg-[#00c4bb] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 transition-opacity"
          >
            <Plus className="h-4 w-4" />
            Add app
          </button>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-8 py-6">
        {loading ? (
          <div className="flex items-center justify-center py-20 text-[#64748b] dark:text-white/50">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…
          </div>
        ) : apps.length === 0 ? (
          <div className="space-y-10 py-6">
            {/* Empty State Card */}
            <div className="flex flex-col items-center justify-center border border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl bg-white dark:bg-card p-10 text-center shadow-sm">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-[#0d9488]/10 text-[#0d9488] border border-[#0d9488]/20 mb-4">
                <Link2 className="h-6 w-6" />
              </div>
              <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">No apps registered yet.</h3>
              <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1 max-w-md">
                Register company apps, portals, and websites so they can be surfaced in assistant conversations when users ask.
              </p>
              <button
                onClick={openAdd}
                className="mt-5 flex items-center gap-1.5 rounded-xl bg-[#00a29a] hover:bg-[#008f88] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Register your first app
              </button>
            </div>

            {/* Suggestions Section */}
            <div className="space-y-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/30">
                Suggested Apps to Register
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {SUGGESTIONS.map((sug) => (
                  <div
                    key={sug.name}
                    className="flex flex-col justify-between border border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl bg-white dark:bg-card p-5 hover:shadow-md hover:border-[#00a29a]/20 dark:hover:border-primary/20 transition-all relative group"
                  >
                    <div className="absolute top-4 right-4 flex items-center gap-1 bg-[#8B5CF6]/10 text-[#8B5CF6] text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full border border-[#8B5CF6]/20">
                      <Sparkles className="h-2.5 w-2.5" />
                      SUGGESTION
                    </div>
                    <div>
                      <h4 className="font-bold text-[#0f172a] dark:text-white text-[14px] pr-20">{sug.name}</h4>
                      <p className="text-[12px] text-[#64748b] dark:text-white/50 mt-2 leading-relaxed">
                        {sug.purpose}
                      </p>
                    </div>
                    <button
                      onClick={() => handleAddSuggestion(sug)}
                      className="mt-4 text-[12px] font-bold text-[#00a29a] dark:text-[#00c4bb] hover:underline text-left"
                    >
                      Add this app →
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card overflow-hidden">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-[#e2e8f0] dark:border-white/[0.08] bg-[#f8fafc] dark:bg-card">
                  {["App", "Purpose", "What it can do", "Chat triggers", "Status", ""].map((h) => (
                    <th
                      key={h}
                      className="text-left py-3 px-4 text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {apps.map((app) => (
                  <tr
                    key={app.id}
                    className="border-b border-[#f1f5f9] dark:border-white/[0.05] last:border-0 hover:bg-[#f8fafc] dark:hover:bg-white/[0.02]"
                  >
                    <td className="py-3.5 px-4 align-top">
                      <div className="font-semibold text-[#0f172a] dark:text-white">{app.name}</div>
                      <a
                        href={app.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-[12px] text-[#00a29a] dark:text-[#00c4bb] hover:underline break-all mt-0.5"
                      >
                        {app.url}
                        <ExternalLink className="h-3 w-3 shrink-0" />
                      </a>
                    </td>
                    <td className="py-3.5 px-4 align-top max-w-[280px] text-[#64748b] dark:text-white/60 leading-normal">
                      {app.purpose}
                    </td>
                    <td className="py-3.5 px-4 align-top max-w-[280px] text-[#64748b] dark:text-white/50 leading-normal">
                      {app.capabilities || "—"}
                    </td>
                    <td className="py-3.5 px-4 align-top max-w-[220px]">
                      {app.trigger_keywords ? (
                        <div className="flex flex-wrap gap-1">
                          {app.trigger_keywords.split(",").map((kw) => kw.trim()).filter(Boolean).map((kw) => (
                            <span key={kw} className="inline-block rounded-full px-2 py-0.5 text-[10px] font-medium bg-violet-500/10 text-violet-600 dark:text-violet-400 border border-violet-500/20">
                              {kw}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-[#94a3b8] dark:text-white/30 text-[12px]">—</span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-top whitespace-nowrap">
                      <span
                        className={cn(
                          "inline-block rounded-full px-2.5 py-0.5 text-[10px] font-semibold border",
                          app.is_active
                            ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"
                            : "bg-zinc-500/10 text-zinc-500 dark:text-zinc-400 border-zinc-500/20"
                        )}
                      >
                        {app.is_active ? "Active" : "Inactive"}
                      </span>
                      {!app.has_embedding && (
                        <span
                          className="ml-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20"
                          title="Embedding pending — will back-fill automatically; won't surface in chat until then"
                        >
                          indexing
                        </span>
                      )}
                    </td>
                    <td className="py-3.5 px-4 align-top">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          onClick={() => toggleActive(app)}
                          disabled={toggling.has(app.id)}
                          className={cn(
                            "rounded-lg p-1.5 transition-colors",
                            app.is_active
                              ? "text-emerald-500 hover:bg-rose-500/10 hover:text-rose-500"
                              : "text-zinc-400 dark:text-zinc-600 hover:bg-emerald-500/10 hover:text-emerald-600"
                          )}
                          title={app.is_active ? "Deactivate" : "Activate"}
                        >
                          {toggling.has(app.id) ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : app.is_active ? (
                            <ToggleRight className="h-3.5 w-3.5" />
                          ) : (
                            <ToggleLeft className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={() => openEdit(app)}
                          className="rounded-lg p-1.5 text-[#94a3b8] dark:text-white/40 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.06] hover:text-[#00a29a] dark:hover:text-[#00c4bb] transition-colors"
                          title="Edit"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteId(app.id)}
                          className="rounded-lg p-1.5 text-[#94a3b8] dark:text-white/40 hover:bg-rose-500/10 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {editId !== null ? (
                <Pencil className="h-4 w-4 text-primary" />
              ) : (
                <Plus className="h-4 w-4 text-primary" />
              )}
              {editId !== null ? "Edit app" : "Add app"}
            </DialogTitle>
            <DialogDescription>
              The purpose and capabilities are what Centriq matches against user questions — be
              descriptive so the right people find it.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Name</label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. ExpenseFlow"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">URL</label>
              <Input
                value={form.url}
                onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://expenseflow.company.com"
                className="mt-1"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">Purpose</label>
              <Textarea
                value={form.purpose}
                onChange={(e) => setForm({ ...form, purpose: e.target.value })}
                placeholder="What is this app for? e.g. Submit and track expense reimbursements"
                className="mt-1 min-h-[70px]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">
                What it can do <span className="opacity-60">(optional)</span>
              </label>
              <Textarea
                value={form.capabilities}
                onChange={(e) => setForm({ ...form, capabilities: e.target.value })}
                placeholder="e.g. create expense reports, upload receipts, track approval status, export to PDF"
                className="mt-1 min-h-[70px]"
              />
            </div>
            <div>
              <label className="text-[12px] font-medium text-muted-foreground">
                Chat trigger keywords <span className="opacity-60">(optional)</span>
              </label>
              <Input
                value={form.trigger_keywords}
                onChange={(e) => setForm({ ...form, trigger_keywords: e.target.value })}
                placeholder="e.g. payslip, salary, pay slip, my pay"
                className="mt-1"
              />
              <p className="text-[11px] text-muted-foreground/70 mt-1">
                Comma-separated. When a user's message contains any of these words, the assistant will offer to open this portal directly. Use specific phrases (e.g. "payslip", "salary slip") — single generic words like "requests", "form", or "status" are not allowed and will be rejected.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={save} disabled={!valid || saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              {editId !== null ? "Save changes" : "Add app"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={deleteId !== null} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this app?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer be surfaced in chat. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
