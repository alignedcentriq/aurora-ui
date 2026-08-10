import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarClock,
  Cake,
  PartyPopper,
  MapPin,
  AlertCircle,
  PanelRightOpen,
  PanelRightClose,
  Gift,
  Loader2,
  Check,
  Mail,
  type LucideIcon,
} from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth-store";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── Shared section shell ──────────────────────────────────────────────────────

function RailSection({
  icon: Icon,
  label,
  accent,
  children,
}: {
  icon: LucideIcon;
  label: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <Icon className="h-3.5 w-3.5" style={{ color: accent }} />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
      </div>
      <div className="p-3">{children}</div>
    </div>
  );
}

function EmptyRow({ text }: { text: string }) {
  return <p className="px-1 py-2 text-[12px] text-muted-foreground">{text}</p>;
}

function ErrorRow({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-[11px] text-destructive">
      <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      {text}
    </div>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .map((n) => n[0]?.toUpperCase())
    .slice(0, 2)
    .join("");
}

/** A truncated line of text that shows the full value in a tooltip on hover. */
function TruncatedText({ text, className }: { text: string; className?: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <p className={cn("truncate", className)}>{text}</p>
      </TooltipTrigger>
      <TooltipContent side="top">{text}</TooltipContent>
    </Tooltip>
  );
}

/** Shared send-a-Teams-DM flow behind both the birthday-wish and congratulate buttons. */
function useTeamsSend(email: string, message: string, successText: string, authHeaders: Record<string, string>) {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");

  const send = async () => {
    if (state !== "idle") return;
    setState("sending");
    try {
      const res = await fetch("/api/ms365/send-teams-message", {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ email, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        toast.error(
          res.status === 401
            ? "Connect your Microsoft account in Settings to send Teams messages."
            : (data.detail ?? "Couldn't send the message."),
        );
        setState("idle");
        return;
      }
      toast.success(successText);
      setState("sent");
    } catch {
      toast.error("Couldn't reach the server.");
      setState("idle");
    }
  };

  return { state, send };
}

// ── Meetings (real — Microsoft 365 calendar) ─────────────────────────────────

interface MeetingEvent {
  subject: string;
  start: string;
  end: string;
  location: string;
  organizer_name: string;
}

function fmtTime(iso: string) {
  const hhmm = iso.slice(11, 16);
  const [h, m] = hhmm.split(":").map(Number);
  if (Number.isNaN(h)) return "";
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function MeetingsSection({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [events, setEvents] = useState<MeetingEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/ms365/my-meetings?days=1", { headers: authHeaders })
      .then(async (res) => {
        const data = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError(
            res.status === 401
              ? "Connect your Microsoft account in Settings to see your meetings."
              : (data.detail ?? "Couldn't load your meetings."),
          );
          return;
        }
        setEvents(data.events ?? []);
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  return (
    <RailSection icon={CalendarClock} label="Today's Meetings" accent="var(--connectivity)">
      {error && <ErrorRow text={error} />}
      {!error && events === null && (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      )}
      {!error && events !== null && events.length === 0 && (
        <EmptyRow text="No meetings on your calendar today." />
      )}
      <AnimatePresence>
        {events?.slice(0, 5).map((ev, i) => (
          <motion.div
            key={`${ev.subject}-${ev.start}-${i}`}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-1.5 rounded-xl border border-border bg-background px-3 py-2 last:mb-0"
          >
            <TruncatedText text={ev.subject} className="text-[13px] font-semibold text-foreground" />
            <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
              <span>{fmtTime(ev.start)} – {fmtTime(ev.end)}</span>
              {ev.location && (
                <span className="flex items-center gap-1">
                  <MapPin className="h-3 w-3" />
                  {ev.location}
                </span>
              )}
            </div>
          </motion.div>
        ))}
      </AnimatePresence>
    </RailSection>
  );
}

// ── Appreciation board (dummy data) ──────────────────────────────────────────

interface KudosAttachment {
  subject: string;
  from: string;
  snippet: string;
}

interface KudosEntry {
  name: string;
  email: string;
  message: string;
  from: string;
  attachment?: KudosAttachment;
}

const DUMMY_KUDOS: KudosEntry[] = [
  {
    name: "Ananya Rao",
    email: "ananya.rao@alignedautomation.com",
    message: "Shipped the dashboard redesign a day early — huge!",
    from: "Vikram Shah",
    attachment: {
      subject: "Kudos to Ananya!",
      from: "vikram.shah@alignedautomation.com",
      snippet:
        "Just wanted to call out Ananya's work on the dashboard redesign — shipped a full day ahead of schedule and the client loved it. Great job!",
    },
  },
  {
    name: "Rahul Mehta",
    email: "rahul.mehta@alignedautomation.com",
    message: "Went above and beyond helping onboard the new hires.",
    from: "Priya Nair",
  },
  {
    name: "Sneha Iyer",
    email: "sneha.iyer@alignedautomation.com",
    message: "Great catch on that production bug before it shipped.",
    from: "Arjun Kapoor",
    attachment: {
      subject: "Great catch, Sneha!",
      from: "arjun.kapoor@alignedautomation.com",
      snippet:
        "Sneha spotted a critical bug in QA before it hit production — saved us a very bad Monday. Thank you!",
    },
  },
  {
    name: "Karan Malhotra",
    email: "karan.malhotra@alignedautomation.com",
    message: "Always the first to jump in and help teammates.",
    from: "Divya Menon",
  },
];

function SendCongratsButton({
  name,
  email,
  quote,
  authHeaders,
}: {
  name: string;
  email: string;
  quote: string;
  authHeaders: Record<string, string>;
}) {
  const firstName = name.split(" ")[0] || name;
  const message = `Congratulations, ${firstName}! 🎉 Just saw this shoutout — "${quote}" — well deserved!`;
  const { state, send } = useTeamsSend(
    email,
    message,
    `Sent your congratulations to ${firstName} on Teams!`,
    authHeaders,
  );

  return (
    <Button onClick={send} disabled={state !== "idle"} className="gap-2">
      {state === "sending" ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : state === "sent" ? (
        <Check className="h-4 w-4" />
      ) : (
        <PartyPopper className="h-4 w-4" />
      )}
      {state === "sent" ? "Sent!" : "Send Congratulations"}
    </Button>
  );
}

function AppreciationSection({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [selected, setSelected] = useState<KudosEntry | null>(null);

  return (
    <>
      <RailSection icon={PartyPopper} label="Appreciation Board" accent="var(--collaboration)">
        {DUMMY_KUDOS.map((k, i) => (
          <button
            key={k.name}
            onClick={() => setSelected(k)}
            className={cn(
              "flex w-full items-start gap-2.5 rounded-xl px-1.5 py-2 text-left transition-colors hover:bg-muted/50 cursor-pointer",
              i < DUMMY_KUDOS.length - 1 && "border-b border-border/60",
            )}
          >
            <Avatar className="h-7 w-7 mt-0.5">
              <AvatarFallback className="text-[10px]">{initials(k.name)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <TruncatedText text={k.name} className="text-[12px] font-semibold text-foreground" />
              <p className="line-clamp-2 text-[11.5px] leading-snug text-muted-foreground">
                “{k.message}”
              </p>
              <p className="mt-0.5 text-[10.5px] text-muted-foreground/80">from {k.from}</p>
            </div>
          </button>
        ))}
      </RailSection>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-md">
          {selected && (
            <>
              <DialogHeader>
                <div className="flex items-center gap-3">
                  <Avatar className="h-10 w-10">
                    <AvatarFallback>{initials(selected.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0">
                    <DialogTitle className="truncate">{selected.name}</DialogTitle>
                    <p className="text-xs text-muted-foreground">Appreciated by {selected.from}</p>
                  </div>
                </div>
              </DialogHeader>

              <p className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-sm leading-relaxed text-foreground">
                “{selected.message}”
              </p>

              {selected.attachment && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                    <Mail className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Forwarded email
                    </span>
                  </div>
                  <div className="space-y-1 px-3 py-2.5">
                    <p className="text-[12px] font-semibold text-foreground">
                      {selected.attachment.subject}
                    </p>
                    <p className="text-[11px] text-muted-foreground">From: {selected.attachment.from}</p>
                    <p className="text-[12px] leading-snug text-foreground/80">
                      {selected.attachment.snippet}
                    </p>
                  </div>
                </div>
              )}

              <DialogFooter>
                <SendCongratsButton
                  name={selected.name}
                  email={selected.email}
                  quote={selected.message}
                  authHeaders={authHeaders}
                />
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Celebrations (real — Zoho employee database) ─────────────────────────────

interface Celebration {
  name: string;
  email?: string;
  date: string;
  days_away: number;
  years?: number;
}

function WishButton({
  name,
  email,
  authHeaders,
}: {
  name: string;
  email: string;
  authHeaders: Record<string, string>;
}) {
  const firstName = name.split(" ")[0] || name;
  const message = `Happy Birthday, ${firstName}! 🎉🎂 Hope you have a fantastic day!`;
  const { state, send } = useTeamsSend(
    email,
    message,
    `Sent a Happy Birthday message to ${firstName} on Teams!`,
    authHeaders,
  );

  return (
    <button
      onClick={send}
      disabled={state !== "idle"}
      title={state === "sent" ? "Wish sent" : `Wish ${firstName} a happy birthday on Teams`}
      aria-label={`Wish ${firstName} a happy birthday on Teams`}
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-full transition-all cursor-pointer",
        state === "sent"
          ? "text-emerald-500"
          : "text-muted-foreground hover:bg-primary/10 hover:text-primary",
      )}
    >
      {state === "sending" ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : state === "sent" ? (
        <Check className="h-3.5 w-3.5" />
      ) : (
        <Gift className="h-3.5 w-3.5" />
      )}
    </button>
  );
}

function celebrationLabel(daysAway: number, dateIso: string) {
  if (daysAway === 0) return "Today";
  if (daysAway === 1) return "Tomorrow";
  return new Date(dateIso + "T00:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function CelebrationsSection({ authHeaders }: { authHeaders: Record<string, string> }) {
  const [data, setData] = useState<{ birthdays: Celebration[]; anniversaries: Celebration[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/employees/celebrations?days=14", { headers: authHeaders })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}));
        if (cancelled) return;
        if (!res.ok) {
          setError("Couldn't load upcoming celebrations.");
          return;
        }
        setData({ birthdays: json.birthdays ?? [], anniversaries: json.anniversaries ?? [] });
      })
      .catch(() => {
        if (!cancelled) setError("Couldn't reach the server.");
      });
    return () => {
      cancelled = true;
    };
  }, [authHeaders]);

  const combined = useMemo(() => {
    if (!data) return [];
    return [
      ...data.birthdays.map((b) => ({ ...b, kind: "birthday" as const })),
      ...data.anniversaries.map((a) => ({ ...a, kind: "anniversary" as const })),
    ].sort((a, b) => a.days_away - b.days_away);
  }, [data]);

  return (
    <RailSection icon={Cake} label="Birthdays & Anniversaries" accent="var(--capacity)">
      {error && <ErrorRow text={error} />}
      {!error && data === null && (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}
      {!error && data !== null && combined.length === 0 && (
        <EmptyRow text="Nothing in the next 2 weeks." />
      )}
      {combined.slice(0, 6).map((c, i) => (
        <div
          key={`${c.kind}-${c.name}-${i}`}
          className={cn(
            "flex items-center gap-2.5 px-1.5 py-2",
            i < combined.length - 1 && i < 5 && "border-b border-border/60",
          )}
        >
          <Avatar className="h-7 w-7">
            <AvatarFallback className="text-[10px]">{initials(c.name)}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <TruncatedText text={c.name} className="text-[12px] font-semibold text-foreground" />
            <p className="text-[10.5px] text-muted-foreground">
              {c.kind === "birthday" ? "Birthday" : `${c.years}-year anniversary`}
            </p>
          </div>
          {c.kind === "birthday" && c.email && (
            <WishButton name={c.name} email={c.email} authHeaders={authHeaders} />
          )}
          <Badge variant={c.days_away === 0 ? "success" : "secondary"} className="shrink-0">
            {celebrationLabel(c.days_away, c.date)}
          </Badge>
        </div>
      ))}
    </RailSection>
  );
}

// ── Main rail ─────────────────────────────────────────────────────────────────

const RAIL_OPEN_KEY = "centriq-home-rail-open";

export function HomeRightRail() {
  const { user } = useAuth();
  // Closed by default — only remembers an explicit "open" the user chose before.
  const [open, setOpen] = useState(() => localStorage.getItem(RAIL_OPEN_KEY) === "1");
  const authHeaders = useMemo(
    () => ({
      "x-user-email": user?.email ?? "",
      "x-user-role": (user?.role ?? "employee").toLowerCase(),
    }),
    [user?.email, user?.role],
  );

  const toggle = () => {
    setOpen((v) => {
      const next = !v;
      localStorage.setItem(RAIL_OPEN_KEY, next ? "1" : "0");
      return next;
    });
  };

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("centriq-right-rail-state", { detail: { open } }));
  }, [open]);

  useEffect(() => {
    const handleToggle = () => {
      setOpen((v) => {
        const next = !v;
        localStorage.setItem(RAIL_OPEN_KEY, next ? "1" : "0");
        return next;
      });
    };
    window.addEventListener("centriq-toggle-right-rail", handleToggle);
    return () => window.removeEventListener("centriq-toggle-right-rail", handleToggle);
  }, []);

  if (!user?.email) return null;

  if (!open) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <aside className="hidden lg:flex w-[320px] shrink-0 flex-col overflow-y-auto border-l border-border bg-background/60 p-4">
        <div className="mb-2 flex items-center justify-end">
          <button
            onClick={toggle}
            title="Hide sidebar"
            aria-label="Close sidebar"
            className="flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors cursor-pointer"
          >
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-col gap-4">
          <MeetingsSection authHeaders={authHeaders} />
          <AppreciationSection authHeaders={authHeaders} />
          <CelebrationsSection authHeaders={authHeaders} />
        </div>
      </aside>
    </TooltipProvider>
  );
}
