import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Award,
  Star,
  Trash2,
  Plus,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Upload,
  FileText,
  Paperclip,
} from "lucide-react";
import { flyBanner } from "@/lib/fly-banner";
import type { SkillsEditorPrefill } from "@/lib/chat-store";
import { DatePicker } from "@/components/ui/date-picker";

// ── Types ───────────────────────────────────────────────────────────────────

interface Skill {
  id: number;
  skill: string;
  certification: string;
  is_primary: boolean;
  years_experience: number | null;
  last_used: string | null; // YYYY-MM-DD
  has_cert_file: boolean;
  cert_file_name: string;
}

interface Props {
  userEmail: string;
  userRole: string;
  prefill?: SkillsEditorPrefill;
  onSaved: (message: string) => void;
}

const SKILL_SUGGESTIONS = [
  "Python",
  "AWS",
  "Azure",
  "Project Management",
  "Scrum",
  "Kubernetes",
  "Data Analysis",
  "Machine Learning",
  "Java",
  "React",
  "SQL",
  "DevOps",
  "Cybersecurity",
  "Salesforce",
  "Networking",
  "TypeScript",
  "Node.js",
  "Power BI",
];

const inputCls =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow";
const labelCls = "mb-1 block text-[11px] font-semibold text-muted-foreground";

// ── Component ─────────────────────────────────────────────────────────────────

