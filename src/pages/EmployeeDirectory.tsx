import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search, Users, Loader2, X, RefreshCw, ChevronDown, Network } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";

// Shape returned by GET /api/employees/directory (Zoho HR profile ⋈ Employee).
interface DirEmployee {
  name: string;
  email: string;
  employee_code: string;
  designation: string;
  department: string;
  location: string;
  city: string;
  reporting_manager: string;
  functional_manager: string;
  phone: string;
  extension: string;
  nick_name: string;
  birthday: string;
}

const initials = (name: string) =>
  name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((n) => n[0]?.toUpperCase())
    .join("") || "?";

// Local-part of the email — the portal shows this as the card's handle.
const handle = (email: string) => (email || "").split("@")[0];

const teamsChatUrl = (email: string) =>
  `https://teams.microsoft.com/l/chat/0/0?users=${encodeURIComponent(email)}`;

// Microsoft Teams glyph (two-tone), so the card/footer reads exactly like the portal.
function TeamsIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path
        fill="#5059C9"
        d="M16.8 9.6h4.6c.43 0 .78.35.78.78v4.2a3.06 3.06 0 0 1-3.06 3.06h-.01a3.06 3.06 0 0 1-3.06-3.06V10.2c0-.33.27-.6.6-.6z"
      />
      <circle cx="18.6" cy="6.3" r="1.95" fill="#5059C9" />
      <circle cx="11.6" cy="5.4" r="2.55" fill="#7B83EB" />
      <path
        fill="#7B83EB"
        d="M14.9 9.6H7.1c-.5 0-.9.4-.9.9v6.06a4.8 4.8 0 0 0 3.74 4.68 4.8 4.8 0 0 0 5.86-4.68V10.5c0-.5-.4-.9-.9-.9z"
      />
      <path
        fill="#000"
        opacity=".1"
        d="M12.4 8.4v9.3c0 .46-.32.86-.78.95-.06.01-.12.02-.18.02H6.27a4.6 4.6 0 0 1-.07-.78V9.5c0-.5.4-.9.9-.9h5.3z"
      />
      <rect x="2" y="6.6" width="9.6" height="9.6" rx="1.6" fill="#4B53BC" />
      <path
        fill="#fff"
        d="M9.2 9.06H4.4v1.2h1.68v4.5h1.45v-4.5H9.2z"
      />
    </svg>
  );
}

function Avatar({
  email,
  name,
  className,
  textClassName = "text-sm",
}: {
  email: string;
  name: string;
  className?: string;
  textClassName?: string;
}) {
  const [failed, setFailed] = useState(false);
  // reset the fallback when the email changes (modal reuse)
  useEffect(() => setFailed(false), [email]);
  const showPhoto = !!email && !failed;
  return (
    <div className={cn("relative shrink-0 overflow-hidden bg-[#e2e8f0] dark:bg-white/10", className)}>
      {showPhoto ? (
        <img
          src={`/api/ms365/users/${encodeURIComponent(email)}/photo`}
          alt={name}
          loading="lazy"
          draggable={false}
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <span
          className={cn(
            "flex h-full w-full items-center justify-center font-bold text-[#64748b] dark:text-white/70",
            textClassName,
          )}
        >
          {initials(name)}
        </span>
      )}
    </div>
  );
}

