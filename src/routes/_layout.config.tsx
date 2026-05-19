import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  Save,
  HelpCircle,
  RefreshCw,
  CheckCircle2,
  AlertCircle,
  Loader2,
  FlaskConical,
  Send,
  ThumbsUp,
  ThumbsDown,
  Megaphone,
  Clock,
  Mail,
  X,
  Trash2,
  Sparkles,
  Image,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_layout/config")({
  component: ConfigPage,
});

interface PromptRow {
  domain: string;
  key: string;
  value: string;
  version: number;
  updated_at: string;
}

interface PendingDraft {
  id: number;
  domain: string;
  key: string;
  value: string;
  submitted_by: string;
  created_at: string;
}

const ALL_DOMAINS = [
  { id: "hr", label: "HR", color: "text-emerald-500" },
  { id: "admin", label: "Admin", color: "text-amber-500" },
  { id: "it_support", label: "IT Support", color: "text-blue-500" },
  { id: "pmo", label: "PMO", color: "text-violet-500" },
  { id: "functional_manager", label: "Manager", color: "text-indigo-500" },
];

const ROLE_DOMAINS: Record<string, string[]> = {
  hr: ["hr"],
  it: ["it_support"],
  pmo: ["pmo"],
  admin: ["hr", "admin", "it_support", "pmo", "functional_manager"],
};

const ROLE_TO_DOMAIN: Record<string, string> = {
  hr: "hr",
  it: "it_support",
  pmo: "pmo",
  admin: "admin",
  functional_manager: "functional_manager",
};

const KNOWN_PROMPT_METADATA: Record<string, { label: string; description: string }> = {
  system_prompt: { label: "System Prompt", description: "Core instructions and persona for this domain." },
  guardrail: { label: "Guardrail", description: "Anti-hallucination and scope constraints appended after the system prompt." },
};

