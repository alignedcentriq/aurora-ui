import { useEffect, useMemo, useRef, useState } from "react";
import {
  Search,
  Users,
  Loader2,
  RefreshCw,
  SlidersHorizontal,
  Network,
  Star,
  BadgeCheck,
  Sparkles,
  GraduationCap,
  Briefcase,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

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
  reporting_manager_email: string;
  functional_manager: string;
  phone: string;
  extension: string;
  nick_name: string;
  birthday: string;
  // Alchemy enrichment bundled with the directory payload when cached server-side.
  // Absent (undefined) → not yet synced; the profile lazy-loads it on open.
  skills?: DirSkill[];
  projects?: DirProject[];
}

// Alchemy-sourced profile enrichment (skills + projects).
interface DirSkill {
  skill: string;
  category: string;
  competency: string;
  certified: boolean;
  certificate_url: string;
  primary_skill: boolean;
  secondary_skill: boolean;
  primary_interest: boolean;
  instructor: boolean;
  years_experience: string;
  last_used: string;
}
interface DirProject {
  name: string;
  role: string;
  client: string;
  manager: string;
  status: string;
  start_date: string;
  end_date: string;
  skills_used: string;
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
      <path fill="#fff" d="M9.2 9.06H4.4v1.2h1.68v4.5h1.45v-4.5H9.2z" />
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
  // Track which email failed (derived, not reset-on-effect) so the photo state is
  // always correct for the *current* person — never carried over from a previous one.
  const [failedEmail, setFailedEmail] = useState<string | null>(null);
  const showPhoto = !!email && failedEmail !== email;
  return (
    <div
      className={cn("relative shrink-0 overflow-hidden bg-[#e2e8f0] dark:bg-white/10", className)}
    >
      {/* Initials always render behind, so there's no blank circle while a photo loads
          and no stale image if the photo is missing. */}
      <span
        className={cn(
          "absolute inset-0 flex items-center justify-center font-bold text-[#64748b] dark:text-white/70",
          textClassName,
        )}
      >
        {initials(name)}
      </span>
      {showPhoto && (
        // key={email} forces a fresh <img> per person — the browser can't keep showing
        // the previously-loaded photo while the new one loads.
        <img
          key={email}
          src={`/api/ms365/users/${encodeURIComponent(email)}/photo`}
          alt={name}
          loading="lazy"
          draggable={false}
          onError={() => setFailedEmail(email)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
    </div>
  );
}

function EmployeeCard({
  emp,
  selected,
  onClick,
  onOrgChart,
}: {
  emp: DirEmployee;
  selected: boolean;
  onClick: () => void;
  onOrgChart: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "group flex flex-col text-left rounded-2xl border overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:-translate-y-0.5 hover:shadow-lg shadow-sm w-full cursor-pointer",
        selected
          ? "border-[#1f86e0] dark:border-primary/80 ring-2 ring-[#1f86e0]/30 dark:ring-primary/20 bg-white/90 dark:bg-white/[0.05]"
          : "border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.02] backdrop-blur-md hover:border-[#1f86e0]/40 dark:hover:border-primary/40",
      )}
    >
      <div className="flex items-center gap-3.5 p-3.5 sm:p-4 w-full min-w-0">
        <Avatar
          email={emp.email}
          name={emp.name}
          className="h-12.5 w-12.5 rounded-full border border-slate-200/60 dark:border-white/10 shadow-sm shrink-0 group-hover:scale-105 transition-transform duration-300"
          textClassName="text-sm"
        />
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-black text-slate-800 dark:text-white leading-tight truncate group-hover:text-[#1f86e0] dark:group-hover:text-primary transition-colors">
            {emp.name}
          </p>
          <p className="text-[12px] font-bold text-slate-500 dark:text-slate-400 mt-0.5 truncate">
            {emp.designation || "—"}
          </p>
          <div className="mt-1">
            <span className="inline-flex text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100/80 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200/40 dark:border-white/[0.03] truncate max-w-full">
              {emp.department}
            </span>
          </div>
        </div>
      </div>
      {/* Footer strip: org chart + email handle + Teams chat link */}
      <div className="w-full flex items-center justify-between gap-2 border-t border-slate-200/50 dark:border-white/[0.04] bg-slate-50/50 dark:bg-zinc-950/20 px-3.5 sm:px-4 py-2 mt-auto">
        <button
          onClick={(e) => {
            e.stopPropagation();
            onOrgChart();
          }}
          title={`View ${emp.name.split(" ")[0]}'s org chart`}
          className="flex items-center gap-1 shrink-0 rounded-lg px-1.5 py-1 text-[10px] font-extrabold uppercase tracking-wide text-[#1f86e0] dark:text-primary/80 hover:bg-[#1f86e0]/10 dark:hover:bg-primary/10 active:scale-95 transition-all"
        >
          <Network className="h-3.5 w-3.5" />
          <span>Org Chart</span>
        </button>
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="text-[11px] font-bold text-[#1f86e0] dark:text-primary/70 truncate">
            @{handle(emp.email)}
          </span>
          <a
            href={teamsChatUrl(emp.email)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={`Chat with ${emp.name.split(" ")[0]} on Teams`}
            className="shrink-0 hover:scale-110 active:scale-95 transition-all p-1 hover:bg-slate-200/40 dark:hover:bg-white/5 rounded-lg"
          >
            <TeamsIcon className="h-4 w-4" />
          </a>
        </div>
      </div>
    </button>
  );
}

function SkillPill({ s }: { s: DirSkill }) {
  return (
    <div className="flex items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.03] px-2.5 py-1.5">
      {s.primary_skill && (
        <Star
          className="h-3.5 w-3.5 text-amber-500 fill-amber-400 shrink-0"
          aria-label="Primary skill"
        />
      )}
      <span className="text-[12.5px] font-bold text-slate-700 dark:text-slate-200">{s.skill}</span>
      {s.competency && (
        <span className="text-[9px] font-extrabold uppercase tracking-wide text-slate-400 dark:text-slate-500">
          {s.competency}
        </span>
      )}
      {s.years_experience && s.years_experience !== "0.00" && (
        <span className="text-[10px] font-semibold text-slate-400">
          {parseFloat(s.years_experience)}y
        </span>
      )}
      {s.primary_interest && (
        <Sparkles className="h-3.5 w-3.5 text-violet-500 shrink-0" aria-label="Primary interest" />
      )}
      {s.instructor && (
        <GraduationCap className="h-3.5 w-3.5 text-emerald-500 shrink-0" aria-label="Instructor" />
      )}
      {s.certified &&
        (s.certificate_url ? (
          <a
            href={s.certificate_url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            title="View certificate"
          >
            <BadgeCheck className="h-3.5 w-3.5 text-sky-500 shrink-0" />
          </a>
        ) : (
          <BadgeCheck className="h-3.5 w-3.5 text-sky-500 shrink-0" aria-label="Certified" />
        ))}
    </div>
  );
}

function ProjectRow({ p }: { p: DirProject }) {
  const years = [p.start_date, p.end_date].map((d) => (d ? d.slice(0, 4) : "")).filter(Boolean);
  const period = years.length === 2 ? `${years[0]} – ${years[1]}` : years[0] || "";
  const done = p.status.toLowerCase() === "completed";
  return (
    <div className="rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-white/[0.02] px-3 py-2.5">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[13px] font-bold text-slate-800 dark:text-white leading-snug">
          {p.name || "—"}
        </p>
        {p.status && (
          <span
            className={cn(
              "shrink-0 text-[9px] font-extrabold uppercase tracking-wide px-1.5 py-0.5 rounded-md",
              done
                ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "bg-sky-100 text-sky-700 dark:bg-sky-950/40 dark:text-sky-400",
            )}
          >
            {p.status}
          </span>
        )}
      </div>
      <p className="text-[11.5px] font-semibold text-slate-500 dark:text-slate-400 mt-0.5">
        {[p.role, p.client].filter(Boolean).join(" · ")}
      </p>
      {(period || p.manager) && (
        <p className="text-[10.5px] text-slate-400 dark:text-slate-500 mt-0.5">
          {[period, p.manager && `PM: ${p.manager}`].filter(Boolean).join("  ·  ")}
        </p>
      )}
    </div>
  );
}

function ProfileModal({ emp, onClose }: { emp: DirEmployee; onClose: () => void }) {
  const { user } = useAuth();
  // Bundled with the directory payload → render instantly, no fetch.
  const bundled = emp.skills !== undefined || emp.projects !== undefined;
  const [enrich, setEnrich] = useState<{
    loading: boolean;
    available: boolean;
    skills: DirSkill[];
    projects: DirProject[];
  }>(
    bundled
      ? { loading: false, available: true, skills: emp.skills ?? [], projects: emp.projects ?? [] }
      : { loading: true, available: false, skills: [], projects: [] },
  );

  useEffect(() => {
    let cancelled = false;
    const code = emp.employee_code;
    // Already have the data from the directory payload — skip the network entirely.
    if (emp.skills !== undefined || emp.projects !== undefined) {
      setEnrich({
        loading: false,
        available: true,
        skills: emp.skills ?? [],
        projects: emp.projects ?? [],
      });
      return;
    }
    if (!code) {
      setEnrich({ loading: false, available: false, skills: [], projects: [] });
      return;
    }
    setEnrich((e) => ({ ...e, loading: true }));
    const headers: Record<string, string> = {};
    if (user?.email) headers["x-user-email"] = user.email;
    if (user?.role) headers["x-user-role"] = user.role.toLowerCase();
    fetch(`/api/employees/directory/${encodeURIComponent(code)}/enrichment`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => {
        if (!cancelled)
          setEnrich({
            loading: false,
            available: !!d.available,
            skills: d.skills ?? [],
            projects: d.projects ?? [],
          });
      })
      .catch(() => {
        if (!cancelled) setEnrich({ loading: false, available: false, skills: [], projects: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [emp.employee_code, user?.email, user?.role]);

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
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-md p-0 overflow-hidden gap-0 max-h-[95vh] sm:max-h-[90vh] flex flex-col">
        {/* Navy/Gradient header with centred avatar */}
        <div className="relative bg-gradient-to-br from-[#0e2a47] via-[#12395f] to-[#164775] px-4 pt-6 pb-4 sm:px-6 sm:pt-8 sm:pb-6 text-center shrink-0">
          <Avatar
            email={emp.email}
            name={emp.name}
            className="h-24 w-24 rounded-full mx-auto border-4 border-white/20 shadow-xl"
            textClassName="text-2xl"
          />
          <h2 className="mt-3.5 text-[20px] font-black text-white leading-tight">{emp.name}</h2>
          {emp.designation && (
            <p className="text-[13px] font-bold text-[#4cc6d6] mt-1">{emp.designation}</p>
          )}
          {emp.department && (
            <p className="text-[10px] font-extrabold uppercase tracking-widest text-white/70 mt-1.5">
              {emp.department}
            </p>
          )}
        </div>

        {/* Detail rows */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-3.5 sm:px-6 sm:py-4">
            <dl className="divide-y divide-slate-100 dark:divide-white/[0.04]">
              {rows.map(([label, value]) => (
                <div
                  key={label}
                  className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-3 py-2.5 sm:py-3 text-[13px]"
                >
                  <dt className="sm:w-32 shrink-0 font-bold text-slate-500 dark:text-slate-400">
                    {label}
                  </dt>
                  <dd className="min-w-0 flex-1 font-semibold text-slate-800 dark:text-slate-200 break-words">
                    {label === "Email ID" && value ? (
                      <a
                        href={`mailto:${value}`}
                        className="text-[#1f86e0] dark:text-primary hover:underline"
                      >
                        {value}
                      </a>
                    ) : (
                      value || "—"
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {/* Skills & Projects (Alchemy, loaded on demand) */}
            {enrich.loading ? (
              <div className="flex items-center gap-2 py-4 text-[12px] text-slate-400">
                <Skeleton className="h-4 w-4 rounded-full" />
                <Skeleton className="h-3 w-36" />
              </div>
            ) : (
              <>
                {enrich.skills.length > 0 && (
                  <div className="pt-4 mt-1 border-t border-slate-100 dark:border-white/[0.04]">
                    <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                      <Sparkles className="h-3.5 w-3.5 text-[#1f86e0]" /> Skills
                      <span className="text-slate-400 font-bold normal-case tracking-normal">
                        ({enrich.skills.length})
                      </span>
                    </h3>
                    <div className="flex flex-wrap gap-1.5">
                      {enrich.skills.map((s) => (
                        <SkillPill key={`${s.skill}-${s.category}`} s={s} />
                      ))}
                    </div>
                  </div>
                )}

                {enrich.projects.length > 0 && (
                  <div className="pt-4 mt-3 border-t border-slate-100 dark:border-white/[0.04]">
                    <h3 className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5">
                      <Briefcase className="h-3.5 w-3.5 text-[#1f86e0]" /> Projects
                      <span className="text-slate-400 font-bold normal-case tracking-normal">
                        ({enrich.projects.length})
                      </span>
                    </h3>
                    <div className="flex flex-col gap-2">
                      {enrich.projects.map((p, i) => (
                        <ProjectRow key={`${p.name}-${i}`} p={p} />
                      ))}
                    </div>
                  </div>
                )}

                {enrich.available && enrich.skills.length === 0 && enrich.projects.length === 0 && (
                  <p className="py-4 text-[12px] text-slate-400 dark:text-slate-500">
                    No skills or projects on record.
                  </p>
                )}
              </>
            )}
          </div>
        </ScrollArea>

        {/* Footer actions */}
        <DialogFooter className="border-t border-slate-100 dark:border-white/[0.08] px-4 py-2.5 sm:px-6 sm:py-3.5 bg-slate-50/50 dark:bg-zinc-950/20 shrink-0">
          <a
            href={teamsChatUrl(emp.email)}
            target="_blank"
            rel="noreferrer"
            title={`Chat with ${emp.name.split(" ")[0]} on Teams`}
            className="shrink-0 hover:scale-110 active:scale-95 transition-all p-1.5 hover:bg-slate-200/40 dark:hover:bg-white/5 rounded-lg"
          >
            <TeamsIcon className="h-6 w-6" />
          </a>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OrgChartModal({
  root,
  all,
  onClose,
  onShowProfile,
}: {
  root: DirEmployee;
  all: DirEmployee[];
  onClose: () => void;
  onShowProfile: (emp: DirEmployee) => void;
}) {
  // The chart re-centres as you click up (manager) or down (a report).
  const [focus, setFocus] = useState<DirEmployee>(root);
  useEffect(() => setFocus(root), [root]);

  const byEmail = useMemo(() => {
    const m = new Map<string, DirEmployee>();
    for (const e of all) if (e.email) m.set(e.email.toLowerCase(), e);
    return m;
  }, [all]);

  const manager = focus.reporting_manager_email
    ? byEmail.get(focus.reporting_manager_email)
    : undefined;

  const reports = useMemo(
    () =>
      all
        .filter(
          (e) =>
            e.reporting_manager_email && e.reporting_manager_email === focus.email.toLowerCase(),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [all, focus],
  );

  const connector = <div className="mx-auto h-5 w-px bg-slate-300 dark:bg-white/15" />;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-lg p-0 overflow-hidden gap-0 max-h-[95vh] sm:max-h-[90vh] flex flex-col bg-[#f3f6fa] dark:bg-zinc-900/95">
        {/* Header */}
        <DialogHeader className="flex-row items-center justify-between gap-3 border-b border-slate-200/60 dark:border-white/[0.06] bg-white/80 dark:bg-card px-4 py-3 sm:px-5 sm:py-3.5 shrink-0 space-y-0">
          <DialogTitle className="text-[15px] font-black text-[#0f2a4a] dark:text-white truncate">
            {focus.name}{" "}
            <span className="text-slate-400 dark:text-slate-500 font-bold">— Hierarchy</span>
          </DialogTitle>
        </DialogHeader>

        {/* Body */}
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-4 py-3 sm:px-5 sm:py-4 space-y-3">
            {/* Reports to (immediate manager) */}
            {manager && (
              <>
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/80 dark:bg-white/[0.02] p-3 sm:px-3.5 sm:py-3 shadow-sm">
                  <div className="flex items-center gap-3 min-w-0">
                    <Avatar
                      email={manager.email}
                      name={manager.name}
                      className="h-10 w-10 sm:h-11 sm:w-11 rounded-full border border-slate-200/60 dark:border-white/10 shrink-0"
                      textClassName="text-xs"
                    />
                    <div className="min-w-0">
                      <p className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-[#1f86e0] dark:text-primary/70">
                        Reports to
                      </p>
                      <p className="text-[13px] sm:text-[14px] font-black text-slate-800 dark:text-white truncate">
                        {manager.name}
                      </p>
                      <p className="text-[11px] sm:text-[12px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                        {manager.designation || "—"}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setFocus(manager)}
                    className="w-full sm:w-auto"
                  >
                    View
                  </Button>
                </div>
                {connector}
              </>
            )}

            {/* Selected (focus) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl bg-gradient-to-br from-[#0e2a47] via-[#12395f] to-[#164775] p-3.5 sm:px-4 sm:py-3.5 shadow-lg">
              <div className="flex items-center gap-3 min-w-0">
                <Avatar
                  email={focus.email}
                  name={focus.name}
                  className="h-11 w-11 sm:h-12.5 sm:w-12.5 rounded-full border-2 border-white/20 shrink-0"
                  textClassName="text-sm"
                />
                <div className="min-w-0">
                  <p className="text-[9px] sm:text-[10px] font-extrabold uppercase tracking-wider text-[#4cc6d6]">
                    Selected
                  </p>
                  <p className="text-[15px] sm:text-[16px] font-black text-white truncate">
                    {focus.name}
                  </p>
                  <p className="text-[11px] sm:text-[12px] font-semibold text-white/70 truncate">
                    {focus.designation || "—"}
                  </p>
                </div>
              </div>
              <Button
                size="sm"
                onClick={() => onShowProfile(focus)}
                className="w-full sm:w-auto bg-[#1f86e0] hover:bg-[#1a75c4] text-white"
              >
                Details
              </Button>
            </div>

            {/* Direct reports */}
            {connector}
            <p className="text-center text-[12px] font-bold text-slate-500 dark:text-slate-400">
              Direct Reports{reports.length ? ` (${reports.length})` : ""}
            </p>
            {reports.length === 0 ? (
              <p className="text-center text-[12px] text-slate-400 dark:text-slate-500 py-2">
                No direct reports.
              </p>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                {reports.map((r) => (
                  <button
                    key={r.email}
                    onClick={() => setFocus(r)}
                    title={`View ${r.name.split(" ")[0]}'s org chart`}
                    className="flex items-center gap-2.5 rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-white/80 dark:bg-white/[0.02] px-3 py-2.5 text-left hover:border-[#1f86e0]/40 dark:hover:border-primary/40 hover:shadow-md active:scale-[0.99] transition-all cursor-pointer"
                  >
                    <Avatar
                      email={r.email}
                      name={r.name}
                      className="h-9 w-9 rounded-full border border-slate-200/60 dark:border-white/10 shrink-0"
                      textClassName="text-[10px]"
                    />
                    <div className="min-w-0">
                      <p className="text-[12.5px] font-bold text-[#1f86e0] dark:text-primary/80 truncate">
                        {r.name}
                      </p>
                      <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                        {r.designation || "—"}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Footer */}
        <DialogFooter className="border-t border-slate-200/60 dark:border-white/[0.08] px-4 py-2.5 sm:px-5 sm:py-3 bg-white/70 dark:bg-zinc-950/20 shrink-0">
          <Button
            variant="outline"
            onClick={onClose}
            className="bg-[#0e2a47] text-white border-none hover:bg-[#12395f]"
          >
            ← Directory
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

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
    <Select value={value} onValueChange={(v) => onChange(v === "__all__" ? "" : v)}>
      <SelectTrigger className="w-full sm:w-52 rounded-xl border-slate-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-zinc-900/50 backdrop-blur-md text-[13px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="__all__">{placeholder}</SelectItem>
        {options.map((o) => (
          <SelectItem key={o} value={o}>
            {o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function EmployeeDirectory() {
  const { user } = useAuth();
  const [all, setAll] = useState<DirEmployee[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [dept, setDept] = useState("");
  const [desig, setDesig] = useState("");
  const [selected, setSelected] = useState<DirEmployee | null>(null);
  const [orgChartFor, setOrgChartFor] = useState<DirEmployee | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const activeFilterCount = useMemo(() => (dept ? 1 : 0) + (desig ? 1 : 0), [dept, desig]);
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
      toast.error(
        e instanceof Error
          ? `Could not load directory: ${e.message}`
          : "Could not load the employee directory",
      );
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
      return e.name.toLowerCase().includes(q) || handle(e.email).toLowerCase().includes(q);
    });
  }, [all, query, dept, desig]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [query, dept, desig]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f3f6fa] dark:bg-background">
      {/* Header bar */}
      <div className="shrink-0 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card px-4 sm:px-6 py-3.5 shadow-sm">
        <div className="flex flex-col gap-3">
          {/* Header Row */}
          <div className="flex items-center justify-between sm:justify-start gap-4">
            <h1 className="text-[18px] sm:text-[20px] font-black text-[#0f2a4a] dark:text-white tracking-tight shrink-0">
              Employee Directory
            </h1>

            {/* Mobile Refresh Button */}
            <button
              onClick={load}
              disabled={loading}
              title="Refresh Directory"
              className="flex sm:hidden items-center justify-center rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-zinc-900/50 backdrop-blur-md h-9 w-9 text-slate-600 dark:text-white/80 hover:bg-[#f0f6fc] disabled:opacity-50 transition-all cursor-pointer shadow-sm active:scale-95"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
            </button>
          </div>

          {/* Controls Row */}
          <div className="flex flex-row items-center gap-2">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 h-4 w-4 text-[#94a3b8]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name..."
                className="w-full rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-zinc-900/50 backdrop-blur-md pl-10 pr-9 py-2 text-[14px] sm:text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-[#1f86e0]/60 dark:focus:border-primary/50 focus:ring-2 focus:ring-[#1f86e0]/10 dark:focus:ring-primary/10 transition-all"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-white/10 text-muted-foreground transition-colors"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Desktop-only dropdowns & refresh */}
            <div className="hidden sm:flex items-center gap-2">
              <FilterSelect
                value={dept}
                onChange={setDept}
                options={departments}
                placeholder="All Departments"
              />
              <FilterSelect
                value={desig}
                onChange={setDesig}
                options={designations}
                placeholder="All Designations"
              />
              <button
                onClick={load}
                disabled={loading}
                title="Refresh Directory"
                className="flex items-center justify-center rounded-xl border border-slate-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-zinc-900/50 backdrop-blur-md h-[38px] w-[38px] text-[#1f86e0] hover:bg-[#f0f6fc] disabled:opacity-50 transition-all cursor-pointer shadow-sm"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              </button>
            </div>

            {/* Mobile Filters Trigger Row */}
            <div className="flex sm:hidden items-center gap-1.5 shrink-0">
              <button
                onClick={() => setShowMobileFilters(!showMobileFilters)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-xl border px-3 h-[38px] text-[13px] font-bold transition-all shadow-sm cursor-pointer shrink-0",
                  showMobileFilters || activeFilterCount > 0
                    ? "border-[#1f86e0]/40 bg-[#1f86e0]/10 text-[#1f86e0] dark:text-primary-foreground dark:bg-primary/20"
                    : "border-slate-200/80 dark:border-white/[0.08] bg-white/70 dark:bg-zinc-900/50 text-slate-700 dark:text-white/80",
                )}
              >
                <SlidersHorizontal className="h-4 w-4" />
                <span>Filters</span>
                {activeFilterCount > 0 && (
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1f86e0] dark:bg-primary text-[10px] font-black text-white">
                    {activeFilterCount}
                  </span>
                )}
              </button>

              {activeFilterCount > 0 && (
                <button
                  onClick={() => {
                    setDept("");
                    setDesig("");
                  }}
                  className="flex items-center justify-center rounded-xl border border-rose-200 dark:border-rose-950 bg-rose-50/50 dark:bg-rose-950/20 px-3 h-[38px] text-[13px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-100/50 transition-all cursor-pointer shadow-sm shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Collapsible Mobile Filters Drawer */}
          {showMobileFilters && (
            <div className="flex sm:hidden flex-col gap-2.5 rounded-2xl border border-slate-200/60 dark:border-white/[0.06] bg-slate-50/50 dark:bg-zinc-950/20 p-3.5 mt-0.5 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/80 pl-1">
                  Department
                </span>
                <FilterSelect
                  value={dept}
                  onChange={setDept}
                  options={departments}
                  placeholder="All Departments"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/80 pl-1">
                  Designation
                </span>
                <FilterSelect
                  value={desig}
                  onChange={setDesig}
                  options={designations}
                  placeholder="All Designations"
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="rounded-2xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.02] p-4 space-y-3">
                <div className="flex items-center gap-3.5">
                  <Skeleton className="h-12 w-12 rounded-full shrink-0" />
                  <div className="space-y-2 flex-1">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-4 w-16" />
                  </div>
                </div>
                <Skeleton className="h-8 w-full rounded-lg" />
              </div>
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div>
              <Users className="h-14 w-14 text-[#94a3b8]/30 mx-auto mb-4" />
              <p className="text-[15px] font-bold text-[#0f2a4a] dark:text-white">
                No employees found
              </p>
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
              <span className="font-semibold text-[#0f2a4a] dark:text-white">
                {filtered.length}
              </span>{" "}
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
                  onOrgChart={() => setOrgChartFor(emp)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      {orgChartFor && (
        <OrgChartModal
          root={orgChartFor}
          all={all ?? []}
          onClose={() => setOrgChartFor(null)}
          onShowProfile={(emp) => setSelected(emp)}
        />
      )}

      {/* Rendered last so a profile opened from the org chart's "Details" layers on top. */}
      {selected && <ProfileModal emp={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
