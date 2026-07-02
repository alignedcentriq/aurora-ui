import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useMemo, useRef } from "react";
import {
  AnnouncementBodyEditor,
  type ImageAction,
} from "@/components/assistant/AnnouncementBodyEditor";
import {
  Server,
  Shield,
  Megaphone,
  Plus,
  Trash2,
  Loader2,
  CheckCircle2,
  AlertTriangle,
  TrendingUp,
  Radio,
  Filter,
  Clock,
  AtSign,
  Hash,
  Search,
  UserPlus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";

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
  const [newAnn, setNewAnn] = useState({ title: "", body: "", category: "General" });
  const [audienceRole, setAudienceRole] = useState("all");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageAction, setImageAction] = useState<ImageAction | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<{ name: string; email: string }[]>([]);
  const [showRecipientDrop, setShowRecipientDrop] = useState(false);
  const [recipientTags, setRecipientTags] = useState<{ name: string; email: string }[]>([]);
  const recipientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [creating, setCreating] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [categoryFilter, setCategoryFilter] = useState("All");
  const [recallTarget, setRecallTarget] = useState<number | null>(null);

  const authHeaders = useMemo(
    () => ({
      "Content-Type": "application/json",
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

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

  const AUDIENCE_ROLES = [
    { label: "All Staff", value: "all" },
    { label: "HR", value: "hr" },
    { label: "IT", value: "it" },
    { label: "Admin", value: "admin" },
    { label: "PMO", value: "pmo" },
    { label: "Manager", value: "functional_manager" },
    { label: "Employee", value: "employee" },
  ];

  function handleRecipientSearch(q: string) {
    setRecipientSearch(q);
    setShowRecipientDrop(q.length >= 2);
    if (recipientTimer.current) clearTimeout(recipientTimer.current);
    if (q.length < 2) {
      setRecipientResults([]);
      return;
    }
    recipientTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/announcements/users/search?q=${encodeURIComponent(q)}`, {
          headers: authHeaders,
        });
        const data = await res.json();
        setRecipientResults(Array.isArray(data) ? data : []);
      } catch {
        setRecipientResults([]);
      }
    }, 250);
  }

  function addRecipient(u: { name: string; email: string }) {
    if (!recipientTags.some((r) => r.email === u.email)) {
      setRecipientTags((prev) => [...prev, u]);
    }
    setRecipientSearch("");
    setRecipientResults([]);
    setShowRecipientDrop(false);
  }

  const handleCreateAnnouncement = async () => {
    if (!newAnn.title.trim() || !newAnn.body.trim()) return;
    setCreating(true);
    try {
      await fetch("/api/announcements", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          title: newAnn.title,
          body: newAnn.body,
          category: newAnn.category,
          created_by_domain: "admin",
          target_audience: audienceRole,
          email_recipients: recipientTags.length > 0 ? recipientTags.map((r) => r.email) : null,
          image_url: imageUrl ?? null,
          image_action: imageAction ?? null,
        }),
      });
      setNewAnn({ title: "", body: "", category: "General" });
      setAudienceRole("all");
      setImageUrl(null);
      setImageAction(null);
      setRecipientTags([]);
      setRecipientSearch("");
      setRecipientResults([]);
      setShowForm(false);
      refreshAnnouncements();
    } finally {
      setCreating(false);
    }
  };

  const handleDeactivate = async (id: number, recall: boolean) => {
    await fetch(`/api/announcements/${id}?recall=${recall}`, {
      method: "DELETE",
      headers: authHeaders,
    });
    setRecallTarget(null);
    refreshAnnouncements();
  };

  if (!user || user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Shield className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">
            This dashboard is available to Administrators only.
          </p>
        </div>
      </div>
    );
  }

  const categoryColors: Record<string, string> = {
    "Policy Update": "bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/20",
    Holiday:
      "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
    Events: "bg-[#3b82f6]/10 text-[#3b82f6] border border-[#3b82f6]/20",
    "IT Alert": "bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20",
    General: "bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20",
  };

  const filterCategories = ["All", "Policy", "Events", "Alerts"];
  const activeAnnouncements = announcements.filter((a) => a.is_active);
  const filteredAnnouncements =
    categoryFilter === "All"
      ? announcements
      : announcements.filter((a) => {
          if (categoryFilter === "Policy") return a.category === "Policy Update";
          if (categoryFilter === "Events")
            return a.category === "Events" || a.category === "Holiday";
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
      <div className="sticky top-0 z-20 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white/80 dark:bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
              System & Ops
            </p>
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
          <Card>
            <CardContent className="p-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Active Broadcasts
                </p>
                <p className="text-[28px] font-bold text-[#0f172a] dark:text-white mt-1">
                  {activeAnnouncements.length}
                </p>
                <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">
                  +{Math.min(activeAnnouncements.length, 2)} this week
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#00a29a]/10 dark:bg-[#00c4bb]/10">
                <Megaphone className="h-5 w-5 text-[#00a29a] dark:text-[#00c4bb]" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  System Status
                </p>
                <p className="text-[18px] font-bold text-[#0f172a] dark:text-white mt-1">
                  Operational
                </p>
                <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">
                  All services up
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#16a34a]/10 dark:bg-emerald-500/10">
                <CheckCircle2 className="h-5 w-5 text-[#16a34a] dark:text-emerald-400" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Open IT Alerts
                </p>
                <p className="text-[28px] font-bold text-[#0f172a] dark:text-white mt-1">1</p>
                <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">
                  Scheduled tonight
                </p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#f59e0b]/10 dark:bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-[#f59e0b] dark:text-amber-400" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 flex items-start justify-between">
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-[#94a3b8] dark:text-white/40">
                  Engagement
                </p>
                <p className="text-[28px] font-bold text-[#0f172a] dark:text-white mt-1">94%</p>
                <p className="text-[11px] text-[#94a3b8] dark:text-white/40 mt-0.5">Last 30 days</p>
              </div>
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#16a34a]/10 dark:bg-emerald-500/10">
                <TrendingUp className="h-5 w-5 text-[#16a34a] dark:text-emerald-400" />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* New Announcement Form */}
        {showForm && (
          <Card>
            <CardContent className="p-5 space-y-3">
              <div className="flex gap-2">
                <Input
                  type="text"
                  placeholder="Title"
                  value={newAnn.title}
                  onChange={(e) => setNewAnn((p) => ({ ...p, title: e.target.value }))}
                  className="flex-1"
                />
                <Input
                  type="text"
                  placeholder="Category"
                  value={newAnn.category}
                  onChange={(e) => setNewAnn((p) => ({ ...p, category: e.target.value }))}
                  className="w-36"
                />
              </div>
              <AnnouncementBodyEditor
                body={newAnn.body}
                onBodyChange={(v) => setNewAnn((p) => ({ ...p, body: v }))}
                imageUrl={imageUrl}
                onImageUrlChange={setImageUrl}
                imageAction={imageAction}
                onImageActionChange={setImageAction}
                authHeaders={authHeaders}
                title={newAnn.title}
                category={newAnn.category}
                rows={8}
              />

              {/* Audience */}
              <div className="space-y-2">
                <p className="text-[11px] font-semibold uppercase tracking-widest text-[#94a3b8]">
                  Send to
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {AUDIENCE_ROLES.map((r) => (
                    <button
                      key={r.value}
                      type="button"
                      onClick={() => setAudienceRole(r.value)}
                      className={cn(
                        "rounded-full px-3 py-1 text-[12px] font-medium border transition-colors",
                        audienceRole === r.value
                          ? "bg-[#00a29a] dark:bg-[#00c4bb] text-white border-transparent"
                          : "border-[#e2e8f0] dark:border-white/[0.1] text-[#64748b] dark:text-white/50 hover:border-[#00a29a]/40",
                      )}
                    >
                      {r.label}
                    </button>
                  ))}
                </div>

                {/* Specific email recipients — people search */}
                <div className="space-y-2">
                  {recipientTags.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {recipientTags.map((r) => (
                        <Badge
                          key={r.email}
                          variant="secondary"
                          className="flex items-center gap-1 rounded-full px-2.5 py-0.5"
                        >
                          {r.name || r.email}
                          <button
                            onClick={() =>
                              setRecipientTags((p) => p.filter((x) => x.email !== r.email))
                            }
                            className="text-muted-foreground hover:text-rose-500 ml-1"
                          >
                            ×
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-[#94a3b8] pointer-events-none" />
                    <Input
                      type="text"
                      placeholder="Search people by name or email…"
                      value={recipientSearch}
                      onChange={(e) => handleRecipientSearch(e.target.value)}
                      onFocus={() => recipientSearch.length >= 2 && setShowRecipientDrop(true)}
                      onBlur={() => setTimeout(() => setShowRecipientDrop(false), 150)}
                      className="pl-8 text-[12px]"
                    />
                    {showRecipientDrop && recipientResults.length > 0 && (
                      <div className="absolute left-0 top-full mt-1 z-20 bg-background border border-[#e2e8f0] dark:border-white/[0.1] rounded-xl shadow-lg w-full max-h-44 overflow-y-auto">
                        {recipientResults.map((u) => (
                          <button
                            key={u.email}
                            type="button"
                            onMouseDown={() => addRecipient(u)}
                            className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/50 text-left"
                          >
                            <UserPlus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <div className="min-w-0">
                              <div className="text-[12px] font-medium truncate">{u.name}</div>
                              <div className="text-[11px] text-muted-foreground truncate">
                                {u.email}
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  onClick={handleCreateAnnouncement}
                  disabled={creating || !newAnn.title.trim() || !newAnn.body.trim()}
                  className="bg-[#00a29a] dark:bg-[#00c4bb] hover:opacity-90"
                  size="sm"
                >
                  {creating && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1" />}
                  Publish
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setShowForm(false);
                    setNewAnn({ title: "", body: "", category: "General" });
                    setAudienceRole("all");
                    setImageUrl(null);
                    setImageAction(null);
                    setRecipientTags([]);
                    setRecipientSearch("");
                    setRecipientResults([]);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Announcement Management */}
        <Card>
          {/* Section Header */}
          <CardHeader className="flex-row items-start justify-between space-y-0 pb-0">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#00a29a]/10 dark:bg-[#00c4bb]/10">
                <Megaphone className="h-4 w-4 text-[#00a29a] dark:text-[#00c4bb]" />
              </div>
              <div>
                <CardTitle className="text-[15px]">Announcement Management</CardTitle>
                <CardDescription>Create and manage broadcasts for all employees</CardDescription>
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
                      : "text-[#94a3b8] dark:text-white/40 hover:text-[#64748b] dark:hover:text-white/60",
                  )}
                >
                  {cat}
                </button>
              ))}
              <button className="rounded-lg p-1.5 text-[#94a3b8] dark:text-white/40 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.06] transition-colors">
                <Filter className="h-4 w-4" />
              </button>
            </div>
          </CardHeader>

          {/* Announcement List */}
          <CardContent className="p-5 space-y-3">
            {annLoading ? (
              <div className="space-y-3 py-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="rounded-xl border border-border px-5 py-4 space-y-2">
                    <div className="flex items-center gap-2">
                      <Skeleton className="h-2.5 w-2.5 rounded-full" />
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-5 w-20 rounded-full" />
                    </div>
                    <Skeleton className="h-3 w-full" />
                    <Skeleton className="h-3 w-4/5" />
                  </div>
                ))}
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
                        <span
                          className={cn(
                            "h-2.5 w-2.5 rounded-full shrink-0",
                            ann.is_active ? "bg-[#00a29a] dark:bg-[#00c4bb]" : "bg-[#94a3b8]",
                          )}
                        />
                        <span className="text-[14px] font-bold text-[#0f172a] dark:text-white">
                          {ann.title}
                        </span>
                        <Badge
                          variant="outline"
                          className={cn(
                            "rounded-full text-[10px] font-semibold",
                            categoryColors[ann.category] ??
                              "bg-[#f1f5f9] dark:bg-white/[0.08] text-[#64748b] dark:text-white/50",
                          )}
                        >
                          {ann.category}
                        </Badge>
                        {!ann.is_active && (
                          <Badge variant="secondary" className="rounded-full text-[10px]">
                            Inactive
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-1.5 line-clamp-2 leading-relaxed">
                        {ann.body}
                      </p>
                      <div className="flex items-center gap-4 mt-2.5 text-[11px] text-[#94a3b8] dark:text-white/30">
                        <span className="flex items-center gap-1">
                          <AtSign className="h-3 w-3" />
                          {ann.created_by}@{ann.created_by_domain}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {formatTimeAgo(ann.created_at)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Hash className="h-3 w-3" />
                          {ann.created_by_domain}
                        </span>
                      </div>
                    </div>
                    {ann.is_active && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setRecallTarget(ann.id)}
                        className="shrink-0 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 hover:text-rose-600"
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-1" /> Deactivate
                      </Button>
                    )}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recall confirm dialog */}
      <Dialog open={recallTarget !== null} onOpenChange={(open) => !open && setRecallTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Announcement</DialogTitle>
            <DialogDescription>
              Do you also want to recall the email sent to recipients? A retraction notice will be
              sent.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              className="w-full"
              onClick={() => recallTarget !== null && handleDeactivate(recallTarget, true)}
            >
              Delete &amp; Recall Email
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => recallTarget !== null && handleDeactivate(recallTarget, false)}
            >
              Delete Only
            </Button>
            <Button
              variant="ghost"
              className="w-full text-muted-foreground"
              onClick={() => setRecallTarget(null)}
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
