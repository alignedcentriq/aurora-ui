import { createFileRoute } from "@tanstack/react-router";
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
} from "lucide-react";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/admin")({
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

function AdminDashboard() {
  const { user } = useAuth();

  const [announcements, setAnnouncements] = useState<AnnouncementItem[]>([]);
  const [annLoading, setAnnLoading] = useState(true);
  const [newAnn, setNewAnn] = useState({ title: "", body: "", category: "General", image_url: "" });
  const [creating, setCreating] = useState(false);
  const [suggesting, setSuggesting] = useState(false);
  const [showForm, setShowForm] = useState(false);

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
    "Policy Update": "bg-blue-500/10 text-blue-500",
    "Holiday": "bg-emerald-500/10 text-emerald-500",
    "Events": "bg-violet-500/10 text-violet-500",
    "IT Alert": "bg-rose-500/10 text-rose-500",
    "General": "bg-amber-500/10 text-amber-500",
  };

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Admin</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">Manage announcements and monitor system status</p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-8 space-y-8">

        {/* Announcement Management */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <div className="flex items-center justify-between mb-5">
            <div className="flex items-center gap-2">
              <Megaphone className="h-4 w-4 text-muted-foreground" />
              <div>
                <h3 className="text-[15px] font-semibold text-foreground">Announcement Management</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Create and manage broadcasts for all employees</p>
              </div>
            </div>
            <button
              onClick={() => setShowForm((v) => !v)}
              className="flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus className="h-4 w-4" />
              New Announcement
            </button>
          </div>

          {showForm && (
            <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--muted)] p-4 space-y-3">
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder="Title"
                  value={newAnn.title}
                  onChange={(e) => setNewAnn((p) => ({ ...p, title: e.target.value }))}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
                <select
                  value={newAnn.category}
                  onChange={(e) => setNewAnn((p) => ({ ...p, category: e.target.value }))}
                  className="rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
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
                  className="w-full rounded-lg border border-[var(--border)] bg-background px-3 py-2 pr-28 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50 resize-none"
                />
                <button
                  onClick={handleSuggestBody}
                  disabled={suggesting || !newAnn.title.trim()}
                  className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-500 hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
                >
                  {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                  Suggest
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Image className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <input
                  type="url"
                  placeholder="Image URL (optional)"
                  value={newAnn.image_url}
                  onChange={(e) => setNewAnn((p) => ({ ...p, image_url: e.target.value }))}
                  className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground outline-none focus:border-primary/50"
                />
              </div>
              {newAnn.image_url.trim() && (
                <img src={newAnn.image_url.trim()} alt="Preview" className="h-24 w-auto rounded-lg object-cover border border-[var(--border)]"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
              )}
              <div className="flex items-center gap-3">
                <button
                  onClick={handleCreateAnnouncement}
                  disabled={creating || !newAnn.title.trim() || !newAnn.body.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[13px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Publish
                </button>
                <button
                  onClick={() => { setShowForm(false); setNewAnn({ title: "", body: "", category: "General", image_url: "" }); }}
                  className="rounded-lg border border-[var(--border)] px-4 py-2 text-[13px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {annLoading ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading announcements...
            </div>
          ) : announcements.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No announcements found.</p>
          ) : (
            <div className="space-y-2">
              {announcements.map((ann) => (
                <div key={ann.id} className={cn(
                  "flex items-start justify-between gap-4 rounded-xl border px-4 py-3",
                  ann.is_active ? "border-[var(--border)] bg-background" : "border-[var(--border)] bg-[var(--muted)] opacity-60",
                )}>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[13px] font-semibold text-foreground">{ann.title}</span>
                      <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", categoryColors[ann.category] ?? "bg-[var(--muted)] text-muted-foreground")}>
                        {ann.category}
                      </span>
                      {!ann.is_active && (
                        <span className="rounded-full bg-[var(--muted)] px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">Inactive</span>
                      )}
                    </div>
                    <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2">{ann.body}</p>
                    <p className="text-[11px] text-muted-foreground/60 mt-1">by {ann.created_by} · {ann.created_by_domain}</p>
                  </div>
                  {ann.is_active && (
                    <button
                      onClick={() => handleDeactivate(ann.id)}
                      className="shrink-0 flex items-center gap-1 rounded-lg border border-rose-500/20 px-2.5 py-1.5 text-[11px] font-medium text-rose-500 hover:bg-rose-500/10 transition-colors"
                    >
                      <Trash2 className="h-3 w-3" /> Deactivate
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* System Status */}
        <div className="rounded-2xl border border-[var(--border)] bg-card p-6">
          <h3 className="text-[15px] font-semibold text-foreground mb-4 flex items-center gap-2">
            <Server className="h-4 w-4 text-muted-foreground" /> System Status
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              { name: "API Gateway", status: "Operational", uptime: "99.99%" },
              { name: "LLM Engine", status: "Operational", uptime: "99.95%" },
              { name: "Vector Store", status: "Operational", uptime: "99.98%" },
              { name: "Auth Service", status: "Operational", uptime: "99.80%" },
            ].map((s) => (
              <div key={s.name} className="flex items-center gap-3 rounded-xl border border-[var(--border)] px-4 py-3">
                <div className={cn("h-2.5 w-2.5 rounded-full shrink-0", s.status === "Operational" ? "bg-emerald-500" : "bg-amber-500 animate-pulse")} />
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-foreground truncate">{s.name}</p>
                  <p className="text-[11px] text-muted-foreground">{s.uptime} uptime</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
