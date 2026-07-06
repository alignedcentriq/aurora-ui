import { useState, useEffect, useRef } from "react";
import {
  FileText,
  CheckCircle2,
  Loader2,
  ImagePlus,
  X,
  Type,
  AlignLeft,
  Calendar,
  ChevronDown,
  Hash,
  Mail,
  CheckSquare,
  User,
  Image as ImageIcon,
} from "lucide-react";
import { motion } from "framer-motion";
import type { DynamicFormData, DynamicFormField } from "@/lib/chat-store";

// Small visual cue shown beside each field label, hinting at the kind of input expected.
const FIELD_ICON: Record<DynamicFormField["type"], React.ElementType> = {
  text: Type,
  textarea: AlignLeft,
  date: Calendar,
  select: ChevronDown,
  number: Hash,
  email: Mail,
  checkbox: CheckSquare,
  user: User,
  image: ImageIcon,
};

/** Unified field label: type icon + label + required/optional marker. */
function FieldLabel({ field, prefilled }: { field: DynamicFormField; prefilled?: boolean }) {
  const Icon = FIELD_ICON[field.type] ?? Type;
  return (
    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground/80">
      <Icon className="h-3.5 w-3.5 text-muted-foreground/70" />
      <span>{field.label}</span>
      {field.required ? (
        <span className="text-destructive">*</span>
      ) : (
        <span className="font-normal text-muted-foreground/50">(optional)</span>
      )}
      {prefilled && (
        <span className="ml-auto inline-flex items-center gap-1 rounded-full border border-primary/20 bg-primary/5 px-1.5 py-0.5 text-[9px] font-semibold text-primary/80">
          <CheckCircle2 className="h-2.5 w-2.5" /> from your profile
        </span>
      )}
    </label>
  );
}

interface Props {
  data: DynamicFormData;
  userEmail: string;
  userRole?: string;
  onSubmitted: (message: string) => void;
}