function EmployeeCard({
  emp,
  selected,
  onClick,
}: {
  emp: DirEmployee;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col text-left rounded-md border bg-white dark:bg-card overflow-hidden transition-all hover:shadow-md",
        selected
          ? "border-[#1f86e0] ring-1 ring-[#1f86e0]/40"
          : "border-[#e2e8f0] dark:border-white/[0.08] hover:border-[#1f86e0]/40",
      )}
    >
      <div className="flex items-center gap-3 p-3">
        <Avatar
          email={emp.email}
          name={emp.name}
          className="h-12 w-12 rounded-full"
          textClassName="text-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold text-[#0f2a4a] dark:text-white leading-tight truncate">
            {emp.name}
          </p>
          <p className="text-[12px] font-semibold text-[#1f86e0] dark:text-primary/80 truncate">
            {emp.designation || "—"}
          </p>
          <p className="text-[10px] font-bold uppercase tracking-wide text-[#94a3b8] dark:text-white/40 truncate">
            {emp.department}
          </p>
        </div>
      </div>
      {/* Footer strip: email handle + Teams chat link, like the portal */}
      <div className="flex items-center justify-between gap-2 border-t border-[#eef2f7] dark:border-white/[0.06] bg-[#f5f9fd] dark:bg-white/[0.02] px-3 py-1.5">
        <span className="text-[11px] text-[#1f86e0] dark:text-primary/70 truncate">
          {handle(emp.email)}
        </span>
        <a
          href={teamsChatUrl(emp.email)}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          title={`Chat with ${emp.name.split(" ")[0]} on Teams`}
          className="shrink-0 hover:opacity-80"
        >
          <TeamsIcon className="h-4 w-4" />
        </a>
      </div>
    </button>
  );
}

