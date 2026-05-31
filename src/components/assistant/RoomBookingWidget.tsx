import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  CalendarDays, Clock, Users, MapPin, Video,
  CheckCircle2, Loader2, ChevronRight, Building2, AlertCircle,
} from "lucide-react";
import { flyBanner } from "@/lib/fly-banner";
import type { RoomBookingPrefill } from "@/lib/chat-store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface Room {
  name: string; email: string; capacity: number | null;
  building: string; floor: string; wheelchair_accessible: boolean;
}
interface RoomWithStatus extends Room {
  is_free: boolean;
  booked_slots: { status: string; start: string; end: string; subject: string }[];
}
interface Props {
  userEmail: string; userRole: string;
  prefill?: RoomBookingPrefill;
  onBooked: (message: string) => void;
}

// ── Time helpers ──────────────────────────────────────────────────────────────

function localDateISO(offset = 0) {
  const d = new Date(); d.setDate(d.getDate() + offset);
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,"0"), String(d.getDate()).padStart(2,"0")].join("-");
}
function toISO(date: string, hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${date}T${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:00`;
}
function addMinutes(date: string, hhmm: string, mins: number) {
  const [h, m] = hhmm.split(":").map(Number);
  const total = h*60 + m + mins;
  const overflow = Math.floor(total / (60*24));
  let d = date;
  if (overflow > 0) {
    const [y, mo, dd] = date.split("-").map(Number);
    d = new Date(Date.UTC(y, mo-1, dd+overflow)).toISOString().slice(0,10);
  }
  return `${d}T${String(Math.floor(total/60)%24).padStart(2,"0")}:${String(total%60).padStart(2,"0")}:00`;
}
function defaultStartTime() {
  const n = new Date(); const m = n.getMinutes();
  n.setMinutes(m < 30 ? 30 : 60, 0, 0);
  return `${String(n.getHours()).padStart(2,"0")}:${String(n.getMinutes()).padStart(2,"0")}`;
}
function fmt12(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return `${h%12||12}:${String(m).padStart(2,"0")} ${h>=12?"PM":"AM"}`;
}
function fmtDate(iso: string) {
  const [y, mo, d] = iso.split("-").map(Number);
  return new Date(y, mo-1, d).toLocaleDateString("en-IN", { weekday:"short", day:"numeric", month:"short", year:"numeric" });
}
function durationIdx(s?: string, e?: string) {
  if (!s || !e) return 1;
  const [sh,sm]=s.split(":").map(Number); const [eh,em]=e.split(":").map(Number);
  const mins = (eh*60+em)-(sh*60+sm);
  const i = DURATION_OPTIONS.findIndex(d=>d.minutes===mins);
  return i>=0 ? i : 1;
}

const TIME_OPTIONS = (() => {
  const opts: {label:string; value:string}[] = [];
  for (let h=7; h<=20; h++) for (const m of [0,30]) {
    if (h===20&&m===30) continue;
    const dh = h>12?h-12:h===0?12:h;
    opts.push({ label:`${dh}:${String(m).padStart(2,"0")} ${h<12?"AM":"PM"}`, value:`${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}` });
  }
  return opts;
})();
const DURATION_OPTIONS = [
  {label:"30 min",minutes:30},{label:"1 hour",minutes:60},
  {label:"1.5 hours",minutes:90},{label:"2 hours",minutes:120},{label:"3 hours",minutes:180},
];

// ── Component ─────────────────────────────────────────────────────────────────

export function RoomBookingWidget({ userEmail, userRole, prefill, onBooked }: Props) {
  const auth = useMemo(() => ({"x-user-email":userEmail,"x-user-role":userRole.toLowerCase()}), [userEmail, userRole]);

  // Detect auto-book mode: all required fields present in prefill
  const autoBookMode = !!(prefill?.roomHint && prefill.date && prefill.startTime && prefill.endTime && prefill.title !== undefined);

  // showAutoBook can be flipped to false to escape into full form mode
  const [showAutoBook, setShowAutoBook] = useState(autoBookMode);
  const [autoBooking, setAutoBooking] = useState(autoBookMode);
  const [autoBookError, setAutoBookError] = useState<string|null>(null);
  const [booked, setBooked] = useState(false);
  const didAutoBook = useRef(false);

  // Form state
  const [date, setDate] = useState(prefill?.date ?? localDateISO());
  const [startTime, setStartTime] = useState(prefill?.startTime ?? defaultStartTime);
  const [durIdx, setDurIdx] = useState(durationIdx(prefill?.startTime, prefill?.endTime));
  const [isTeams, setIsTeams] = useState(false);
  const [title, setTitle] = useState(prefill?.title ?? "");
  const [attendees, setAttendees] = useState(prefill?.attendees ?? "");

  // Room list & availability state (form mode only)
  const [allRooms, setAllRooms] = useState<Room[]>([]);
  const [rooms, setRooms] = useState<RoomWithStatus[]>([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [roomsError, setRoomsError] = useState<string|null>(null);
  const [roomsChecked, setRoomsChecked] = useState(false);
  const [selectedRoom, setSelectedRoom] = useState<RoomWithStatus|null>(null);
  const [booking, setBooking] = useState(false);
  const autoChecked = useRef(false);

  const endISO = prefill?.endTime
    ? toISO(date, prefill.endTime)
    : addMinutes(date, startTime, DURATION_OPTIONS[durIdx].minutes);

  // ── AUTO-BOOK: fires on mount when all info is present ───────────────────
  useEffect(() => {
    if (!autoBookMode || didAutoBook.current) return;
    didAutoBook.current = true;

    (async () => {
      try {
        // 1. Fetch room directory to resolve email from name hint
        const r1 = await fetch("/api/ms365/rooms", { headers: auth });
        const d1 = await r1.json().catch(() => ({}));
        if (!r1.ok) throw new Error(d1.detail ?? (r1.status === 401
          ? "Microsoft account not connected. Go to Settings → Connected Accounts."
          : "Failed to load rooms."));

        const list: Room[] = d1.rooms ?? [];
        const hint = prefill!.roomHint!.toLowerCase();
        const room = list.find(r => r.name.toLowerCase().includes(hint));
        if (!room) throw new Error(`Room "${prefill!.roomHint}" not found in the directory.`);

        // 2. Check availability for this ONE room only (fast — single getSchedule call)
        const r2 = await fetch("/api/ms365/rooms/availability", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...auth },
          body: JSON.stringify({
            room_emails: [room.email],
            start: toISO(prefill!.date!, prefill!.startTime!),
            end: toISO(prefill!.date!, prefill!.endTime!),
          }),
        });
        const d2 = await r2.json().catch(() => ({}));
        if (!r2.ok) throw new Error(d2.detail ?? "Availability check failed.");
        const roomStatus = d2.rooms?.[0];
        if (!roomStatus) {
          // No availability data returned — treat as unknown, block booking
          throw new Error("Could not verify room availability. Please try again.");
        }
        if (!roomStatus.is_free) {
          // Exchange hides meeting titles/organizer for room resources — don't try to show them.
          // Use the time the user requested (always known) for a clear error.
          const timeRange = `${fmt12(prefill!.startTime!)} – ${fmt12(prefill!.endTime!)}`;
          throw new Error(`${room.name} is not available from ${timeRange}. Please try a different time or room.`);
        }

        // 3. Room is free — book it
        const r3 = await fetch("/api/ms365/rooms/book", {
          method: "POST",
          headers: { "Content-Type":"application/json", ...auth },
          body: JSON.stringify({
            room_email: room.email,
            room_name: room.name,
            subject: prefill!.title || "Meeting",
            start: toISO(prefill!.date!, prefill!.startTime!),
            end: toISO(prefill!.date!, prefill!.endTime!),
            attendee_emails: null,
            is_online_meeting: false,
          }),
        });
        const d3 = await r3.json().catch(() => ({}));
        if (!r3.ok) throw new Error(d3.detail ?? "Room booking failed.");

        // Success
        flyBanner(`${room.name} booked — "${prefill!.title || "Meeting"}"`);
        setBooked(true);
        onBooked(
          `✅ **${room.name}** booked for **"${prefill!.title}"**\n` +
          `📅 ${fmtDate(prefill!.date!)} · ${fmt12(prefill!.startTime!)} – ${fmt12(prefill!.endTime!)}`
        );
      } catch (e) {
        setAutoBookError(e instanceof Error ? e.message : "Booking failed.");
        setAutoBooking(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── AUTO-BOOK render path ────────────────────────────────────────────────
  if (showAutoBook) {
    // Success: widget disappears (onBooked already added the success turn)
    if (booked) return null;

    // Loading
    if (autoBooking) return (
      <motion.div
        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className="mt-2 flex items-center gap-2.5 text-sm text-muted-foreground"
      >
        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary shrink-0" />
        Booking {prefill?.roomHint} for "{prefill?.title}"…
      </motion.div>
    );

    // Error — offer fallback to manual form
    if (autoBookError) return (
      <motion.div
        initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }}
        className="mt-3 overflow-hidden rounded-2xl border border-destructive/20 bg-destructive/5"
      >
        <div className="flex items-start gap-2 px-4 py-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="flex-1 min-w-0">
            <p className="text-sm text-destructive">{autoBookError}</p>
            <button
              onClick={() => { setAutoBookError(null); setAutoBooking(false); setShowAutoBook(false); }}
              className="mt-2 text-xs font-semibold text-primary hover:underline"
            >
              Open booking form →
            </button>
          </div>
        </div>
      </motion.div>
    );

    return null;
  }

  // ── FORM MODE ────────────────────────────────────────────────────────────

  // Fetch rooms when entering form mode
  useEffect(() => {
    if (showAutoBook) return; // handled by auto-book path
    (async () => {
      try {
        const res = await fetch("/api/ms365/rooms", { headers: auth });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          setRoomsError(res.status===401
            ? "Microsoft account not connected. Go to Settings → Connected Accounts."
            : data.detail ?? "Failed to load rooms.");
          setRoomsChecked(true); return;
        }
        const list: Room[] = data.rooms ?? [];
        if (!list.length) { setRoomsError("No meeting rooms found in your organisation's directory."); setRoomsChecked(true); }
        else setAllRooms(list);
      } catch { setRoomsError("Could not reach the server."); setRoomsChecked(true); }
    })();
  }, [auth, showAutoBook]);

  const checkAvailability = useCallback(async () => {
    if (!allRooms.length) { setRoomsError("No rooms found. Make sure your Microsoft account is connected."); setRoomsChecked(true); return; }
    setLoadingRooms(true); setRoomsError(null); setSelectedRoom(null); setRoomsChecked(false);
    try {
      const startISO = toISO(date, startTime);
      const res = await fetch("/api/ms365/rooms/availability", {
        method:"POST", headers:{"Content-Type":"application/json",...auth},
        body: JSON.stringify({ room_emails: allRooms.map(r=>r.email).filter(Boolean), start: startISO, end: endISO }),
      });
      if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e.detail??"Check failed"); }
      const data = await res.json();
      const map: Record<string,{is_free:boolean;booked_slots:RoomWithStatus["booked_slots"]}> = {};
      for (const r of data.rooms??[]) map[r.room_email]={is_free:r.is_free,booked_slots:r.booked_slots};
      const merged = allRooms.map(r=>({...r,is_free:map[r.email]?.is_free??true,booked_slots:map[r.email]?.booked_slots??[]}));
      merged.sort((a,b)=>a.is_free!==b.is_free?(a.is_free?-1:1):a.name.localeCompare(b.name));
      setRooms(merged); setRoomsChecked(true);
    } catch(e) { setRoomsError(e instanceof Error?e.message:"Failed to check availability"); setRoomsChecked(true); }
    finally { setLoadingRooms(false); }
  }, [allRooms, auth, date, startTime, endISO]);

  // Auto-check when rooms load from prefill hint (partial info path)
  useEffect(() => {
    if (!prefill?.roomHint || !allRooms.length || autoChecked.current) return;
    autoChecked.current = true;
    checkAvailability();
  }, [allRooms, checkAvailability, prefill]);

  // Auto-select matching room after check (partial info path)
  useEffect(() => {
    if (!prefill?.roomHint || !rooms.length || selectedRoom) return;
    const hint = prefill.roomHint.toLowerCase();
    const match = rooms.find(r=>r.is_free && r.name.toLowerCase().includes(hint));
    if (match) setSelectedRoom(match);
  }, [rooms, prefill, selectedRoom]);

  const handleBook = async () => {
    if (!selectedRoom || !title.trim() || booking) return;
    setBooking(true);
    const atts = attendees.split(/[,;\s]+/).map(e=>e.trim()).filter(e=>e.includes("@"));
    try {
      const res = await fetch("/api/ms365/rooms/book", {
        method:"POST", headers:{"Content-Type":"application/json",...auth},
        body: JSON.stringify({
          room_email: selectedRoom.email, room_name: selectedRoom.name,
          subject: title.trim(),
          start: toISO(date, startTime), end: endISO,
          attendee_emails: atts.length?atts:null,
          is_online_meeting: isTeams,
        }),
      });
      const data = await res.json().catch(()=>({}));
      if (!res.ok) throw new Error(data.detail??"Booking failed");
      setBooked(true);
      flyBanner(`${selectedRoom.name} booked — "${title.trim()}"`);
      onBooked(`✅ **${selectedRoom.name}** booked for **"${title.trim()}"**\n📅 ${fmtDate(date)} · ${fmt12(startTime)} – ${fmt12(endISO.slice(11,16))}${isTeams?" · Teams meeting":""}`);
    } catch(e) { setRoomsError(e instanceof Error?e.message:"Booking failed. Please try again."); }
    finally { setBooking(false); }
  };

  if (booked) return (
    <motion.div initial={{opacity:0,scale:0.95}} animate={{opacity:1,scale:1}}
      className="mt-3 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/20 dark:text-emerald-400">
      <CheckCircle2 className="h-4 w-4 shrink-0" /> Room booked successfully.
    </motion.div>
  );

  const freeCount = rooms.filter(r=>r.is_free).length;

  return (
    <motion.div initial={{opacity:0,y:8}} animate={{opacity:1,y:0}} transition={{type:"spring",stiffness:300,damping:30}}
      className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/50 backdrop-blur-sm">
      <div className="flex items-center gap-2 border-b border-border bg-muted/40 px-4 py-2.5">
        <CalendarDays className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Book a Meeting Room</span>
      </div>

      <div className="space-y-5 p-4">
        {/* Date / Time / Duration */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            { label:"Date", content:
              <input type="date" value={date} min={localDateISO()}
                onChange={e=>{setDate(e.target.value);setRoomsChecked(false);setSelectedRoom(null);}}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow" />
            },
            { label:"Start Time", content:
              <select value={startTime} onChange={e=>{setStartTime(e.target.value);setRoomsChecked(false);setSelectedRoom(null);}}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow">
                {TIME_OPTIONS.map(o=><option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            },
            { label:"Duration", content:
              <select value={durIdx} onChange={e=>{setDurIdx(Number(e.target.value));setRoomsChecked(false);setSelectedRoom(null);}}
                className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow">
                {DURATION_OPTIONS.map((o,i)=><option key={i} value={i}>{o.label}</option>)}
              </select>
            },
          ].map(({label,content})=>(
            <div key={label}>
              <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</label>
              {content}
            </div>
          ))}
        </div>

        <motion.button whileHover={{scale:1.01}} whileTap={{scale:0.97}} onClick={checkAvailability} disabled={loadingRooms}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 bg-primary/8 px-4 py-2.5 text-sm font-semibold text-primary transition-all hover:bg-primary/15 disabled:cursor-not-allowed disabled:opacity-50">
          {loadingRooms ? <Loader2 className="h-4 w-4 animate-spin" /> : <Clock className="h-4 w-4" />}
          {loadingRooms ? "Checking…" : roomsChecked ? "Re-check Availability" : "Check Available Rooms"}
        </motion.button>

        <AnimatePresence>
          {roomsError && (
            <motion.div key="err" initial={{opacity:0,y:-4}} animate={{opacity:1,y:0}} exit={{opacity:0}}
              className="flex items-start gap-2 rounded-xl border border-destructive/20 bg-destructive/5 px-3 py-2.5 text-xs text-destructive">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{roomsError}
            </motion.div>
          )}

          {roomsChecked && !roomsError && rooms.length>0 && (
            <motion.div key="rooms" initial={{opacity:0,y:4}} animate={{opacity:1,y:0}}>
              <div className="mb-2 text-xs font-semibold text-muted-foreground">{freeCount} of {rooms.length} rooms available</div>
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {rooms.map(room=>(
                  <motion.button key={room.email} type="button" whileTap={{scale:0.98}} disabled={!room.is_free}
                    onClick={()=>setSelectedRoom(selectedRoom?.email===room.email?null:room)}
                    className={`w-full rounded-xl border px-3 py-2.5 text-left transition-all ${
                      !room.is_free ? "cursor-not-allowed border-border bg-muted/30 opacity-50"
                      : selectedRoom?.email===room.email ? "border-primary bg-primary/8 shadow-sm shadow-primary/10"
                      : "border-border bg-background hover:border-primary/40 hover:bg-primary/5"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-foreground">{room.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-muted-foreground">
                          {room.capacity!=null && <span className="flex items-center gap-1"><Users className="h-3 w-3" />{room.capacity} people</span>}
                          {(room.building||room.floor) && <span className="flex items-center gap-1"><Building2 className="h-3 w-3" />{[room.building,room.floor].filter(Boolean).join(", Fl. ")}</span>}
                        </div>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${room.is_free?"bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400":"bg-red-100 text-red-600 dark:bg-red-900/20 dark:text-red-400"}`}>
                        {room.is_free?"Free":"Busy"}
                      </span>
                    </div>
                    {selectedRoom?.email===room.email && (
                      <motion.div initial={{opacity:0}} animate={{opacity:1}} className="mt-1 flex items-center gap-1 text-[11px] font-medium text-primary">
                        <CheckCircle2 className="h-3 w-3" /> Selected
                      </motion.div>
                    )}
                  </motion.button>
                ))}
              </div>
            </motion.div>
          )}

          {selectedRoom && (
            <motion.div key="details" initial={{opacity:0,y:6}} animate={{opacity:1,y:0}} className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                <MapPin className="h-3.5 w-3.5 text-primary" />{selectedRoom.name}
                <ChevronRight className="h-3 w-3" /><span className="text-foreground">Meeting details</span>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Meeting Title <span className="text-destructive">*</span></label>
                <input value={title} onChange={e=>setTitle(e.target.value)} placeholder="e.g. Sprint Planning"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-muted-foreground">Attendees <span className="text-muted-foreground/60">(optional)</span></label>
                <input value={attendees} onChange={e=>setAttendees(e.target.value)} placeholder="john@company.com, jane@company.com"
                  className="w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground outline-none focus:ring-2 focus:ring-primary/20 transition-shadow" />
              </div>
              <button type="button" onClick={()=>setIsTeams(v=>!v)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-all ${isTeams?"border-indigo-300 bg-indigo-50 dark:border-indigo-700 dark:bg-indigo-950/20":"border-border bg-background hover:bg-muted/50"}`}>
                <Video className={`h-4 w-4 ${isTeams?"text-indigo-600 dark:text-indigo-400":"text-muted-foreground"}`} />
                <span className={`flex-1 text-left font-medium ${isTeams?"text-indigo-700 dark:text-indigo-300":"text-foreground"}`}>Teams meeting</span>
                <div className={`relative h-5 w-9 rounded-full transition-colors ${isTeams?"bg-indigo-500":"bg-muted-foreground/30"}`}>
                  <div className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${isTeams?"translate-x-4":"translate-x-0.5"}`} />
                </div>
              </button>
              <motion.button whileHover={{scale:1.01}} whileTap={{scale:0.97}} onClick={handleBook} disabled={!title.trim()||booking}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-primary/20 transition-all hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">
                {booking?<Loader2 className="h-4 w-4 animate-spin" />:<CalendarDays className="h-4 w-4" />}
                {booking?"Booking…":`Book ${selectedRoom.name}`}
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
