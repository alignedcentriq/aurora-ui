import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useRef } from "react";
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
  Pencil,
  Plus,
  Send,
  ThumbsUp,
  ThumbsDown,
  Megaphone,
  Clock,
  X,
  Trash2,
  Search,
  UserPlus,
  Sparkles,
  Globe,
} from "lucide-react";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import { cn } from "@/lib/utils";
import {
  AnnouncementBodyEditor,
  type ImageAction,
} from "@/components/assistant/AnnouncementBodyEditor";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { ExportCsvButton } from "@/components/ui/ExportCsvButton";

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
  { id: "general", label: "General", color: "text-purple-500" },
];

const ROLE_DOMAINS: Record<string, string[]> = {
  hr: ["hr"],
  it: ["it_support"],
  pmo: ["pmo"],
  admin: ["admin"],
  "super admin": ["general"],
};

const ROLE_TO_DOMAIN: Record<string, string> = {
  hr: "hr",
  it: "it_support",
  pmo: "pmo",
  admin: "admin",
  functional_manager: "functional_manager",
  "super admin": "general",
};

const KNOWN_PROMPT_METADATA: Record<string, { label: string; description: string }> = {
  system_prompt: {
    label: "System Prompt",
    description: "Core instructions and persona for this domain.",
  },
  guardrail: {
    label: "Guardrail",
    description: "Anti-hallucination and scope constraints appended after the system prompt.",
  },
};

