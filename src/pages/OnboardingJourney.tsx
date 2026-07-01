import { useAuth } from "@/lib/auth-store";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Loader2,
  CheckCircle2,
  Circle,
  ArrowRight,
  ArrowLeft,
  Download,
  Upload,
  FileText,
  PlayCircle,
  Sparkles,
  Rocket,
  PartyPopper,
  ListChecks,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize2,
  Minimize2,
  RotateCcw,
  UserCheck,
  Laptop,
  BookOpen,
  Users,
  GraduationCap,
  Briefcase,
  Video,
  Mail,
  Calendar,
  Check,
  AlertCircle,
  Clock,
  ShieldCheck,
  PenLine,
  X as XIcon,
} from "lucide-react";
import { Fragment } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";

// ── Types (mirror the /api/onboarding/me payload) ────────────────────────────
interface StepView {
  key: string;
  title: string;
  description: string;
  category: string;
  order: number;
  kind: "manual" | "deeplink" | "documents" | "video";
  cta_label: string;
  action_payload: { prompt?: string; route?: string; tab?: string };
  auto: boolean;
  required: boolean;
  status: "pending" | "in_progress" | "done" | "skipped";
  completed_at: string | null;
}
interface DocView {
  doc_key: string;
  name: string;
  description: string;
  fields: string[];
  required: boolean;
  submitted: boolean;
  status: string;
  original_name: string | null;
  submitted_at: string | null;
  has_template_file: boolean;
}
interface JourneyView {
  employee_name: string;
  employee_email: string;
  is_new_hire: boolean;
  status: "active" | "completed";
  progress_pct: number;
  next_step: string | null;
  assigned_device: string | null;
  steps: StepView[];
  documents: DocView[];
}
interface ManagerCallView {
  status: "none" | "pending" | "scheduled" | "cancelled";
  manager_name?: string | null;
  manager_email?: string | null;
  scheduled_start?: string | null;
  scheduled_label?: string;
  teams_join_url?: string | null;
}
interface VideoView {
  id?: string;
  title: string;
  description?: string;
  url: string;
  chapters: { title: string; start: number }[];
}
interface InductionDocView {
  id: string;
  title: string;
  description?: string;
  url: string;
  uploaded_filename?: string | null;
}

const STATUS_PILL: Record<string, string> = {
  done: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20",
  in_progress: "bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/20",
  pending: "bg-slate-400/10 text-slate-500 dark:text-slate-400 border border-slate-400/20",
  skipped: "bg-slate-400/10 text-slate-500 border border-slate-400/20",
};

const STATUS_LABEL: Record<string, string> = {
  done: "Completed",
  in_progress: "In progress",
  pending: "To do",
  skipped: "Skipped",
};

