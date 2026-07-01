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
  Clock,
  FolderKanban,
  X,
  History,
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
  // Project allocations (employee_allocations) — distinct project names + clients the
  // person was staffed on. Broad coverage; powers the grid's project search/filter.
  allocation_projects?: string[];
  allocation_clients?: string[];
  // Current availability from the latest allocation snapshot.
  allocated_percent?: number;
  availability_percent?: number;
  available?: boolean;
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
          fetchPriority="low"
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
          <div className="mt-1 flex flex-wrap items-center gap-1">
            <span className="inline-flex text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-slate-100/80 dark:bg-white/5 text-slate-500 dark:text-slate-400 border border-slate-200/40 dark:border-white/[0.03] truncate max-w-full">
              {emp.department}
            </span>
            {emp.available && (
              <span
                title={
                  emp.availability_percent != null
                    ? `${emp.availability_percent}% free capacity`
                    : "Currently available"
                }
                className="inline-flex items-center gap-1 text-[9px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-md bg-teal-500/10 text-teal-600 dark:text-teal-400 border border-teal-500/20"
              >
                <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
                {emp.availability_percent != null && emp.availability_percent > 0
                  ? `${emp.availability_percent}% free`
                  : "Available"}
              </span>
            )}
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

function SkillPill({ s, onClick }: { s: DirSkill; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={`About ${s.skill} & who else has it`}
      className="flex items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-white/[0.08] bg-slate-50/70 dark:bg-white/[0.03] px-2.5 py-1.5 text-left cursor-pointer transition-colors hover:border-[#1f86e0]/60 hover:bg-[#1f86e0]/[0.06] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f86e0]/40">
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
    </button>
  );
}

function ProjectRow({ p, onClick }: { p: DirProject; onClick?: () => void }) {
  const years = [p.start_date, p.end_date].map((d) => (d ? d.slice(0, 4) : "")).filter(Boolean);
  const period = years.length === 2 ? `${years[0]} – ${years[1]}` : years[0] || "";
  const done = p.status.toLowerCase() === "completed";
  return (
    <button
      type="button"
      onClick={onClick}
      title={`About ${p.name} & the team`}
      className="w-full text-left rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-white/[0.02] px-3 py-2.5 cursor-pointer transition-colors hover:border-[#1f86e0]/60 hover:bg-[#1f86e0]/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f86e0]/40">
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
    </button>
  );
}

// Compact clickable row for a peer / team member inside a detail popup. Opens that
// person's profile when they're in the directory roster (no-op otherwise).
function PersonRow({
  name,
  code,
  meta,
  onOpen,
}: {
  name: string;
  code: string;
  meta?: string;
  onOpen?: (code: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => code && onOpen?.(code)}
      className="flex w-full items-center gap-2.5 rounded-xl border border-slate-200/70 dark:border-white/[0.06] bg-white/70 dark:bg-white/[0.02] px-2.5 py-2 text-left transition-colors hover:border-[#1f86e0]/60 hover:bg-[#1f86e0]/[0.05] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1f86e0]/40"
    >
      <Avatar email="" name={name} className="h-8 w-8 rounded-full" textClassName="text-[11px]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-bold text-slate-800 dark:text-slate-100">{name}</p>
        {meta && (
          <p className="truncate text-[10.5px] font-semibold text-slate-400 dark:text-slate-500">
            {meta}
          </p>
        )}
      </div>
    </button>
  );
}

interface SkillDetailResp {
  available: boolean;
  skill_name: string;
  description?: string;
  image_url?: string;
  category?: string;
  total_employees?: number;
  certified_count?: number;
  instructor_count?: number;
  expert_count?: number;
  peers?: { employee_id: string; name: string; competency: string; experience: string; last_used: string }[];
}