function promptLabel(key: string) {
  return (
    KNOWN_PROMPT_METADATA[key]?.label ??
    key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}
function promptDescription(key: string) {
  return KNOWN_PROMPT_METADATA[key]?.description ?? "";
}

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

export function ConfigPage() {
  const { user } = useAuth();
  const role = user?.role?.toLowerCase() ?? "";
  const allowed = userDomains(role);

  const [tab, setTab] = useState<"prompts" | "announcements" | "company">(
    role === "super admin" ? "company" : "prompts",
  );
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

  // Prompt table modal state
  const [editingPromptKey, setEditingPromptKey] = useState<string | null>(null);
  const [testModalKey, setTestModalKey] = useState<string | null>(null);
  const addModalBodyRef = useRef<HTMLDivElement>(null);

  // AI authoring (Describe-it draft + Refine-with-AI) — keyed by composite key ("domain::key")
  // or "new::add" for the Add-Prompt modal.
  const [aiInstruction, setAiInstruction] = useState<Record<string, string>>({});
  const [aiBusy, setAiBusy] = useState<string | null>(null);

  // Company context state
  const [companyContext, setCompanyContext] = useState("");
  const [companyContextEdit, setCompanyContextEdit] = useState("");
  const [loadingCompany, setLoadingCompany] = useState(false);
  const [savingCompany, setSavingCompany] = useState(false);
  // Pull-from-portal: auto-draft company context from the company website.
  const [companyWebsite, setCompanyWebsite] = useState("https://alignedautomation.com");
  const [pullingCompany, setPullingCompany] = useState(false);
  const [pullSources, setPullSources] = useState<string[]>([]);

  // Announcement state
  const [annTitle, setAnnTitle] = useState("");
  const [annBody, setAnnBody] = useState("");
  const [annCategory, setAnnCategory] = useState(
    DOMAIN_ANNOUNCEMENT_CATEGORY[activeDomain] ?? "General",
  );
  const [annExpires, setAnnExpires] = useState("");
  const [annAudienceRole, setAnnAudienceRole] = useState("all");
  const [annImageUrl, setAnnImageUrl] = useState<string | null>(null);
  const [annImageAction, setAnnImageAction] = useState<ImageAction | null>(null);
  const [recipientSearch, setRecipientSearch] = useState("");
  const [recipientResults, setRecipientResults] = useState<{ name: string; email: string }[]>([]);
  const [showRecipientDrop, setShowRecipientDrop] = useState(false);
  const [recipientTags, setRecipientTags] = useState<{ name: string; email: string }[]>([]);
  const recipientTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [submittingAnn, setSubmittingAnn] = useState(false);
  const [announcements, setAnnouncements] = useState<any[]>([]);
  const [editingAnn, setEditingAnn] = useState<any | null>(null);
  const [editFields, setEditFields] = useState({ title: "", body: "", category: "" });
  const [savingEdit, setSavingEdit] = useState(false);
  const [recallTarget, setRecallTarget] = useState<number | null>(null);

  const headers = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const isAdmin = role === "admin" || role === "super admin";

  const fetchPrompts = useCallback(
    async (domain: string) => {
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
          data.forEach((row) => {
            next[`${domain}::${row.key}`] = row.value;
          });
          return next;
        });
      } catch {
        toast.error("Failed to load prompts for " + domain);
      } finally {
        setLoading(false);
      }
    },
    [user?.email, user?.role],
  );

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
    } catch {
    } finally {
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
      if (role === "admin" || role === "super admin") fetchCompanyContext();
    }
  }, [role]);

  useEffect(() => {
    if (allowed.length === 0) return;
    fetchPrompts(activeDomain);
    setShowAddForm(false);
    setNewKey("");
    setNewValue("");
  }, [activeDomain]);

  const handleSave = async (domain: string, promptKey: string): Promise<boolean> => {
    const compositeKey = `${domain}::${promptKey}`;
    const value = edits[compositeKey];
    if (!value?.trim()) {
      toast.error("Prompt cannot be empty");
      return false;
    }

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
        flyBanner("Submitted for peer approval");
        fetchDrafts();
        fetchMyDrafts();
      } else {
        toast.success("Saved successfully");
        await fetchPrompts(domain);
      }
      return true;
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to save");
      return false;
    } finally {
      setSaving(null);
    }
  };

  const handleSaveNew = async () => {
    const key = newKey.trim().toLowerCase().replace(/\s+/g, "_");
    if (!key || !newValue.trim()) {
      toast.error("Key and value are required");
      return;
    }
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
        flyBanner("Submitted for peer approval");
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

  // AI-author or refine a prompt. `current` non-empty → refine; empty → draft fresh.
  // `apply` receives the generated text so callers can drop it into the right editor.
  const runAi = async (
    stateKey: string,
    domain: string,
    promptKey: string,
    current: string,
    apply: (value: string) => void,
  ) => {
    const instruction = (aiInstruction[stateKey] ?? "").trim();
    if (!instruction) {
      toast.error("Describe what this prompt should do");
      return;
    }
    setAiBusy(stateKey);
    try {
      const res = await fetch("/api/prompts/generate", {
        method: "POST",
        headers,
        body: JSON.stringify({ domain, prompt_key: promptKey, instruction, current }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Drafting failed");
      apply(data.value);
      setAiInstruction((p) => ({ ...p, [stateKey]: "" }));
      toast.success(data.mode === "refine" ? "Prompt refined" : "Prompt drafted — review and save");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Drafting failed");
    } finally {
      setAiBusy(null);
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
      setPrompts((prev) => {
        const next = { ...prev };
        delete next[compositeKey];
        return next;
      });
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
      const res = await fetch(`/api/prompts/drafts/${draftId}/approve`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Approval failed");
      flyBanner(data.message);
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
      const res = await fetch(`/api/prompts/drafts/${draftId}/force-approve`, {
        method: "POST",
        headers,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Force approval failed");
      flyBanner(data.message);
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

  const handlePullCompanyContext = async () => {
    setPullingCompany(true);
    setPullSources([]);
    try {
      const res = await fetch("/api/admin/company-settings/pull", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: companyWebsite.trim() || null }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Pull failed");
      setCompanyContextEdit(data.value);
      setPullSources(Array.isArray(data.sources) ? data.sources : []);
      toast.success("Pulled from company portal — review and save");
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Pull failed");
    } finally {
      setPullingCompany(false);
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
          headers,
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
    if (!annTitle.trim() || !annBody.trim()) {
      toast.error("Title and body are required");
      return;
    }
    setSubmittingAnn(true);
    try {
      const emailRecipients = recipientTags.length > 0 ? recipientTags.map((r) => r.email) : null;
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers,
        body: JSON.stringify({
          title: annTitle,
          body: annBody,
          category: annCategory,
          created_by_domain: ROLE_TO_DOMAIN[role] ?? activeDomain,
          target_audience: annAudienceRole,
          expires_days: annExpires ? parseInt(annExpires) : null,
          email_recipients: emailRecipients,
          image_url: annImageUrl ?? null,
          image_action: annImageAction ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Failed");
      toast.success("Announcement published — all users will be notified.");
      setAnnTitle("");
      setAnnBody("");
      setAnnAudienceRole("all");
      setAnnImageUrl(null);
      setAnnImageAction(null);
      setRecipientTags([]);
      setRecipientSearch("");
      setRecipientResults([]);
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

  const handleDeactivateAnnouncement = async (id: number, recall: boolean) => {
    try {
      const res = await fetch(`/api/announcements/${id}?recall=${recall}`, {
        method: "DELETE",
        headers,
      });
      if (!res.ok) throw new Error("Failed");
      toast.success(recall ? "Announcement removed and recall email sent" : "Announcement removed");
      setRecallTarget(null);
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
    <div className="flex h-full flex-col overflow-hidden bg-[#f5f7fa] dark:bg-background">
      {/* Header */}
      <div className="shrink-0 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card px-8 py-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.1em] text-[#00a29a] dark:text-[#00c4bb] mb-1">
              Assets & Config
            </p>
            <p className="text-[13px] text-[#64748b] dark:text-white/50 mt-0.5">
              Tune the prompts, announcements, and grounding sources that power your domain.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {domainDrafts.length > 0 && (
              <span className="flex items-center gap-1.5 rounded-full bg-amber-500/10 px-3 py-1 text-[12px] font-semibold text-amber-600 dark:text-amber-400">
                <Clock className="h-3 w-3" />
                {domainDrafts.length} pending approval
              </span>
            )}
            <div className="flex items-center gap-1 rounded-xl bg-slate-100 dark:bg-slate-900 border border-slate-200/50 dark:border-white/[0.04] p-1">
              <button
                onClick={() => setTab("prompts")}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all cursor-pointer",
                  tab === "prompts"
                    ? "bg-white dark:bg-slate-800 text-[#0f172a] dark:text-white shadow-sm font-semibold"
                    : "text-[#64748b] dark:text-white/50 hover:text-[#334155] dark:hover:text-white/80",
                )}
              >
                Prompts
              </button>
              <button
                onClick={() => setTab("announcements")}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all cursor-pointer",
                  tab === "announcements"
                    ? "bg-white dark:bg-slate-800 text-[#0f172a] dark:text-white shadow-sm font-semibold"
                    : "text-[#64748b] dark:text-white/50 hover:text-[#334155] dark:hover:text-white/80",
                )}
              >
                Announcements
              </button>
              {role === "super admin" && (
                <button
                  onClick={() => {
                    setTab("company");
                    fetchCompanyContext();
                  }}
                  className={cn(
                    "rounded-lg px-4 py-1.5 text-[13px] font-medium transition-all cursor-pointer",
                    tab === "company"
                      ? "bg-white dark:bg-slate-800 text-[#0f172a] dark:text-white shadow-sm font-semibold"
                      : "text-[#64748b] dark:text-white/50 hover:text-[#334155] dark:hover:text-white/80",
                  )}
                >
                  Company
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Domain Sidebar — only show when the role has access to multiple domains */}
        {visibleDomains.length > 1 && (
          <aside className="w-52 shrink-0 border-r border-[#e2e8f0] dark:border-white/[0.08] p-4 space-y-1 overflow-y-auto bg-white dark:bg-[#0a1628]">
            {visibleDomains.map((d) => (
              <button
                key={d.id}
                onClick={() => setActiveDomain(d.id)}
                className={cn(
                  "w-full flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-[13px] font-semibold text-left transition-all",
                  activeDomain === d.id
                    ? "bg-[#f0fdfa] dark:bg-[#00a29a]/10 text-[#00a29a] dark:text-[#00c4bb]"
                    : "text-[#64748b] dark:text-white/50 hover:text-[#334155] dark:hover:text-white/80 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.04]",
                )}
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full bg-current shrink-0",
                    activeDomain === d.id ? "" : d.color,
                  )}
                />
                {d.label} Prompts
              </button>
            ))}
          </aside>
        )}

        {/* Main Area */}
        <main className="flex-1 overflow-y-auto bg-[#f5f7fa] dark:bg-background">
          {tab === "prompts" ? (
            <div className="p-8 space-y-6">
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={cn(
                    "h-2.5 w-2.5 rounded-full",
                    activeDomainMeta?.color?.replace("text-", "bg-"),
                  )}
                />
                <h2 className="text-[15px] font-semibold text-foreground">
                  {activeDomainMeta?.label} Prompts
                </h2>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    onClick={() => {
                      setNewKey("");
                      setNewValue("");
                      setShowAddForm(true);
                    }}
                    className="flex items-center gap-1.5 rounded-full bg-[#00a29a] hover:bg-[#008f88] px-4 py-1.5 text-[12px] font-bold text-white transition-all shadow-sm"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add Prompt
                  </button>
                  <button
                    onClick={() => fetchPrompts(activeDomain)}
                    disabled={loading}
                    className="flex items-center gap-1.5 rounded-full border border-[#e2e8f0] dark:border-white/[0.1] bg-white dark:bg-card px-4 py-1.5 text-[12px] font-bold text-[#64748b] dark:text-white/60 hover:bg-[#f1f5f9] dark:hover:bg-white/[0.04] transition-all disabled:opacity-50"
                  >
                    <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
                    Refresh
                  </button>
                </div>
              </div>

              {loading ? (
                <div className="space-y-0 overflow-hidden rounded-2xl border border-border">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex items-center gap-4 px-4 py-3 border-b border-border last:border-0">
                      <Skeleton className="h-4 w-28" />
                      <Skeleton className="h-4 flex-1" />
                      <Skeleton className="h-7 w-16 rounded-lg" />
                    </div>
                  ))}
                </div>
              ) : (
                (() => {
                  const fetchedKeys = Object.keys(prompts)
                    .filter((k) => k.startsWith(`${activeDomain}::`))
                    .map((k) => k.slice(`${activeDomain}::`.length));
                  const allKeys = ["guardrail", ...fetchedKeys.filter((k) => k !== "guardrail")];
                  return (
                    <div className="rounded-2xl border border-[var(--border)] bg-card overflow-hidden">
                      <div className="flex justify-end p-2 pb-0">
                        <ExportCsvButton
                          rows={allKeys.map((key) => {
                            const compositeKey = `${activeDomain}::${key}`;
                            const row = prompts[compositeKey];
                            const currentEdit = edits[compositeKey] ?? "";
                            const isDirty = row ? currentEdit !== row.value : currentEdit.trim() !== "";
                            return {
                              Key: promptLabel(key),
                              "Key Slug": key,
                              Prompt: currentEdit.trim(),
                              Version: row ? row.version : "",
                              Updated: row ? new Date(row.updated_at).toLocaleDateString() : "",
                              Status: isDirty ? "Unsaved" : row ? "Saved" : "Empty",
                            };
                          })}
                          filename={`prompts-${activeDomain}.csv`}
                        />
                      </div>
                      <Table paginate itemsPerPage={10} className="w-full text-[13px]">
                        <TableHeader>
                          <TableRow className="border-b border-[var(--border)] bg-muted/30">
                            <TableHead className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-40">
                              Key
                            </TableHead>
                            <TableHead className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Prompt
                            </TableHead>
                            <TableHead className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-20">
                              Version
                            </TableHead>
                            <TableHead className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-28 hidden sm:table-cell">
                              Updated
                            </TableHead>
                            <TableHead className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-24">
                              Status
                            </TableHead>
                            <TableHead className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground w-28">
                              Actions
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody className="divide-y divide-[var(--border)]">
                          {allKeys.map((key) => {
                            const compositeKey = `${activeDomain}::${key}`;
                            const label = promptLabel(key);
                            const row = prompts[compositeKey];
                            const currentEdit = edits[compositeKey] ?? "";
                            const isDirty = row
                              ? currentEdit !== row.value
                              : currentEdit.trim() !== "";
                            const isDeleting = deleting === compositeKey;
                            return (
                              <TableRow key={key} className="hover:bg-muted/20 transition-colors">
                                <TableCell className="px-4 py-3.5">
                                  <p className="font-semibold text-foreground">{label}</p>
                                  <p className="text-[11px] text-muted-foreground/55 font-mono mt-0.5">
                                    {key}
                                  </p>
                                </TableCell>
                                <TableCell className="px-4 py-3.5 max-w-0 w-full">
                                  <p className="text-[12px] text-muted-foreground/80 truncate">
                                    {currentEdit.trim() || "—"}
                                  </p>
                                </TableCell>
                                <TableCell className="px-4 py-3.5">
                                  {row ? (
                                    <span className="text-[11px] text-muted-foreground/70 font-mono">
                                      v{row.version}
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground/40 italic">
                                      —
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="px-4 py-3.5 hidden sm:table-cell">
                                  <span className="text-[12px] text-muted-foreground/70">
                                    {row ? new Date(row.updated_at).toLocaleDateString() : "—"}
                                  </span>
                                </TableCell>
                                <TableCell className="px-4 py-3.5">
                                  {isDirty ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                                      <AlertCircle className="h-3.5 w-3.5" />
                                      Unsaved
                                    </span>
                                  ) : row ? (
                                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-500">
                                      <CheckCircle2 className="h-3.5 w-3.5" />
                                      Saved
                                    </span>
                                  ) : (
                                    <span className="text-[11px] text-muted-foreground/40 italic">
                                      Empty
                                    </span>
                                  )}
                                </TableCell>
                                <TableCell className="px-4 py-3.5">
                                  <div className="flex items-center justify-end gap-1">
                                    <button
                                      onClick={() => setEditingPromptKey(compositeKey)}
                                      className="rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                                      title="Edit"
                                    >
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      onClick={() => setTestModalKey(compositeKey)}
                                      disabled={!currentEdit.trim()}
                                      className="rounded-lg p-1.5 text-muted-foreground hover:text-violet-500 hover:bg-violet-500/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                                      title="Test"
                                    >
                                      <FlaskConical className="h-3.5 w-3.5" />
                                    </button>
                                    {row && (
                                      <button
                                        onClick={() => handleDelete(activeDomain, key)}
                                        disabled={isDeleting}
                                        className="rounded-lg p-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors disabled:opacity-50"
                                        title="Delete"
                                      >
                                        {isDeleting ? (
                                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        ) : (
                                          <Trash2 className="h-3.5 w-3.5" />
                                        )}
                                      </button>
                                    )}
                                  </div>
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  );
                })()
              )}

              {/* My submitted drafts — test override section */}
              {myDrafts.filter((d) => allowed.includes(d.domain)).length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    <FlaskConical className="h-4 w-4 text-amber-500" />
                    <h3 className="text-[14px] font-semibold text-foreground">
                      My Submitted Drafts
                    </h3>
                    <span className="ml-1 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                      awaiting peer review
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    These drafts are waiting for a peer to approve. Use{" "}
                    <strong>Force Approve</strong> to bypass peer review during testing.
                  </p>
                  {myDrafts
                    .filter((d) => allowed.includes(d.domain))
                    .map((draft) => {
                      const draftMeta = ALL_DOMAINS.find((d) => d.id === draft.domain);
                      return (
                        <div
                          key={draft.id}
                          className="rounded-2xl border border-amber-200/60 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-950/30 p-5 space-y-3"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span
                                  className={cn(
                                    "text-[11px] font-semibold px-2 py-0.5 rounded-full",
                                    draftMeta?.color?.replace("text-", "bg-") + "/10",
                                    draftMeta?.color,
                                  )}
                                >
                                  {draftMeta?.label ?? draft.domain}
                                </span>
                                <span className="text-[11px] text-muted-foreground capitalize">
                                  {draft.key.replace("_", " ")}
                                </span>
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
                              {forceApprovingId === draft.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <FlaskConical className="h-3.5 w-3.5" />
                              )}
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
                    These prompt drafts were submitted by your colleagues and are waiting for your
                    review. You can test each draft before approving.
                  </p>
                  {domainDrafts.map((draft) => {
                    const draftKey = `draft::${draft.id}`;
                    const draftMeta = ALL_DOMAINS.find((d) => d.id === draft.domain);
                    return (
                      <div
                        key={draft.id}
                        className="rounded-2xl border border-amber-200/40 dark:border-amber-500/20 bg-amber-50/30 dark:bg-amber-950/20 p-5 space-y-3"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "text-[11px] font-semibold px-2 py-0.5 rounded-full",
                                  draftMeta?.color?.replace("text-", "bg-") + "/10",
                                  draftMeta?.color,
                                )}
                              >
                                {draftMeta?.label ?? draft.domain}
                              </span>
                              <span className="text-[11px] text-muted-foreground capitalize">
                                {draft.key.replace("_", " ")}
                              </span>
                            </div>
                            <p className="text-[11px] text-muted-foreground/70 mt-1">
                              Submitted by <strong>{draft.submitted_by}</strong> on{" "}
                              {new Date(draft.created_at).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              onClick={() => handleApprove(draft.id)}
                              disabled={approvingId === draft.id}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-[12px] font-semibold text-white hover:bg-emerald-600 disabled:opacity-50"
                            >
                              {approvingId === draft.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <ThumbsUp className="h-3.5 w-3.5" />
                              )}
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
                                  onChange={(e) =>
                                    setTestQuery((prev) => ({
                                      ...prev,
                                      [draftKey]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") {
                                      setTesting(draftKey);
                                      fetch("/api/prompts/test", {
                                        method: "POST",
                                        headers,
                                        body: JSON.stringify({
                                          domain: draft.domain,
                                          draft_value: draft.value,
                                          test_query: testQuery[draftKey],
                                        }),
                                      })
                                        .then((r) => r.json())
                                        .then((d) =>
                                          setTestResult((p) => ({ ...p, [draftKey]: d.response })),
                                        )
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
                                      body: JSON.stringify({
                                        domain: draft.domain,
                                        draft_value: draft.value,
                                        test_query: testQuery[draftKey],
                                      }),
                                    })
                                      .then((r) => r.json())
                                      .then((d) =>
                                        setTestResult((p) => ({ ...p, [draftKey]: d.response })),
                                      )
                                      .catch(() => toast.error("Test failed"))
                                      .finally(() => setTesting(null));
                                  }}
                                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
                                >
                                  {testing === draftKey ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Send className="h-3.5 w-3.5" />
                                  )}
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
              {/* ── Add Prompt Modal ─────────────────────────────────── */}
              <Dialog
                open={showAddForm}
                onOpenChange={(open) => {
                  if (!open) {
                    setShowAddForm(false);
                    setTestOpen((p) => (p === "new::add" ? null : p));
                    setTestQuery((p) => {
                      const n = { ...p };
                      delete n["new::add"];
                      return n;
                    });
                    setTestResult((p) => {
                      const n = { ...p };
                      delete n["new::add"];
                      return n;
                    });
                  }
                }}
              >
                <DialogContent className="max-w-xl flex flex-col max-h-[90vh]">
                  <DialogHeader className="shrink-0">
                    <DialogTitle className="text-[15px] flex items-center gap-2">
                      <Plus className="h-4 w-4 text-primary" />
                      Add Prompt — {activeDomainMeta?.label}
                    </DialogTitle>
                  </DialogHeader>
                  <div ref={addModalBodyRef} className="space-y-4 py-1 overflow-y-auto flex-1 pr-1">
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                        Prompt Key
                      </label>
                      <input
                        value={newKey}
                        onChange={(e) => setNewKey(e.target.value)}
                        placeholder="e.g. onboarding_prompt"
                        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[12px] font-mono text-foreground outline-none focus:border-primary/50"
                      />
                      <p className="text-[11px] text-muted-foreground/60 mt-1">
                        Spaces will be converted to underscores
                      </p>
                    </div>
                    <div>
                      <label className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1.5 block">
                        Content
                      </label>
                      <textarea
                        value={newValue}
                        onChange={(e) => setNewValue(e.target.value)}
                        placeholder="Enter prompt instructions..."
                        className="w-full min-h-[160px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[12px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/30"
                      />
                    </div>

                    {/* AI authoring for the new prompt */}
                    <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-violet-500/[0.04] p-3.5 space-y-2.5">
                      <div className="flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                          {newValue.trim() ? "Refine with AI" : "Write with AI"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <input
                          value={aiInstruction["new::add"] ?? ""}
                          onChange={(e) =>
                            setAiInstruction((p) => ({ ...p, "new::add": e.target.value }))
                          }
                          onKeyDown={(e) => {
                            if (e.key === "Enter")
                              runAi(
                                "new::add",
                                activeDomain,
                                newKey.trim().toLowerCase().replace(/\s+/g, "_") || "system_prompt",
                                newValue,
                                setNewValue,
                              );
                          }}
                          placeholder={`Describe what this ${activeDomainMeta?.label} prompt should do…`}
                          className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                        />
                        <button
                          onClick={() =>
                            runAi(
                              "new::add",
                              activeDomain,
                              newKey.trim().toLowerCase().replace(/\s+/g, "_") || "system_prompt",
                              newValue,
                              setNewValue,
                            )
                          }
                          disabled={
                            aiBusy === "new::add" || !(aiInstruction["new::add"] ?? "").trim()
                          }
                          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50 shrink-0"
                        >
                          {aiBusy === "new::add" ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Sparkles className="h-3.5 w-3.5" />
                          )}
                          {newValue.trim() ? "Refine" : "Draft"}
                        </button>
                      </div>
                    </div>

                    {newValue.trim() && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setTestOpen(testOpen === "new::add" ? null : "new::add")}
                          className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-primary transition-colors"
                        >
                          <FlaskConical className="h-3.5 w-3.5" />
                          {testOpen === "new::add" ? "Hide test" : "Test this prompt"}
                        </button>
                      </div>
                    )}

                    {testOpen === "new::add" &&
                      (() => {
                        const runNewTest = () => {
                          const q = testQuery["new::add"] ?? "";
                          if (!q.trim()) return;
                          setTesting("new::add");
                          fetch("/api/prompts/test", {
                            method: "POST",
                            headers,
                            body: JSON.stringify({
                              domain: activeDomain,
                              draft_value: newValue,
                              test_query: q,
                            }),
                          })
                            .then((r) => r.json())
                            .then((d) => {
                              setTestResult((p) => ({ ...p, "new::add": d.response }));
                              setTimeout(() => {
                                if (addModalBodyRef.current) {
                                  addModalBodyRef.current.scrollTop =
                                    addModalBodyRef.current.scrollHeight;
                                }
                              }, 50);
                            })
                            .catch(() => toast.error("Test failed"))
                            .finally(() => setTesting(null));
                        };
                        return (
                          <div className="rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-4 space-y-3">
                            <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-widest">
                              Test sandbox — not saved
                            </p>
                            <div className="flex gap-2">
                              <input
                                value={testQuery["new::add"] ?? ""}
                                onChange={(e) =>
                                  setTestQuery((prev) => ({ ...prev, "new::add": e.target.value }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") runNewTest();
                                }}
                                placeholder="Type a test query and press Enter..."
                                className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                              />
                              <button
                                onClick={runNewTest}
                                disabled={
                                  testing === "new::add" || !(testQuery["new::add"] ?? "").trim()
                                }
                                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
                              >
                                {testing === "new::add" ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Send className="h-3.5 w-3.5" />
                                )}
                                Run
                              </button>
                            </div>
                            {testResult["new::add"] && (
                              <div className="rounded-lg bg-background border border-[var(--border)] px-4 py-3 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                                {testResult["new::add"]}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                  </div>
                  <DialogFooter className="gap-2 shrink-0">
                    <Button variant="outline" onClick={() => setShowAddForm(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleSaveNew}
                      disabled={savingNew || !newKey.trim() || !newValue.trim()}
                    >
                      {savingNew ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-1" />
                      ) : (
                        <Save className="h-4 w-4 mr-1" />
                      )}
                      {savingNew ? "Saving..." : isAdmin ? "Save" : "Submit for Approval"}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>

              {/* ── Edit Prompt Modal ─────────────────────────────────── */}
              {editingPromptKey &&
                (() => {
                  const compositeKey = editingPromptKey;
                  const key = compositeKey.includes("::")
                    ? compositeKey.slice(compositeKey.indexOf("::") + 2)
                    : compositeKey;
                  const label = promptLabel(key);
                  const description = promptDescription(key);
                  const row = prompts[compositeKey];
                  const currentEdit = edits[compositeKey] ?? "";
                  const isDirty = row ? currentEdit !== row.value : currentEdit.trim() !== "";
                  const isSaving = saving === compositeKey;
                  const isTesting = testing === compositeKey;
                  const isTestOpen = testOpen === compositeKey;
                  return (
                    <Dialog
                      open
                      onOpenChange={(open) => {
                        if (!open) {
                          setEditingPromptKey(null);
                          setTestOpen(null);
                        }
                      }}
                    >
                      <DialogContent className="max-w-2xl p-0 gap-0 overflow-hidden">
                        <DialogHeader className="sr-only">
                          <DialogTitle>{label}</DialogTitle>
                        </DialogHeader>

                        {/* Header — matches old card top row */}
                        <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-4 pr-12">
                          <div>
                            <p className="text-[13px] font-semibold text-foreground">{label}</p>
                            <p className="text-[11px] text-muted-foreground mt-0.5">
                              {description}
                            </p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {row && (
                              <span className="text-[10px] text-muted-foreground/60">
                                v{row.version}
                              </span>
                            )}
                            {isDirty ? (
                              <AlertCircle className="h-4 w-4 text-amber-500" />
                            ) : row ? (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            ) : null}
                          </div>
                        </div>

                        {/* Body */}
                        <div className="px-5 space-y-3 pb-4">
                          {/* AI authoring — describe it, AI drafts/refines the prompt */}
                          <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-violet-500/[0.04] p-3.5 space-y-2.5">
                            <div className="flex items-center gap-1.5">
                              <Sparkles className="h-3.5 w-3.5 text-primary" />
                              <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                                {currentEdit.trim() ? "Refine with AI" : "Write with AI"}
                              </span>
                            </div>
                            <div className="flex gap-2">
                              <input
                                value={aiInstruction[compositeKey] ?? ""}
                                onChange={(e) =>
                                  setAiInstruction((p) => ({
                                    ...p,
                                    [compositeKey]: e.target.value,
                                  }))
                                }
                                onKeyDown={(e) => {
                                  if (e.key === "Enter")
                                    runAi(compositeKey, activeDomain, key, currentEdit, (v) =>
                                      setEdits((prev) => ({ ...prev, [compositeKey]: v })),
                                    );
                                }}
                                placeholder={
                                  currentEdit.trim()
                                    ? "e.g. make it stricter about citing the source policy"
                                    : `Describe how the ${activeDomainMeta?.label} assistant should behave…`
                                }
                                className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                              />
                              <button
                                onClick={() =>
                                  runAi(compositeKey, activeDomain, key, currentEdit, (v) =>
                                    setEdits((prev) => ({ ...prev, [compositeKey]: v })),
                                  )
                                }
                                disabled={
                                  aiBusy === compositeKey ||
                                  !(aiInstruction[compositeKey] ?? "").trim()
                                }
                                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50 shrink-0"
                              >
                                {aiBusy === compositeKey ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Sparkles className="h-3.5 w-3.5" />
                                )}
                                {currentEdit.trim() ? "Refine" : "Draft"}
                              </button>
                            </div>
                          </div>

                          <textarea
                            value={currentEdit}
                            onChange={(e) =>
                              setEdits((prev) => ({ ...prev, [compositeKey]: e.target.value }))
                            }
                            placeholder={`Enter ${label.toLowerCase()} instructions...`}
                            className="w-full min-h-[200px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[12px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/30"
                          />

                          {key === "system_prompt" && (
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 bg-amber-500/5 border border-amber-500/20 rounded-lg px-3 py-2 leading-relaxed">
                              <strong>Append mode:</strong> Your text is added after the agent's
                              built-in instructions inside a{" "}
                              <code className="font-mono text-[10px]">[DOMAIN CONTEXT]</code> block.
                              To replace everything, start with{" "}
                              <code className="font-mono text-[10px]">[FULL REPLACE]</code>.
                            </p>
                          )}

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
                              <p className="text-[11px] font-semibold text-primary/70 uppercase tracking-widest">
                                Test sandbox — not saved
                              </p>
                              <div className="flex gap-2">
                                <input
                                  value={testQuery[compositeKey] ?? ""}
                                  onChange={(e) =>
                                    setTestQuery((prev) => ({
                                      ...prev,
                                      [compositeKey]: e.target.value,
                                    }))
                                  }
                                  onKeyDown={(e) => {
                                    if (e.key === "Enter") handleTest(activeDomain, key);
                                  }}
                                  placeholder="Type a test query and press Enter..."
                                  className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                                />
                                <button
                                  onClick={() => handleTest(activeDomain, key)}
                                  disabled={isTesting}
                                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
                                >
                                  {isTesting ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                  ) : (
                                    <Send className="h-3.5 w-3.5" />
                                  )}
                                  Run
                                </button>
                              </div>
                              {testResult[compositeKey] && (
                                <div className="rounded-lg bg-background border border-[var(--border)] px-4 py-3 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-40 overflow-y-auto">
                                  {testResult[compositeKey]}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Footer — matches old card bottom row */}
                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-t border-[var(--border)] px-5 py-4">
                          <div className="flex items-center gap-3">
                            {row && (
                              <p className="text-[10px] text-muted-foreground/60">
                                v{row.version} · Updated{" "}
                                {new Date(row.updated_at).toLocaleDateString()}
                              </p>
                            )}
                            {row && (
                              <button
                                onClick={() => {
                                  handleDelete(activeDomain, key);
                                  setEditingPromptKey(null);
                                }}
                                disabled={deleting === compositeKey}
                                className="flex items-center gap-1.5 text-[12px] font-medium text-muted-foreground hover:text-rose-500 transition-colors disabled:opacity-50"
                              >
                                {deleting === compositeKey ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="h-3.5 w-3.5" />
                                )}
                                Remove
                              </button>
                            )}
                          </div>
                          <button
                            onClick={async () => {
                              const ok = await handleSave(activeDomain, key);
                              if (ok) setEditingPromptKey(null);
                            }}
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
                      </DialogContent>
                    </Dialog>
                  );
                })()}

              {/* ── Test Prompt Modal ─────────────────────────────────── */}
              {testModalKey &&
                (() => {
                  const compositeKey = testModalKey;
                  const key = compositeKey.includes("::")
                    ? compositeKey.slice(compositeKey.indexOf("::") + 2)
                    : compositeKey;
                  const label = promptLabel(key);
                  const isTesting = testing === compositeKey;
                  return (
                    <Dialog
                      open
                      onOpenChange={(open) => {
                        if (!open) setTestModalKey(null);
                      }}
                    >
                      <DialogContent className="max-w-xl">
                        <DialogHeader>
                          <DialogTitle className="text-[15px] flex items-center gap-2">
                            <FlaskConical className="h-4 w-4 text-primary" />
                            Test — {label}
                          </DialogTitle>
                        </DialogHeader>
                        <div className="space-y-3 py-1">
                          <p className="text-[12px] text-muted-foreground">
                            Run a query against this prompt. Results reflect real chat behavior
                            including the guardrail.
                          </p>
                          <div className="flex gap-2">
                            <input
                              value={testQuery[compositeKey] ?? ""}
                              onChange={(e) =>
                                setTestQuery((prev) => ({
                                  ...prev,
                                  [compositeKey]: e.target.value,
                                }))
                              }
                              onKeyDown={(e) => {
                                if (e.key === "Enter") handleTest(activeDomain, key);
                              }}
                              placeholder="Type a test query and press Enter..."
                              className="flex-1 rounded-xl border border-[var(--border)] bg-background px-3 py-2.5 text-[13px] text-foreground outline-none focus:border-primary/40"
                            />
                            <Button
                              onClick={() => handleTest(activeDomain, key)}
                              disabled={isTesting || !(testQuery[compositeKey] ?? "").trim()}
                            >
                              {isTesting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Send className="h-4 w-4" />
                              )}
                              Run
                            </Button>
                          </div>
                          {testResult[compositeKey] && (
                            <div className="rounded-xl bg-muted/30 border border-[var(--border)] px-4 py-3 text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap max-h-64 overflow-y-auto">
                              {testResult[compositeKey]}
                            </div>
                          )}
                        </div>
                      </DialogContent>
                    </Dialog>
                  );
                })()}
            </div>
          ) : tab === "company" ? (
            /* ── Company Context Tab ──────────────────────────────────── */
            <div className="p-8 space-y-6">
              <div className="rounded-2xl border border-[var(--border)] bg-card p-6 space-y-4">
                <div>
                  <h3 className="text-[15px] font-semibold text-foreground">Company Context</h3>
                  <p className="text-[12px] text-muted-foreground mt-1">
                    This text is prepended to every assistant's system prompt. Use it to describe
                    what your company does, where it is located, and any general facts the AI should
                    always know.
                  </p>
                </div>

                {/* Pull from company portal — auto-draft the context from the website */}
                <div className="rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-violet-500/[0.04] p-4 space-y-2.5">
                  <div className="flex items-center gap-1.5">
                    <Globe className="h-3.5 w-3.5 text-primary" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-primary">
                      Pull from company portal
                    </span>
                  </div>
                  <p className="text-[12px] text-muted-foreground">
                    Fetch your company website and let AI distill a factual profile into the editor.
                    Review before saving.
                  </p>
                  <div className="flex gap-2">
                    <input
                      value={companyWebsite}
                      onChange={(e) => setCompanyWebsite(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !pullingCompany) handlePullCompanyContext();
                      }}
                      placeholder="https://alignedautomation.com"
                      className="flex-1 rounded-lg border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/40"
                    />
                    <button
                      onClick={handlePullCompanyContext}
                      disabled={pullingCompany}
                      className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-[12px] font-semibold text-white hover:bg-primary/90 disabled:opacity-50 shrink-0"
                    >
                      {pullingCompany ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5" />
                      )}
                      {pullingCompany ? "Pulling…" : "Pull & Draft"}
                    </button>
                  </div>
                  {pullSources.length > 0 && (
                    <p className="text-[11px] text-muted-foreground/70">
                      Sources: {pullSources.join(", ")}
                    </p>
                  )}
                </div>

                {loadingCompany ? (
                  <div className="space-y-2 py-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-5/6" />
                    <Skeleton className="h-4 w-4/5" />
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-3/4" />
                  </div>
                ) : (
                  <textarea
                    value={companyContextEdit}
                    onChange={(e) => setCompanyContextEdit(e.target.value)}
                    placeholder={
                      "Example:\nAligned Automation is a B2B SaaS company headquartered in Pune, India.\nWe build enterprise AI tools for HR, IT, and operations teams.\nOur main product is Centriq AI, an internal assistant platform."
                    }
                    className="w-full min-h-[260px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[13px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/30"
                  />
                )}
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <p className="text-[11px] text-muted-foreground/60">
                    {companyContextEdit.length > 0
                      ? `${companyContextEdit.length} characters`
                      : "Empty — no context injected"}
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
                      {savingCompany ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Save className="h-3.5 w-3.5" />
                      )}
                      {savingCompany ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          ) : (
            /* ── Announcements Tab ──────────────────────────────────── */
            <div className="p-8 space-y-8">
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
                  <AnnouncementBodyEditor
                    body={annBody}
                    onBodyChange={setAnnBody}
                    imageUrl={annImageUrl}
                    onImageUrlChange={setAnnImageUrl}
                    imageAction={annImageAction}
                    onImageActionChange={setAnnImageAction}
                    authHeaders={headers}
                    title={annTitle}
                    category={annCategory}
                    rows={8}
                  />

                  <div className="flex gap-3">
                    <div className="flex-1 space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        Category
                      </label>
                      <input
                        type="text"
                        value={annCategory}
                        onChange={(e) => setAnnCategory(e.target.value)}
                        placeholder="e.g. General, Holiday, IT Alert"
                        className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
                      />
                    </div>
                    <div className="w-36 space-y-1">
                      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                        Expires (days)
                      </label>
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

                  {/* Audience */}
                  <div className="space-y-2">
                    <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground/60">
                      Send to
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {[
                        { label: "All Staff", value: "all" },
                        { label: "HR", value: "hr" },
                        { label: "IT", value: "it" },
                        { label: "Admin", value: "admin" },
                        { label: "PMO", value: "pmo" },
                        { label: "Manager", value: "functional_manager" },
                        { label: "Employee", value: "employee" },
                      ].map((r) => (
                        <button
                          key={r.value}
                          type="button"
                          onClick={() => setAnnAudienceRole(r.value)}
                          className={cn(
                            "rounded-full px-3 py-1 text-[12px] font-medium border transition-colors",
                            annAudienceRole === r.value
                              ? "bg-primary text-white border-transparent"
                              : "border-[var(--border)] text-muted-foreground hover:border-primary/40",
                          )}
                        >
                          {r.label}
                        </button>
                      ))}
                    </div>
                    <div className="space-y-2">
                      {recipientTags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {recipientTags.map((r) => (
                            <span
                              key={r.email}
                              className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 text-[12px] text-foreground"
                            >
                              {r.name || r.email}
                              <button
                                onClick={() =>
                                  setRecipientTags((p) => p.filter((x) => x.email !== r.email))
                                }
                                className="text-muted-foreground hover:text-rose-500"
                              >
                                ×
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                        <input
                          type="text"
                          placeholder="Search people by name or email…"
                          value={recipientSearch}
                          onChange={(e) => handleRecipientSearch(e.target.value)}
                          onFocus={() => recipientSearch.length >= 2 && setShowRecipientDrop(true)}
                          onBlur={() => setTimeout(() => setShowRecipientDrop(false), 150)}
                          className="w-full pl-8 pr-3 rounded-xl border border-[var(--border)] bg-background py-1.5 text-[12px] text-foreground outline-none focus:border-primary/50"
                        />
                        {showRecipientDrop && recipientResults.length > 0 && (
                          <div className="absolute left-0 top-full mt-1 z-20 bg-background border border-[var(--border)] rounded-xl shadow-lg w-full max-h-44 overflow-y-auto">
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
                </div>

                <div className="flex justify-end">
                  <button
                    onClick={handleCreateAnnouncement}
                    disabled={submittingAnn || !annTitle.trim() || !annBody.trim()}
                    className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  >
                    {submittingAnn ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Megaphone className="h-4 w-4" />
                    )}
                    {submittingAnn ? "Publishing..." : "Publish Announcement"}
                  </button>
                </div>
              </div>

              {/* Existing announcements */}
              {announcements.filter(
                (a) => a.is_active && (isAdmin || a.created_by_domain === activeDomain),
              ).length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-[14px] font-semibold text-foreground">
                    Active Announcements
                  </h3>
                  {announcements
                    .filter((a) => a.is_active && (isAdmin || a.created_by_domain === activeDomain))
                    .map((a) => (
                      <AnnouncementCard
                        key={a.id}
                        ann={a}
                        onEdit={() => openEdit(a)}
                        onRemove={() => setRecallTarget(a.id)}
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
                    <input
                      type="text"
                      value={editFields.category}
                      onChange={(e) => setEditFields((p) => ({ ...p, category: e.target.value }))}
                      placeholder="e.g. General, Holiday, IT Alert"
                      className="w-full rounded-xl border border-[var(--border)] bg-background px-3 py-2 text-[13px] text-foreground outline-none focus:border-primary/50"
                    />
                  </div>
                  <DialogFooter className="gap-2">
                    <Button variant="outline" onClick={() => setEditingAnn(null)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleUpdateAnnouncement}
                      disabled={savingEdit || !editFields.title.trim() || !editFields.body.trim()}
                    >
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

      {/* Recall confirm dialog */}
      {recallTarget !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <div className="w-full max-w-sm mx-4 rounded-2xl border border-[var(--border)] bg-card p-6 shadow-2xl space-y-4">
            <p className="text-[15px] font-bold text-foreground">Delete Announcement</p>
            <p className="text-[13px] text-muted-foreground">
              Do you also want to recall the email sent to recipients? A retraction notice will be
              sent.
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => handleDeactivateAnnouncement(recallTarget, true)}
                className="w-full rounded-xl bg-rose-600 px-4 py-2.5 text-[13px] font-semibold text-white hover:bg-rose-700 transition-colors"
              >
                Delete &amp; Recall Email
              </button>
              <button
                onClick={() => handleDeactivateAnnouncement(recallTarget, false)}
                className="w-full rounded-xl border border-[var(--border)] px-4 py-2.5 text-[13px] font-medium text-foreground hover:bg-muted transition-colors"
              >
                Delete Only
              </button>
              <button
                onClick={() => setRecallTarget(null)}
                className="w-full rounded-xl px-4 py-2 text-[12px] font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
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
          <p
            className={cn(
              "text-[12px] text-muted-foreground leading-relaxed whitespace-pre-wrap",
              !expanded && "line-clamp-2",
            )}
          >
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
            <span className="text-[10px] font-medium text-muted-foreground/70 bg-muted/50 rounded px-1.5 py-0.5">
              {ann.category}
            </span>
            <span className="text-[10px] text-muted-foreground/40">·</span>
            <span className="text-[10px] text-muted-foreground/60">
              {new Date(ann.created_at).toLocaleDateString()}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={onEdit}
            className="rounded-lg p-1.5 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
            title="Edit"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
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
