import { createFileRoute, redirect } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo } from "react";
import {
  Server,
  Shield,
  Megaphone,
  Plus,
  Trash2,
  Loader2,
  Sparkles,
  Image,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Radio,
  Filter,
  Clock,
  AtSign,
  Hash,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/admin")({
  beforeLoad: () => {
    throw redirect({
      to: "/control-hub",
      search: { tab: "dashboard" },
    });
  },
  component: AdminDashboard,
});

interface AnnouncementItem {
  id: number;
  title: string;
  body: string;
  category: string;
  created_by: string;
  created_by_domain: string;
  is_active: boolean;
  created_at: string;
}

export function AdminDashboard() {
  const { user } = useAuth();

  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [newAnn, setNewAnn] = useState({ title: "", body: "", category: "General", image_url: "" });
  const [creating, setCreating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("All");

  const authHeaders = useMemo(() => ({
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  }), [user?.email, user?.role]);

  useEffect(() => {
    fetch("/api/announcements", { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => setAnnouncements([]))
      .finally(() => setAnnLoading(false));
  }, []);

  const refreshAnnouncements = () =>
    fetch("/api/announcements", { headers: authHeaders })
      .then((r) => r.json())
      .then((data) => setAnnouncements(Array.isArray(data) ? data : []))
      .catch(() => {});

  const handleSuggestBody = async () => {
    if (!newAnn.title.trim()) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/announcements/suggest", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({ title: newAnn.title, category: newAnn.category }),
      });
      if (res.ok) { const data = await res.json(); setNewAnn((p) => ({ ...p, body: data.body })); }
    } finally { setSuggesting(false); }
  };

  const handleCreateAnnouncement = async () => {
    if (!newAnn.title.trim() || !newAnn.body.trim()) return;
    setCreating(true);
    try {
      await fetch("/api/announcements", {
        method: "POST", headers: authHeaders,
        body: JSON.stringify({
          title: newAnn.title, body: newAnn.body, category: newAnn.category,
          created_by_domain: "admin", target_audience: "all",
          image_url: newAnn.image_url.trim() || null,
        }),
      });
      setNewAnn({ title: "", body: "", category: "General", image_url: "" });
      setShowForm(false);
      refreshAnnouncements();
    } finally { setCreating(false); }
  };

  const handleDeactivate = async (id: number) => {
    await fetch(`/api/announcements/${id}`, { method: "DELETE", headers: authHeaders });
    refreshAnnouncements();
  };

  if (!user || user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">This dashboard is available to Administrators only.</p>
        </div>
      </div>
    );
  }

  const categoryColors: Record<string, string> = {
    "Policy Update": "bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/20",
    "Holiday": "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
    "Events": "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20",
    "IT Alert": "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
    "General": "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  };

  const filterCategories = ["All", "Policy", "Events", "Alerts"];
  const activeAnnouncements = announcements.filter((a) => a.is_active);
  const filteredAnnouncements = categoryFilter === "All"
    ? announcements
    : announcements.filter((a) => {
        if (categoryFilter === "Policy") return a.category === "Policy Update";
        if (categoryFilter === "Events") return a.category === "Events" || a.category === "Holiday";
        if (categoryFilter === "Alerts") return a.category === "IT Alert";
        return true;
      });

  const formatTimeAgo = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    if (diffHours < 1) return "Just now";
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays === 1) return "Yesterday";
    return `${diffDays}d ago`;
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
              System & Ops
            </p>
            <h1 className="text-[22px] font-bold text-[#0f172a] dark:text-white tracking-tight">Admin</h1>
            <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5">
              Manage announcements and monitor system status across the workspace.
            </p>
          </div>
          <button
            onClick={() => setShowForm((v) => !v)}
            className="flex items-center gap-2 rounded-xl bg-[#00a29a] dark:bg-[#00c4bb] px-5 py-2.5 text-[13px] font-semibold text-white hover:opacity-90 transition-opacity shadow-sm"
          >
            <Plus className="h-4 w-4" />
            New Announcement
          </button>
        </div>
      </div>

      <div className="flex-1 p-8 space-y-6">

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card p-5 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">Active Broadcasts</p>
              <p className="text-[28px] font-bold text-[#0f172a] dark:text-white mt-1">{activeAnnouncements.length}</p>
              <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">+{Math.min(activeAnnouncements.length, 2)} this week</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a29a]/10 dark:bg-[#00c4bb]/10">
              <Megaphone className="h-5 w-5 text-[#00a29a] dark:text-[#00c4bb]" />
            </div>
          </div>

          <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card p-5 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">System Status</p>
              <p className="text-[18px] font-bold text-[#0f172a] dark:text-white mt-1">Operational</p>
              <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">All services up</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#16a34a]/10 dark:bg-emerald-500/10">
              <CheckCircle2 className="h-5 w-5 text-[#16a34a] dark:text-emerald-400" />
            </div>
          </div>

          <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card p-5 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">Open IT Alerts</p>
              <p className="text-[28px] font-bold text-[#0f172a] dark:text-white mt-1">1</p>
              <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">Scheduled tonight</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f59e0b]/10 dark:bg-amber-500/10">
              <AlertTriangle className="h-5 w-5 text-[#f59e0b] dark:text-amber-400" />
            </div>
          </div>

          <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card p-5 flex items-start justify-between">
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">Engagement</p>
              <p className="text-[28px] font-bold text-[#0f172a] dark:text-white mt-1">94%</p>
              <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">Last 30 days</p>
            </div>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#16a34a]/10 dark:bg-emerald-500/10">
              <TrendingUp className="h-5 w-5 text-[#16a34a] dark:text-emerald-400" />
            </div>
          </div>
        </div>

        {/* New Announcement Form */}
        {showForm && (
          <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card p-5 space-y-3">
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Title"
                value={newAnn.title}
                onChange={(e) => setNewAnn((p) => ({ ...p, title: e.target.value }))}
                className="flex-1 rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-[#f8fafc] dark:bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-[#94a3b8] outline-none focus:border-[#00a29a]/50 dark:focus:border-teal-500/50"
              />
              <select
                value={newAnn.category}
                onChange={(e) => setNewAnn((p) => ({ ...p, category: e.target.value }))}
                className="rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-[#f8fafc] dark:bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-[#00a29a]/50 dark:focus:border-teal-500/50"
              >
                {["General", "Policy Update", "Holiday", "Events", "IT Alert"].map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div className="relative">
              <textarea
                placeholder="Announcement body..."
                rows={4}
                value={newAnn.body}
                onChange={(e) => setNewAnn((p) => ({ ...p, body: e.target.value }))}
                className="w-full rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-[#f8fafc] dark:bg-background px-3 py-2 pr-28 text-[13px] text-foreground placeholder:text-[#94a3b8] outline-none focus:border-[#00a29a]/50 dark:focus:border-teal-500/50 resize-none"
              />
              <button
                onClick={handleSuggestBody}
                disabled={suggesting || !newAnn.title.trim()}
                className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
              >
                {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                Suggest
              </button>
            </div>
            <div className="flex items-center gap-2">
              <Image className="h-3.5 w-3.5 text-[#94a3b8] shrink-0" />
              <input
                type="url"
                placeholder="Image URL (optional)"
                value={newAnn.image_url}
                onChange={(e) => setNewAnn((p) => ({ ...p, image_url: e.target.value }))}
                className="flex-1 rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] bg-[#f8fafc] dark:bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-[#94a3b8] outline-none focus:border-[#00a29a]/50 dark:focus:border-teal-500/50"
              />
            </div>
            {newAnn.image_url.trim() && (
              <img src={newAnn.image_url.trim()} alt="Preview" className="h-24 w-auto rounded-lg object-cover border border-[#e2e8f0] dark:border-white/[0.1]"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
            )}
            <div className="flex items-center gap-3">
              <button
                onClick={handleCreateAnnouncement}
                disabled={creating || !newAnn.title.trim() || !newAnn.body.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-[#00a29a] dark:bg-[#00c4bb] px-4 py-2 text-[13px] font-semibold text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Publish
              </button>
              <button
                onClick={() => { setShowForm(false); setNewAnn({ title: "", body: "", category: "General", image_url: "" }); }}
                className="rounded-lg border border-[#e2e8f0] dark:border-white/[0.1] px-4 py-2 text-[13px] font-medium text-[#64748b] dark:text-white/50 hover:text-[#0f172a] dark:hover:text-white transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* Announcement Management */}
        <div className="rounded-2xl border border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card">
          {/* Section Header */}
          <div className="flex items-center justify-between p-5 pb-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00a29a]/10 dark:bg-[#00c4bb]/10">
                <Megaphone className="h-4 w-4 text-[#00a29a] dark:text-[#00c4bb]" />
              </div>
              <div>
                <h3 className="text-[15px] font-bold text-[#0f172a] dark:text-white">Announcement Management</h3>
                <p className="text-[12px] text-[#94a3b8] dark:text-white/40 mt-0.5">Create and manage broadcasts for all employees</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {filterCategories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-[12px] font-medium transition-colors",
                    categoryFilter === cat
                      ? "bg-[#f1f5f9] dark:bg-white/[0.08] text-[#0f172a] dark:text-white"
                      : "text-[#94a3b8] dark:text-white/40 hover:text-[#64748b] dark:hover:text-white/60"
                  )}
                >
                  {cat}
                </button>
              ))}
              <button className="rounded-lg p-1.5 text-[#94a3b8] dark:text-white/40 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.06] transition-colors">
                <Filter className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Announcement List */}
          <div className="p-5 space-y-3">
            {annLoading ? (
              <div className="flex items-center gap-2 py-8 justify-center text-sm text-[#94a3b8]">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading announcements...
              </div>
            ) : filteredAnnouncements.length === 0 ? (
              <p className="text-sm text-[#94a3b8] py-8 text-center">No announcements found.</p>
            ) : (
              filteredAnnouncements.map((ann) => (
                <div
                  key={ann.id}
                  className={cn(
                    "rounded-xl border px-5 py-4",
                    ann.is_active
                      ? "border-[#e2e8f0] dark:border-white/[0.08] bg-[#f8fafc] dark:bg-background/50"
                      : "border-[#e2e8f0] dark:border-white/[0.08] bg-[#f1f5f9] dark:bg-background/30 opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2.5 flex-wrap">
                        <span className={cn("h-2.5 w-2.5 rounded-full shrink-0", ann.is_active ? "bg-[#00a29a] dark:bg-[#00c4bb]" : "bg-[#94a3b8]")} />
                        <span className="text-[14px] font-bold text-[#0f172a] dark:text-white">{ann.title}</span>
                        <span className={cn("rounded-full px-2.5 py-0.5 text-[10px] font-semibold", categoryColors[ann.category] ?? "bg-[#f1f5f9] dark:bg-white/[0.08] text-[#64748b] dark:text-white/50")}>
                          {ann.category}
                        </span>
                        {!ann.is_active && (
                          <span className="rounded-full bg-[#f1f5f9] dark:bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-[#94a3b8]">Inactive</span>
                        )}
                      </div>
                      <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1.5 line-clamp-2 leading-relaxed">{ann.body}</p>
                      <div className="flex items-center gap-4 mt-2.5 text-[11px] text-[#94a3b8] dark:text-white/30">
                        <span className="flex items-center gap-1"><AtSign className="h-3 w-3" />{ann.created_by}@{ann.created_by_domain}</span>
                        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{formatTimeAgo(ann.created_at)}</span>
                        <span className="flex items-center gap-1"><Hash className="h-3 w-3" />{ann.created_by_domain}</span>
                      </div>
                    </div>
                    {ann.is_active && (
                      <button
                        onClick={() => handleDeactivate(ann.id)}
                        className="shrink-0 flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-medium text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" /> Deactivate
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