const inputClass =
  "w-full rounded-xl border border-border/70 bg-background/80 px-3.5 py-2.5 text-sm text-foreground outline-none transition-all placeholder:text-muted-foreground/50 hover:border-border focus:border-primary/40 focus:ring-4 focus:ring-primary/10";

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
        const res = await fetch(
          `/api/employees/autocomplete?q=${encodeURIComponent(query)}&limit=8`,
          {
            headers: {
              ...(userEmail ? { "x-user-email": userEmail } : {}),
              ...(userRole ? { "x-user-role": userRole.toLowerCase() } : {}),
            },
          },
        );
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
                  {emp.designation ? `${emp.designation} · ` : ""}
                  {emp.email}
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ImageUploadField({
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
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setError("");
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/forms/upload-image", {
        method: "POST",
        headers: {
          ...(userEmail ? { "x-user-email": userEmail } : {}),
          ...(userRole ? { "x-user-role": userRole.toLowerCase() } : {}),
        },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.detail || "Upload failed.");
      onChange(data.url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  };

  const clear = () => {
    onChange("");
    setError("");
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div>
      <FieldLabel field={field} />
      {value ? (
        <div className="relative inline-block">
          <img
            src={value}
            alt="Uploaded"
            className="h-32 w-auto rounded-xl border border-border object-cover"
          />
          <button
            type="button"
            onClick={clear}
            className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-destructive text-white shadow"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground transition-colors hover:bg-muted/50 disabled:opacity-50"
        >
          {uploading ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <ImagePlus className="h-4 w-4" />
          )}
          {uploading ? "Uploading…" : field.placeholder || "Choose image…"}
        </button>
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={handleFile}
      />
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
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
  // Seed identity-bound fields the backend resolved from the user's profile — they only confirm.
  const [values, setValues] = useState<Record<string, string | boolean>>(() => ({
    ...(data.prefill || {}),
  }));
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const setField = (name: string, val: string | boolean) =>
    setValues((prev) => ({ ...prev, [name]: val }));

  const hasPrefill = Boolean(data.prefill && Object.keys(data.prefill).length > 0);
  // A field shows its "from your profile" badge only while it still holds the seeded value;
  // once the user edits it, the badge clears, signalling it's now their own input.
  const isPrefilled = (f: DynamicFormField) =>
    Boolean(data.prefill && f.name in data.prefill && values[f.name] === data.prefill[f.name]);

  const missingRequired = (data.fields || []).some((f) => {
    if (!f.required) return false;
    const v = values[f.name];
    return v === undefined || v === "" || v === false;
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (missingRequired || submitting || submitted) return;
    setSubmitting(true);
    try {
      // Connector-backed forms invoke a Connector Studio operation; others use the forms endpoint.
      const connector = data.submit_target?.kind === "connector" ? data.submit_target : null;
      const endpoint = connector ? "/api/connectors/invoke" : data.submit_endpoint || "/api/forms/submit";
      const payload = connector
        ? { operation_id: connector.operation_id, args: values }
        : { form_template_id: data.template_id, field_values: values };
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(userEmail ? { "x-user-email": userEmail } : {}),
          ...(userRole ? { "x-user-role": userRole.toLowerCase() } : {}),
        },
        body: JSON.stringify(payload),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(result.detail || "Submission failed.");
      setSubmitted(true);
      onSubmitted(result.message || result.text || "Your request has been submitted.");
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
        transition={{ type: "spring", stiffness: 300, damping: 24 }}
        className="mt-3 flex items-center gap-3 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 dark:border-emerald-800 dark:bg-emerald-950/20"
      >
        <motion.span
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: "spring", stiffness: 400, damping: 18, delay: 0.1 }}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        >
          <CheckCircle2 className="h-4.5 w-4.5" />
        </motion.span>
        <div className="min-w-0">
          <p className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">
            {data.name} submitted
          </p>
          <p className="text-[11px] text-emerald-700/70 dark:text-emerald-400/70">
            You can track it under My Requests.
          </p>
        </div>
      </motion.div>
    );
  }

  const renderField = (f: DynamicFormField) => {
    const v = values[f.name];
    if (f.type === "image") {
      return (
        <ImageUploadField
          field={f}
          value={(v as string) || ""}
          onChange={(val) => setField(f.name, val)}
          userEmail={userEmail}
          userRole={userRole}
        />
      );
    }
    if (f.type === "user") {
      return (
        <div>
          <FieldLabel field={f} prefilled={isPrefilled(f)} />
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

    const labelEl = <FieldLabel field={f} prefilled={isPrefilled(f)} />;

    if (f.type === "checkbox") {
      return (
        <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-border/70 bg-background/50 px-3.5 py-2.5 text-sm text-foreground transition-colors hover:border-border has-[:checked]:border-primary/40 has-[:checked]:bg-primary/5">
          <input
            type="checkbox"
            checked={Boolean(v)}
            onChange={(e) => setField(f.name, e.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          <span className="font-medium">{f.label}</span>
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
          <div className="relative">
            <select
              value={(v as string) || ""}
              onChange={(e) => setField(f.name, e.target.value)}
              className={`${inputClass} cursor-pointer appearance-none pr-9`}
            >
              <option value="">Select…</option>
              {(f.options || []).map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground/60" />
          </div>
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

  const fields = data.fields || [];
  const requiredFields = fields.filter((f) => f.required);
  const filledRequired = requiredFields.filter((f) => {
    const v = values[f.name];
    return v !== undefined && v !== "" && v !== false;
  }).length;
  // Long-form inputs get the full row; short ones pair up in two columns.
  const isWide = (f: DynamicFormField) =>
    f.type === "textarea" || f.type === "image" || f.type === "checkbox";

  return (
    <motion.form
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      onSubmit={handleSubmit}
      className="mt-3 max-w-2xl overflow-hidden rounded-2xl border border-border/70 bg-card shadow-lg shadow-primary/[0.04]"
    >
      <div className="border-b border-border/60 bg-gradient-to-r from-primary/10 via-primary/[0.04] to-transparent px-4 py-3">
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <FileText className="h-4 w-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-foreground">{data.name}</p>
            {data.description && (
              <p className="truncate text-[11px] text-muted-foreground">{data.description}</p>
            )}
          </div>
          {requiredFields.length > 0 && (
            <span className="shrink-0 rounded-full border border-border/60 bg-background/70 px-2.5 py-1 text-[10px] font-semibold text-muted-foreground">
              {filledRequired}/{requiredFields.length} required
            </span>
          )}
        </div>
        {requiredFields.length > 0 && (
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-border/50">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: `${(filledRequired / requiredFields.length) * 100}%` }}
              transition={{ type: "spring", stiffness: 200, damping: 25 }}
            />
          </div>
        )}
      </div>

      <div className="p-4">
        {hasPrefill && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-primary/15 bg-primary/[0.04] px-3.5 py-2.5 text-[11px] text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-primary/70" />
            <span>
              We pre-filled some fields from your profile — just confirm or edit them before
              submitting.
            </span>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={isWide(f) ? "sm:col-span-2" : ""}>
              {renderField(f)}
            </div>
          ))}
        </div>

        <div className="mt-5 flex items-center justify-between gap-3 border-t border-border/50 pt-3.5">
          <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            {missingRequired ? (
              "Fill the required fields marked with * to submit."
            ) : (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                <span>All set — ready to submit.</span>
              </>
            )}
          </p>
          <motion.button
            type="submit"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.97 }}
            disabled={submitting || missingRequired}
            className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-white shadow-md shadow-primary/25 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
              </>
            ) : (
              "Submit"
            )}
          </motion.button>
        </div>
      </div>
    </motion.form>
  );
}
