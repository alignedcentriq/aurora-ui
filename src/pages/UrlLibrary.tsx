import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, Fragment } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  ExternalLink,
  Link2,
  Sparkles,
  Lightbulb,
  Check,
  Search,
  Globe,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
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
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/StatusBadge";
import { TableLoader } from "@/components/ui/TableLoader";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
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
    purpose:
      "Submit expense claims, track reimbursement approvals, and manage corporate card expenses.",
    capabilities: "create expense reports, upload receipts, track approval status, view history",
  },
  {
    name: "IT Service Desk",
    url: "https://helpdesk.centriq.corp",
    purpose:
      "Raise tickets for hardware issues, software licenses, network access, or account lockouts.",
    capabilities: "create support tickets, track ticket status, chat with IT agent, request access",
  },
  {
    name: "Bookshelf Buddy",
    url: "https://library.centriq.corp",
    purpose: "Browse company library, borrow books, suggest new arrivals, and manage book returns.",
    capabilities: "search library catalog, check availability, borrow books, request purchase",
  },
];

type FormState = {
  name: string;
  url: string;
  purpose: string;
  capabilities: string;
  trigger_keywords: string;
};
const EMPTY_FORM: FormState = {
  name: "",
  url: "",
  purpose: "",
  capabilities: "",
  trigger_keywords: "",
};

interface KeywordSuggestion {
  keyword: string;
  count: number;
  samples: string[];
}
interface AppSuggestions {
  app_id: number;
  app_name: string;
  near_miss_count: number;
  suggestions: KeywordSuggestion[];
}

/** Deterministic gradient per app name */
function getAppGradient(name: string): string {
  const palettes = [
    "from-violet-500 to-purple-600",
    "from-teal-500 to-emerald-600",
    "from-blue-500 to-indigo-600",
    "from-rose-500 to-pink-600",
    "from-amber-500 to-orange-600",
    "from-cyan-500 to-sky-600",
    "from-fuchsia-500 to-purple-600",
    "from-green-500 to-teal-600",
  ];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palettes[hash % palettes.length];
}