// Click-through popup for a skill pill: what the skill is (Alchemy catalog), this
// person's own proficiency, and everyone else in the org who has it.
function SkillDetailDialog({
  skill,
  personName,
  currentCode,
  onClose,
  onOpenPerson,
}: {
  skill: DirSkill;
  personName: string;
  currentCode: string;
  onClose: () => void;
  onOpenPerson?: (code: string) => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<SkillDetailResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const headers: Record<string, string> = {};
    if (user?.email) headers["x-user-email"] = user.email;
    if (user?.role) headers["x-user-role"] = user.role.toLowerCase();
    fetch(`/api/employees/skill-detail?name=${encodeURIComponent(skill.skill)}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => !cancelled && (setData(d), setLoading(false)))
      .catch(() => !cancelled && (setData({ available: false, skill_name: skill.skill }), setLoading(false)));
    return () => {
      cancelled = true;
    };
  }, [skill.skill, user?.email, user?.role]);

  const peers = (data?.peers ?? []).filter((p) => p.employee_id !== currentCode);
  const userFacts = [
    skill.competency,
    skill.years_experience && skill.years_experience !== "0.00"
      ? `${parseFloat(skill.years_experience)} yrs`
      : "",
    skill.certified ? "Certified" : "",
    skill.instructor ? "Instructor" : "",
    skill.primary_interest ? "Primary interest" : "",
    skill.last_used ? `Last used ${skill.last_used}` : "",
  ].filter(Boolean);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-md p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0 space-y-0 border-b border-slate-100 dark:border-white/[0.06] px-5 py-4">
          <DialogTitle className="flex items-start gap-2 pr-8 text-[16px] font-black text-[#0f2a4a] dark:text-white">
            <Sparkles className="h-4 w-4 text-[#1f86e0] shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">{data?.skill_name || skill.skill}</span>
          </DialogTitle>
          {(data?.category || skill.category) && (
            <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
              {data?.category || skill.category}
            </p>
          )}
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* This person's proficiency */}
          <div>
            <h4 className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
              {personName.split(" ")[0]}’s proficiency
            </h4>
            {userFacts.length ? (
              <div className="flex flex-wrap gap-1.5">
                {userFacts.map((f) => (
                  <Badge key={f} variant="secondary" className="text-[11px]">
                    {f}
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">No proficiency details on record.</p>
            )}
          </div>

          {/* What the skill is */}
          <div>
            <h4 className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500 mb-1.5">
              About this skill
            </h4>
            {loading ? (
              <div className="space-y-1.5">
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            ) : data?.description ? (
              <p className="text-[12.5px] leading-relaxed text-slate-600 dark:text-slate-300">
                {data.description}
              </p>
            ) : (
              <p className="text-[12px] text-slate-400">No description available.</p>
            )}
          </div>

          {/* Peers */}
          <div>
            <h4 className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
              <Users className="h-3.5 w-3.5 text-[#1f86e0]" /> Others with this skill
              {!loading && (
                <span className="font-bold normal-case tracking-normal text-slate-400">
                  ({data?.total_employees ?? peers.length})
                </span>
              )}
            </h4>
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : peers.length ? (
              <div className="flex flex-col gap-1.5">
                {peers.map((p) => (
                  <PersonRow
                    key={p.employee_id}
                    name={p.name}
                    code={p.employee_id}
                    meta={[p.competency, p.experience && `${parseFloat(p.experience)} yrs`]
                      .filter(Boolean)
                      .join(" · ")}
                    onOpen={(c) => {
                      onClose();
                      onOpenPerson?.(c);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">No one else has this skill on record.</p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface ProjectDetailResp {
  available: boolean;
  project_name: string;
  client?: string;
  status?: string;
  lead?: string;
  delivery_manager?: string;
  project_type?: string;
  member_count?: number;
  members?: {
    employee_id: string;
    name: string;
    efforts: number | null;
    billability: number | null;
    done: boolean;
    role?: string;
  }[];
}

// Click-through popup for a project row: project overview + the team that worked on
// it (from allocation records), each member clickable to their profile.
function ProjectDetailDialog({
  project,
  currentCode,
  onClose,
  onOpenPerson,
}: {
  project: DirProject;
  currentCode: string;
  onClose: () => void;
  onOpenPerson?: (code: string) => void;
}) {
  const { user } = useAuth();
  const [data, setData] = useState<ProjectDetailResp | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const headers: Record<string, string> = {};
    if (user?.email) headers["x-user-email"] = user.email;
    if (user?.role) headers["x-user-role"] = user.role.toLowerCase();
    fetch(`/api/employees/project-detail?name=${encodeURIComponent(project.name)}`, { headers })
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((d) => !cancelled && (setData(d), setLoading(false)))
      .catch(() => !cancelled && (setData({ available: false, project_name: project.name }), setLoading(false)));
    return () => {
      cancelled = true;
    };
  }, [project.name, user?.email, user?.role]);

  const members = (data?.members ?? []).filter((m) => m.employee_id !== currentCode);
  const facts = [
    ["Client", data?.client || project.client],
    ["Status", data?.status || project.status],
    ["Project Lead", data?.lead],
    ["Delivery Manager", data?.delivery_manager || project.manager],
    ["Type", data?.project_type],
    ["Role (this person)", project.role],
  ].filter(([, v]) => v) as [string, string][];

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="w-full max-w-md p-0 overflow-hidden gap-0 max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0 space-y-0 border-b border-slate-100 dark:border-white/[0.06] px-5 py-4">
          <DialogTitle className="flex items-start gap-2 pr-8 text-[15px] font-black text-[#0f2a4a] dark:text-white leading-snug">
            <Briefcase className="h-4 w-4 text-[#1f86e0] shrink-0 mt-0.5" />
            <span className="min-w-0 break-words">{project.name}</span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-4">
          {/* Overview */}
          <dl className="grid grid-cols-2 gap-x-3 gap-y-2.5">
            {facts.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-[9.5px] font-extrabold uppercase tracking-wider text-slate-400">
                  {label}
                </dt>
                <dd className="text-[12.5px] font-semibold text-slate-700 dark:text-slate-200 break-words">
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          {project.skills_used && (
            <div>
              <h4 className="text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500 mb-1.5">
                Skills used
              </h4>
              <p className="text-[12px] text-slate-600 dark:text-slate-300">{project.skills_used}</p>
            </div>
          )}

          {/* Team */}
          <div>
            <h4 className="flex items-center gap-1.5 text-[10.5px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
              <Users className="h-3.5 w-3.5 text-[#1f86e0]" /> Team members
              {!loading && data?.available && (
                <span className="font-bold normal-case tracking-normal text-slate-400">
                  ({(data?.member_count ?? members.length)})
                </span>
              )}
            </h4>
            {loading ? (
              <Skeleton className="h-10 w-full" />
            ) : members.length ? (
              <div className="flex flex-col gap-1.5">
                {members.map((m) => (
                  <PersonRow
                    key={m.employee_id}
                    name={m.name || m.employee_id}
                    code={m.employee_id}
                    meta={[
                      m.role,
                      m.billability != null ? `${m.billability}% billable` : null,
                      m.billability != null ? (m.done ? "Completed" : "Active") : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                    onOpen={(c) => {
                      onClose();
                      onOpenPerson?.(c);
                    }}
                  />
                ))}
              </div>
            ) : (
              <p className="text-[12px] text-slate-400">
                No other team members found in allocation records.
              </p>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProfileModal({
  emp,
  onClose,
  onOpenPerson,
}: {
  emp: DirEmployee;
  onClose: () => void;
  onOpenPerson?: (code: string) => void;
}) {
  const { user } = useAuth();
  // Skill / project click-through popups (rendered above this modal).
  const [skillDetail, setSkillDetail] = useState<DirSkill | null>(null);
  const [projectDetail, setProjectDetail] = useState<DirProject | null>(null);
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
    <>
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
        <div className="flex-1 min-h-0 overflow-y-auto">
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
                        <SkillPill
                          key={`${s.skill}-${s.category}`}
                          s={s}
                          onClick={() => setSkillDetail(s)}
                        />
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
                        <ProjectRow
                          key={`${p.name}-${i}`}
                          p={p}
                          onClick={() => setProjectDetail(p)}
                        />
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
        </div>

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

    {skillDetail && (
      <SkillDetailDialog
        skill={skillDetail}
        personName={emp.name}
        currentCode={emp.employee_code}
        onClose={() => setSkillDetail(null)}
        onOpenPerson={onOpenPerson}
      />
    )}
    {projectDetail && (
      <ProjectDetailDialog
        project={projectDetail}
        currentCode={emp.employee_code}
        onClose={() => setProjectDetail(null)}
        onOpenPerson={onOpenPerson}
      />
    )}
    </>
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
        <div className="flex-1 min-h-0 overflow-y-auto">
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
        </div>

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
  // Skill / certification / experience / recency / project filters — driven by the copilot
  // sidebar (centriq:directory-filter) and clearable from the header. All match against the
  // Alchemy enrichment bundled in the directory payload (skills[] + projects[]). Skills/
  // projects are arrays so a query can name several ("React and Node") — a person matches
  // if they satisfy ANY named skill/project (see the `filtered` memo below).
  const [skillFilters, setSkillFilters] = useState<string[]>([]);
  const [minYears, setMinYears] = useState<number | null>(null);
  const [maxYears, setMaxYears] = useState<number | null>(null);
  const [certifiedOnly, setCertifiedOnly] = useState(false);
  const [projectFilters, setProjectFilters] = useState<string[]>([]);
  const [usedWithinMonths, setUsedWithinMonths] = useState<number | null>(null);
  // Allocation-aware availability filter (current free capacity from the latest snapshot).
  const [availableOnly, setAvailableOnly] = useState(false);
  // Free-text query fallback: when the copilot's regex parser can't find a filterable
  // dimension, the backend translates the query into SQL over the composed directory and
  // returns the matching employee codes directly (see directory_query_service on the
  // backend). ANDs with the other filters like everything else.
  const [queryResultCodes, setQueryResultCodes] = useState<Set<string> | null>(null);
  const [queryResultSummary, setQueryResultSummary] = useState("");
  // Visible "memory" of the copilot filter conversation: each turn that added or narrowed
  // a filter appends one line here, so a sequence like "React developers" → "also
  // certified" → "5+ years" reads back as a trail instead of silently replacing itself.
  const [appliedSteps, setAppliedSteps] = useState<string[]>([]);
  const [selected, setSelected] = useState<DirEmployee | null>(null);
  const [orgChartFor, setOrgChartFor] = useState<DirEmployee | null>(null);
  const [showMobileFilters, setShowMobileFilters] = useState(false);
  const enrichFilterActive =
    skillFilters.length > 0 ||
    minYears !== null ||
    certifiedOnly ||
    projectFilters.length > 0 ||
    usedWithinMonths !== null ||
    availableOnly ||
    queryResultCodes !== null;
  const activeFilterCount = useMemo(
    () =>
      (dept ? 1 : 0) +
      (desig ? 1 : 0) +
      (skillFilters.length ? 1 : 0) +
      (minYears !== null ? 1 : 0) +
      (certifiedOnly ? 1 : 0) +
      (projectFilters.length ? 1 : 0) +
      (usedWithinMonths !== null ? 1 : 0) +
      (availableOnly ? 1 : 0) +
      (queryResultCodes !== null ? 1 : 0),
    [
      dept,
      desig,
      skillFilters,
      minYears,
      certifiedOnly,
      projectFilters,
      usedWithinMonths,
      availableOnly,
      queryResultCodes,
    ],
  );
  const scrollRef = useRef<HTMLDivElement>(null);

  const authHeaders = {
    ...(user?.email ? { "x-user-email": user.email } : {}),
    ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
  };

  // Resets every assistant-driven filter (not manual dept/designation/name search) and
  // tells the copilot sidebar to forget the accumulated filter context — without this,
  // the next chat turn would keep merging on top of a search the user just cleared.
  const clearAssistantFilters = () => {
    setSkillFilters([]);
    setMinYears(null);
    setMaxYears(null);
    setCertifiedOnly(false);
    setProjectFilters([]);
    setUsedWithinMonths(null);
    setAvailableOnly(false);
    setQueryResultCodes(null);
    setQueryResultSummary("");
    setAppliedSteps([]);
    window.dispatchEvent(new CustomEvent("centriq:directory-filter-reset"));
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
    const skillQs = skillFilters.map((s) => s.trim().toLowerCase()).filter(Boolean);
    const projectQs = projectFilters.map((p) => p.trim().toLowerCase()).filter(Boolean);
    // Cutoff date for the "used within N months" recency filter (null when not set).
    const usedCutoff =
      usedWithinMonths !== null
        ? (() => {
            const d = new Date();
            d.setMonth(d.getMonth() - usedWithinMonths);
            return d;
          })()
        : null;
    return all.filter((e) => {
      if (dept && e.department !== dept) return false;
      if (desig && e.designation !== desig) return false;
      // Skill / certification / experience / recency filters operate on the bundled Alchemy
      // enrichment. A row with no skills array (not yet synced) can't satisfy them, so it's
      // excluded. Several named skills match on ANY of them (OR); the other conditions
      // (years/certified/recency) must hold on that SAME matched skill entry.
      if (skillQs.length || minYears !== null || maxYears !== null || certifiedOnly || usedCutoff) {
        const skills = e.skills ?? [];
        const queries = skillQs.length ? skillQs : [null];
        const ok = queries.some((skillQ) =>
          skills.some((s) => {
            if (skillQ && !s.skill.toLowerCase().includes(skillQ)) return false;
            const yrs = parseFloat(s.years_experience || "0") || 0;
            if (minYears !== null && yrs < minYears) return false;
            if (maxYears !== null && yrs > maxYears) return false;
            if (certifiedOnly && !s.certified) return false;
            if (usedCutoff) {
              const lu = s.last_used ? new Date(s.last_used) : null;
              if (!lu || isNaN(lu.getTime()) || lu < usedCutoff) return false;
            }
            return true;
          }),
        );
        if (!ok) return false;
      }
      // Project filter (partial match, OR across named projects): allocations the person
      // was staffed on (project name or client), plus the Alchemy profile projects + skills-used.
      if (projectQs.length) {
        const ok = projectQs.some(
          (projectQ) =>
            (e.allocation_projects ?? []).some((p) => p.toLowerCase().includes(projectQ)) ||
            (e.allocation_clients ?? []).some((c) => c.toLowerCase().includes(projectQ)) ||
            (e.projects ?? []).some(
              (p) =>
                p.name.toLowerCase().includes(projectQ) ||
                (p.skills_used || "").toLowerCase().includes(projectQ),
            ),
        );
        if (!ok) return false;
      }
      // Availability (allocation-aware): only people with current free capacity, from
      // the latest allocation snapshot bundled in the payload.
      if (availableOnly && !e.available) return false;
      // Free-text query fallback (LLM-generated SQL over the composed directory).
      if (queryResultCodes && !queryResultCodes.has(e.employee_code || "")) return false;
      if (!q) return true;
      return e.name.toLowerCase().includes(q) || handle(e.email).toLowerCase().includes(q);
    });
  }, [
    all,
    query,
    dept,
    desig,
    skillFilters,
    minYears,
    maxYears,
    certifiedOnly,
    projectFilters,
    usedWithinMonths,
    availableOnly,
    queryResultCodes,
  ]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [
    query,
    dept,
    desig,
    skillFilters,
    minYears,
    maxYears,
    certifiedOnly,
    projectFilters,
    usedWithinMonths,
    availableOnly,
    queryResultCodes,
  ]);

  // Sidebar copilot → directory filter. MERGES the parsed skill / certification /
  // experience / recency / project / availability filters into the grid rather than
  // replacing it, so a follow-up turn ("also certified", "5+ years") narrows the current
  // search instead of resetting it. Only dimensions the new turn actually named are
  // touched — an unset field means "unchanged", not "clear it" (query-result codes and
  // dept/designation/name search are untouched here too, so everything keeps composing).
  useEffect(() => {
    const handler = (e: Event) => {
      const detail =
        (
          e as CustomEvent<{
            skills?: string[];
            minYears?: number;
            maxYears?: number;
            certified?: boolean;
            projects?: string[];
            usedWithinMonths?: number;
            available?: boolean;
          }>
        ).detail || {};
      const steps: string[] = [];
      if (detail.skills?.length) {
        setSkillFilters((prev) => Array.from(new Set([...prev, ...detail.skills!])));
        steps.push(detail.skills.join(", "));
      }
      if (detail.projects?.length) {
        setProjectFilters((prev) => Array.from(new Set([...prev, ...detail.projects!])));
        steps.push(`project ${detail.projects.join(", ")}`);
      }
      if (detail.minYears !== undefined) {
        setMinYears(detail.minYears);
        setMaxYears(detail.maxYears ?? null);
        steps.push(
          detail.maxYears !== undefined
            ? `${detail.minYears}-${detail.maxYears} yrs`
            : `${detail.minYears}+ yrs`,
        );
      }
      if (detail.certified) {
        setCertifiedOnly(true);
        steps.push("certified");
      }
      if (detail.usedWithinMonths !== undefined) {
        setUsedWithinMonths(detail.usedWithinMonths);
        steps.push(`used ≤${detail.usedWithinMonths}mo`);
      }
      if (detail.available) {
        setAvailableOnly(true);
        steps.push("available");
      }
      if (steps.length) setAppliedSteps((prev) => [...prev, steps.join(" · ")].slice(-6));
    };
    window.addEventListener("centriq:directory-filter", handler as EventListener);
    return () => window.removeEventListener("centriq:directory-filter", handler as EventListener);
  }, []);

  // Sidebar copilot → free-text query fallback (regex found nothing, backend translated
  // the query into SQL over the composed directory and returned matching employee codes).
  // INTERSECTS with any already-applied query result rather than replacing it, so two
  // free-text searches in a row narrow down ("Python devs" then "who used it recently")
  // instead of the second one wiping out the first.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ employeeCodes?: string[]; summary?: string }>).detail || {};
      const nextCodes = new Set(detail.employeeCodes ?? []);
      setQueryResultCodes((prev) => (prev ? new Set([...nextCodes].filter((c) => prev.has(c))) : nextCodes));
      setQueryResultSummary((prev) => (prev ? `${prev} · ${detail.summary}` : detail.summary ?? ""));
      if (detail.summary) setAppliedSteps((prev) => [...prev, detail.summary!].slice(-6));
    };
    window.addEventListener("centriq:directory-query-result", handler as EventListener);
    return () => window.removeEventListener("centriq:directory-query-result", handler as EventListener);
  }, []);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#f3f6fa] dark:bg-background">
      {/* Header bar */}
      <div className="shrink-0 border-b border-[#e2e8f0] dark:border-white/[0.08] bg-white dark:bg-card px-4 sm:px-6 py-3.5 shadow-sm">
        <div className="flex flex-col gap-3">
          {/* Header Row */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 sm:justify-start gap-4">
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
                    clearAssistantFilters();
                  }}
                  className="flex items-center justify-center rounded-xl border border-rose-200 dark:border-rose-950 bg-rose-50/50 dark:bg-rose-950/20 px-3 h-[38px] text-[13px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-100/50 transition-all cursor-pointer shadow-sm shrink-0"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          {/* Active enrichment filter chips (driven by the copilot sidebar) */}
          {enrichFilterActive && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">
                Assistant filter
              </span>
              {skillFilters.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[#1f86e0]/30 bg-[#1f86e0]/10 dark:bg-primary/15 px-2.5 py-1 text-[12px] font-bold text-[#1f86e0] dark:text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {skillFilters.join(", ")}
                  <button
                    onClick={() => setSkillFilters([])}
                    className="ml-0.5 rounded-full hover:bg-[#1f86e0]/20 p-0.5 transition-colors"
                    title="Remove skill filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {certifiedOnly && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[12px] font-bold text-sky-600 dark:text-sky-400">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Certified
                  <button
                    onClick={() => setCertifiedOnly(false)}
                    className="ml-0.5 rounded-full hover:bg-sky-500/20 p-0.5 transition-colors"
                    title="Remove certification filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {minYears !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[12px] font-bold text-emerald-600 dark:text-emerald-400">
                  <Briefcase className="h-3.5 w-3.5" />
                  {maxYears !== null ? `${minYears}-${maxYears} yrs` : `${minYears}+ yrs`}
                  <button
                    onClick={() => {
                      setMinYears(null);
                      setMaxYears(null);
                    }}
                    className="ml-0.5 rounded-full hover:bg-emerald-500/20 p-0.5 transition-colors"
                    title="Remove experience filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {usedWithinMonths !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-violet-500/30 bg-violet-500/10 px-2.5 py-1 text-[12px] font-bold text-violet-600 dark:text-violet-400">
                  <Clock className="h-3.5 w-3.5" />
                  Used ≤ {usedWithinMonths}mo
                  <button
                    onClick={() => setUsedWithinMonths(null)}
                    className="ml-0.5 rounded-full hover:bg-violet-500/20 p-0.5 transition-colors"
                    title="Remove recency filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {projectFilters.length > 0 && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[12px] font-bold text-amber-600 dark:text-amber-400">
                  <FolderKanban className="h-3.5 w-3.5" />
                  {projectFilters.join(", ")}
                  <button
                    onClick={() => setProjectFilters([])}
                    className="ml-0.5 rounded-full hover:bg-amber-500/20 p-0.5 transition-colors"
                    title="Remove project filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {availableOnly && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-teal-500/30 bg-teal-500/10 px-2.5 py-1 text-[12px] font-bold text-teal-600 dark:text-teal-400">
                  <Users className="h-3.5 w-3.5" />
                  Available now
                  <button
                    onClick={() => setAvailableOnly(false)}
                    className="ml-0.5 rounded-full hover:bg-teal-500/20 p-0.5 transition-colors"
                    title="Remove availability filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {queryResultCodes !== null && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-fuchsia-500/30 bg-fuchsia-500/10 px-2.5 py-1 text-[12px] font-bold text-fuchsia-600 dark:text-fuchsia-400">
                  <Sparkles className="h-3.5 w-3.5" />
                  {queryResultSummary || "Assistant search"}
                  <button
                    onClick={() => {
                      setQueryResultCodes(null);
                      setQueryResultSummary("");
                    }}
                    className="ml-0.5 rounded-full hover:bg-fuchsia-500/20 p-0.5 transition-colors"
                    title="Remove search filter"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              <button
                onClick={clearAssistantFilters}
                className="text-[11px] font-bold text-rose-500 hover:text-rose-600 hover:underline"
              >
                Clear
              </button>
            </div>
          )}

          {/* Copilot search history — the "memory" of what's been narrowed down turn by
              turn, since each turn now merges into the current filter instead of replacing
              it. Purely a readable trail; "Clear" above resets it. */}
          {appliedSteps.length > 1 && (
            <div className="flex items-start gap-1.5 rounded-xl border border-slate-200/60 dark:border-white/[0.06] bg-slate-50/60 dark:bg-zinc-950/20 px-3 py-2">
              <History className="h-3.5 w-3.5 mt-0.5 shrink-0 text-muted-foreground/60" />
              <div className="flex flex-col gap-0.5 min-w-0">
                <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">
                  Search history
                </span>
                <ol className="flex flex-col gap-0.5">
                  {appliedSteps.map((step, i) => (
                    <li key={i} className="text-[12px] text-muted-foreground truncate">
                      <span className="font-bold text-muted-foreground/70">{i + 1}.</span> {step}
                    </li>
                  ))}
                </ol>
              </div>
            </div>
          )}

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
                  : enrichFilterActive
                    ? "No one matches that skill / certification / experience / project filter. Skills & projects are only available for synced profiles — try clearing the assistant filter."
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
              {(dept || desig || enrichFilterActive) && " (filtered)"}
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
      {selected && (
        <ProfileModal
          emp={selected}
          onClose={() => setSelected(null)}
          onOpenPerson={(code) => {
            const next = (all ?? []).find((e) => e.employee_code === code);
            if (next) setSelected(next);
          }}
        />
      )}
    </div>
  );
}
