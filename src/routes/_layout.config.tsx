import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback } from "react";
import {
  Save,
  HelpCircle,
  RefreshCw,
  ChevronDown,
  CheckCircle2,
  AlertCircle,
  Loader2,
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

const DOMAINS = [
  { id: "hr", label: "HR", color: "text-emerald-500" },
  { id: "admin", label: "Admin", color: "text-amber-500" },
  { id: "it_support", label: "IT Support", color: "text-blue-500" },
  { id: "pmo", label: "PMO", color: "text-violet-500" },
  { id: "functional_manager", label: "Manager", color: "text-indigo-500" },
];

const PROMPT_KEYS = [
  { key: "system_prompt", label: "System Prompt", description: "Core instructions and persona for this agent domain." },
  { key: "guardrail", label: "Guardrail", description: "Anti-hallucination and scope constraints appended after the system prompt." },
];

function ConfigPage() {
  const { user } = useAuth();
  const [activeDomain, setActiveDomain] = useState("hr");
  const [prompts, setPrompts] = useState<Record<string, PromptRow>>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);

  const fetchPrompts = useCallback(async (domain: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/prompts/${domain}`);
      if (!res.ok) throw new Error("Failed to load");
      const data: PromptRow[] = await res.json();
      const map: Record<string, PromptRow> = {};
      data.forEach((row) => { map[row.key] = row; });
      setPrompts((prev) => ({ ...prev, ...Object.fromEntries(Object.entries(map).map(([k, v]) => [`${domain}::${k}`, v])) }));
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
  }, []);

  useEffect(() => {
    fetchPrompts(activeDomain);
  }, [activeDomain, fetchPrompts]);

  const handleSave = async (domain: string, promptKey: string) => {
    const compositeKey = `${domain}::${promptKey}`;
    const value = edits[compositeKey];
    if (!value?.trim()) { toast.error("Prompt cannot be empty"); return; }

    setSaving(compositeKey);
    try {
      const res = await fetch(`/api/prompts/${domain}/${promptKey}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value,
          updated_by: user?.email || "admin",
          user_role: roleForDomain(domain, user?.role),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Update failed");
      toast.success("Saved successfully");
      await fetchPrompts(domain);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(null);
    }
  };

  if (!user || user.role === "Employee" || user.role === "Functional Manager") {
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

  const activeMeta = DOMAINS.find((d) => d.id === activeDomain);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="sticky top-0 z-10 border-b border-[var(--border)] bg-background/80 backdrop-blur-xl px-8 py-5">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-foreground tracking-tight">
              Prompt Configuration
            </h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Edit live agent system prompts and guardrails — changes take effect immediately.
            </p>
          </div>
          <button
            onClick={() => fetchPrompts(activeDomain)}
            disabled={loading}
            className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-card px-4 py-2.5 text-[13px] font-medium text-foreground transition-all hover:bg-[var(--muted)] disabled:opacity-50"
          >
            <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Domain Sidebar */}
        <aside className="w-48 shrink-0 border-r border-[var(--border)] p-4 space-y-1">
          {DOMAINS.map((d) => (
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

        {/* Editor Area */}
        <main className="flex-1 overflow-y-auto p-8 space-y-6">
          <div className="flex items-center gap-2 mb-6">
            <span className={cn("h-2.5 w-2.5 rounded-full", activeMeta?.color?.replace("text-", "bg-"))} />
            <h2 className="text-[15px] font-semibold text-foreground">{activeMeta?.label} Agent</h2>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            PROMPT_KEYS.map(({ key, label, description }) => {
              const compositeKey = `${activeDomain}::${key}`;
              const row = prompts[compositeKey];
              const currentEdit = edits[compositeKey] ?? "";
              const isDirty = row ? currentEdit !== row.value : currentEdit !== "";
              const isSaving = saving === compositeKey;

              return (
                <div key={key} className="rounded-2xl border border-[var(--border)] bg-card p-5 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-[13px] font-semibold text-foreground">{label}</p>
                      <p className="text-[11px] text-muted-foreground mt-0.5">{description}</p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {row && (
                        <span className="text-[10px] text-muted-foreground/60">v{row.version}</span>
                      )}
                      {isDirty ? (
                        <AlertCircle className="h-4 w-4 text-amber-500" />
                      ) : row ? (
                        <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                      ) : null}
                    </div>
                  </div>

                  {row ? (
                    <>
                      <textarea
                        value={currentEdit}
                        onChange={(e) => setEdits((prev) => ({ ...prev, [compositeKey]: e.target.value }))}
                        className="w-full min-h-[180px] resize-y rounded-xl border border-[var(--border)] bg-background px-4 py-3 text-[12px] font-mono leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-4 focus:ring-primary/5 placeholder:text-muted-foreground/40"
                      />
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] text-muted-foreground/60">
                          Updated {new Date(row.updated_at).toLocaleDateString()}
                        </p>
                        <button
                          onClick={() => handleSave(activeDomain, key)}
                          disabled={!isDirty || isSaving}
                          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-[12px] font-medium text-white transition-all hover:bg-primary/90 disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          {isSaving ? "Saving..." : "Save Changes"}
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-dashed border-[var(--border)] bg-[var(--muted)]/30 px-4 py-6 text-center">
                      <ChevronDown className="h-4 w-4 text-muted-foreground/40 mx-auto mb-2" />
                      <p className="text-[11px] text-muted-foreground/60">
                        No custom {label.toLowerCase()} configured — agent is using its hardcoded default.
                      </p>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </main>
      </div>
    </div>
  );
}

function roleForDomain(domain: string, userRole: string | undefined): string {
  const map: Record<string, string> = {
    hr: "hr_manager",
    admin: "admin_manager",
    it_support: "it_manager",
    pmo: "pmo_manager",
    functional_manager: "manager",
  };
  return map[domain] ?? userRole ?? "admin";
}