function AppAvatar({ name, size = "md" }: { name: string; size?: "sm" | "md" }) {
  const gradient = getAppGradient(name);
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  return (
    <div
      className={cn(
        "flex items-center justify-center rounded-xl bg-gradient-to-br text-white font-bold shrink-0",
        gradient,
        size === "sm" ? "h-8 w-8 text-[11px]" : "h-10 w-10 text-[13px]",
      )}
    >
      {initials || <Globe className="h-4 w-4" />}
    </div>
  );
}

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
  const [genDesc, setGenDesc] = useState("");
  const [genUrl, setGenUrl] = useState("");
  const [generating, setGenerating] = useState(false);
  const [suggestOpen, setSuggestOpen] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [suggestData, setSuggestData] = useState<{
    apps: AppSuggestions[];
    scanned: number;
    window_days: number;
  } | null>(null);
  const [addingKw, setAddingKw] = useState<Set<string>>(new Set());
  const [expandedAppId, setExpandedAppId] = useState<number | null>(null);

  // Search & filter
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive">("all");

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

  const filteredApps = apps.filter((app) => {
    const q = search.toLowerCase();
    const matchesSearch =
      !q ||
      app.name.toLowerCase().includes(q) ||
      app.url.toLowerCase().includes(q) ||
      app.purpose.toLowerCase().includes(q) ||
      (app.trigger_keywords || "").toLowerCase().includes(q);
    const matchesStatus =
      statusFilter === "all" ||
      (statusFilter === "active" && app.is_active) ||
      (statusFilter === "inactive" && !app.is_active);
    return matchesSearch && matchesStatus;
  });

  const activeCount = apps.filter((a) => a.is_active).length;
  const inactiveCount = apps.filter((a) => !a.is_active).length;

  const toggleActive = async (app: AppLink) => {
    setToggling((prev) => new Set(prev).add(app.id));
    try {
      const res = await fetch(`/api/admin/url-library/${app.id}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ is_active: !app.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setApps((prev) =>
        prev.map((a) => (a.id === app.id ? { ...a, is_active: !app.is_active } : a)),
      );
      toast.success(app.is_active ? "App deactivated" : "App activated");
    } catch {
      toast.error("Failed to update status");
    } finally {
      setToggling((prev) => {
        const s = new Set(prev);
        s.delete(app.id);
        return s;
      });
    }
  };

  const openAdd = () => {
    setEditId(null);
    setForm(EMPTY_FORM);
    setGenDesc("");
    setGenUrl("");
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
    setGenDesc("");
    setGenUrl("");
    setDialogOpen(true);
  };

  const describeAndDraft = async () => {
    const description = genDesc.trim();
    if (!description) return;
    setGenerating(true);
    try {
      const res = await fetch("/api/admin/url-library/generate", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ description, url: genUrl.trim(), name: form.name.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't draft the entry");
      setForm((prev) => ({
        name: data.name || prev.name,
        url: data.url || genUrl.trim() || prev.url,
        purpose: data.purpose || "",
        capabilities: data.capabilities || "",
        trigger_keywords: data.trigger_keywords || "",
      }));
      toast.success("Drafted — review and save.");
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't draft the entry");
    } finally {
      setGenerating(false);
    }
  };

  const openSuggest = async () => {
    setSuggestOpen(true);
    setSuggesting(true);
    setSuggestData(null);
    try {
      const res = await fetch("/api/admin/url-library/keyword-suggestions?window_days=30", {
        headers: authHeaders,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't load suggestions");
      setSuggestData(data);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't load suggestions");
      setSuggestOpen(false);
    } finally {
      setSuggesting(false);
    }
  };

  const addSuggestedKeyword = async (appId: number, keyword: string) => {
    const app = apps.find((a) => a.id === appId);
    if (!app) return;
    const key = `${appId}:${keyword}`;
    setAddingKw((prev) => new Set(prev).add(key));
    try {
      const existing = app.trigger_keywords
        ? app.trigger_keywords
            .split(",")
            .map((k) => k.trim())
            .filter(Boolean)
        : [];
      const seen = new Set(existing.map((k) => k.toLowerCase()));
      if (!seen.has(keyword.toLowerCase())) existing.push(keyword);
      const merged = existing.join(", ");
      const res = await fetch(`/api/admin/url-library/${appId}`, {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ trigger_keywords: merged }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Couldn't add keyword");
      setApps((prev) =>
        prev.map((a) => (a.id === appId ? { ...a, trigger_keywords: merged } : a)),
      );
      setSuggestData((prev) =>
        prev
          ? {
              ...prev,
              apps: prev.apps
                .map((s) =>
                  s.app_id === appId
                    ? { ...s, suggestions: s.suggestions.filter((x) => x.keyword !== keyword) }
                    : s,
                )
                .filter((s) => s.suggestions.length > 0),
            }
          : prev,
      );
      toast.success(`Added "${keyword}" to ${app.name}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Couldn't add keyword");
    } finally {
      setAddingKw((prev) => {
        const s = new Set(prev);
        s.delete(key);
        return s;
      });
    }
  };

  const handleAddSuggestion = (sug: (typeof SUGGESTIONS)[0]) => {
    setForm({ ...sug, trigger_keywords: "" });
    setEditId(null);
    setDialogOpen(true);
  };

  const valid =
    form.name.trim().length > 0 && form.url.trim().length > 0 && form.purpose.trim().length > 0;

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
      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 sm:gap-2 px-6 py-4 border-b border-[#e2e8f0] dark:border-white/[0.08] shrink-0 bg-white dark:bg-card">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#00a29a] dark:text-[#00c4bb] mb-0.5">
            Assets &amp; Config
          </p>
          <h1 className="text-[20px] font-bold text-[#0f172a] dark:text-white tracking-tight">
            URL Library
          </h1>
          <p className="text-[12px] text-[#64748b] dark:text-white/50 mt-0.5 max-w-[520px]">
            Register company apps, portals, and websites. Centriq surfaces the right link in chat
            when a user's question matches — no code change needed for new apps.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <button
            onClick={load}
            disabled={loading}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card text-[#64748b] dark:text-white/60 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.04] transition-colors"
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
          </button>
          <button
            onClick={openSuggest}
            disabled={apps.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-violet-500/25 bg-violet-500/[0.06] px-3 py-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-300 hover:bg-violet-500/[0.12] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Mine recent chat questions for trigger keywords your apps are missing"
          >
            <Lightbulb className="h-3.5 w-3.5" />
            Suggest keywords
          </button>
          <button
            onClick={openAdd}
            className="flex items-center gap-1.5 rounded-lg bg-[#00a29a] dark:bg-[#00c4bb] px-3.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="h-3.5 w-3.5" />
            Add app
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
        {loading ? (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="h-[72px] animate-pulse" />
              ))}
            </div>
            <div className="rounded-xl border border-border bg-card overflow-hidden">
              <TableLoader label="Loading apps…" className="h-48" />
            </div>
          </div>
        ) : apps.length === 0 ? (
          /* ── Empty state ── */
          <div className="space-y-8 py-4">
            <div className="flex flex-col items-center justify-center border border-dashed border-[#e2e8f0] dark:border-white/[0.08] rounded-2xl bg-white dark:bg-card p-12 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-teal-500 to-emerald-600 text-white mb-4 shadow-lg">
                <Link2 className="h-6 w-6" />
              </div>
              <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">
                No apps registered yet.
              </h3>
              <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1 max-w-md">
                Register company apps, portals, and websites so they can be surfaced in assistant
                conversations when users ask.
              </p>
              <button
                onClick={openAdd}
                className="mt-5 flex items-center gap-1.5 rounded-xl bg-[#00a29a] hover:bg-[#008f88] px-5 py-2.5 text-[13px] font-semibold text-white transition-colors shadow-sm"
              >
                <Plus className="h-4 w-4" />
                Register your first app
              </button>
            </div>

            {/* Suggestions */}
            <div className="space-y-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/30 px-1">
                Suggested Apps to Register
              </p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {SUGGESTIONS.map((sug) => (
                  <div
                    key={sug.name}
                    className="relative group flex flex-col justify-between border border-[#e2e8f0] dark:border-white/[0.08] rounded-xl bg-white dark:bg-card p-4 hover:shadow-md hover:border-[#00a29a]/20 dark:hover:border-primary/20 transition-all"
                  >
                    <div className="absolute top-3 right-3 flex items-center gap-1 bg-violet-500/10 text-violet-600 text-[9px] font-bold tracking-wider px-2 py-0.5 rounded-full border border-violet-500/20">
                      <Sparkles className="h-2.5 w-2.5" />
                      SUGGESTION
                    </div>
                    <div className="flex items-start gap-3">
                      <AppAvatar name={sug.name} size="sm" />
                      <div>
                        <h4 className="font-bold text-[#0f172a] dark:text-white text-[13px] pr-16">
                          {sug.name}
                        </h4>
                        <p className="text-[12px] text-[#64748b] dark:text-white/50 mt-1 leading-relaxed">
                          {sug.purpose}
                        </p>
                      </div>
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
          <div className="space-y-4">
            {/* ── Stat Cards ── */}
            <div className="grid grid-cols-3 gap-2 sm:gap-4">
              {[
                {
                  icon: Globe,
                  label: "Total apps",
                  value: apps.length,
                  tint: "bg-[#00a29a]/10 text-[#00a29a]",
                },
                {
                  icon: CheckCircle2,
                  label: "Active",
                  value: activeCount,
                  tint: "bg-emerald-500/10 text-emerald-600",
                },
                {
                  icon: XCircle,
                  label: "Inactive",
                  value: inactiveCount,
                  tint: "bg-zinc-500/10 text-zinc-500",
                },
              ].map(({ icon: Icon, label, value, tint }) => (
                <Card key={label} className="rounded-xl">
                  <CardContent className="flex flex-col lg:flex-row items-center gap-2 sm:gap-3 p-3 sm:p-4 text-center lg:text-left">
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-lg shrink-0",
                        tint,
                      )}
                    >
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <p className="text-[22px] font-black text-foreground leading-none">{value}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{label}</p>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* ── Search + Filter ── */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none z-10" />
                <Input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search by name, URL, or keyword…"
                  className="h-9 pl-9 text-[13px]"
                />
              </div>
              <div className="flex flex-wrap items-center gap-1 rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card p-1">
                {(["all", "active", "inactive"] as const).map((f) => (
                  <button
                    key={f}
                    onClick={() => setStatusFilter(f)}
                    className={cn(
                      "px-3 py-1 rounded-md text-[11px] font-semibold transition-colors",
                      statusFilter === f
                        ? "bg-[#00a29a] text-white shadow-sm"
                        : "text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white",
                    )}
                  >
                    {f === "all"
                      ? `All (${apps.length})`
                      : f === "active"
                        ? `Active (${activeCount})`
                        : `Inactive (${inactiveCount})`}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Table ── */}
            <TooltipProvider delayDuration={300}>
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="bg-muted/40 hover:bg-muted/40">
                      <TableHead className="w-12 lg:hidden"></TableHead>
                      {["App", "Purpose", "What it can do", "Chat triggers", "Status", ""].map(
                        (h, i) => (
                          <TableHead
                            key={h || i}
                            className={cn(
                              "h-9 px-5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
                              i === 5 && "text-right",
                              (i === 1 || i === 2 || i === 3 || i === 4) && "hidden lg:table-cell"
                            )}
                          >
                            {h}
                          </TableHead>
                        ),
                      )}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredApps.length === 0 ? (
                      <TableRow className="hover:bg-transparent">
                        <TableCell colSpan={6}>
                          <div className="flex flex-col items-center justify-center py-12 text-center">
                            <Search className="h-7 w-7 text-muted-foreground/40 mb-2" />
                            <p className="text-[13px] font-semibold text-muted-foreground">
                              No apps match your search
                            </p>
                            <button
                              onClick={() => {
                                setSearch("");
                                setStatusFilter("all");
                              }}
                              className="mt-2 text-[12px] text-[#00a29a] dark:text-[#00c4bb] hover:underline"
                            >
                              Clear filters
                            </button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredApps.map((app) => (
                        <Fragment key={app.id}>
                        <TableRow className="align-top group">
                          <TableCell className="px-3 py-3.5 text-center lg:hidden align-middle">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground group-hover:text-foreground"
                              onClick={() => setExpandedAppId(expandedAppId === app.id ? null : app.id)}
                            >
                              {expandedAppId === app.id ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </Button>
                          </TableCell>
                          {/* App name + URL */}
                          <TableCell className="px-5 py-3.5 w-full lg:w-auto">
                            <div className="flex items-start gap-3 min-w-0">
                              <AppAvatar name={app.name} />
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-[13px] text-foreground truncate">
                                  {app.name}
                                </div>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <a
                                      href={app.url}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="flex items-center gap-1 text-[11px] text-[#00a29a] dark:text-[#00c4bb] hover:underline mt-0.5 min-w-0"
                                    >
                                      <span className="truncate block min-w-0">{app.url}</span>
                                      <ExternalLink className="h-3 w-3 shrink-0" />
                                    </a>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[420px] break-all">
                                    {app.url}
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            </div>
                          </TableCell>

                          {/* Purpose */}
                          <TableCell className="px-5 py-3.5 text-[12px] text-muted-foreground leading-relaxed hidden lg:table-cell">
                            <span className="line-clamp-3">{app.purpose}</span>
                          </TableCell>

                          {/* Capabilities */}
                          <TableCell className="px-5 py-3.5 text-[12px] text-muted-foreground leading-relaxed hidden lg:table-cell">
                            {app.capabilities ? (
                              <span className="line-clamp-3">{app.capabilities}</span>
                            ) : (
                              <span className="text-muted-foreground/40">—</span>
                            )}
                          </TableCell>

                          {/* Keywords */}
                          <TableCell className="px-5 py-3.5 hidden lg:table-cell">
                            {app.trigger_keywords ? (
                              <div className="flex flex-wrap gap-1">
                                {app.trigger_keywords
                                  .split(",")
                                  .map((kw) => kw.trim())
                                  .filter(Boolean)
                                  .map((kw) => (
                                    <Badge
                                      key={kw}
                                      variant="outline"
                                      className="normal-case tracking-normal font-medium text-[10px] bg-violet-500/10 text-violet-600 dark:text-violet-400 border-violet-500/20"
                                    >
                                      {kw}
                                    </Badge>
                                  ))}
                              </div>
                            ) : (
                              <span className="text-muted-foreground/40 text-[12px]">—</span>
                            )}
                          </TableCell>

                          {/* Status */}
                          <TableCell className="px-5 py-3.5 hidden lg:table-cell">
                            <div className="flex flex-col items-start gap-1">
                              <StatusBadge status={app.is_active ? "active" : "inactive"} />
                              {!app.has_embedding && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Badge
                                      variant="outline"
                                      className="normal-case tracking-normal font-semibold text-[10px] bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20"
                                    >
                                      indexing…
                                    </Badge>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[260px]">
                                    Embedding pending — will back-fill automatically; won't surface
                                    in chat until then.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          </TableCell>

                          {/* Actions */}
                          <TableCell className="px-5 py-3.5">
                            <div className="flex items-center gap-0.5 justify-end">
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => toggleActive(app)}
                                disabled={toggling.has(app.id)}
                                title={app.is_active ? "Deactivate" : "Activate"}
                                className={cn(
                                  "h-7 w-7",
                                  app.is_active
                                    ? "text-emerald-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500"
                                    : "text-zinc-400 dark:text-zinc-500 hover:bg-emerald-50 dark:hover:bg-emerald-500/10 hover:text-emerald-600",
                                )}
                              >
                                {toggling.has(app.id) ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : app.is_active ? (
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                ) : (
                                  <XCircle className="h-3.5 w-3.5" />
                                )}
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => openEdit(app)}
                                title="Edit"
                                className="h-7 w-7 text-muted-foreground hover:text-[#00a29a] dark:hover:text-[#00c4bb]"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setDeleteId(app.id)}
                                title="Delete"
                                className="h-7 w-7 text-muted-foreground hover:bg-rose-50 dark:hover:bg-rose-500/10 hover:text-rose-500 dark:hover:text-rose-400"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </TableCell>
                        </TableRow>
                        {expandedAppId === app.id && (
                          <TableRow className="lg:hidden bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={3} className="p-4 border-b">
                              <div className="flex flex-col gap-4 text-[13px]">
                                <div>
                                  <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Status</span>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <StatusBadge status={app.is_active ? "active" : "inactive"} />
                                    {!app.has_embedding && (
                                      <Badge
                                        variant="outline"
                                        className="normal-case tracking-normal font-semibold text-[10px] bg-amber-500/10 text-amber-600 border-amber-500/20"
                                      >
                                        indexing…
                                      </Badge>
                                    )}
                                  </div>
                                </div>
                                <div>
                                  <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Purpose</span>
                                  <span className="text-foreground">{app.purpose}</span>
                                </div>
                                <div>
                                  <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Capabilities</span>
                                  <span className="text-foreground">{app.capabilities || "—"}</span>
                                </div>
                                <div>
                                  <span className="block text-[11px] font-bold text-muted-foreground uppercase tracking-wider mb-1">Chat Triggers</span>
                                  {app.trigger_keywords ? (
                                    <div className="flex flex-wrap gap-1">
                                      {app.trigger_keywords.split(",").map((kw) => kw.trim()).filter(Boolean).map((kw) => (
                                        <Badge key={kw} variant="outline" className="normal-case tracking-normal font-medium text-[10px] bg-violet-500/10 text-violet-600 border-violet-500/20">
                                          {kw}
                                        </Badge>
                                      ))}
                                    </div>
                                  ) : (
                                    <span className="text-muted-foreground">—</span>
                                  )}
                                </div>
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                        </Fragment>
                      ))
                    )}
                  </TableBody>
                </Table>
              </div>
            </TooltipProvider>

            {filteredApps.length > 0 && (
              <p className="text-[11px] text-[#94a3b8] dark:text-white/30 px-1">
                Showing {filteredApps.length} of {apps.length} app
                {apps.length !== 1 ? "s" : ""}
              </p>
            )}
          </div>
        )}
      </div>

      {/* ── Add / Edit dialog ── */}
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
          {editId === null && (
            <div className="rounded-xl border border-violet-500/20 bg-violet-500/[0.04] p-3 mb-1">
              <label className="flex items-center gap-1.5 text-[12px] font-semibold text-violet-600 dark:text-violet-300">
                <Sparkles className="h-3.5 w-3.5" />
                Describe it, let AI draft it
              </label>
              <p className="text-[11px] text-muted-foreground/80 mt-0.5">
                Describe the app in a sentence — AI drafts the fields below for you to review. Works
                for internal/SSO apps too (nothing is fetched).
              </p>
              <Textarea
                value={genDesc}
                onChange={(e) => setGenDesc(e.target.value)}
                onKeyDown={(e) => {
                  if (
                    e.key === "Enter" &&
                    (e.metaKey || e.ctrlKey) &&
                    !generating &&
                    genDesc.trim()
                  ) {
                    e.preventDefault();
                    describeAndDraft();
                  }
                }}
                placeholder="e.g. Internal travel booking portal (SSO login) — book flights and hotels, view itineraries, submit travel claims"
                disabled={generating}
                className="mt-2 min-h-[56px]"
              />
              <div className="flex items-center gap-2 mt-2">
                <Input
                  value={genUrl}
                  onChange={(e) => setGenUrl(e.target.value)}
                  placeholder="App URL (optional) — https://travel.corp.local"
                  disabled={generating}
                  className="flex-1"
                />
                <Button
                  type="button"
                  onClick={describeAndDraft}
                  disabled={generating || !genDesc.trim()}
                  className="bg-violet-600 hover:bg-violet-700 text-white shrink-0"
                >
                  {generating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {generating ? "Drafting…" : "Draft with AI"}
                </Button>
              </div>
            </div>
          )}
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
                Comma-separated. When a user's message contains any of these words, the assistant
                will offer to open this portal directly. Use specific phrases (e.g. "payslip",
                "salary slip") — single generic words like "requests", "form", or "status" are not
                allowed and will be rejected.
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

      {/* ── Keyword suggestions dialog ── */}
      <Dialog open={suggestOpen} onOpenChange={setSuggestOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lightbulb className="h-4 w-4 text-violet-500" />
              Learn keywords from chat
            </DialogTitle>
            <DialogDescription>
              These are real questions from the last 30 days that{" "}
              <span className="font-medium">matched an app</span> but didn't contain any of its
              trigger keywords — so the direct-link offer never fired. Add the ones that fit.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto -mx-1 px-1">
            {suggesting ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" /> Scanning recent questions…
              </div>
            ) : !suggestData || suggestData.apps.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-14 text-center">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-600 border border-emerald-500/20 mb-3">
                  <Check className="h-6 w-6" />
                </div>
                <p className="text-[14px] font-semibold text-foreground">
                  No new keyword suggestions.
                </p>
                <p className="text-[12px] text-muted-foreground mt-1 max-w-sm">
                  {suggestData
                    ? `Scanned ${suggestData.scanned} recent questions — the assistant is already matching them to your apps, or there's nothing distinctive to add.`
                    : "Nothing to suggest right now."}
                </p>
              </div>
            ) : (
              <div className="space-y-5 py-1">
                {suggestData.apps.map((app) => (
                  <div
                    key={app.app_id}
                    className="rounded-xl border border-[#e2e8f0] dark:border-white/[0.08] p-4"
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <AppAvatar name={app.app_name} size="sm" />
                      <div className="flex-1 flex items-baseline justify-between gap-2">
                        <h4 className="font-bold text-[14px] text-foreground">{app.app_name}</h4>
                        <span className="text-[11px] text-muted-foreground shrink-0">
                          {app.near_miss_count} question{app.near_miss_count === 1 ? "" : "s"}{" "}
                          matched without a keyword
                        </span>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {app.suggestions.map((s) => {
                        const key = `${app.app_id}:${s.keyword}`;
                        const busy = addingKw.has(key);
                        return (
                          <button
                            key={s.keyword}
                            onClick={() => addSuggestedKeyword(app.app_id, s.keyword)}
                            disabled={busy}
                            title={
                              s.samples.length ? `e.g. "${s.samples.join('"  •  "')}"` : undefined
                            }
                            className="group inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/[0.06] pl-3 pr-2 py-1 text-[12px] font-medium text-violet-700 dark:text-violet-300 hover:bg-violet-500/[0.14] transition-colors disabled:opacity-50"
                          >
                            {s.keyword}
                            <span className="text-[10px] text-violet-500/70">×{s.count}</span>
                            {busy ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Plus className="h-3.5 w-3.5 opacity-60 group-hover:opacity-100" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setSuggestOpen(false)}>
              Done
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Delete confirm ── */}
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
