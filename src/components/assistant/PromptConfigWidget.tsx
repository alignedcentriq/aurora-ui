import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { SlidersHorizontal, Loader2, Save, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { flyBanner } from "@/lib/fly-banner";
import type { PromptConfigPrefill } from "@/lib/chat-store";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DOMAINS = [
  { id: "hr", label: "HR" },
  { id: "admin", label: "Admin" },
  { id: "it_support", label: "IT Support" },
  { id: "pmo", label: "PMO" },
  { id: "functional_manager", label: "Manager" },
];

const PROMPT_KEYS = [
  { id: "system_prompt", label: "System Prompt" },
  { id: "guardrail", label: "Guardrail" },
];

interface Props {
  userEmail: string;
  userRole: string;
  prefill?: PromptConfigPrefill;
  onSaved: (message: string) => void;
}

export function PromptConfigWidget({ userEmail, userRole, prefill, onSaved }: Props) {
  const headers = useMemo(
    () => ({
      "Content-Type": "application/json",
      "x-user-email": userEmail,
      "x-user-role": userRole.toLowerCase(),
    }),
    [userEmail, userRole],
  );

  const [domain, setDomain] = useState(prefill?.domain ?? "hr");
  const [promptKey, setPromptKey] = useState(prefill?.promptKey ?? "system_prompt");
  const [value, setValue] = useState(prefill?.value ?? "");
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const save = async () => {
    if (!value.trim()) {
      toast.error("Prompt text is required");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/prompts/${domain}/${promptKey}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Save failed");

      const keyLabel = PROMPT_KEYS.find((k) => k.id === promptKey)?.label ?? promptKey;
      const domLabel = DOMAINS.find((d) => d.id === domain)?.label ?? domain;
      if (data.mode === "draft") {
        flyBanner("Submitted for peer approval");
        onSaved(
          `📝 Your change to the **${domLabel} ${keyLabel}** was submitted for peer approval.`,
        );
      } else {
        flyBanner(`${domLabel} ${keyLabel} updated`);
        onSaved(`✅ **${domLabel} ${keyLabel}** updated and live.`);
      }
      setDone(true);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  if (done) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className="mt-2 flex items-center gap-2 text-sm font-medium text-emerald-600 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Prompt configuration saved.
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/60 backdrop-blur-xl"
    >
      <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
        <SlidersHorizontal className="h-4 w-4 text-primary" />
        <span className="text-[13px] font-semibold text-foreground">Prompt Configuration</span>
      </div>

      <div className="space-y-3 p-4">
        <div className="flex gap-2">
          <div className="flex-1">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Domain
            </label>
            <Select value={domain} onValueChange={setDomain}>
              <SelectTrigger className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-muted/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 bg-card border-border rounded-xl shadow-xl z-50">
                {DOMAINS.map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex-1">
            <label className="mb-1.5 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Section
            </label>
            <Select value={promptKey} onValueChange={setPromptKey}>
              <SelectTrigger className="w-full h-[38px] rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-all hover:bg-muted/10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-h-60 bg-card border-border rounded-xl shadow-xl z-50">
                {PROMPT_KEYS.map((k) => (
                  <SelectItem key={k.id} value={k.id}>
                    {k.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Prompt text
          </label>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            rows={6}
            placeholder="Enter the instructions for this domain…"
            className="w-full resize-none rounded-xl border border-border bg-background px-3 py-2 text-sm leading-relaxed text-foreground outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
          />
        </div>

        <button
          onClick={save}
          disabled={saving}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/25 transition-all hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save configuration
        </button>
      </div>
    </motion.div>
  );
}