function fmtTime(secs: number) {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function OnboardingJourney() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [view, setView] = useState<JourneyView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStep, setBusyStep] = useState<string | null>(null);
  const [panel, setPanel] = useState<"steps" | "documents" | "video-library" | "video">("steps");
  const [selectedStepKey, setSelectedStepKey] = useState<string | null>(null);
  const [videos, setVideos] = useState<VideoView[]>([]);
  const [inductionDocs, setInductionDocs] = useState<InductionDocView[]>([]);
  const [activeVideo, setActiveVideo] = useState<VideoView | null>(null);
  const [managerCall, setManagerCall] = useState<ManagerCallView | null>(null);

  const authHeaders = useMemo(
    () => ({
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    }),
    [user?.email, user?.role],
  );

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/onboarding/me", { headers: authHeaders });
      if (!res.ok)
        throw new Error((await res.json().catch(() => ({})))?.detail || "Failed to load");
      const data = await res.json();
      setView(data);
      if (data && data.steps.length > 0) {
        setSelectedStepKey((prev) => prev || data.next_step || data.steps[0].key);
      }
      // Manager intro-call status (best-effort — never blocks the journey render).
      fetch("/api/onboarding/me/manager-call", { headers: authHeaders })
        .then((r) => (r.ok ? r.json() : null))
        .then((mc) => mc && setManagerCall(mc))
        .catch(() => {});
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't load your onboarding.");
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    load();
  }, [load]);

  // Drop a prompt into the chat assistant and go to it.
  const askInChat = useCallback(
    (prompt: string) => {
      navigate({ to: "/" });
      setTimeout(() => {
        window.dispatchEvent(new CustomEvent("centriq:quick-action", { detail: { prompt } }));
      }, 250);
    },
    [navigate],
  );

  const completeStep = useCallback(
    async (key: string) => {
      setBusyStep(key);
      try {
        const res = await fetch(`/api/onboarding/me/steps/${key}/complete`, {
          method: "POST",
          headers: { ...authHeaders, "Content-Type": "application/json" },
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.detail || "Failed");
        toast.success("Step completed ✓");
        await load();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Couldn't update that step.");
      } finally {
        setBusyStep(null);
      }
    },
    [authHeaders, load],
  );

  const onStepCta = useCallback(
    (step: StepView) => {
      if (step.kind === "documents") {
        setPanel("documents");
        return;
      }
      if (step.kind === "video") {
        setPanel("video-library");
        if (videos.length === 0) {
          fetch("/api/onboarding/induction-videos", { headers: authHeaders })
            .then((r) => r.json())
            .then((list: VideoView[]) => setVideos(Array.isArray(list) ? list : []))
            .catch(() => {});
        }
        fetch("/api/onboarding/induction-documents", { headers: authHeaders })
          .then((r) => r.json())
          .then((list: InductionDocView[]) => setInductionDocs(Array.isArray(list) ? list : []))
          .catch(() => {});
        return;
      }
      if (step.action_payload?.route) {
        navigate({
          to: step.action_payload.route as string,
          ...(step.action_payload.tab ? { search: { tab: step.action_payload.tab as string } } : {}),
        });
        return;
      }
      if (step.action_payload?.prompt) {
        askInChat(step.action_payload.prompt);
        return;
      }
    },
    [askInChat, navigate, authHeaders, videos],
  );

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120]">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
      </div>
    );
  }

  const activeStep = view?.steps.find((s) => s.key === selectedStepKey) || view?.steps[0];

  return (
    <div className="flex flex-col h-full overflow-hidden bg-gradient-to-br from-[#f8fafc] to-[#f1f5f9] dark:from-[#030712] dark:to-[#091120] relative">
      {/* Decorative Blur Circles */}
      <div className="absolute top-[-10%] right-[-10%] w-[300px] h-[300px] rounded-full bg-violet-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] left-[-10%] w-[300px] h-[300px] rounded-full bg-indigo-500/10 blur-[120px] pointer-events-none" />

      {/* Header section */}
      <div className="px-8 py-5 border-b border-slate-200/80 dark:border-white/[0.05] bg-white/40 dark:bg-zinc-950/20 backdrop-blur-md shrink-0 flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-lg bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg">
              <Rocket className="h-3.5 w-3.5 text-white" />
            </div>
            <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-primary">
              Onboarding Command Center
            </span>
          </div>
          <h1 className="text-[20px] font-black tracking-tight text-foreground mt-1">
            {view?.employee_name
              ? `Hi ${view.employee_name.split(" ")[0]}, let's get you set up`
              : "Welcome to the Team"}
          </h1>
        </div>

        {/* Back switcher */}
        {panel !== "steps" && (
          <button
            onClick={() => {
              if (panel === "video") {
                setActiveVideo(null);
                setPanel("video-library");
              } else {
                setPanel("steps");
              }
            }}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 px-4 py-2 text-[12px] font-bold text-muted-foreground hover:text-foreground transition-all cursor-pointer shadow-sm hover:scale-[1.02]"
          >
            <ArrowLeft className="h-4 w-4" />
            {panel === "video" ? "Back to inductions" : "Back to checklist"}
          </button>
        )}
      </div>

      {/* Main Two-Column Dashboard */}
      <div className="flex-1 overflow-auto px-8 py-6">
        {view ? (
          <div className="max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-start pb-12">
            {/* Left Column: Progress Sidebar */}
            <div className="lg:col-span-4 space-y-6">
              {/* Overall Progress Card */}
              <div className="rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-6 shadow-xl relative overflow-hidden">
                <div className="flex items-center gap-4">
                  {/* Radial progress wheel */}
                  <div className="relative w-16 h-16 shrink-0">
                    <svg className="w-full h-full transform -rotate-90">
                      <circle
                        cx="32"
                        cy="32"
                        r="28"
                        className="stroke-slate-200 dark:stroke-zinc-800"
                        strokeWidth="5"
                        fill="transparent"
                      />
                      <motion.circle
                        cx="32"
                        cy="32"
                        r="28"
                        className="stroke-violet-500"
                        strokeWidth="5"
                        fill="transparent"
                        strokeDasharray={176}
                        initial={{ strokeDashoffset: 176 }}
                        animate={{ strokeDashoffset: 176 - (176 * view.progress_pct) / 100 }}
                        transition={{ type: "spring", stiffness: 60, damping: 15 }}
                        strokeLinecap="round"
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-[14px] font-black text-foreground tabular-nums">
                        {view.progress_pct}%
                      </span>
                    </div>
                  </div>

                  <div>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                      Overall Completion
                    </span>
                    <h2 className="text-[16px] font-black text-foreground mt-0.5">
                      Setup Progress
                    </h2>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {view.progress_pct === 100 ? "Ready to launch! 🎉" : "A few steps remaining"}
                    </p>
                  </div>
                </div>

                {/* Micro details */}
                <div className="border-t border-slate-200/60 dark:border-white/[0.04] mt-5 pt-4 grid grid-cols-2 gap-4">
                  <div>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground block">
                      Completed
                    </span>
                    <span className="text-[13px] font-bold text-foreground tabular-nums">
                      {
                        view.steps.filter((s) => s.status === "done" || s.status === "skipped")
                          .length
                      }{" "}
                      of {view.steps.length}
                    </span>
                  </div>
                  <div>
                    <span className="text-[9px] uppercase tracking-wider font-bold text-muted-foreground block">
                      Next up
                    </span>
                    <span className="text-[13px] font-bold text-violet-500 truncate block">
                      {view.steps.find((s) => s.key === view.next_step)?.title || "All set!"}
                    </span>
                  </div>
                </div>
              </div>

              {/* Desktop Stepper: Vertical list, hidden on mobile */}
              <div className="hidden lg:block rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-5 shadow-xl">
                <span className="text-[11px] font-extrabold uppercase tracking-wider text-muted-foreground px-1.5 block mb-4">
                  Journey Roadmap
                </span>

                <div className="space-y-1">
                  {view.steps.map((step, i) => {
                    const done = step.status === "done" || step.status === "skipped";
                    const active = step.key === selectedStepKey;
                    const isNext = view.next_step === step.key;
                    const StepIcon = STEP_ICON[step.key] || Circle;

                    return (
                      <button
                        key={step.key}
                        onClick={() => {
                          setSelectedStepKey(step.key);
                          setPanel("steps");
                        }}
                        className={cn(
                          "w-full flex items-center gap-3.5 px-3 py-2.5 rounded-2xl text-left transition-all border group relative cursor-pointer",
                          active
                            ? "bg-gradient-to-tr from-violet-500/10 to-indigo-500/10 border-violet-500/30 text-foreground"
                            : "bg-transparent border-transparent hover:bg-slate-200/30 dark:hover:bg-zinc-900/40 text-muted-foreground",
                        )}
                      >
                        <div
                          className={cn(
                            "relative grid place-items-center h-9 w-9 rounded-xl border transition-all shrink-0",
                            done
                              ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                              : active
                                ? "bg-violet-500 text-white border-transparent shadow-lg shadow-violet-500/20"
                                : "bg-white/70 dark:bg-zinc-900/60 border-slate-200 dark:border-white/10 text-slate-400 dark:text-zinc-500 group-hover:text-foreground",
                          )}
                        >
                          {done ? (
                            <Check className="h-4.5 w-4.5 stroke-[3px]" />
                          ) : (
                            <StepIcon className="h-4 w-4" />
                          )}
                          {isNext && !done && !active && (
                            <span className="absolute inset-0 rounded-xl ring-2 ring-violet-400 animate-pulse" />
                          )}
                        </div>

                        <div className="flex-1 min-w-0">
                          <p
                            className={cn(
                              "text-[12.5px] font-bold leading-snug truncate",
                              active || done
                                ? "text-foreground font-extrabold"
                                : "text-muted-foreground",
                            )}
                          >
                            {step.title}
                          </p>
                          <span className="text-[10px] text-muted-foreground block mt-0.5">
                            {step.category}
                          </span>
                        </div>

                        {done && (
                          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                        )}
                        {isNext && !done && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 shrink-0">
                            Next
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Mobile Stepper: Horizontal scrolling nodes */}
              <div className="block lg:hidden rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-4 shadow-xl">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-3 px-1">
                  <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                    Journey Roadmap
                  </span>
                  <span className="text-[10px] text-muted-foreground">Swipe to scroll</span>
                </div>
                <div className="overflow-x-auto pb-2 -mx-2 px-2 [scrollbar-width:none] [-ms-overflow-style:none]">
                  <style
                    dangerouslySetInnerHTML={{
                      __html: `
                    .overflow-x-auto::-webkit-scrollbar { display: none; }
                  `,
                    }}
                  />
                  <div className="flex items-start gap-4 min-w-max">
                    {view.steps.map((step, i) => {
                      const done = step.status === "done" || step.status === "skipped";
                      const active = step.key === selectedStepKey;
                      const isNext = view.next_step === step.key;
                      const StepIcon = STEP_ICON[step.key] || Circle;

                      return (
                        <button
                          key={step.key}
                          onClick={() => {
                            setSelectedStepKey(step.key);
                            setPanel("steps");
                          }}
                          className="flex flex-col items-center gap-1.5 w-16 shrink-0 group relative cursor-pointer"
                        >
                          <div
                            className={cn(
                              "relative grid place-items-center h-10 w-10 rounded-xl border transition-all",
                              done
                                ? "bg-emerald-500/10 border-emerald-500/20 text-emerald-500"
                                : active
                                  ? "bg-violet-500 text-white border-transparent shadow-md shadow-violet-500/20"
                                  : "bg-white/70 dark:bg-zinc-900/60 border-slate-200 dark:border-white/10 text-slate-400 dark:text-zinc-500",
                            )}
                          >
                            {done ? (
                              <Check className="h-4.5 w-4.5 stroke-[3px]" />
                            ) : (
                              <StepIcon className="h-4 w-4" />
                            )}
                            {isNext && !done && !active && (
                              <span className="absolute inset-0 rounded-xl ring-2 ring-violet-400 animate-pulse" />
                            )}
                          </div>
                          <span
                            className={cn(
                              "text-[9px] font-bold text-center leading-tight truncate w-full",
                              active ? "text-foreground font-black" : "text-muted-foreground",
                            )}
                          >
                            {STEP_SHORT[step.key] || step.title}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Active Workspace */}
            <div className="lg:col-span-8">
              <AnimatePresence mode="wait">
                {panel === "steps" && activeStep && (
                  <motion.div
                    key={`step-${selectedStepKey}`}
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.25 }}
                    className="rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-6 shadow-xl space-y-6"
                  >
                    {/* Step identity header */}
                    <div className="flex items-start gap-4 justify-between border-b border-slate-200/60 dark:border-white/[0.04] pb-5">
                      <div className="flex items-center gap-3">
                        <div
                          className={cn(
                            "grid place-items-center h-12 w-12 rounded-2xl shrink-0 text-white shadow-md",
                            activeStep.status === "done"
                              ? "bg-gradient-to-tr from-emerald-500 to-teal-500"
                              : "bg-gradient-to-tr from-violet-500 to-indigo-600",
                          )}
                        >
                          {(() => {
                            const Icon = STEP_ICON[activeStep.key] || Circle;
                            return <Icon className="h-6 w-6" />;
                          })()}
                        </div>
                        <div>
                          <div className="flex xl:items-center gap-2 flex-col xl:flex-row">
                            <span className="text-[10px] font-extrabold uppercase tracking-wider text-muted-foreground">
                              {activeStep.category}
                            </span>
                            {view.next_step === activeStep.key && activeStep.status !== "done" && (
                              <span className="text-[9px] font-extrabold uppercase tracking-wider px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500 self-start">
                                Suggested next step
                              </span>
                            )}
                          </div>
                          <h2 className="text-[18px] font-black text-foreground mt-0.5">
                            {activeStep.title}
                          </h2>
                        </div>
                      </div>

                      <span
                        className={cn(
                          "text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0 self-start sm:self-center",
                          STATUS_PILL[activeStep.status],
                        )}
                      >
                        {STATUS_LABEL[activeStep.status]}
                      </span>
                    </div>

                    {/* Step Description */}
                    <div className="space-y-2">
                      <p className="text-[13.5px] text-foreground leading-relaxed font-medium">
                        {activeStep.description}
                      </p>
                    </div>

                    {/* INTERACTIVE RICH MOCKUP WORKSPACES */}
                    <div className="rounded-2xl border border-slate-200/50 dark:border-white/[0.04] bg-slate-500/[0.02] dark:bg-white/[0.01] p-5">
                      {activeStep.key === "profile_confirm" && (
                        <div className="space-y-4">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            AD Profile Details
                          </span>
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                            <div className="space-y-1">
                              <span className="text-[11px] text-muted-foreground">Full name</span>
                              <p className="text-[13px] font-bold text-foreground">
                                {view.employee_name}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] text-muted-foreground">Job Title</span>
                              <p className="text-[13px] font-bold text-foreground">
                                Associate Engineer
                              </p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] text-muted-foreground">
                                Corporate Email
                              </span>
                              <p className="text-[13px] font-bold text-foreground">
                                {view.employee_email}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <span className="text-[11px] text-muted-foreground">Department</span>
                              <p className="text-[13px] font-bold text-foreground">
                                Data & Analytics
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-2 mt-4 text-[12px] text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-4 w-4 shrink-0" />
                            <span>
                              These credentials are successfully synced and confirmed with active
                              systems.
                            </span>
                          </div>
                        </div>
                      )}

                      {activeStep.key === "it_setup" && (
                        <div className="space-y-4">
                          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                              IT Provisioning Ticket Status
                            </span>
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20">
                              <Clock className="h-3 w-3 animate-spin animate-duration-1000" />{" "}
                              Pending Setup
                            </span>
                          </div>

                          <div className="rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 p-4 space-y-4">
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200/50 dark:border-white/[0.04] pb-2.5">
                              <div>
                                <span className="text-[10px] text-muted-foreground">
                                  Assigned Device
                                </span>
                                <p className="text-[13px] font-black text-foreground">
                                  {view.assigned_device || "To be assigned by IT"}
                                </p>
                              </div>
                              <div className="text-right">
                                <span className="text-[10px] text-muted-foreground">Status</span>
                                <p
                                  className={cn(
                                    "text-[13px] font-bold",
                                    view.assigned_device
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : "text-amber-600 dark:text-amber-400",
                                  )}
                                >
                                  {view.assigned_device ? "Assigned" : "Awaiting assignment"}
                                </p>
                              </div>
                            </div>

                            <div className="space-y-3">
                              <span className="text-[11px] font-bold text-foreground block">
                                Provisioning Checklist
                              </span>
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[12px]">
                                <div className="flex items-center gap-2 text-emerald-500">
                                  <Check className="h-4 w-4 stroke-[3px]" /> Active Directory
                                  account
                                </div>
                                <div className="flex items-center gap-2 text-emerald-500">
                                  <Check className="h-4 w-4 stroke-[3px]" /> Microsoft 365 & Teams
                                  access
                                </div>
                                <div
                                  className={cn(
                                    "flex items-center gap-2",
                                    view.assigned_device
                                      ? "text-emerald-500"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  {view.assigned_device ? (
                                    <Check className="h-4 w-4 stroke-[3px]" />
                                  ) : (
                                    <div className="h-4 w-4 rounded-full border border-slate-200 dark:border-zinc-700 flex items-center justify-center shrink-0">
                                      <span className="h-1.5 w-1.5 rounded-full bg-violet-500 animate-ping" />
                                    </div>
                                  )}
                                  {view.assigned_device
                                    ? `${view.assigned_device} configuration`
                                    : "Device configuration"}
                                </div>
                                <div className="flex items-center gap-2 text-muted-foreground">
                                  <div className="h-4 w-4 rounded-full border border-slate-200 dark:border-zinc-700 shrink-0" />
                                  Security key mailing
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeStep.key === "onboarding_documents" && (
                        <div className="space-y-4">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Documents Upload Progress
                          </span>
                          <div className="space-y-2">
                            {view.documents.map((d) => (
                              <div
                                key={d.doc_key}
                                className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-[12.5px] rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 p-2.5"
                              >
                                <div className="flex items-center gap-2 min-w-0">
                                  <FileText className="h-4 w-4 text-slate-400 shrink-0" />
                                  <span className="font-semibold text-foreground truncate">
                                    {d.name}
                                  </span>
                                </div>
                                <span
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0",
                                    d.submitted
                                      ? "bg-emerald-500/10 text-emerald-500"
                                      : "bg-slate-400/10 text-slate-500",
                                  )}
                                >
                                  {d.submitted ? "Uploaded" : "Pending"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeStep.key === "induction_video" && (
                        <div className="rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 px-4 py-3 flex items-center gap-2 text-[12.5px] text-muted-foreground">
                          <PlayCircle className="h-4 w-4 text-violet-500 shrink-0" />
                          Click <span className="font-semibold text-foreground mx-1">Watch induction</span> to browse all available induction videos.
                        </div>
                      )}

                      {activeStep.key === "policy_ack" && (
                        <div className="space-y-4">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Required Policies Acknowledgment
                          </span>
                          <div className="space-y-2">
                            {[
                              { name: "Code of Conduct", read: true },
                              { name: "Information Security Policy", read: false },
                              { name: "Workplace Health & Safety", read: false },
                            ].map((policy, i) => (
                              <div
                                key={i}
                                className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-[12.5px] rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 p-2.5"
                              >
                                <span className="font-semibold text-foreground">{policy.name}</span>
                                <span
                                  className={cn(
                                    "text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0",
                                    policy.read
                                      ? "bg-emerald-500/10 text-emerald-500"
                                      : "bg-slate-400/10 text-slate-500",
                                  )}
                                >
                                  {policy.read ? "Read" : "Unread"}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {activeStep.key === "meet_manager" && (
                        <div className="space-y-4">
                          {managerCall && managerCall.manager_name && (
                            <>
                              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                                Manager Contact Card
                              </span>
                              <div className="flex flex-col sm:flex-row items-center gap-4 rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 p-4">
                                <div className="h-14 w-14 rounded-2xl bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shadow-lg font-black text-[22px] text-white shrink-0">
                                  {managerCall
                                    .manager_name!.split(" ")
                                    .slice(0, 2)
                                    .map((n) => n[0])
                                    .join("")
                                    .toUpperCase()}
                                </div>
                                <div className="flex-1 text-center sm:text-left space-y-1">
                                  <h4 className="text-[15px] font-bold text-foreground">
                                    {managerCall.manager_name}
                                  </h4>
                                  {managerCall.manager_email && (
                                    <div className="flex flex-wrap items-center justify-center sm:justify-start gap-3 mt-2 text-[11px] text-muted-foreground">
                                      <span className="flex items-center gap-1">
                                        <Mail className="h-3.5 w-3.5" /> {managerCall.manager_email}
                                      </span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </>
                          )}

                          {/* Intro-call scheduling status (driven by the manager's magic-link action) */}
                          {managerCall?.status === "scheduled" ? (
                            <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3 py-3 space-y-2">
                              <div className="flex items-center gap-2 text-[12.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                                <Calendar className="h-4 w-4 shrink-0" />
                                <span>Intro call scheduled — {managerCall.scheduled_label}</span>
                              </div>
                              {managerCall.teams_join_url && (
                                <a
                                  href={managerCall.teams_join_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 text-[12px] font-bold text-[#4b53bc] dark:text-indigo-300 hover:underline"
                                >
                                  <Video className="h-3.5 w-3.5" /> Join Microsoft Teams meeting →
                                </a>
                              )}
                            </div>
                          ) : (
                            <div className="flex items-center gap-2 rounded-xl bg-amber-500/10 border border-amber-500/20 px-3 py-2.5 text-[12px] text-amber-600 dark:text-amber-400">
                              <Clock className="h-4 w-4 shrink-0" />
                              <span>
                                Your intro call isn't scheduled yet
                                {managerCall?.manager_name ? ` — ${managerCall.manager_name} has been invited to pick a time.` : ". Your manager will be invited to pick a time."}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {activeStep.key === "first_training" && (
                        <div className="space-y-4">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Allocated Training Course
                          </span>
                          <div className="rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 p-4 space-y-3">
                            <div>
                              <span className="text-[10px] uppercase text-violet-500 font-extrabold tracking-wider">
                                Company Training
                              </span>
                              <h4 className="text-[14px] font-bold text-foreground mt-0.5">
                                Centriq Platform Security & Compliance Induction
                              </h4>
                            </div>
                            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 text-[11.5px] text-muted-foreground border-t border-slate-200/50 dark:border-white/[0.04] pt-2.5">
                              <span>Estimated time: 2.5 hours</span>
                              <span>Target date: End of week</span>
                            </div>
                          </div>
                        </div>
                      )}

                      {activeStep.key === "explore_assistant" && (
                        <div className="space-y-3">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                            Suggested Quick Actions
                          </span>
                          <div className="flex flex-col gap-2">
                            {[
                              "What are my leave balances?",
                              "How do I request a parking sticker?",
                              "Show my team allocations",
                            ].map((prompt, i) => (
                              <button
                                key={i}
                                onClick={() => askInChat(prompt)}
                                className="w-full flex items-center justify-between rounded-xl border border-slate-200/50 dark:border-white/[0.04] bg-white/40 dark:bg-zinc-950/20 px-3.5 py-2.5 text-left text-[12.5px] font-bold text-foreground hover:bg-violet-500/5 hover:border-violet-500/20 transition-all cursor-pointer group"
                              >
                                <span>{prompt}</span>
                                <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-violet-500 group-hover:translate-x-1 transition-all" />
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Step Action Cta Block */}
                    <div className="flex items-center gap-3 border-t border-slate-200/60 dark:border-white/[0.04] pt-5">
                      {activeStep.status !== "done" && activeStep.status !== "skipped" && (
                        <button
                          onClick={() => onStepCta(activeStep)}
                          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-violet-500 to-indigo-600 px-5 py-2.5 text-[13px] font-bold text-white shadow-lg shadow-violet-500/10 hover:shadow-violet-500/20 hover:scale-[1.01] hover:brightness-[1.03] transition-all cursor-pointer"
                        >
                          {activeStep.kind === "documents" ? (
                            <FileText className="h-4 w-4" />
                          ) : activeStep.kind === "video" ? (
                            <PlayCircle className="h-4 w-4" />
                          ) : (
                            <ArrowRight className="h-4 w-4" />
                          )}
                          {activeStep.cta_label}
                        </button>
                      )}

                      {activeStep.status !== "done" &&
                        activeStep.status !== "skipped" &&
                        !activeStep.auto && (
                          <button
                            onClick={() => completeStep(activeStep.key)}
                            disabled={busyStep === activeStep.key}
                            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 px-5 py-2.5 text-[13px] font-bold text-foreground hover:bg-muted transition-all disabled:opacity-50 cursor-pointer"
                          >
                            {busyStep === activeStep.key ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                            )}
                            Mark as done
                          </button>
                        )}

                      {activeStep.status !== "done" &&
                        activeStep.status !== "skipped" &&
                        activeStep.auto && (
                          <span className="text-[12px] text-muted-foreground italic flex items-center gap-1.5">
                            <InfoIcon className="h-4 w-4 text-violet-500 shrink-0" /> Completes
                            automatically once verified
                          </span>
                        )}

                      {(activeStep.status === "done" || activeStep.status === "skipped") && (
                        <div className="inline-flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-4 py-2.5 text-[13.5px] font-bold text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-4 w-4 stroke-[3px]" /> Step Completed ✓
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}

                {panel === "documents" && view && (
                  <motion.div
                    key="docs"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.25 }}
                  >
                    <DocumentsPanel
                      docs={view.documents}
                      authHeaders={authHeaders}
                      onChanged={load}
                    />
                  </motion.div>
                )}

                {panel === "video-library" && (
                  <motion.div
                    key="video-library"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.25 }}
                  >
                    <VideoLibraryPanel
                      videos={videos}
                      documents={inductionDocs}
                      onSelect={(v) => { setActiveVideo(v); setPanel("video"); }}
                    />
                  </motion.div>
                )}

                {panel === "video" && (
                  <motion.div
                    key="video"
                    initial={{ opacity: 0, y: 15 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -15 }}
                    transition={{ duration: 0.25 }}
                  >
                    <VideoPanel
                      video={activeVideo}
                      onComplete={() => completeStep("induction_video")}
                      onBack={() => { setActiveVideo(null); setPanel("video-library"); }}
                    />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No onboarding details available.
          </div>
        )}
      </div>
    </div>
  );
}

// Info Icon helper
function InfoIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      {...props}
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4" />
      <path d="M12 8h.01" />
    </svg>
  );
}

// ── Step flow mapping icons ───────────────────────
const STEP_ICON: Record<string, typeof Circle> = {
  profile_confirm: UserCheck,
  it_setup: Laptop,
  onboarding_documents: FileText,
  induction_video: PlayCircle,
  policy_ack: BookOpen,
  meet_manager: Users,
  first_training: GraduationCap,
  explore_assistant: Sparkles,
};

const STEP_SHORT: Record<string, string> = {
  profile_confirm: "Profile",
  it_setup: "IT Setup",
  onboarding_documents: "Documents",
  induction_video: "Induction",
  policy_ack: "Policies",
  meet_manager: "Your Team",
  first_training: "Training",
  explore_assistant: "Explore",
};

// ── Documents panel ─────────────────────────────────────────────────────────────
function DocumentsPanel({
  docs,
  authHeaders,
  onChanged,
}: {
  docs: DocView[];
  authHeaders: Record<string, string>;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const [fillDoc, setFillDoc] = useState<DocView | null>(null);
  const [fillValues, setFillValues] = useState<Record<string, string>>({});
  const [filling, setFilling] = useState(false);
  const [sigMode, setSigMode] = useState<"draw" | "type" | "upload">("draw");
  const [typedSig, setTypedSig] = useState("");
  const [uploadedSig, setUploadedSig] = useState<string | null>(null);
  const [sigUploadError, setSigUploadError] = useState<string | null>(null);
  const sigCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);
  const hasDrawnRef = useRef(false);

  const openFill = useCallback((doc: DocView) => {
    setFillValues(Object.fromEntries((doc.fields || []).map((f) => [f, ""])));
    setSigMode("draw");
    setTypedSig("");
    setUploadedSig(null);
    setSigUploadError(null);
    hasDrawnRef.current = false;
    setFillDoc(doc);
  }, []);

  // Normalize an uploaded signature image to a size-capped PNG data URL (drawn onto an
  // offscreen canvas so the backend always receives the same format it already renders —
  // no server-side image-format handling needed).
  const handleSigFile = useCallback((file: File) => {
    setSigUploadError(null);
    if (!file.type.startsWith("image/")) {
      setSigUploadError("Please choose an image file.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const maxW = 452, maxH = 140;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        const c = document.createElement("canvas");
        c.width = Math.max(1, Math.round(img.width * scale));
        c.height = Math.max(1, Math.round(img.height * scale));
        c.getContext("2d")?.drawImage(img, 0, 0, c.width, c.height);
        setUploadedSig(c.toDataURL("image/png"));
      };
      img.onerror = () => setSigUploadError("Couldn't read that image.");
      img.src = reader.result as string;
    };
    reader.onerror = () => setSigUploadError("Couldn't read that file.");
    reader.readAsDataURL(file);
  }, []);

  const clearSignature = useCallback(() => {
    const c = sigCanvasRef.current;
    if (c) c.getContext("2d")?.clearRect(0, 0, c.width, c.height);
    hasDrawnRef.current = false;
  }, []);

  const startDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const c = sigCanvasRef.current;
    if (!c) return;
    drawingRef.current = true;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    ctx.beginPath();
    ctx.moveTo(e.clientX - r.left, e.clientY - r.top);
  }, []);

  const moveDraw = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawingRef.current) return;
    const c = sigCanvasRef.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const r = c.getBoundingClientRect();
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#0f172a";
    ctx.lineTo(e.clientX - r.left, e.clientY - r.top);
    ctx.stroke();
    hasDrawnRef.current = true;
  }, []);

  const endDraw = useCallback(() => {
    drawingRef.current = false;
  }, []);

  // Build a PNG data URL from the drawn canvas, the typed name (rendered in script), or an
  // uploaded signature image.
  const buildSignature = useCallback((): string | null => {
    if (sigMode === "draw") {
      return hasDrawnRef.current && sigCanvasRef.current
        ? sigCanvasRef.current.toDataURL("image/png")
        : null;
    }
    if (sigMode === "upload") {
      return uploadedSig;
    }
    const name = typedSig.trim();
    if (!name) return null;
    const c = document.createElement("canvas");
    c.width = 480;
    c.height = 120;
    const ctx = c.getContext("2d")!;
    ctx.fillStyle = "#0f172a";
    ctx.font = "italic 44px 'Segoe Script', 'Brush Script MT', cursive";
    ctx.textBaseline = "middle";
    ctx.fillText(name, 12, 64);
    return c.toDataURL("image/png");
  }, [sigMode, typedSig, uploadedSig]);

  const submitFill = useCallback(async () => {
    if (!fillDoc) return;
    setFilling(true);
    try {
      const res = await fetch(`/api/onboarding/me/documents/${fillDoc.doc_key}/fill`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ field_values: fillValues, signature: buildSignature() }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.detail || "Couldn't submit");
      toast.success(data.message || "Document completed and sent to HR ✓");
      setFillDoc(null);
      onChanged();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't submit the document.");
    } finally {
      setFilling(false);
    }
  }, [fillDoc, fillValues, authHeaders, onChanged, buildSignature]);

  const downloadFile = useCallback(
    async (url: string, fallbackName: string, errorMsg: string) => {
      try {
        const res = await fetch(url, { headers: authHeaders });
        if (!res.ok) throw new Error(errorMsg);
        const blob = await res.blob();
        const objUrl = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = objUrl;
        const cd = res.headers.get("Content-Disposition") || "";
        const m = cd.match(/filename="?([^"]+)"?/);
        a.download = m?.[1] || fallbackName;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(objUrl);
      } catch {
        toast.error(errorMsg);
      }
    },
    [authHeaders],
  );

  const download = useCallback(
    (doc: DocView) =>
      downloadFile(
        `/api/onboarding/documents/${doc.doc_key}/template`,
        `${doc.doc_key}.txt`,
        "Couldn't download that template.",
      ),
    [downloadFile],
  );

  const downloadSubmission = useCallback(
    (doc: DocView) =>
      downloadFile(
        `/api/onboarding/me/documents/${doc.doc_key}/submission`,
        doc.original_name || `${doc.doc_key}_filled`,
        "Couldn't download your submission.",
      ),
    [downloadFile],
  );

  const upload = useCallback(
    async (doc: DocView, file: File) => {
      setBusy(doc.doc_key);
      try {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch(`/api/onboarding/me/documents/${doc.doc_key}/upload`, {
          method: "POST",
          headers: authHeaders,
          body: fd,
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(data?.detail || "Upload failed");
        toast.success(data.message || "Uploaded and sent to HR ✓");
        onChanged();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Upload failed.");
      } finally {
        setBusy(null);
      }
    },
    [authHeaders, onChanged],
  );

  return (
    <div className="rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-6 shadow-xl space-y-6">
      <div>
        <div className="flex items-center gap-2">
          <ListChecks className="h-5 w-5 text-violet-500" />
          <h2 className="text-[17px] font-black text-foreground">Joining Documents Checklist</h2>
        </div>
        <p className="text-[12.5px] text-muted-foreground mt-1">
          Download templates, fill them, and upload them below. Completed files are securely
          forwarded to HR.
        </p>
      </div>

      <div className="space-y-4">
        {docs.map((doc) => {
          const isDragging = dragOverKey === doc.doc_key;
          return (
            <div
              key={doc.doc_key}
              onDragOver={(e) => {
                e.preventDefault();
                setDragOverKey(doc.doc_key);
              }}
              onDragLeave={() => setDragOverKey(null)}
              onDrop={(e) => {
                e.preventDefault();
                setDragOverKey(null);
                const file = e.dataTransfer.files?.[0];
                if (file) upload(doc, file);
              }}
              className={cn(
                "rounded-2xl border p-5 transition-all space-y-4",
                isDragging
                  ? "border-violet-500 bg-violet-500/5 scale-[1.01]"
                  : "border-slate-200/70 dark:border-white/[0.06] bg-white/40 dark:bg-zinc-950/20",
              )}
            >
              <div className="flex items-start gap-3.5 justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
                    <FileText className="h-5 w-5 text-violet-500" />
                  </div>
                  <div>
                    <h3 className="text-[14px] font-bold text-foreground flex items-center gap-2">
                      {doc.name}
                      {doc.required && (
                        <span className="text-[8px] font-extrabold uppercase px-1.5 py-0.5 rounded bg-rose-500/10 text-rose-500">
                          Required
                        </span>
                      )}
                    </h3>
                    <p className="text-[12px] text-muted-foreground mt-0.5">{doc.description}</p>

                    {doc.submitted && doc.original_name && (
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-500 mt-2 font-medium italic bg-slate-500/5 dark:bg-white/5 rounded-lg px-2.5 py-1">
                        <Check className="h-3.5 w-3.5 text-emerald-500 stroke-[3px]" />
                        <span>Uploaded: {doc.original_name}</span>
                      </div>
                    )}
                  </div>
                </div>

                {doc.submitted && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0">
                    <Check className="h-3 w-3 stroke-[3px]" />{" "}
                    {doc.status === "emailed" ? "Sent to HR" : "Uploaded"}
                  </span>
                )}
              </div>

              {/* Action Buttons & Dropzone */}
              <div className="flex flex-wrap items-center gap-2 border-t border-slate-200/50 dark:border-white/[0.04] pt-4">
                {doc.fields && doc.fields.length > 0 && (
                  <button
                    onClick={() => openFill(doc)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-violet-300 dark:border-violet-700/60 bg-violet-500/10 px-4 py-2 text-[12px] font-bold text-violet-600 dark:text-violet-300 hover:bg-violet-500/20 transition-all cursor-pointer shadow-sm"
                  >
                    <PenLine className="h-3.5 w-3.5" /> Fill in app
                  </button>
                )}

                <button
                  onClick={() => download(doc)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 px-4 py-2 text-[12px] font-bold text-foreground hover:bg-muted transition-all cursor-pointer shadow-sm"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" /> Download Form
                </button>

                {doc.submitted && (
                  <button
                    onClick={() => downloadSubmission(doc)}
                    title="Download the exact filled file that was saved and sent to HR"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-300 dark:border-emerald-700/60 bg-emerald-500/10 px-4 py-2 text-[12px] font-bold text-emerald-600 dark:text-emerald-300 hover:bg-emerald-500/20 transition-all cursor-pointer shadow-sm"
                  >
                    <Download className="h-3.5 w-3.5" /> Download My Submission
                  </button>
                )}

                <label className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-violet-500 to-indigo-600 px-4 py-2 text-[12px] font-bold text-white shadow-md shadow-violet-500/10 hover:shadow-violet-500/20 hover:scale-[1.01] hover:brightness-[1.03] transition-all cursor-pointer">
                  {busy === doc.doc_key ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {doc.submitted ? "Re-upload document" : "Upload document"}
                  <input
                    type="file"
                    className="hidden"
                    disabled={busy === doc.doc_key}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) upload(doc, f);
                      e.target.value = "";
                    }}
                  />
                </label>

                <span className="text-[11px] text-muted-foreground/80 italic ml-auto hidden sm:inline">
                  or drag & drop file here
                </span>
              </div>
            </div>
          );
        })}
      </div>

      {/* In-app fill modal — inputs come from the doc's declared fields, not parsed from a file */}
      <AnimatePresence>
        {fillDoc && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => !filling && setFillDoc(null)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 280, damping: 26 }}
              className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl bg-white dark:bg-zinc-950 border border-slate-200/80 dark:border-white/[0.08] shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between px-6 pt-5 pb-3 border-b border-slate-100 dark:border-white/[0.05]">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div className="h-9 w-9 rounded-xl bg-violet-500/10 border border-violet-500/15 flex items-center justify-center shrink-0">
                    <PenLine className="h-4.5 w-4.5 text-violet-500" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-black text-foreground truncate">{fillDoc.name}</h3>
                    <p className="text-[11.5px] text-muted-foreground">
                      Fill the fields below — we'll create the document and send it to HR.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => !filling && setFillDoc(null)}
                  className="text-muted-foreground hover:text-foreground rounded-lg p-1.5 transition-colors shrink-0"
                >
                  <XIcon className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-auto px-6 py-4 space-y-3.5">
                {(fillDoc.fields || []).map((f) => (
                  <div key={f}>
                    <label className="block text-[11.5px] font-bold text-foreground mb-1.5">{f}</label>
                    <input
                      value={fillValues[f] || ""}
                      onChange={(e) => setFillValues((v) => ({ ...v, [f]: e.target.value }))}
                      placeholder={`Enter ${f.toLowerCase()}`}
                      className="w-full h-10 px-3 rounded-lg border border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-zinc-900/60 text-[13px] text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50 focus:border-violet-400/60 transition-all"
                    />
                  </div>
                ))}

                {/* Digital signature — draw or type */}
                <div className="pt-1">
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-[11.5px] font-bold text-foreground">Signature</label>
                    <div className="flex items-center gap-0.5 rounded-lg border border-slate-200/70 dark:border-white/[0.08] p-0.5">
                      {(["draw", "type", "upload"] as const).map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={() => setSigMode(m)}
                          className={cn(
                            "px-2.5 py-1 rounded-md text-[11px] font-semibold capitalize transition-all",
                            sigMode === m
                              ? "bg-violet-600 text-white"
                              : "text-muted-foreground hover:text-foreground",
                          )}
                        >
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>
                  {sigMode === "draw" ? (
                    <div className="relative">
                      <canvas
                        ref={sigCanvasRef}
                        width={452}
                        height={120}
                        onPointerDown={startDraw}
                        onPointerMove={moveDraw}
                        onPointerUp={endDraw}
                        onPointerLeave={endDraw}
                        className="w-full h-[120px] rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 touch-none cursor-crosshair"
                      />
                      <button
                        type="button"
                        onClick={clearSignature}
                        className="absolute top-1.5 right-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground bg-white/80 dark:bg-zinc-800/80 rounded px-1.5 py-0.5"
                      >
                        Clear
                      </button>
                      <p className="text-[10.5px] text-muted-foreground mt-1">Draw your signature above.</p>
                    </div>
                  ) : sigMode === "type" ? (
                    <div>
                      <input
                        value={typedSig}
                        onChange={(e) => setTypedSig(e.target.value)}
                        placeholder="Type your full name"
                        className="w-full h-11 px-3 rounded-lg border border-slate-200/80 dark:border-white/[0.08] bg-white/80 dark:bg-zinc-900/60 text-[20px] italic text-foreground placeholder:text-[13px] placeholder:not-italic placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-violet-500/50"
                        style={{ fontFamily: "'Segoe Script','Brush Script MT',cursive" }}
                      />
                      <p className="text-[10.5px] text-muted-foreground mt-1">
                        Your typed name becomes your digital signature.
                      </p>
                    </div>
                  ) : (
                    <div>
                      {uploadedSig ? (
                        <div className="relative rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 h-[120px] flex items-center justify-center p-2">
                          <img
                            src={uploadedSig}
                            alt="Uploaded signature"
                            className="max-h-full max-w-full object-contain"
                          />
                          <button
                            type="button"
                            onClick={() => setUploadedSig(null)}
                            className="absolute top-1.5 right-1.5 text-[10px] font-semibold text-muted-foreground hover:text-foreground bg-white/80 dark:bg-zinc-800/80 rounded px-1.5 py-0.5"
                          >
                            Clear
                          </button>
                        </div>
                      ) : (
                        <label className="flex flex-col items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 h-[120px] cursor-pointer hover:border-violet-400/60 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-all">
                            <Upload className="h-4.5 w-4.5 text-muted-foreground" />
                            <span className="text-[11px] font-semibold text-muted-foreground">
                              Click to upload a signature image
                            </span>
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(e) => {
                                const f = e.target.files?.[0];
                                if (f) handleSigFile(f);
                                e.target.value = "";
                              }}
                            />
                          </label>
                      )}
                      <p className="text-[10.5px] text-muted-foreground mt-1">
                        {sigUploadError || "Upload a photo or scan of your signature (PNG/JPG)."}
                      </p>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-slate-100 dark:border-white/[0.05]">
                <button
                  onClick={() => setFillDoc(null)}
                  disabled={filling}
                  className="rounded-xl px-4 py-2 text-[12.5px] font-semibold text-muted-foreground hover:bg-muted/60 transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  onClick={submitFill}
                  disabled={filling}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-violet-500 to-indigo-600 px-4 py-2 text-[12.5px] font-bold text-white shadow-md hover:brightness-[1.03] transition-all disabled:opacity-60"
                >
                  {filling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Submit to HR
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Video library picker ───────────────────────────────────────────────────────
function VideoLibraryPanel({
  videos,
  documents = [],
  onSelect,
}: {
  videos: VideoView[];
  documents?: InductionDocView[];
  onSelect: (v: VideoView) => void;
}) {
  if (videos.length === 0 && documents.length === 0) {
    return (
      <div className="rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-8 shadow-xl flex items-center gap-3 text-muted-foreground">
        <Loader2 className="h-5 w-5 animate-spin text-violet-500 shrink-0" />
        Loading induction content…
      </div>
    );
  }

  return (
    <div className="rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-6 shadow-xl space-y-5">
      <div className="flex items-center gap-2">
        <PlayCircle className="h-5 w-5 text-violet-500" />
        <h2 className="text-[17px] font-black text-foreground">Induction Videos</h2>
        <span className="ml-auto text-[12px] text-muted-foreground font-medium">{videos.length} video{videos.length !== 1 ? "s" : ""}</span>
      </div>
      {videos.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {videos.map((v) => (
            <button
              key={v.id ?? v.title}
              onClick={() => onSelect(v)}
              className="group text-left rounded-2xl border border-slate-200/70 dark:border-white/[0.07] bg-white/70 dark:bg-zinc-900/50 p-5 hover:border-violet-400/60 hover:bg-violet-50/40 dark:hover:bg-violet-950/20 transition-all shadow-sm hover:shadow-md cursor-pointer space-y-2"
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5 h-9 w-9 rounded-xl bg-gradient-to-tr from-violet-500 to-indigo-600 flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                  <PlayCircle className="h-4.5 w-4.5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[14px] font-bold text-foreground leading-snug truncate">{v.title}</p>
                  {v.description && (
                    <p className="text-[12px] text-muted-foreground mt-0.5 line-clamp-2 leading-relaxed">{v.description}</p>
                  )}
                </div>
              </div>
              {v.chapters.length > 0 && (
                <p className="text-[11px] text-muted-foreground pl-12">{v.chapters.length} chapters</p>
              )}
            </button>
          ))}
        </div>
      )}

      {documents.length > 0 && (
        <div className="space-y-3 pt-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4.5 w-4.5 text-indigo-500" />
            <h3 className="text-[14px] font-black text-foreground">Reference Documents</h3>
            <span className="ml-auto text-[12px] text-muted-foreground font-medium">
              {documents.length} document{documents.length !== 1 ? "s" : ""}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {documents.map((d) => (
              <a
                key={d.id}
                href={d.url}
                target="_blank"
                rel="noreferrer"
                className="group flex items-start gap-3 rounded-2xl border border-slate-200/70 dark:border-white/[0.07] bg-white/70 dark:bg-zinc-900/50 p-4 hover:border-indigo-400/60 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-all shadow-sm hover:shadow-md"
              >
                <div className="mt-0.5 h-9 w-9 rounded-xl bg-gradient-to-tr from-indigo-500 to-violet-600 flex items-center justify-center shrink-0 shadow-md group-hover:scale-105 transition-transform">
                  <FileText className="h-4.5 w-4.5 text-white" />
                </div>
                <div className="min-w-0">
                  <p className="text-[13.5px] font-bold text-foreground leading-snug truncate">{d.title}</p>
                  {d.description && (
                    <p className="text-[11.5px] text-muted-foreground mt-0.5 line-clamp-2">{d.description}</p>
                  )}
                  <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-500 mt-1">
                    <Download className="h-3 w-3" /> Open
                  </span>
                </div>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Induction video panel — custom chaptered player ───────────────────────────
const PLAYBACK_RATES = [1, 1.25, 1.5, 2];
const INDUCTION_CHAPTERS = [
  { title: "Welcome", start: 0 },
  { title: "Who we are", start: 45 },
  { title: "How we work", start: 120 },
  { title: "Meet the teams", start: 210 },
  { title: "Your first week", start: 300 },
  { title: "Where to get help", start: 380 },
];

function VideoPanel({
  video,
  onComplete,
  onBack,
}: {
  video: VideoView | null;
  onComplete: () => void;
  onBack: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const barRef = useRef<HTMLDivElement | null>(null);
  const hideTimer = useRef<number | null>(null);
  const firedComplete = useRef(false);

  const [playing, setPlaying] = useState(false);
  const [cur, setCur] = useState(0);
  const [dur, setDur] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [muted, setMuted] = useState(false);
  const [rate, setRate] = useState(1);
  const [fs, setFs] = useState(false);
  const [showCtrl, setShowCtrl] = useState(true);
  const [ended, setEnded] = useState(false);

  const chapters = video?.chapters ?? INDUCTION_CHAPTERS;
  const segs = useMemo(
    () =>
      chapters.map((c, i) => ({
        ...c,
        end: i < chapters.length - 1 ? chapters[i + 1].start : dur || c.start + 1,
      })),
    [chapters, dur],
  );
  const activeIdx = useMemo(() => {
    let idx = -1;
    chapters.forEach((c, i) => {
      if (cur + 0.25 >= c.start) idx = i;
    });
    return idx;
  }, [chapters, cur]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const seekTo = useCallback((t: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(t, v.duration || t));
    setEnded(false);
  }, []);

  const onBarPointer = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const bar = barRef.current;
      const v = videoRef.current;
      if (!bar || !v || !v.duration) return;
      const rect = bar.getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      seekTo(frac * v.duration);
    },
    [seekTo],
  );

  const cycleRate = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    const next = PLAYBACK_RATES[(PLAYBACK_RATES.indexOf(rate) + 1) % PLAYBACK_RATES.length];
    v.playbackRate = next;
    setRate(next);
  }, [rate]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFs = useCallback(() => {
    const w = wrapRef.current;
    if (!w) return;
    if (!document.fullscreenElement) w.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.();
  }, []);

  const nudgeControls = useCallback(() => {
    setShowCtrl(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowCtrl(false);
    }, 2600);
  }, []);

  useEffect(() => {
    const onFsChange = () => setFs(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onFsChange);
    return () => {
      document.removeEventListener("fullscreenchange", onFsChange);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, []);

  if (!video) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin text-violet-500" /> Loading induction…
      </div>
    );
  }

  const pct = dur ? (cur / dur) * 100 : 0;
  const bufPct = dur ? (buffered / dur) * 100 : 0;

  return (
    <div className="rounded-3xl border border-slate-200/70 dark:border-white/[0.06] bg-white/60 dark:bg-zinc-950/40 backdrop-blur-xl p-6 shadow-xl space-y-6">
      <div className="flex items-center gap-2">
        <PlayCircle className="h-5 w-5 text-violet-500" />
        <h2 className="text-[17px] font-black text-foreground">
          {video.title || "Team Induction Video"}
        </h2>
        {ended && (
          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
            <Check className="h-3 w-3 stroke-[3px]" /> Watched
          </span>
        )}
      </div>

      {video.url ? (
        <div
          ref={wrapRef}
          onMouseMove={nudgeControls}
          onMouseLeave={() => {
            if (playing) setShowCtrl(false);
          }}
          className="relative rounded-2xl overflow-hidden border border-slate-200/70 dark:border-white/[0.06] bg-black shadow-xl group select-none"
        >
          <video
            ref={videoRef}
            src={video.url}
            playsInline
            onClick={togglePlay}
            onPlay={() => {
              setPlaying(true);
              nudgeControls();
            }}
            onPause={() => {
              setPlaying(false);
              setShowCtrl(true);
            }}
            onTimeUpdate={(e) => setCur(e.currentTarget.currentTime)}
            onLoadedMetadata={(e) => setDur(e.currentTarget.duration)}
            onProgress={(e) => {
              const v = e.currentTarget;
              try {
                if (v.buffered.length) setBuffered(v.buffered.end(v.buffered.length - 1));
              } catch {
                /* noop */
              }
            }}
            onEnded={() => {
              setPlaying(false);
              setEnded(true);
              setShowCtrl(true);
              if (!firedComplete.current) {
                firedComplete.current = true;
                onComplete();
              }
            }}
            className="w-full aspect-video bg-black cursor-pointer"
          />

          {/* Center play / replay */}
          <AnimatePresence>
            {!playing && (
              <motion.button
                key="bigplay"
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                onClick={togglePlay}
                className="absolute inset-0 m-auto h-16 w-16 grid place-items-center rounded-full bg-white/15 backdrop-blur-md ring-1 ring-white/30 text-white hover:bg-white/25 transition-colors cursor-pointer"
              >
                {ended ? (
                  <RotateCcw className="h-7 w-7" />
                ) : (
                  <Play className="h-7 w-7 translate-x-0.5" />
                )}
              </motion.button>
            )}
          </AnimatePresence>

          {/* Current chapter label (top-left) */}
          <div
            className={cn(
              "absolute top-3 left-3 transition-opacity",
              showCtrl ? "opacity-100" : "opacity-0",
            )}
          >
            {activeIdx >= 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-black/65 backdrop-blur-md px-2.5 py-1 text-[11px] font-semibold text-white">
                <span className="text-violet-300">
                  {activeIdx + 1}/{chapters.length}
                </span>{" "}
                {chapters[activeIdx].title}
              </span>
            )}
          </div>

          {/* Controls */}
          <motion.div
            initial={false}
            animate={{ opacity: showCtrl ? 1 : 0, y: showCtrl ? 0 : 8 }}
            transition={{ duration: 0.2 }}
            className="absolute inset-x-0 bottom-0 px-3 pb-3 pt-10 bg-gradient-to-t from-black/70 via-black/30 to-transparent"
          >
            {/* Scrubber */}
            <div
              ref={barRef}
              onPointerDown={onBarPointer}
              className="relative h-1.5 hover:h-2.5 transition-[height] rounded-full bg-white/25 cursor-pointer mb-2.5"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-white/25"
                style={{ width: `${bufPct}%` }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-gradient-to-r from-violet-400 to-indigo-400"
                style={{ width: `${pct}%` }}
              />
              {/* chapter dividers */}
              {dur > 0 &&
                chapters
                  .slice(1)
                  .map((c, i) => (
                    <div
                      key={i}
                      className="absolute top-1/2 -translate-y-1/2 w-px h-2.5 bg-white/50"
                      style={{ left: `${(c.start / dur) * 100}%` }}
                    />
                  ))}
              <div
                className="absolute top-1/2 -translate-y-1/2 h-3 w-3 rounded-full bg-white shadow ring-2 ring-violet-500"
                style={{ left: `${pct}%`, marginLeft: -6 }}
              />
            </div>

            <div className="flex items-center gap-2 text-white">
              <button
                onClick={togglePlay}
                className="grid place-items-center h-8 w-8 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
              >
                {playing ? (
                  <Pause className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4 translate-x-0.5" />
                )}
              </button>
              <button
                onClick={toggleMute}
                className="grid place-items-center h-8 w-8 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
              <span className="text-[11px] tabular-nums text-white/90 ml-0.5">
                {fmtTime(Math.floor(cur))} / {fmtTime(Math.floor(dur))}
              </span>
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={cycleRate}
                  className="h-8 px-2 rounded-lg text-[11px] font-bold hover:bg-white/15 transition-colors tabular-nums cursor-pointer"
                >
                  {rate}×
                </button>
                <button
                  onClick={toggleFs}
                  className="grid place-items-center h-8 w-8 rounded-lg hover:bg-white/15 transition-colors cursor-pointer"
                >
                  {fs ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      ) : (
        <div className="relative rounded-2xl overflow-hidden border border-slate-200/70 dark:border-white/[0.06] aspect-video grid place-items-center bg-gradient-to-br from-violet-600/90 via-indigo-600/90 to-fuchsia-600/80 text-center px-6 shadow-lg">
          <div
            className="absolute inset-0 opacity-20"
            style={{
              backgroundImage: "radial-gradient(circle at 30% 30%, white 0, transparent 45%)",
            }}
          />
          <div className="relative">
            <div className="mx-auto mb-3 h-14 w-14 grid place-items-center rounded-2xl bg-white/15 ring-1 ring-white/30 backdrop-blur-md">
              <PlayCircle className="h-7 w-7 text-white" />
            </div>
            <p className="text-[15px] font-black text-white">
              {video.title || "Team Induction Video"}
            </p>
            <p className="text-[12px] text-white/80 mt-1.5 max-w-sm mx-auto">
              Your induction video will play here. An admin can set the video URL in configuration
              to enable playback.
            </p>
          </div>
        </div>
      )}

      {/* Chapter rail */}
      {chapters.length > 0 && (
        <div className="mt-4 border-t border-slate-200/50 dark:border-white/[0.04] pt-4">
          <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
            Interactive Index / Chapters
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {chapters.map((ch, i) => {
              const seg = segs[i];
              const isActive = i === activeIdx;
              const isDone = cur >= seg.end - 0.4;
              const within =
                isActive && seg.end > ch.start
                  ? Math.max(0, Math.min(1, (cur - ch.start) / (seg.end - ch.start)))
                  : isDone
                    ? 1
                    : 0;
              return (
                <button
                  key={i}
                  onClick={() => {
                    seekTo(ch.start);
                    videoRef.current?.play().catch(() => {});
                  }}
                  disabled={!video.url}
                  className={cn(
                    "relative overflow-hidden flex items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition-all cursor-pointer disabled:opacity-50",
                    isActive
                      ? "border-violet-500/50 bg-violet-500/5"
                      : "border-slate-200/70 dark:border-white/[0.06] bg-white/40 dark:bg-zinc-950/20 hover:border-violet-500/30",
                  )}
                >
                  <span
                    className={cn(
                      "grid place-items-center h-7 w-7 rounded-lg text-[11px] font-bold shrink-0",
                      isDone
                        ? "bg-emerald-500 text-white"
                        : isActive
                          ? "bg-gradient-to-tr from-violet-500 to-indigo-600 text-white shadow-md shadow-violet-500/10"
                          : "bg-slate-200 dark:bg-zinc-800 text-muted-foreground",
                    )}
                  >
                    {isDone ? (
                      <Check className="h-4.5 w-4.5 stroke-[3px]" />
                    ) : isActive && playing ? (
                      <span className="flex gap-0.5 items-end h-3">
                        <motion.span
                          className="w-0.5 bg-white rounded-full"
                          animate={{ height: [4, 12, 4] }}
                          transition={{ duration: 0.7, repeat: Infinity }}
                        />
                        <motion.span
                          className="w-0.5 bg-white rounded-full"
                          animate={{ height: [10, 4, 10] }}
                          transition={{ duration: 0.7, repeat: Infinity, delay: 0.15 }}
                        />
                        <motion.span
                          className="w-0.5 bg-white rounded-full"
                          animate={{ height: [6, 12, 6] }}
                          transition={{ duration: 0.7, repeat: Infinity, delay: 0.3 }}
                        />
                      </span>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-[12.5px] font-bold text-foreground truncate">
                      {ch.title}
                    </span>
                    <span className="block text-[11px] tabular-nums text-muted-foreground mt-0.5">
                      {fmtTime(ch.start)}
                    </span>
                  </span>
                  {within > 0 && within < 1 && (
                    <span
                      className="absolute bottom-0 left-0 h-0.5 bg-gradient-to-r from-violet-500 to-indigo-500"
                      style={{ width: `${within * 100}%` }}
                    />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer operations */}
      <div className="flex items-center gap-2 mt-5 border-t border-slate-200/50 dark:border-white/[0.04] pt-4">
        <button
          onClick={() => {
            onComplete();
            onBack();
          }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-tr from-violet-500 to-indigo-600 px-4 py-2 text-[13px] font-bold text-white shadow-md shadow-violet-500/10 hover:shadow-violet-500/20 hover:scale-[1.01] transition-all cursor-pointer"
        >
          <CheckCircle2 className="h-4 w-4" /> Mark watched & continue
        </button>
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-zinc-700 bg-white/70 dark:bg-zinc-900/60 px-4 py-2 text-[12px] font-bold text-muted-foreground hover:text-foreground transition-all cursor-pointer"
        >
          <ArrowLeft className="h-4 w-4" /> Back to steps
        </button>
      </div>
    </div>
  );
}
