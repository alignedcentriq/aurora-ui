import { useState, useEffect } from "react";
import { FileText, CheckCircle2, Loader2 } from "lucide-react";
import { motion } from "framer-motion";
import type { DynamicFormData, DynamicFormField } from "@/lib/chat-store";

interface Props {
  data: DynamicFormData;
  userEmail: string;
  userRole?: string;
  onSubmitted: (message: string) => void;
}

const inputClass =
  "w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow";

interface EmployeeMatch {
  id: number;
  name: string;
  email: string;
  designation: string;
  department: string;
}

function UserPickerField({
  field,
  value,
  onChange,
  userEmail,
  userRole,
}: {
  field: DynamicFormField;
  value: string;
  onChange: (val: string) => void;
  userEmail: string;
  userRole?: string;
}) {
  const [query, setQuery] = useState(value || "");
  const [results, setResults] = useState<EmployeeMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    if (!value && query) setQuery("");
  }, [value]);

  useEffect(() => {
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/employees/autocomplete?q=${encodeURIComponent(query)}&limit=8`, {
          headers: {
            ...(userEmail ? { "x-user-email": userEmail } : {}),
            ...(userRole ? { "x-user-role": userRole.toLowerCase() } : {}),
          },
        });
        const data = await res.json();
        setResults(Array.isArray(data) ? data : []);
        setOpen(true);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [query]);

  const select = (emp: EmployeeMatch) => {
    setQuery(emp.name);
    onChange(emp.name);
    setOpen(false);
    setResults([]);
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (!e.target.value) onChange("");
          }}
          placeholder={field.placeholder || "Search by name…"}
          className={inputClass}
          onFocus={() => results.length > 0 && setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          autoComplete="off"
        />
        {searching && (
          <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 animate-spin text-muted-foreground pointer-events-none" />
        )}
      </div>
      {open && results.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-xl border border-border bg-background shadow-lg overflow-hidden max-h-48 overflow-y-auto">
          {results.map((emp) => (
            <button
              key={emp.id}
              type="button"
              className="w-full text-left px-3 py-2.5 hover:bg-muted/60 transition-colors border-b border-border/40 last:border-0 flex flex-col gap-0.5"
              onMouseDown={() => select(emp)}
            >
              <span className="text-sm font-medium text-foreground">{emp.name}</span>
              {(emp.designation || emp.email) && (
                <span className="text-[11px] text-muted-foreground">
                  {emp.designation ? `${emp.designation} · ` : ""}{emp.email}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Generic renderer for an admin-defined Form Library form. Renders inputs from `data.fields`,
 * validates required fields client-side, and POSTs {form_template_id, field_values} to the
 * form's submit endpoint. Adding a new form needs no new component — this widget renders any
 * schema the backend sends.
 */
export function DynamicFormWidget({ data, userEmail, userRole, onSubmitted }: Props) {
  const [values, setValues] = useState<Record<string, string | boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const setField = (name: string, val: string | boolean) =>
    setValues((prev) => ({ ...prev, [name]: val }));

  const missingRequired = (data.fields || []).some((f) => {
    if (!f.required) return false;
    const v = values[f.name];
    return v === undefined || v === "" || v === false;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(data.submit_endpoint || "/api/forms/submit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userEmail ? { "x-user-email": userEmail } : {}),
          ...(userRole ? { "x-user-role": userRole.toLowerCase() } : {}),
        },
        body: JSON.stringify({
          form_template_id: data.template_id,
          field_values: values,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.detail || "Submission failed.");
      setSubmitted(true);
      onSubmitted(result.message || "Your request has been submitted.");
    } catch (err) {
      onSubmitted(err instanceof Error ? err.message : "Failed to submit. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400"
      >
        <CheckCircle2 className="h-4 w-4 shrink-0" />
        Submitted successfully.
      </motion.div>
    );
  }

  const renderField = (f: DynamicFormField) => {
    const v = values[f.name];
    if (f.type === "user") {
      return (
        <div>
          <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
            {f.label}
            {f.required ? (
              <span className="text-destructive"> *</span>
            ) : (
              <span className="text-muted-foreground/60"> (optional)</span>
            )}
          </label>
          <UserPickerField
            field={f}
            value={(v as string) || ""}
            onChange={(val) => setField(f.name, val)}
            userEmail={userEmail}
            userRole={userRole}
          />
        </div>
      );
    }

    const labelEl = (
      <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">
        {f.label}
        {f.required ? (
          <span className="text-destructive"> *</span>
        ) : (
          <span className="text-muted-foreground/60"> (optional)</span>
        )}
      </label>
    );

    if (f.type === "checkbox") {
      return (
        <label className="flex items-center gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => setField(f.name, e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          {f.label}
          {f.required && <span className="text-destructive">*</span>}
        </label>
      );
    }

    if (f.type === "textarea") {
      return (
        <div>
          {labelEl}
          <textarea
            value={(v as string) || ""}
            onChange={(e) => setField(f.name, e.target.value)}
            placeholder={f.placeholder}
            rows={3}
            className={inputClass}
          />
        </div>
      );
    }

    if (f.type === "select") {
      return (
        <div>
          {labelEl}
          <select
            value={(v as string) || ""}
            onChange={(e) => setField(f.name, e.target.value)}
            className={inputClass}
          >
            <option value="">Select…</option>
            {(f.options || []).map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
      );
    }

    const htmlType =
      f.type === "number"
        ? "number"
        : f.type === "email"
          ? "email"
          : f.type === "date"
            ? "date"
            : "text";
    return (
      <div>
        {labelEl}
        <input
          type={htmlType}
          value={(v as string) || ""}
          onChange={(e) => setField(f.name, e.target.value)}
          placeholder={f.placeholder}
          className={inputClass}
        />
      </div>
    );
  };

  return (
    <motion.form
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onSubmit={handleSubmit}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <FileText className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {data.name}
        </span>
      </div>

      <div className="space-y-4 p-4">
        {(data.fields || []).map((f) => (
          <div key={f.name}>{renderField(f)}</div>
        ))}

        <div className="flex justify-end pt-1">
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            disabled={submitting || missingRequired}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Submitting…" : "Submit"}
          </motion.button>
        </div>
      </div>
    </motion.form>
  );
}