export function SkillsEditorWidget({ userEmail, userRole, prefill, onSaved }: Props) {
  const auth = useMemo(
    () => ({ "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() }),
    [userEmail, userRole],
  );

  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/employees/me/skills", { headers: auth });
      if (!res.ok) throw new Error("Couldn't load your skills.");
      const data = await res.json();
      setSkills(data.skills ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setLoading(false);
    }
  }, [auth]);

  useEffect(() => {
    load();
  }, [load]);

  // ── Add new skill ────────────────────────────────────────────────────────
  const [newSkill, setNewSkill] = useState(prefill?.skill ?? "");
  const [newCert, setNewCert] = useState("");
  const [newYears, setNewYears] = useState("");
  const [newLastUsed, setNewLastUsed] = useState("");
  const [newPrimary, setNewPrimary] = useState(false);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);
  const addFileRef = useRef<HTMLInputElement>(null);

  const resetAddForm = () => {
    setNewSkill("");
    setNewCert("");
    setNewYears("");
    setNewLastUsed("");
    setNewPrimary(false);
    setNewFile(null);
    if (addFileRef.current) addFileRef.current.value = "";
  };

  const validateFile = (f: File): string | null => {
    const ok = f.type.startsWith("image/") || f.type === "application/pdf";
    if (!ok) return "Certification must be an image or PDF.";
    if (f.size > 10 * 1024 * 1024) return "File must be 10 MB or smaller.";
    return null;
  };

  const addSkill = async () => {
    if (!newSkill.trim()) return;
    if (newFile) {
      const err = validateFile(newFile);
      if (err) {
        setError(err);
        return;
      }
    }
    setAdding(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("skill", newSkill.trim());
      if (newCert.trim()) fd.append("certification", newCert.trim());
      if (newYears.trim()) fd.append("years_experience", newYears.trim());
      if (newLastUsed) fd.append("last_used", newLastUsed);
      fd.append("is_primary", String(newPrimary));
      if (newFile) fd.append("cert_file", newFile);

      const res = await fetch("/api/employees/me/skills", {
        method: "POST",
        headers: auth, // no Content-Type — browser sets multipart boundary
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "Couldn't add skill.");
      flyBanner(`${newSkill.trim()} added to your skills`);
      resetAddForm();
      await load();
      onSaved(`Added "${newSkill.trim()}" to your skills profile.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add skill.");
    } finally {
      setAdding(false);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Award className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          My Skills &amp; Certifications
        </span>
      </div>

      <div className="space-y-4 p-4">
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* Existing skills */}
        {loading ? (
          <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> Loading your skills…
          </div>
        ) : skills.length === 0 ? (
          <p className="text-sm text-muted-foreground">No skills yet — add your first one below.</p>
        ) : (
          <div className="space-y-2.5">
            <AnimatePresence initial={false}>
              {skills.map((s) => (
                <SkillCard
                  key={s.id}
                  skill={s}
                  auth={auth}
                  onChanged={load}
                  onError={setError}
                  validateFile={validateFile}
                />
              ))}
            </AnimatePresence>
          </div>
        )}

        {/* Add new skill */}
        <div className="rounded-xl border border-dashed border-border bg-muted/20 p-3.5">
          <p className="mb-2.5 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            <Plus className="h-3 w-3" /> Add a skill
          </p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className={labelCls}>Skill</label>
              <input
                list="skill-suggestions"
                value={newSkill}
                onChange={(e) => setNewSkill(e.target.value)}
                placeholder="e.g. Python, Project Management"
                className={inputCls}
              />
              <datalist id="skill-suggestions">
                {SKILL_SUGGESTIONS.map((s) => (
                  <option key={s} value={s} />
                ))}
              </datalist>
            </div>
            <div>
              <label className={labelCls}>Years of experience</label>
              <input
                type="number"
                min="0"
                step="0.5"
                value={newYears}
                onChange={(e) => setNewYears(e.target.value)}
                placeholder="e.g. 3"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Last used</label>
              <DatePicker value={newLastUsed} onChange={setNewLastUsed} toDate={new Date()} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Certification name (optional)</label>
              <input
                value={newCert}
                onChange={(e) => setNewCert(e.target.value)}
                placeholder="e.g. AWS Certified Solutions Architect"
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2 flex flex-wrap items-center gap-3">
              <input
                ref={addFileRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={(e) => setNewFile(e.target.files?.[0] ?? null)}
                className="hidden"
                id="new-cert-file"
              />
              <button
                type="button"
                onClick={() => addFileRef.current?.click()}
                className="flex items-center gap-2 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
              >
                <Paperclip className="h-3.5 w-3.5" />
                {newFile ? "Change file" : "Attach certificate (image/PDF)"}
              </button>
              {newFile && (
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <FileText className="h-3.5 w-3.5" /> {newFile.name}
                </span>
              )}
              <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={newPrimary}
                  onChange={(e) => setNewPrimary(e.target.checked)}
                  className="accent-primary"
                />
                Set as primary skill
              </label>
            </div>
          </div>
          <button
            type="button"
            onClick={addSkill}
            disabled={adding || !newSkill.trim()}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2.5 text-sm font-semibold text-primary transition-all hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add skill
          </button>
        </div>
      </div>
    </motion.div>
  );
}

// ── Single skill card (inline edit / primary / cert file / delete) ─────────────

function SkillCard({
  skill,
  auth,
  onChanged,
  onError,
  validateFile,
}: {
  skill: Skill;
  auth: Record<string, string>;
  onChanged: () => Promise<void>;
  onError: (msg: string | null) => void;
  validateFile: (f: File) => string | null;
}) {
  const [years, setYears] = useState(skill.years_experience?.toString() ?? "");
  const [lastUsed, setLastUsed] = useState(skill.last_used ?? "");
  const [cert, setCert] = useState(skill.certification ?? "");
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const dirty =
    years !== (skill.years_experience?.toString() ?? "") ||
    lastUsed !== (skill.last_used ?? "") ||
    cert !== (skill.certification ?? "");

  const patch = async (fd: FormData, successMsg?: string) => {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/employees/me/skills/${skill.id}`, {
        method: "PATCH",
        headers: auth,
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail ?? "Couldn't save changes.");
      if (successMsg) flyBanner(successMsg);
      setSavedTick(true);
      setTimeout(() => setSavedTick(false), 1500);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't save changes.");
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = () => {
    const fd = new FormData();
    fd.append("years_experience", years.trim());
    fd.append("last_used", lastUsed);
    fd.append("certification", cert.trim());
    patch(fd);
  };

  const uploadFile = (f: File) => {
    const err = validateFile(f);
    if (err) {
      onError(err);
      return;
    }
    const fd = new FormData();
    fd.append("cert_file", f);
    patch(fd, `Certificate attached to ${skill.skill}`);
  };

  const makePrimary = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/employees/me/skills/${skill.id}/primary`, {
        method: "POST",
        headers: auth,
      });
      if (!res.ok) throw new Error("Couldn't set primary skill.");
      flyBanner(`${skill.skill} is now your primary skill`);
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't set primary skill.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    onError(null);
    try {
      const res = await fetch(`/api/employees/me/skills/${skill.id}`, {
        method: "DELETE",
        headers: auth,
      });
      if (!res.ok) throw new Error("Couldn't remove skill.");
      await onChanged();
    } catch (e) {
      onError(e instanceof Error ? e.message : "Couldn't remove skill.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden rounded-xl border border-border bg-background/60 p-3.5"
    >
      <div className="mb-2.5 flex items-center gap-2">
        <button
          type="button"
          onClick={makePrimary}
          disabled={busy || skill.is_primary}
          title={skill.is_primary ? "Primary skill" : "Set as primary skill"}
          className={
            skill.is_primary ? "text-amber-500" : "text-muted-foreground/40 hover:text-amber-500"
          }
        >
          <Star className="h-4 w-4" fill={skill.is_primary ? "currentColor" : "none"} />
        </button>
        <span className="text-sm font-semibold text-foreground">{skill.skill}</span>
        {skill.is_primary && (
          <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-600 dark:text-amber-400">
            Primary
          </span>
        )}
        <button
          type="button"
          onClick={remove}
          disabled={busy}
          title="Remove skill"
          className="ml-auto text-muted-foreground/50 transition-colors hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
        <div>
          <label className={labelCls}>Years of experience</label>
          <input
            type="number"
            min="0"
            step="0.5"
            value={years}
            onChange={(e) => setYears(e.target.value)}
            className={inputCls}
          />
        </div>
        <div>
          <label className={labelCls}>Last used</label>
          <DatePicker value={lastUsed} onChange={setLastUsed} toDate={new Date()} />
        </div>
        <div className="sm:col-span-2">
          <label className={labelCls}>Certification name</label>
          <input
            value={cert}
            onChange={(e) => setCert(e.target.value)}
            placeholder="e.g. PMP – Project Management Professional"
            className={inputCls}
          />
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap items-center gap-2.5">
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadFile(f);
          }}
          className="hidden"
        />
        {skill.has_cert_file ? (
          <a
            href={`/api/employees/me/skills/${skill.id}/cert-file`}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <FileText className="h-3.5 w-3.5" />
            {skill.cert_file_name || "View certificate"}
          </a>
        ) : (
          <span className="text-xs text-muted-foreground/60">No certificate attached</span>
        )}
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={busy}
          className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted"
        >
          <Upload className="h-3 w-3" />
          {skill.has_cert_file ? "Replace" : "Attach"}
        </button>

        <AnimatePresence>
          {dirty && (
            <motion.button
              type="button"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={saveEdits}
              disabled={busy}
              className="ml-auto flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/8 px-3 py-1.5 text-xs font-semibold text-primary transition-colors hover:bg-primary/15 disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <CheckCircle2 className="h-3 w-3" />
              )}
              Save
            </motion.button>
          )}
        </AnimatePresence>
        {!dirty && savedTick && (
          <span className="ml-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400">
            <CheckCircle2 className="h-3.5 w-3.5" /> Saved
          </span>
        )}
        {!dirty && !savedTick && busy && (
          <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-primary" />
        )}
      </div>
    </motion.div>
  );
}
