import { useState, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarX2,
  MapPin,
  Clock,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Trash2,
} from "lucide-react";
import { flyBanner } from "@/lib/fly-banner";

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
  onCancelled: (message: string) => void;
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
  const s = start.slice(11, 16);
  const e = end.slice(11, 16);
  return `${fmt12(s)} – ${fmt12(e)}`;
}

export function CancelBookingWidget({ userEmail, userRole, onCancelled }: Props) {
  const auth = useMemo(
    () => ({ "x-user-email": userEmail, "x-user-role": userRole.toLowerCase() }),
    [userEmail, userRole],
  );

  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null); // event id being cancelled
  const [cancelled, setCancelled] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch("/api/ms365/my-room-bookings?days=14", { headers: auth });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError(
            res.status === 401
              ? "Microsoft account not connected. Go to Settings → Connected Accounts."
              : (data.detail ?? "Failed to load bookings."),
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
  }, [auth]);

  const handleCancel = async (booking: Booking) => {
    if (cancelling) return;
    setCancelling(booking.id);
    try {
      const res = await fetch(`/api/ms365/events/${encodeURIComponent(booking.id)}`, {
        method: "DELETE",
        headers: auth,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail ?? "Cancellation failed.");
      }
      setCancelled((prev) => new Set([...prev, booking.id]));
      flyBanner(`${booking.room_name} booking cancelled`);
      onCancelled(
        `✅ Booking cancelled — **${booking.room_name}** on ${fmtDate(booking.start)}, ` +
          `${fmtTimeRange(booking.start, booking.end)} (**"${booking.subject}"**)`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Cancellation failed.");
    } finally {
      setCancelling(null);
    }
  };

  const visible = bookings.filter((b) => !cancelled.has(b.id));

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: "spring", stiffness: 300, damping: 30 }}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <CalendarX2 className="h-3.5 w-3.5 text-destructive" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Cancel a Room Booking
        </span>
      </div>

      <div className="p-4">
        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2.5 py-3 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
            Loading your upcoming room bookings…
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {error}
          </div>
        )}

        {/* No bookings */}
        {!loading && !error && visible.length === 0 && (
          <p className="py-2 text-sm text-muted-foreground">
            No upcoming room bookings found in the next 14 days.
          </p>
        )}

        {/* Booking list */}
        <AnimatePresence>
          {visible.map((booking) => (
            <motion.div
              key={booking.id}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: -8, transition: { duration: 0.2 } }}
              className="mb-2 flex items-start justify-between gap-3 rounded-xl border border-border bg-background px-3 py-3 last:mb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{booking.subject}</p>
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <MapPin className="h-3 w-3 text-primary" />
                    {booking.room_name}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {fmtDate(booking.start)} · {fmtTimeRange(booking.start, booking.end)}
                  </span>
                </div>
              </div>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => handleCancel(booking)}
                disabled={cancelling === booking.id}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-1.5 text-xs font-semibold text-destructive transition-all hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {cancelling === booking.id ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
                {cancelling === booking.id ? "Cancelling…" : "Cancel"}
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>

        {/* All cancelled */}
        {!loading && !error && bookings.length > 0 && visible.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 py-2 text-sm text-emerald-600 dark:text-emerald-400"
          >
            <CheckCircle2 className="h-4 w-4" />
            All bookings cancelled.
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}
