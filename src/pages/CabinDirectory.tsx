import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/lib/auth-store";
import { toast } from "sonner";
import { Save, Building2, Loader2, RefreshCw, Plus, Trash2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

// Dept columns: key matches what the backend / CompanySettingsService reads
const DEPTS = [
  { key: "admin", label: "Admin", color: "text-blue-400" },
  { key: "hr",    label: "HR",    color: "text-emerald-400" },
  { key: "it",    label: "IT Support", color: "text-teal-400" },
  { key: "pmo",   label: "PMO",   color: "text-violet-400" },
] as const;

type DeptKey = (typeof DEPTS)[number]["key"];

interface OfficeEntry {
  /** Must match employee.location / M365 officeLocation values exactly (e.g. "Pune", "Dubai") */
  name: string;
  /** Display-only country label */
  country: string;
  admin: string;
  hr: string;
  it: string;
  pmo: string;
}

function emptyOffice(): OfficeEntry {
  return { name: "", country: "", admin: "", hr: "", it: "", pmo: "" };
}

export function CabinDirectory() {
  const { user } = useAuth();
  const [offices, setOffices] = useState<OfficeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const authHeaders = {
    "Content-Type": "application/json",
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const fetchCabins = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/company-settings/cabins", { headers: authHeaders });
      if (res.ok) {
        const data = await res.json();
        if (data.value) {
          const parsed: OfficeEntry[] = JSON.parse(data.value);
          if (Array.isArray(parsed)) setOffices(parsed);
        }
      }
    } catch {
      // use empty list silently
    } finally {
      setLoading(false);
    }
  }, [user?.email]);

  useEffect(() => { fetchCabins(); }, [fetchCabins]);

  const handleChange = (idx: number, field: keyof OfficeEntry, value: string) => {
    setOffices((prev) =>
      prev.map((o, i) => (i === idx ? { ...o, [field]: value } : o))
    );
  };

  const addOffice = () => setOffices((prev) => [...prev, emptyOffice()]);

  const removeOffice = (idx: number) =>
    setOffices((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = async () => {
    // Validate: each office must have a name
    const invalid = offices.find((o) => !o.name.trim());
    if (invalid !== undefined) {
      toast.error("Every office must have a location name (e.g. Pune)");
      return;
    }
    // Deduplicate names
    const names = offices.map((o) => o.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) {
      toast.error("Duplicate office names found — each location name must be unique");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/admin/company-settings/cabins", {
        method: "PUT",
        headers: authHeaders,
        body: JSON.stringify({ value: JSON.stringify(offices) }),
      });
      if (res.ok) {
        toast.success("Cabin directory saved");
      } else {
        toast.error("Failed to save cabin directory");
      }
    } catch {
      toast.error("Failed to save cabin directory");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 shrink-0">
            <Building2 className="h-5 w-5 text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-foreground">Cabin Directory</h2>
            <p className="text-[11px] text-muted-foreground leading-relaxed max-w-lg">
              Set cabin/room locations per office. The <strong>Location Name</strong> must exactly match
              the employee's office location in M365 (e.g. <em>Pune</em>, <em>Indore</em>, <em>Dubai</em>).
              The assistant auto-picks the right row based on where the user is based.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={fetchCabins}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            title="Refresh"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={addOffice}
            className="flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/30 hover:bg-muted/60 px-3 h-8 text-[12px] font-medium text-foreground transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add Office
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 rounded-xl bg-primary px-4 h-8 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
            Save All
          </button>
        </div>
      </div>

      {offices.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-muted/10 py-16">
          <Building2 className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-[13px] text-muted-foreground">No offices configured yet.</p>
          <button
            onClick={addOffice}
            className="flex items-center gap-2 rounded-xl bg-primary/10 hover:bg-primary/20 border border-primary/20 px-4 h-8 text-[12px] font-medium text-primary transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            Add first office
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {/* Column headers */}
          <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_32px] gap-3 px-4 items-center">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
              <MapPin className="h-3 w-3" /> Location Name
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              Country / Region
            </span>
            {DEPTS.map((d) => (
              <span key={d.key} className={cn("text-[10px] font-bold uppercase tracking-wider", d.color)}>
                {d.label}
              </span>
            ))}
            <span />
          </div>

          {offices.map((office, idx) => (
            <div
              key={idx}
              className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_32px] gap-3 items-center rounded-xl border border-border bg-muted/20 px-4 py-3 hover:bg-muted/30 transition-colors"
            >
              {/* Location name — must match employee.location */}
              <input
                type="text"
                value={office.name}
                onChange={(e) => handleChange(idx, "name", e.target.value)}
                placeholder="e.g. Pune"
                className="h-8 w-full rounded-lg border border-border bg-background px-3 text-[12px] font-medium text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 transition-colors"
              />

              {/* Country label (display only, not used for matching) */}
              <input
                type="text"
                value={office.country}
                onChange={(e) => handleChange(idx, "country", e.target.value)}
                placeholder="e.g. India"
                className="h-8 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 transition-colors"
              />

              {/* Cabin fields per dept */}
              {DEPTS.map((d) => (
                <input
                  key={d.key}
                  type="text"
                  value={office[d.key as DeptKey]}
                  onChange={(e) => handleChange(idx, d.key as DeptKey, e.target.value)}
                  placeholder="e.g. Room 201"
                  className="h-8 w-full rounded-lg border border-border bg-background px-3 text-[12px] text-foreground placeholder:text-muted-foreground/50 outline-none focus:border-primary/50 transition-colors"
                />
              ))}

              {/* Remove */}
              <button
                onClick={() => removeOffice(idx)}
                className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-400 transition-colors shrink-0"
                title="Remove this office"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <p className="text-[11px] text-muted-foreground/55">
        The <strong>Location Name</strong> field is used for matching — it must match the office location
        value in employee profiles (MS365 officeLocation field). Multiple offices per country are supported.
        Leave cabin fields blank for departments not present at a location.
      </p>
    </div>
  );
}