function promptLabel(key: string) {
  return KNOWN_PROMPT_METADATA[key]?.label ?? key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
function promptDescription(key: string) {
  return KNOWN_PROMPT_METADATA[key]?.description ?? "";
}

const ANNOUNCEMENT_CATEGORIES = [
  "General", "Policy Update", "Holiday", "Events", "Hiring", "Training", "IT Alert",
];

const DOMAIN_ANNOUNCEMENT_CATEGORY: Record<string, string> = {
  hr: "Policy Update",
  admin: "General",
  it_support: "IT Alert",
  pmo: "General",
};

function userDomains(role: string): string[] {
  return ROLE_DOMAINS[role.toLowerCase()] ?? [];
}

// ── Component ─────────────────────────────────────────────────────────────────

function ConfigPage() {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase() ?? "";
  const allowed = userDomains(role);

  const [tab, setTab] = useState<"prompts" | "announcements" | "company">("prompts");
  const [activeDomain, setActiveDomain] = useState(allowed[0] ?? "hr");
  const [prompts, setPrompts] = useState<Record<string, PromptRow>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const [pendingDrafts, setPendingDrafts] = useState<PendingDraft[]>([]);
  const [approvingId, setApprovingId] = useState<number | null>(null);
  const [myDrafts, setMyDrafts] = useState<PendingDraft[]>([]);
  const [forceApprovingId, setForceApprovingId] = useState<number | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);

  // Add new prompt
  const [showAddForm, setShowAddForm] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [savingNew, setSavingNew] = useState(false);

  // Test prompt state
  const [testOpen, setTestOpen] = useState<string | null>(null);
  const [testQuery, setTestQuery] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [testing, setTesting] = useState<string | null>(null);

  // Company context state
  const [companyContext, setCompanyContext] = useState("");
  const [companyContextEdit, setCompanyContextEdit] = useState("");
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);

  // Announcement state
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annCategory, setAnnCategory] = useState(DOMAIN_ANNOUNCEMENT_CATEGORY[activeDomain] ?? "General");
  const [annExpires, setAnnExpires] = useState("");
  const [annImageUrl, setAnnImageUrl] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [sendEmail, setSendEmail] = useState(false);
  const [emailTo, setEmailTo] = useState("all-staff@company.com");
  const [submittingAnn, setSubmittingAnn] = useState(false);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [editingAnn, setEditingAnn] = useState<any | null>(null);
  const [editFields, setEditFields] = useState({ title: "", body: "", category: "" });
  const [savingEdit, setSavingEdit] = useState(false);

  const headers = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const isAdmin = role === "admin";

  const fetchPrompts = useCallback(async (domain: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prompts/${domain}`, { headers });
      if (!res.ok) throw new Error("Failed to load");
      const data: PromptRow[] = await res.json();
      setPrompts((prev) => ({
        ...prev,
        ...Object.fromEntries(data.map((row) => [`${domain}::${row.key}`, row])),
      }));
      setEdits((prev) => {
        const next = { ...prev };
        data.forEach((row) => { next[`${domain}::${row.key}`] = row.value; });
        return next;
      });
    } catch {
      toast.error("Failed to load prompts for " + domain);
    } finally {
      setLoading(false);
    }
  }, [user?.email, user?.role]);

  const fetchDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/prompts/drafts", { headers });
      if (res.ok) setPendingDrafts(await res.json());
    } catch {}
  }, [user?.email, user?.role]);

  const fetchMyDrafts = useCallback(async () => {
    try {
      const res = await fetch("/api/prompts/drafts/mine", { headers });
      if (res.ok) setMyDrafts(await res.json());
    } catch {}
  }, [user?.email, user?.role]);

  const fetchAnnouncements = useCallback(async () => {
    try {
      const res = await fetch("/api/announcements", { headers });
      if (res.ok) setAnnouncements(await res.json());
    } catch {}
  }, [user?.email, user?.role]);

  const fetchCompanyContext = useCallback(async () => {
    setLoadingCompany(true);
    try {
      const res = await fetch("/api/admin/company-settings", { headers });
      if (res.ok) {
        const data = await res.json();
        setCompanyContext(data.value ?? "");
        setCompanyContextEdit(data.value ?? "");
      }
    } catch {} finally {
      setLoadingCompany(false);
    }
  }, [user?.email, user?.role]);

  useEffect(() => {
    if (allowed.length > 0) {
      setActiveDomain(allowed[0]);
      fetchPrompts(allowed[0]);
      fetchDrafts();
      fetchMyDrafts();
      fetchAnnouncements();
      if (role === "admin") fetchCompanyContext();
    }
  }, [role]);

  useEffect(() => {
    if (allowed.length === 0) return;
    fetchPrompts(activeDomain);
    setShowAddForm(false);
    setNewKey("");
    setNewValue("");
  }, [activeDomain]);

  const handleSave = async (domain: string, promptKey: string) => {
    const compositeKey = `${domain}::${promptKey}`;
    const value = edits[compositeKey];
    if (!value?.trim()) { toast.error("Prompt cannot be empty"); return; }

    setSaving(compositeKey);
    try {
      const res = await fetch(`/api/prompts/${domain}/${promptKey}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Update failed");

      if (data.mode === "draft") {
        toast.success("Submitted for approval", { description: "A peer with the same role will review your change." });
        fetchDrafts();
        fetchMyDrafts();
      } else {
        toast.success("Saved successfully");
        await fetchPrompts(domain);
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(null);
    }
  };

  const handleSaveNew = async () => {
    const key = newKey.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key || !newValue.trim()) { toast.error("Key and value are required"); return; }
    setSavingNew(true);
    try {
      const res = await fetch(`/api/prompts/${activeDomain}/${key}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: newValue }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");
      if (data.mode === "draft") {
        toast.success("Submitted for approval", { description: "A peer with the same role will review your change." });
        fetchDrafts();
        fetchMyDrafts();
      } else {
        toast.success("Saved successfully");
        await fetchPrompts(activeDomain);
      }
      setShowAddForm(false);
      setNewKey("");
      setNewValue("");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingNew(false);
    }
  };

  const handleTest = async (domain: string, promptKey: string) => {
    const compositeKey = `${domain}::${promptKey}`;
    const draft_value = edits[compositeKey];
    const query = testQuery[compositeKey];
    if (!draft_value?.trim() || !query?.trim()) {
      toast.error("Enter a test query first");
      return;
    }
    setTesting(compositeKey);
    try {
      const res = await fetch("/api/prompts/test", {
        method: "POST",
        headers,
        body: JSON.stringify({ domain, draft_value, test_query: query }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Test failed");
      setTestResult((prev) => ({ ...prev, [compositeKey]: data.response }));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Test failed");
    } finally {
      setTesting(null);
    }
  };

  const handleDelete = async (domain: string, promptKey: string) => {
    const compositeKey = `${domain}::${promptKey}`;
    setDeleting(compositeKey);
    try {
      const res = await fetch(`/api/prompts/${domain}/${promptKey}`, { method: "DELETE", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Delete failed");
      toast.success("Prompt removed");
      setPrompts((prev) => { const next = { ...prev }; delete next[compositeKey]; return next; });
      setEdits((prev) => ({ ...prev, [compositeKey]: "" }));
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setDeleting(null);
    }
  };

  const handleApprove = async (draftId: number) => {
    setApprovingId(draftId);
    try {
      const res = await fetch(`/api/prompts/drafts/${draftId}/approve`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Approval failed");
      toast.success(data.message);
      fetchDrafts();
      fetchPrompts(activeDomain);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Approval failed");
    } finally {
      setApprovingId(null);
    }
  };

  const handleForceApprove = async (draftId: number) => {
    setForceApprovingId(draftId);
    try {
      const res = await fetch(`/api/prompts/drafts/${draftId}/force-approve`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Force approval failed");
      toast.success(data.message, { description: "Applied via test override." });
      fetchMyDrafts();
      fetchDrafts();
      fetchPrompts(activeDomain);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Force approval failed");
    } finally {
      setForceApprovingId(null);
    }
  };

  const handleReject = async (draftId: number) => {
    setApprovingId(draftId);
    try {
      const res = await fetch(`/api/prompts/drafts/${draftId}/reject`, { method: "POST", headers });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Rejection failed");
      toast.success("Draft rejected");
      fetchDrafts();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Rejection failed");
    } finally {
      setApprovingId(null);
    }
  };

  const handleSaveCompanyContext = async () => {
    setSavingCompany(true);
    try {
      const res = await fetch("/api/admin/company-settings", {
        method: "PUT",
        headers,
        body: JSON.stringify({ value: companyContextEdit }),
      });
      if (!res.ok) throw new Error("Save failed");
      setCompanyContext(companyContextEdit);
      toast.success("Company context saved — all assistants will use it from the next message.");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSavingCompany(false);
    }
  };

  const handleSuggestBody = async () => {
    if (!annTitle.trim()) { toast.error("Enter a title first"); return; }
    setSuggesting(true);
    try {
      const res = await fetch("/api/announcements/suggest", {
        method: "POST",
        headers,
        body: JSON.stringify({ title: annTitle, category: annCategory }),
      });
      if (!res.ok) throw new Error("Suggestion failed");
      const data = await res.json();
      setAnnBody(data.body);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Could not generate suggestion");
    } finally {
      setSuggesting(false);
    }
  };

  const handleCreateAnnouncement = async () => {
    if (!annTitle.trim() || !annBody.trim()) {
      toast.error("Title and body are required");
      return;
    }
    setSubmittingAnn(true);
    try {
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: annTitle,
          body: annBody,
          category: annCategory,
          created_by_domain: ROLE_TO_DOMAIN[role] ?? activeDomain,
          expires_days: annExpires ? parseInt(annExpires) : null,
          image_url: annImageUrl.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      toast.success("Announcement published — all users will be notified.");
      setAnnTitle("");
      setAnnBody("");
      setAnnImageUrl("");
      setSendEmail(false);
      fetchAnnouncements();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to publish");
    } finally {
      setSubmittingAnn(false);
    }
  };

  const openEdit = (ann: any) => {
    setEditingAnn(ann);
    setEditFields({ title: ann.title, body: ann.body, category: ann.category });
  };

  const handleUpdateAnnouncement = async () => {
    if (!editingAnn) return;
    setSavingEdit(true);
    try {
      const res = await fetch(`/api/announcements/${editingAnn.id}`, {
        method: "PUT",
        headers,
        body: JSON.stringify(editFields),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Update failed");
      toast.success("Announcement updated");
      setEditingAnn(null);
      fetchAnnouncements();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Update failed");
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDeactivateAnnouncement = async (id: number) => {
    try {
      const res = await fetch(`/api/announcements/${id}`, { method: "DELETE", headers });
      if (!res.ok) throw new Error("Failed");
      toast.success("Announcement removed");
      fetchAnnouncements();
    } catch {
      toast.error("Failed to remove announcement");
    }
  };

  if (!user || allowed.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <HelpCircle className="h-12 w-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-lg font-medium text-foreground">Access Restricted</p>
          <p className="text-sm text-muted-foreground mt-1">
            Prompt configuration is available for HR, IT, PMO, and Admin roles.
          </p>
        </div>
      </div>
    );
  }

  const activeDomainMeta = ALL_DOMAINS.find((d) => d.id === activeDomain);
  const visibleDomains = ALL_DOMAINS.filter((d) => allowed.includes(d.id));
  const domainDrafts = pendingDrafts.filter((d) => allowed.includes(d.domain));

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">Configuration</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Manage prompts and announcements for your domain.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {domainDrafts.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                <Clock className="h-3 w-3" />
                {domainDrafts.length} pending approval
              </span>
            )}
            <div className="flex items-center gap-1 rounded-xl border border-[var(--border)] bg-card p-1">
              <button
                onClick={() => setTab("prompts")}
                className={cn("rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all", tab === "prompts" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}
              >
                Prompts
              </button>
              <button
                onClick={() => setTab("announcements")}
                className={cn("rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all", tab === "announcements" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}
              >
                Announcements
              </button>
              {isAdmin && (
                <button
                  onClick={() => { setTab("company"); fetchCompanyContext(); }}
                  className={cn("rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all", tab === "company" ? "bg-primary text-white" : "text-muted-foreground hover:text-foreground")}
                >
                  Company
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Domain Sidebar — only show if admin (multiple domains) */}
        {isAdmin && (
          <aside className="w-48 shrink-0 border-r border-[var(--border)] p-4 space-y-1 overflow-y-auto">
            {visibleDomains.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDomain(d.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-medium text-left transition-all",
                  activeDomain === d.id
                    ? "bg-primary/10 text-primary"
                    : "text-muted-foreground hover:text-foreground hover:bg-[var(--muted)]",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full bg-current shrink-0", activeDomain === d.id ? "" : d.color)} />
                {d.label}
              </button>
            ))}
          </aside>
        )}

        {/* Main Area */}
        <main className="flex-1 overflow-y-auto">
          {tab === "prompts" ? (
            <div className="p-8 space-y-6 max-w-4xl">
              <div className="flex items-center gap-2 mb-2">
                <span className={cn("h-2.5 w-2.5 rounded-full", activeDomainMeta?.color?.replace("text-", "bg-"))} />
                <h2 className="text-[15px] font-semibold text-foreground">{activeDomainMeta?.label} Prompts</h2>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => { setShowAddForm((v) => !v); setNewKey(""); setNewValue(""); }}
                    className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-[12px] font-medium text-primary hover:bg-primary/20 transition-all"
                  >
                    <Save className="h-3.5 w-3.5" />
                    {showAddForm ? "Cancel" : "Add Prompt"}
                  </button>
                  <button
                    onClick={() => fetchPrompts(activeDomain)}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    Refresh
                  </button>
                </div>
              </div>

              {/* Add new prompt form */}
              {showAddForm && (
                <div className="rounded-2xl border border-primary/30 bg-primary/[0.03] p-5 space-y-3">
                  <p className="text-[13px] font-semibold text-foreground">New Prompt</p>
                  <div className="flex gap-2">
                    <input
                      value={newKey}
                      onChange={(e) => setNewKey(e.target.value)}
                      placeholder="Prompt key (e.g. onboarding_prompt)"
                      className="w-56 rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary/50"
                    />
                    <span className="text-[11px] text-muted-foreground self-center">Spaces will be converted to underscores</span>
                  </div>
                  <textarea
                    value={newValue}
                    onChange={(e) => setNewValue(e.target.value)}
                    placeholder="Enter prompt instructions..."
                    className="w-full min-h-[140px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[12px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/30"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={handleSaveNew}
                      disabled={savingNew || !newKey.trim() || !newValue.trim()}
                      className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-[12px] font-medium text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {savingNew ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {savingNew ? "Saving..." : isAdmin ? "Save" : "Submit for Approval"}
                    </button>
                  </div>
                </div>
              )}

              {loading ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              ) : (
                (() => {
                  const fetchedKeys = Object.keys(prompts)
                    .filter((k) => k.startsWith(`${activeDomain}::`))
                    .map((k) => k.slice(`${activeDomain}::`.length));
                  const allKeys = [...new Set(["system_prompt", "guardrail", ...fetchedKeys])];
                  return allKeys.map((key) => {
                  const compositeKey = `${activeDomain}::${key}`;
                  const label = promptLabel(key);
                  const description = promptDescription(key);
                  const row = prompts[compositeKey];
                  const currentEdit = edits[compositeKey] ?? "";
                  const isDirty = row ? currentEdit !== row.value : currentEdit.trim() !== "";
                  const isSaving = saving === compositeKey;
                  const isTesting = testing === compositeKey;
                  const isTestOpen = testOpen === compositeKey;

                  return (
                    <div key={key} className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-3">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-[13px] font-semibold text-foreground">{label}</p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {row && <span className="text-[10px] text-muted-foreground/60">v{row.version}</span>}
                          {isDirty ? (
                            <AlertCircle className="h-4 w-4 text-amber-500" />
                          ) : row ? (
                            <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                          ) : null}
                        </div>
                      </div>

                      <textarea
                        value={currentEdit}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [compositeKey]: e.target.value }))}
                        placeholder={`Enter ${label.toLowerCase()} instructions...`}
                        className="w-full min-h-[180px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[12px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/30"
                      />

                      {/* Test area — only useful when there's content */}
                      {currentEdit.trim() && (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setTestOpen(isTestOpen ? null : compositeKey)}
                            className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors"
                          >
                            <FlaskConical className="h-3.5 w-3.5" />
                            {isTestOpen ? "Hide test" : "Test this prompt"}
                          </button>
                        </div>
                      )}

                      {isTestOpen && (
                        <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-4 space-y-3">
                          <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-widest">Test sandbox — not saved</p>
                          <div className="flex gap-2">
                            <input
                              value={testQuery[compositeKey] ?? ""}
                              onChange={(e) => setTestQuery((prev) => ({ ...prev, [compositeKey]: e.target.value }))}
                              onKeyDown={(e) => { if (e.key === "Enter") handleTest(activeDomain, key); }}
                              placeholder="Type a test query and press Enter..."
                              className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                            />
                            <button
                              onClick={() => handleTest(activeDomain, key)}
                              disabled={isTesting}
                              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
                            >
                              {isTesting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                              Run
                            </button>
                          </div>
                          {testResult[compositeKey] && (
                            <div className="rounded-lg bg-background border border-[var(--border)] px-4 py-3 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                              {testResult[compositeKey]}
                            </div>
                          )}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          {row && (
                            <p className="text-[10px] text-muted-foreground/60">
                              v{row.version} · Updated {new Date(row.updated_at).toLocaleDateString()}
                            </p>
                          )}
                          {row && (
                            <button
                              onClick={() => handleDelete(activeDomain, key)}
                              disabled={deleting === compositeKey}
                              className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-rose-500 transition-colors disabled:opacity-50"
                              title="Remove prompt"
                            >
                              {deleting === compositeKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                              Remove
                            </button>
                          )}
                        </div>
                        <button
                          onClick={() => handleSave(activeDomain, key)}
                          disabled={!isDirty || isSaving || !currentEdit.trim()}
                          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-[12px] font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {isSaving ? "Saving..." : isAdmin ? "Save" : "Submit for Approval"}
                        </button>
                      </div>
                    </div>
                  );
                  });
                })()
              )}

              {/* My submitted drafts — test override section */}
              {myDrafts.filter((d) => allowed.includes(d.domain)).length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-amber-500" />
                    <h3 className="text-[14px] font-semibold text-foreground">My Submitted Drafts</h3>
                    <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      awaiting peer review
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    These drafts are waiting for a peer to approve. Use <strong>Force Approve</strong> to bypass peer review during testing.
                  </p>
                  {myDrafts
                    .filter((d) => allowed.includes(d.domain))
                    .map((draft) => {
                      const draftMeta = ALL_DOMAINS.find((d) => d.id === draft.domain);
                      return (
                        <div key={draft.id} className="rounded-2xl border border-amber-200/60 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/30 p-5 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", draftMeta?.color?.replace("text-", "bg-") + "/10", draftMeta?.color)}>
                                  {draftMeta?.label ?? draft.domain}
                                </span>
                                <span className="text-[11px] text-muted-foreground capitalize">{draft.key.replace("_", " ")}</span>
                              </div>
                              <p className="text-[11px] text-muted-foreground/70 mt-1">
                                Submitted on {new Date(draft.created_at).toLocaleString()}
                              </p>
                            </div>
                            <button
                              onClick={() => handleForceApprove(draft.id)}
                              disabled={forceApprovingId === draft.id}
                              className="flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-amber-600 disabled:opacity-50"
                            >
                              {forceApprovingId === draft.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
                              Force Approve (Test)
                            </button>
                          </div>
                          <pre className="rounded-lg bg-background border border-[var(--border)] px-4 py-3 text-[11px] font-mono text-foreground/70 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-40">
                            {draft.value}
                          </pre>
                        </div>
                      );
                    })}
                </div>
              )}

              {/* Pending approvals section */}
              {domainDrafts.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <Clock className="h-4 w-4 text-amber-500" />
                    <h3 className="text-[14px] font-semibold text-foreground">Pending Approvals</h3>
                    <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      {domainDrafts.length}
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    These prompt drafts were submitted by your colleagues and are waiting for your review. You can test each draft before approving.
                  </p>
                  {domainDrafts.map((draft) => {
                    const draftKey = `draft::${draft.id}`;
                    const draftMeta = ALL_DOMAINS.find((d) => d.id === draft.domain);
                    return (
                      <div key={draft.id} className="rounded-2xl border border-amber-200/40 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-950/20 p-5 space-y-3">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span className={cn("text-[11px] font-semibold px-2 py-0.5 rounded-full", draftMeta?.color?.replace("text-", "bg-") + "/10", draftMeta?.color)}>
                                {draftMeta?.label ?? draft.domain}
                              </span>
                              <span className="text-[11px] text-muted-foreground capitalize">{draft.key.replace("_", " ")}</span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/70 mt-1">
                              Submitted by <strong>{draft.submitted_by}</strong> on {new Date(draft.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleApprove(draft.id)}
                              disabled={approvingId === draft.id}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                              {approvingId === draft.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ThumbsUp className="h-3.5 w-3.5" />}
                              Approve
                            </button>
                            <button
                              onClick={() => handleReject(draft.id)}
                              disabled={approvingId === draft.id}
                              className="flex items-center gap-1.5 rounded-lg border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/30 px-3 py-1.5 text-[12px] font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-100 dark:hover:bg-rose-900/40 disabled:opacity-50"
                            >
                              <ThumbsDown className="h-3.5 w-3.5" />
                              Reject
                            </button>
                          </div>
                        </div>

                        <pre className="rounded-lg bg-background border border-[var(--border)] px-4 py-3 text-[11px] font-mono text-foreground/70 leading-relaxed overflow-x-auto whitespace-pre-wrap max-h-40">
                          {draft.value}
                        </pre>

                        {/* Test draft before approving */}
                        <div className="space-y-2">
                          <button
                            onClick={() => setTestOpen(testOpen === draftKey ? null : draftKey)}
                            className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors"
                          >
                            <FlaskConical className="h-3.5 w-3.5" />
                            {testOpen === draftKey ? "Hide test" : "Test before approving"}
                          </button>
                          {testOpen === draftKey && (
                            <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-4 space-y-3">
                              <div className="flex gap-2">
                                <input
                                  value={testQuery[draftKey] ?? ""}
                                  onChange={(e) => setTestQuery((prev) => ({ ...prev, [draftKey]: e.target.value }))}
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setTesting(draftKey);
                                      fetch("/api/prompts/test", {
                                        method: "POST",
                                        headers,
                                        body: JSON.stringify({ domain: draft.domain, draft_value: draft.value, test_query: testQuery[draftKey] }),
                                      })
                                        .then((r) => r.json())
                                        .then((d) => setTestResult((p) => ({ ...p, [draftKey]: d.response })))
                                        .catch(() => toast.error("Test failed"))
                                        .finally(() => setTesting(null));
                                    }
                                  }}
                                  placeholder="Type a test query and press Enter..."
                                  className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                                />
                                <button
                                  disabled={testing === draftKey}
                                  onClick={() => {
                                    setTesting(draftKey);
                                    fetch("/api/prompts/test", {
                                      method: "POST",
                                      headers,
                                      body: JSON.stringify({ domain: draft.domain, draft_value: draft.value, test_query: testQuery[draftKey] }),
                                    })
                                      .then((r) => r.json())
                                      .then((d) => setTestResult((p) => ({ ...p, [draftKey]: d.response })))
                                      .catch(() => toast.error("Test failed"))
                                      .finally(() => setTesting(null));
                                  }}
                                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
                                >
                                  {testing === draftKey ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                                  Run
                                </button>
                              </div>
                              {testResult[draftKey] && (
                                <div className="rounded-lg bg-background border border-[var(--border)] px-4 py-3 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                                  {testResult[draftKey]}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          ) : tab === "company" ? (
            /* ── Company Context Tab ──────────────────────────────────── */
            <div className="p-8 space-y-6 max-w-3xl">
              <div className="rounded-2xl border border-[var(--border)] bg-card p-6 space-y-4">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">Company Context</h3>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    This text is prepended to every assistant's system prompt. Use it to describe what your company does, where it is located, and any general facts the AI should always know.
                  </p>
                </div>
                {loadingCompany ? (
                  <div className="flex items-center justify-center py-12">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : (
                  <textarea
                    value={companyContextEdit}
                    onChange={(e) => setCompanyContextEdit(e.target.value)}
                    placeholder={"Example:\nAligned Automation is a B2B SaaS company headquartered in Pune, India.\nWe build enterprise AI tools for HR, IT, and operations teams.\nOur main product is Centriq AI, an internal assistant platform."}
                    className="w-full min-h-[260px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/30"
                  />
                )}
                <div className="flex items-center justify-between">
                  <p className="text-[11px] text-muted-foreground/60">
                    {companyContextEdit.length > 0 ? `${companyContextEdit.length} characters` : "Empty — no context injected"}
                  </p>
                  <div className="flex items-center gap-2">
                    {companyContextEdit !== companyContext && (
                      <button
                        onClick={() => setCompanyContextEdit(companyContext)}
                        className="text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
                      >
                        Discard
                      </button>
                    )}
                    <button
                      onClick={handleSaveCompanyContext}
                      disabled={savingCompany || companyContextEdit === companyContext}
                      className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-[12px] font-medium text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    >
                      {savingCompany ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      {savingCompany ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Announcements Tab ──────────────────────────────────── */
            <div className="p-8 space-y-8 max-w-3xl">
              {/* Create announcement */}
              <div className="rounded-2xl border border-[var(--border)] bg-card p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Megaphone className="h-5 w-5 text-primary" />
                  <h3 className="text-[15px] font-semibold text-foreground">New Announcement</h3>
                </div>
                <p className="text-[12px] text-muted-foreground">
                  Published announcements appear instantly in the notification bell for all users.
                </p>

                <div className="space-y-3">
                  <input
                    value={annTitle}
                    onChange={(e) => setAnnTitle(e.target.value)}
                    placeholder="Title"
                    className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-2.5 text-[14px] text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5"
                  />
                  <div className="relative">
                    <textarea
                      value={annBody}
                      onChange={(e) => setAnnBody(e.target.value)}
                      placeholder="Announcement body..."
                      rows={4}
                      className="w-full resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 pr-28 text-[13px] text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5"
                    />
                    <button
                      onClick={handleSuggestBody}
                      disabled={suggesting || !annTitle.trim()}
                      title="Suggest body from title"
                      className="absolute right-3 top-3 flex items-center gap-1 rounded-lg bg-violet-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-violet-500 hover:bg-violet-500/20 disabled:opacity-40 transition-colors"
                    >
                      {suggesting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                      Suggest
                    </button>
                  </div>

                  {/* Image URL */}
                  <div className="flex items-center gap-2">
                    <Image className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <input
                      type="url"
                      value={annImageUrl}
                      onChange={(e) => setAnnImageUrl(e.target.value)}
                      placeholder="Image URL (optional) — paste a link to an image"
                      className="flex-1 rounded-xl border border-[var(--border)] bg-background px-4 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                  {annImageUrl.trim() && (
                    <img
                      src={annImageUrl.trim()}
                      alt="Preview"
                      className="h-28 w-auto rounded-xl object-cover border border-[var(--border)]"
                      onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                    />
                  )}

                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">Category</label>
                      <select
                        value={annCategory}
                        onChange={(e) => setAnnCategory(e.target.value)}
                        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none"
                      >
                        {ANNOUNCEMENT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div className="w-36 space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">Expires (days)</label>
                      <input
                        type="number"
                        value={annExpires}
                        onChange={(e) => setAnnExpires(e.target.value)}
                        placeholder="Never"
                        min={1}
                        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none"
                      />
                    </div>
                  </div>

                  {/* Email toggle */}
                  <div className="flex items-center gap-3 rounded-xl border border-[var(--border)] bg-background px-4 py-3">
                    <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
                    <div className="flex-1">
                      <p className="text-[13px] font-medium text-foreground">Also send email to all staff</p>
                      <p className="text-[11px] text-muted-foreground">Sends the same content as an email notification</p>
                    </div>
                    <button
                      onClick={() => setSendEmail((v) => !v)}
                      className={cn(
                        "relative h-5 w-9 rounded-full transition-colors",
                        sendEmail ? "bg-primary" : "bg-muted-foreground/30",
                      )}
                    >
                      <span className={cn("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform", sendEmail ? "translate-x-4" : "translate-x-0.5")} />
                    </button>
                  </div>

                  {sendEmail && (
                    <div className="rounded-xl border border-[var(--border)] bg-background px-4 py-4 space-y-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">Email preview</p>
                      <div className="space-y-1">
                        <p className="text-[12px] text-muted-foreground">To:</p>
                        <input
                          value={emailTo}
                          onChange={(e) => setEmailTo(e.target.value)}
                          className="w-full rounded-lg border border-[var(--border)] bg-card px-3 py-1.5 text-[13px] text-foreground outline-none"
                        />
                      </div>
                      <div className="space-y-1">
                        <p className="text-[12px] text-muted-foreground">Subject:</p>
                        <p className="text-[13px] text-foreground/80 border border-[var(--border)] rounded-lg px-3 py-1.5 bg-card">
                          {annTitle || "(announcement title)"}
                        </p>
                      </div>
                      <div className="space-y-1">
                        <p className="text-[12px] text-muted-foreground">Body:</p>
                        <p className="text-[13px] text-foreground/70 border border-[var(--border)] rounded-lg px-3 py-2 bg-card whitespace-pre-wrap">
                          {annBody || "(announcement body)"}
                        </p>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleCreateAnnouncement}
                    disabled={submittingAnn || !annTitle.trim() || !annBody.trim()}
                    className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {submittingAnn ? <Loader2 className="h-4 w-4 animate-spin" /> : <Megaphone className="h-4 w-4" />}
                    {submittingAnn ? "Publishing..." : "Publish Announcement"}
                  </button>
                </div>
              </div>

              {/* Existing announcements */}
              {announcements.filter((a) => a.is_active && (isAdmin || a.created_by_domain === activeDomain)).length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-[14px] font-semibold text-foreground">Active Announcements</h3>
                  {announcements
                    .filter((a) => a.is_active && (isAdmin || a.created_by_domain === activeDomain))
                    .map((a) => (
                      <AnnouncementCard
                        key={a.id}
                        ann={a}
                        onEdit={() => openEdit(a)}
                        onRemove={() => handleDeactivateAnnouncement(a.id)}
                      />
                    ))}
                </div>
              )}

              {/* Edit dialog */}
              <Dialog open={!!editingAnn} onOpenChange={(open) => !open && setEditingAnn(null)}>
                <DialogContent className="sm:max-w-lg">
                  <DialogHeader>
                    <DialogTitle>Edit Announcement</DialogTitle>
                  </DialogHeader>
                  <div className="space-y-3 py-2">
                    <input
                      value={editFields.title}
                      onChange={(e) => setEditFields((p) => ({ ...p, title: e.target.value }))}
                      placeholder="Title"
                      className="w-full rounded-xl border border-[var(--border)] bg-background px-4 py-2.5 text-[14px] text-foreground outline-none focus:border-primary/50"
                    />
                    <textarea
                      value={editFields.body}
                      onChange={(e) => setEditFields((p) => ({ ...p, body: e.target.value }))}
                      rows={6}
                      className="w-full resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] text-foreground outline-none focus:border-primary/50"
                    />
                    <select
                      value={editFields.category}
                      onChange={(e) => setEditFields((p) => ({ ...p, category: e.target.value }))}
                      className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none"
                    >
                      {ANNOUNCEMENT_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setEditingAnn(null)}>Cancel</Button>
                    <Button onClick={handleUpdateAnnouncement} disabled={savingEdit || !editFields.title.trim() || !editFields.body.trim()}>
                      {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                      Save Changes
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

function AnnouncementCard({
  ann,
  onEdit,
  onRemove,
}: {
  ann: any;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
      <div className="flex items-start gap-3 p-4">
        <div className="flex-1 min-w-0 space-y-1">
          <p className="text-[13px] font-semibold text-foreground">{ann.title}</p>
          <p className={cn("text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap", !expanded && "line-clamp-2")}>
            {ann.body}
          </p>
          {ann.body.length > 120 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="text-[11px] font-medium text-primary hover:underline"
            >
              {expanded ? "Show less" : "Read more"}
            </button>
          )}
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[10px] font-medium text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5">{ann.category}</span>
            <span className="text-[10px] text-muted-foreground/40">·</span>
            <span className="text-[10px] text-muted-foreground/60">{new Date(ann.created_at).toLocaleDateString()}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Edit"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          <button
            onClick={onRemove}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
            title="Remove"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
