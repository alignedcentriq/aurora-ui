import { useState } from "react";
import { Wand2, Trash2, Plus, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { FormBuilderDraft, DynamicFormField } from "@/lib/chat-store";

interface Props {
  draft: FormBuilderDraft;
  userEmail: string;
  userRole?: string;
  onCreated: (message: string, form?: { id: number; name: string }) => void;
}

// Friendly, human-readable names for each field type — the stored value stays lowercase,
// only the label shown to the admin is title-cased.
const FIELD_TYPES: { value: DynamicFormField["type"]; label: string }[] = [
  { value: "text", label: "Short Text" },
  { value: "textarea", label: "Long Text" },
  { value: "date", label: "Date" },
  { value: "select", label: "Dropdown" },
  { value: "number", label: "Number" },
  { value: "email", label: "Email" },
  { value: "checkbox", label: "Checkbox" },
  { value: "user", label: "User Picker" },
  { value: "image", label: "Image Upload" },
];

const inputClass =
  "w-full rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[13px] text-foreground outline-none transition-shadow focus:border-primary/40 focus:ring-2 focus:ring-primary/15";

function slugify(label: string, used: Set<string>): string {
  const base = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "field";
  let name = base;
  let n = 2;
  while (used.has(name)) name = `${base}_${n++}`;
  return name;
}

/**
 * Editable preview of an LLM-drafted Form Library template. The admin reviews/edits the
 * draft inline in chat and confirms — only then is the form actually created (and instantly
 * chat-discoverable via its embedding).
 */
export function FormBuilderWidget({ draft, userEmail, userRole, onCreated }: Props) {
  const [name, setName] = useState(draft.name);
  const [description, setDescription] = useState(draft.description);
  const [fields, setFields] = useState<DynamicFormField[]>(draft.fields);
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState(false);
  const [error, setError] = useState("");

  const updateField = (idx: number, patch: Partial<DynamicFormField>) =>
    setFields((prev) => prev.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const removeField = (idx: number) => setFields((prev) => prev.filter((_, i) => i !== idx));

  const addField = () => {
    const used = new Set(fields.map((f) => f.name));
    setFields((prev) => [
      ...prev,
      { name: slugify("new field", used), label: "New Field", type: "text", required: false },
    ]);
  };

  // An `id` on the draft means we're revising an existing form (PUT) rather than creating one (POST).
  const isEdit = typeof draft.id === "number";

  const handleCreate = async () => {
    if (creating || created) return;
    if (!name.trim() || fields.length === 0) {
      setError("Give the form a name and at least one field.");
      return;
    }
    setError("");
    setCreating(true);
    try {
      // Re-derive snake_case names from (possibly edited) labels so they stay unique.
      const used = new Set<string>();
      const cleanFields = fields.map((f) => {
        const fieldName = slugify(f.label || f.name, used);
        used.add(fieldName);
        const out: DynamicFormField = { ...f, name: fieldName, label: f.label.trim() || fieldName };
        if (out.type !== "select") delete out.options;
        return out;
      });
      const res = await fetch(
        isEdit ? `/api/admin/form-library/${draft.id}` : "/api/admin/form-library",
        {
          method: isEdit ? "PUT" : "POST",
          headers: {
            "Content-Type": "application/json",
            ...(userEmail ? { "X-User-Email": userEmail } : {}),
            ...(userRole ? { "X-User-Role": userRole.toLowerCase() } : {}),
          },
          credentials: "include",
          body: JSON.stringify({
            name: name.trim(),
            description: description.trim() || `${name.trim()} form`,
            category: draft.category || "General",
            fields: cleanFields,
          }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok)
        throw new Error(data.detail || `Failed to ${isEdit ? "update" : "create"} the form.`);
      setCreated(true);
      const savedId = isEdit ? (draft.id as number) : (data.id as number | undefined);
      onCreated(
        isEdit
          ? `Form **"${name.trim()}"** updated — it now has ${cleanFields.length} field(s). The changes are live in chat right away.`
          : `Form **"${name.trim()}"** is live in the Form Library with ${cleanFields.length} field(s). ` +
              "Employees can now open it just by asking for it in chat.",
        typeof savedId === "number" ? { id: savedId, name: name.trim() } : undefined,
      );
    } catch (err) {
      setError(
        err instanceof Error ? err.message : `Failed to ${isEdit ? "update" : "create"} the form.`,
      );
    } finally {
      setCreating(false);
    }
  };

  if (created) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        {isEdit ? "Form updated and live in the Form Library." : "Form created and live in the Form Library."}
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-lg"
    >
      <div className="flex items-center gap-2.5 border-b border-border/70 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/15 text-primary">
          <Wand2 className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold text-foreground">
            {isEdit ? "Form draft — review changes" : "Form draft — review & create"}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {isEdit
              ? "Tweak anything below, then save your changes."
              : "Edit anything below, then publish it to the Form Library."}
          </p>
        </div>
      </div>

      <div className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Form name
            </label>
            <input value={name} onChange={(e) => setName(e.target.value)} className={inputClass} />
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Description
            </label>
            <input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Fields ({fields.length})
          </p>
          {fields.map((f, idx) => (
            <div
              key={idx}
              className="group rounded-xl border border-border/60 bg-background/50 p-3 transition-colors hover:border-primary/30"
            >
              {/* Row 1: ordinal badge · label · remove */}
              <div className="flex items-center gap-2">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-muted text-[10px] font-bold text-muted-foreground">
                  {idx + 1}
                </span>
                <input
                  value={f.label}
                  onChange={(e) => updateField(idx, { label: e.target.value })}
                  className={`${inputClass} flex-1 font-medium`}
                  placeholder="Field label (e.g. Full Name)"
                />
                <button
                  type="button"
                  onClick={() => removeField(idx)}
                  className="rounded-lg p-1.5 text-muted-foreground/60 transition-colors hover:bg-rose-500/10 hover:text-rose-500"
                  title="Remove field"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Row 2: type select · required toggle */}
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-7">
                <div className="flex items-center gap-1.5">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground/70">
                    Type
                  </span>
                  <select
                    value={f.type}
                    onChange={(e) =>
                      updateField(idx, { type: e.target.value as DynamicFormField["type"] })
                    }
                    className="rounded-lg border border-border/70 bg-background px-2.5 py-1.5 text-[12px] font-medium text-foreground outline-none transition-shadow focus:border-primary/40 focus:ring-2 focus:ring-primary/15"
                  >
                    {FIELD_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                </div>
                <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-border/60 px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/30 has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5 has-[:checked]:text-foreground">
                  <input
                    type="checkbox"
                    checked={Boolean(f.required)}
                    onChange={(e) => updateField(idx, { required: e.target.checked })}
                    className="h-3.5 w-3.5 rounded border-border accent-primary"
                  />
                  Required
                </label>
              </div>

              {/* Row 3: options (dropdown only) */}
              {f.type === "select" && (
                <div className="mt-2 pl-7">
                  <input
                    value={(f.options || []).join(", ")}
                    onChange={(e) =>
                      updateField(idx, {
                        options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean),
                      })
                    }
                    className={`${inputClass} w-full`}
                    placeholder="Dropdown options, comma-separated (e.g. Small, Medium, Large)"
                  />
                </div>
              )}
            </div>
          ))}
          <button
            type="button"
            onClick={addField}
            className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border/70 py-2 text-[12px] font-semibold text-primary transition-colors hover:border-primary/40 hover:bg-primary/5"
          >
            <Plus className="h-3.5 w-3.5" /> Add field
          </button>
        </div>

        {error && <p className="text-xs text-destructive">{error}</p>}

        <div className="flex justify-end border-t border-border/50 pt-3">
          <motion.button
            type="button"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            onClick={handleCreate}
            disabled={creating}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {creating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> {isEdit ? "Saving…" : "Creating…"}
              </>
            ) : isEdit ? (
              "Save changes"
            ) : (
              "Create form"
            )}
          </motion.button>
        </div>
      </div>
    </motion.div>
  );
}