function ProfileModal({
  emp,
  onClose,
  onOrgChart,
}: {
  emp: DirEmployee;
  onClose: () => void;
  onOrgChart: () => void;
}) {
  const rows: [string, string][] = [
    ["Employee ID", emp.employee_code],
    ["Email ID", emp.email],
    ["Phone", emp.phone],
    ["Location", emp.location],
    ["Reporting Manager", emp.reporting_manager],
    ["Functional Manager", emp.functional_manager],
    ["Nick Name", emp.nick_name],
    ["Birthday", emp.birthday],
    ["City", emp.city],
  ];
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div
        className="relative w-full max-w-md rounded-xl bg-white dark:bg-card shadow-2xl overflow-hidden max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Navy header with centred avatar */}
        <div className="relative bg-[#0e2a47] px-6 pt-8 pb-6 text-center">
          <button
            onClick={onClose}
            className="absolute top-3 right-3 rounded-full bg-white/15 p-1.5 text-white hover:bg-white/30 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
          <Avatar
            email={emp.email}
            name={emp.name}
            className="h-24 w-24 rounded-full mx-auto border-4 border-white/90 shadow-lg"
            textClassName="text-2xl"
          />
          <h2 className="mt-3 text-[19px] font-bold text-white leading-tight">{emp.name}</h2>
          {emp.designation && (
            <p className="text-[13px] font-semibold text-[#4cc6d6] mt-0.5">{emp.designation}</p>
          )}
          {emp.department && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-white/80 mt-1">
              {emp.department}
            </p>
          )}
        </div>

        {/* Detail rows */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          <dl className="divide-y divide-[#eef2f7] dark:divide-white/[0.06]">
            {rows.map(([label, value]) => (
              <div key={label} className="flex items-start gap-4 py-2.5 text-[13px]">
                <dt className="w-36 shrink-0 text-[#3a78b5] dark:text-primary/70">{label}</dt>
                <dd className="min-w-0 flex-1 font-semibold text-[#7a2e3a] dark:text-rose-300/90 break-words">
                  {label === "Email ID" && value ? (
                    <a href={`mailto:${value}`} className="hover:underline">{value}</a>
                  ) : (
                    value || ""
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {/* Footer actions */}
        <div className="flex items-center justify-between border-t border-[#eef2f7] dark:border-white/[0.08] px-6 py-3">
          <button
            onClick={onOrgChart}
            className="flex items-center gap-1.5 rounded-full bg-[#1ba8b8] hover:bg-[#159aa9] px-4 py-1.5 text-[12px] font-semibold text-white transition-colors"
          >
            <Network className="h-3.5 w-3.5" /> Org Chart
          </button>
          <a
            href={teamsChatUrl(emp.email)}
            target="_blank"
            rel="noreferrer"
            title={`Chat with ${emp.name.split(" ")[0]} on Teams`}
            className="hover:opacity-80"
          >
            <TeamsIcon className="h-6 w-6" />
          </a>
        </div>
      </div>
    </div>
  );
}

// A styled <select> that matches the portal's bordered dropdown look.
function FilterSelect({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  placeholder: string;
}) {
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="appearance-none w-full sm:w-52 rounded-md border border-[#cdd9e5] dark:border-white/[0.12] bg-white dark:bg-background pl-3 pr-9 py-2 text-[13px] text-foreground outline-none focus:border-[#1f86e0]/60"
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
      <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#1f86e0]" />
    </div>
  );
}

export function EmployeeDirectory() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [all, setAll] = useState<DirEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [desig, setDesig] = useState("");
  const [selected, setSelected] = useState<DirEmployee | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/employees/directory`, { headers: authHeaders });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}${detail ? ` — ${detail.slice(0, 160)}` : ""}`);
      }
      const data = await res.json();
      const list: DirEmployee[] = (data.employees ?? []).filter((e: DirEmployee) => e.name);
      setAll(list);
    } catch (e) {
      console.error("[EmployeeDirectory] load failed:", e);
      toast.error(e instanceof Error ? `Could not load directory: ${e.message}` : "Could not load the employee directory");
      setAll([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const departments = useMemo(
    () => Array.from(new Set((all ?? []).map((e) => e.department).filter(Boolean))).sort(),
    [all],
  );
  const designations = useMemo(
    () => Array.from(new Set((all ?? []).map((e) => e.designation).filter(Boolean))).sort(),
    [all],
  );

  const filtered = useMemo(() => {
    if (!all) return [];
    const q = query.trim().toLowerCase();
    return all.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (desig && e.designation !== desig) return false;
      if (!q) return true;
      return (
        e.name.toLowerCase().includes(q) ||
        handle(e.email).toLowerCase().includes(q)
      );
    });
  }, [all, query, dept, desig]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, dept, desig]);

  const goToOrgChart = () => {
    setSelected(null);
    navigate({ to: "/control-hub", search: { tab: "org-hierarchy" } as any });
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f3f6fa] dark:bg-background">
      {/* Header bar */}
      <div className="shrink-0 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card px-4 sm:px-6 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center gap-3">
          <h1 className="text-[17px] font-bold text-[#0f2a4a] dark:text-white tracking-tight shrink-0 lg:w-56">
            Employee Directory
          </h1>
          <div className="flex flex-1 flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name..."
                className="w-full rounded-md border border-[#cdd9e5] dark:border-white/[0.12] bg-white dark:bg-background pl-10 pr-3 py-2 text-[13px] text-foreground outline-none focus:border-[#1f86e0]/60"
              />
            </div>
            <FilterSelect value={dept} onChange={setDept} options={departments} placeholder="All Departments" />
            <FilterSelect value={desig} onChange={setDesig} options={designations} placeholder="All Designations" />
            <button
              onClick={load}
              disabled={loading}
              title="Refresh"
              className="flex items-center justify-center rounded-md border border-[#cdd9e5] dark:border-white/[0.12] bg-white dark:bg-background h-[38px] w-[38px] text-[#1f86e0] hover:bg-[#f0f6fc] disabled:opacity-50 transition-colors shrink-0"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-[#1f86e0]" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Users className="h-14 w-14 text-[#94a3b8]/30 mx-auto mb-4" />
              <p className="text-[15px] font-bold text-[#0f2a4a] dark:text-white">No employees found</p>
              <p className="text-[13px] text-[#64748b] dark:text-muted-foreground mt-1">
                {all && all.length === 0
                  ? "The directory hasn't been synced yet."
                  : "Try a different name, department, or designation."}
              </p>
            </div>
          </div>
        ) : (
          <>
            <p className="text-[12px] text-[#64748b] dark:text-muted-foreground mb-3">
              <span className="font-semibold text-[#0f2a4a] dark:text-white">{filtered.length}</span>{" "}
              {filtered.length === 1 ? "person" : "people"}
              {(dept || desig) && " (filtered)"}
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {filtered.map((emp) => (
                <EmployeeCard
                  key={emp.email}
                  emp={emp}
                  selected={selected?.email === emp.email}
                  onClick={() => setSelected(emp)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {selected && (
        <ProfileModal emp={selected} onClose={() => setSelected(null)} onOrgChart={goToOrgChart} />
      )}
    </div>
  );
}
