import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CalendarDays, MapPin, Clock, Loader2, AlertCircle } from "lucide-react";

interface Booking {
  id: string;
  subject: string;
  start: string;
  end: string;
  room_name: string;
  room_email: string;
}

interface Props {
  userEmail: string;
  userRole: string;
  days?: number;
}

function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDate(iso: string) {
  const [y, mo, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, mo - 1, d).toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
}

function fmtTimeRange(start: string, end: string) {
  return `${fmt12(start.slice(11, 16))} – ${fmt12(end.slice(11, 16))}`;
}

/** Read-only view of the user's upcoming meetings — a zero-LLM fast-path that pulls
 *  straight from the existing /api/ms365/my-room-bookings endpoint. */
export function MyScheduleWidget({ userEmail, userRole, days = 7 }: Props) {
  const auth = useMemo(
    () => ({ "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() }),
    [userEmail, userRole],
  );

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/ms365/my-room-bookings?days=${days}`, { headers: auth });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            res.status === 401
              ? "Microsoft account not connected. Go to Settings → Connected Accounts."
              : (data.detail ?? "Failed to load your schedule."),
          );
          return;
        }
        setBookings(data.bookings ?? []);
      } catch {
        setError("Could not reach the server. Please try again.");
      } finally {
        setLoading(false);
      }
    })();
  }, [auth, days]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <CalendarDays className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Your Upcoming Meetings
        </span>
      </div>

      <div className="p-4">
        {loading && (
          <div className="flex items-center gap-2.5 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading your schedule…
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {!loading && !error && bookings.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">
            Nothing on your calendar in the next {days} days.
          </p>
        )}

        <AnimatePresence>
          {bookings.map((b) => (
            <motion.div
              key={b.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-2 rounded-xl border border-border bg-background px-3 py-3 last:mb-0"
            >
              <p className="truncate text-sm font-semibold text-foreground">{b.subject}</p>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-3 w-3 text-primary" />
                  {fmtDate(b.start)} · {fmtTimeRange(b.start, b.end)}
                </span>
                {b.room_name && (
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3" />
                    {b.room_name}
                  </span>
                )}
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
