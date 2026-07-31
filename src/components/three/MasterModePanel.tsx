// Master Mode panel — the inference cockpit that sits inside the chat home when
// Master Mode is on. Shows the four tiers this app actually runs, all served
// locally via Ollama (see backend/app/config.py). No ChatGPT / Claude / Gemini.
//
// Deliberate split of responsibilities, learned the hard way: three.js renders ONLY
// the wireframe core. The orbit rings are SVG and the node badges are plain DOM
// positioned at computed points on those same ellipses. Projecting HTML labels out
// of the 3D scene (drei's <Html>) scales them by camera distance and lets them
// collide with each other and the core — this keeps every label at a fixed,
// predictable spot instead.
import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useDeviceTier } from "@/hooks/use-device-tier";
import { useAuth } from "@/lib/auth-store";
import { cn } from "@/lib/utils";
import { Brain, Network, Wrench, Zap, type LucideIcon } from "lucide-react";
import * as THREE from "three";

// Shared coordinate space for the rings and the badges that sit on them. Both are
// expressed in this box and converted to percentages, so they stay locked together
// at any panel size.
const VB = { w: 1000, h: 340 };
const CORE = { x: 480, y: 150 };

const RINGS = [
  { rx: 200, ry: 60, color: "#fbbf24", opacity: 0.5 },
  { rx: 300, ry: 92, color: "#22d3ee", opacity: 0.42 },
  { rx: 400, ry: 125, color: "#818cf8", opacity: 0.32 },
];

interface TierNode {
  id: string;
  tier: string;
  model: string;
  role: string;
  color: string;
  icon: LucideIcon;
  /** which entry of RINGS this tier rides, and where on it (degrees) */
  ring: number;
  angle: number;
}

// Angles are picked so each label clears the core sphere in the middle — a tier parked
// at, say, ring 0 / 65° lands its label right on top of the core.
const TIERS: TierNode[] = [
  { id: "reasoning", tier: "Reasoning", model: "gpt-oss:latest", role: "Deep answers · intent routing", color: "#22d3ee", icon: Brain, ring: 2, angle: -115 },
  { id: "service", tier: "Tool-Calling", model: "llama3.1:8b", role: "Actions · summaries", color: "#818cf8", icon: Wrench, ring: 1, angle: -35 },
  { id: "embeddings", tier: "Embeddings", model: "nomic-embed-text", role: "Semantic search · RAG", color: "#34d399", icon: Network, ring: 1, angle: 205 },
  { id: "router", tier: "Routing", model: "llama3.2:3b", role: "Fast triage · general chat", color: "#fbbf24", icon: Zap, ring: 1, angle: 90 },
];

function pointOnRing(ringIndex: number, angleDeg: number) {
  const ring = RINGS[ringIndex];
  const rad = (angleDeg * Math.PI) / 180;
  return {
    xPct: ((CORE.x + ring.rx * Math.cos(rad)) / VB.w) * 100,
    yPct: ((CORE.y + ring.ry * Math.sin(rad)) / VB.h) * 100,
  };
}

// ── 3D core ─────────────────────────────────────────────────────────────────
function CoreMesh() {
  const wire = useRef<THREE.Mesh>(null);
  const glow = useRef<THREE.Mesh>(null);
  useFrame((state, delta) => {
    if (wire.current) {
      wire.current.rotation.y += delta * 0.12;
      wire.current.rotation.x += delta * 0.05;
    }
    glow.current?.scale.setScalar(1 + Math.sin(state.clock.elapsedTime * 1.3) * 0.04);
  });
  return (
    <>
      <mesh ref={wire}>
        <icosahedronGeometry args={[1.5, 3]} />
        <meshBasicMaterial color="#a5f3fc" wireframe transparent opacity={0.45} />
      </mesh>
      <mesh ref={glow} scale={0.9}>
        <sphereGeometry args={[1.5, 32, 32]} />
        <meshBasicMaterial
          color="#0e7490"
          transparent
          opacity={0.22}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
    </>
  );
}

// ── telemetry ───────────────────────────────────────────────────────────────
interface Telemetry {
  latencyMs: number;
  totalTokens: number;
  feedbackPct: number;
  errorRatePct: number;
  totalRequests: number;
  series: number[];
  /** Which window these numbers actually cover — surfaced on the cards, never implied. */
  period: string;
  /** Always the 24h window, regardless of which period the cards fell back to. Health has
   *  to come from current traffic — a month-old error spike is not a live outage. */
  recentRequests: number;
  recentErrorRatePct: number;
}

// Widest-first would hide a quiet day; narrowest-first with fallback keeps the readout
// recent when there IS recent traffic, and still shows something on a fresh/idle DB.
const PERIODS = ["24h", "7d", "30d"] as const;

/** Real numbers from the observability endpoints — null while loading or if the call fails. */
function useTelemetry(): { data: Telemetry | null; failed: boolean } {
  const { user } = useAuth();
  const [data, setData] = useState<Telemetry | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!user?.email) return;
    let cancelled = false;
    const headers = {
      "x-user-email": user.email,
      "x-user-role": (user.role ?? "").toLowerCase(),
    };
    // A hung backend must not leave a permanent spinner. Note fetch() resolves on
    // HEADERS, so the timeout has to cover reading the body too — that is where a
    // stalled response actually blocks.
    const getJson = async (path: string) => {
      // 12s, not a few: a cold dev server (or a busy backend) can take a while to send
      // the body, and a false "unavailable" is worse than a slightly longer spinner.
      const res = await fetch(path, { headers, signal: AbortSignal.timeout(12000) });
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    };

    (async () => {
      // Reset on every attempt: the effect re-runs when the backend resolves the user's
      // real role, and an early 403 (role still defaulting to Employee) must not stick.
      setFailed(false);
      try {
        // All three windows at once — sequential probing meant three round trips just to
        // discover the recent ones were empty.
        const summaries = await Promise.all(
          PERIODS.map((p) => getJson(`/api/observability/summary?period=${p}`)),
        );
        const recent = summaries[0];
        const idx = summaries.findIndex((s) => (s.total_requests ?? 0) > 0);
        const useIdx = idx === -1 ? 0 : idx;
        const summary = summaries[useIdx];
        const period = PERIODS[useIdx];

        let series: number[] = [];
        try {
          const volume = await getJson(`/api/observability/charts/volume?period=${period}`);
          series = Array.isArray(volume) ? volume.map((v: any) => v.requests ?? 0) : [];
        } catch {
          // Sparklines are decorative — losing them shouldn't blank the numbers.
        }

        if (cancelled) return;
        setData({
          latencyMs: summary.avg_latency_ms ?? 0,
          totalTokens: summary.total_tokens ?? 0,
          feedbackPct: summary.feedback_score_pct ?? 0,
          errorRatePct: summary.error_rate_pct ?? 0,
          totalRequests: summary.total_requests ?? 0,
          series,
          period,
          recentRequests: recent.total_requests ?? 0,
          recentErrorRatePct: recent.error_rate_pct ?? 0,
        });
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.email, user?.role]);

  return { data, failed };
}

/** Local Ollama calls run to tens of seconds — raw ms gets unreadable fast. */
function formatLatency(ms: number): string {
  if (ms <= 0) return "—";
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function compactNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function Sparkline({ values, color }: { values: number[]; color: string }) {
  // Needs two points to draw a line; a flat/empty series just renders nothing.
  const path = useMemo(() => {
    if (values.length < 2) return null;
    const max = Math.max(...values);
    const min = Math.min(...values);
    const span = max - min || 1;
    return values
      .map((v, i) => `${(i / (values.length - 1)) * 100},${20 - ((v - min) / span) * 18}`)
      .join(" ");
  }, [values]);
  if (!path) return null;
  return (
    <svg viewBox="0 0 100 20" preserveAspectRatio="none" className="h-4 w-full" aria-hidden="true">
      <polyline points={path} fill="none" stroke={color} strokeWidth={1.1} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function StatCard({
  label,
  value,
  series,
  color,
  className,
}: {
  label: string;
  value: string;
  series: number[];
  color: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-white/10 bg-[#080d18]/90 px-2.5 py-1.5 backdrop-blur-sm",
        className,
      )}
    >
      <div className="text-[9px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className="mt-0.5 text-[13px] font-semibold text-slate-100">{value}</div>
      <div className="mt-0.5 opacity-70">
        <Sparkline values={series} color={color} />
      </div>
    </div>
  );
}

// ── panel ───────────────────────────────────────────────────────────────────
export function MasterModePanel() {
  const { tier, canRender3D } = useDeviceTier();
  const { data, failed } = useTelemetry();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = TIERS.find((t) => t.id === selectedId) ?? null;

  const window_ = data?.period ?? "24h";
  // Distinct states — "still loading" is not "unavailable", "idle" is not "healthy",
  // and neither is "we couldn't reach the telemetry endpoint".
  const health: "loading" | "unknown" | "idle" | "ok" | "degraded" = failed
    ? "unknown"
    : !data
      ? "loading"
      : data.recentRequests === 0
        ? "idle"
        : data.recentErrorRatePct < 5
          ? "ok"
          : "degraded";
  const HEALTH_LABEL = {
    loading: "Reading telemetry…",
    unknown: "Telemetry unavailable",
    idle: "Idle · no traffic in 24h",
    ok: "All Systems Operational",
    degraded: "Degraded · errors in 24h",
  } as const;

  return (
    <div
      // Height is deliberately tight: greeting + quick-glance + chips already eat most
      // of the viewport above the composer, and the cockpit shouldn't force a scroll.
      className="relative h-[205px] w-full overflow-hidden rounded-2xl border border-white/10 sm:h-[228px]"
      style={{ background: "radial-gradient(120% 120% at 50% 30%, #101a2e 0%, #060912 70%)" }}
    >
      {/* orbit rings — SVG, sharing VB with the badges so the two stay aligned */}
      <svg
        viewBox={`0 0 ${VB.w} ${VB.h}`}
        preserveAspectRatio="none"
        className="absolute inset-0 h-full w-full"
        aria-hidden="true"
      >
        {RINGS.map((ring, i) => (
          <ellipse
            key={i}
            cx={CORE.x}
            cy={CORE.y}
            rx={ring.rx}
            ry={ring.ry}
            fill="none"
            stroke={ring.color}
            strokeOpacity={ring.opacity}
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
      </svg>

      {/* 3D core — its own square canvas pinned to CORE, so the sphere always lands
          exactly where the rings are centred rather than depending on camera framing */}
      {canRender3D && (
        <div
          // Small enough that the orbit rings read as orbits rather than a halo, and the
          // tier labels have somewhere to sit.
          className="absolute h-[112px] w-[112px] -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${(CORE.x / VB.w) * 100}%`, top: `${(CORE.y / VB.h) * 100}%` }}
        >
          <Canvas
            camera={{ position: [0, 0, 4.2], fov: 45 }}
            dpr={tier === "high" ? [1, 2] : 1}
            gl={{ antialias: tier === "high", powerPreference: "low-power" }}
          >
            <CoreMesh />
          </Canvas>
        </div>
      )}

      {/* caption */}
      <div className="absolute left-5 top-4">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-cyan-300">
          <Zap className="h-3.5 w-3.5" />
          Master Mode
        </div>
        <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
          Unified intelligence. All systems active.
          <br />
          You&apos;re in control.
        </p>
      </div>

      {/* system status — derived from the real error rate, not decoration */}
      <div className="absolute right-5 top-4 flex items-center gap-1.5 rounded-full border border-white/10 bg-[#080d18]/90 px-2.5 py-1">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            health === "ok" && "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]",
            health === "degraded" && "bg-amber-400",
            health === "idle" && "bg-slate-500",
            health === "loading" && "animate-pulse bg-cyan-400",
            health === "unknown" && "bg-slate-600",
          )}
        />
        <span className="text-[10px] font-medium text-slate-300">{HEALTH_LABEL[health]}</span>
      </div>

      {/* tier badges — DOM at fixed points on the rings above */}
      {TIERS.map((node) => {
        const { xPct, yPct } = pointOnRing(node.ring, node.angle);
        const isSelected = selectedId === node.id;
        const isDimmed = selectedId !== null && !isSelected;
        return (
          <button
            key={node.id}
            onClick={() => setSelectedId(isSelected ? null : node.id)}
            className="absolute flex flex-col items-center transition-opacity duration-300"
            // Centre the ICON on the ring point, not the whole badge — the label hangs
            // below it, so centring the badge pushed the topmost tier off the panel.
            style={{
              left: `${xPct}%`,
              top: `${yPct}%`,
              transform: "translate(-50%, -20px)",
              opacity: isDimmed ? 0.4 : 1,
            }}
            aria-pressed={isSelected}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-full transition-all duration-300"
              style={{
                border: `2px solid ${node.color}`,
                background: isSelected ? node.color : "#080d18",
                color: isSelected ? "#080d18" : node.color,
                boxShadow: `0 0 ${isSelected ? 22 : 10}px ${node.color}80`,
              }}
            >
              <node.icon className="h-4 w-4" strokeWidth={2.25} />
            </span>
            <span className="mt-1.5 whitespace-nowrap rounded-md border border-white/10 bg-[#080d18]/95 px-2 py-0.5 text-center">
              <span className="block text-[11px] font-semibold text-slate-100">{node.tier}</span>
              <span className="block text-[8px] uppercase tracking-wider text-slate-500">
                {node.model}
              </span>
            </span>
          </button>
        );
      })}

      {/* live telemetry — hidden on narrow panels where it would cover the rings */}
      <div className="absolute bottom-4 right-5 hidden w-[150px] flex-col gap-1.5 lg:flex">
        <StatCard
          label={`Avg latency · ${window_}`}
          value={data ? formatLatency(data.latencyMs) : failed ? "—" : "…"}
          series={data?.series ?? []}
          color="#22d3ee"
        />
        <StatCard
          label={`Tokens · ${window_}`}
          value={data ? compactNumber(data.totalTokens) : failed ? "—" : "…"}
          series={data?.series ?? []}
          color="#818cf8"
        />
        <StatCard
          label={`Helpful · ${window_}`}
          value={data && data.totalRequests > 0 ? `${data.feedbackPct}%` : failed ? "—" : "…"}
          series={data?.series ?? []}
          color="#34d399"
        />
      </div>

      {/* selected tier detail, or the request-volume readout when nothing is picked */}
      {selected ? (
        <div className="absolute bottom-4 left-5 w-[190px] rounded-lg border border-white/10 bg-[#080d18]/95 p-3 text-left">
          <div className="text-[12px] font-semibold text-slate-100">{selected.tier}</div>
          <div className="mt-0.5 text-[9px] uppercase tracking-wider text-slate-500">
            {selected.model}
          </div>
          <p className="mt-1.5 text-[11px] leading-snug text-slate-400">{selected.role}</p>
        </div>
      ) : (
        <div className="absolute bottom-4 left-5 hidden w-[130px] rounded-lg border border-white/10 bg-[#080d18]/90 px-3 py-2 sm:block">
          <div className="text-[9px] uppercase tracking-wider text-slate-500">Requests · {window_}</div>
          <div className="mt-0.5 text-[13px] font-semibold text-slate-100">
            {data ? compactNumber(data.totalRequests) : failed ? "—" : "…"}
          </div>
          <div className="mt-1 opacity-70">
            <Sparkline values={data?.series ?? []} color="#a5f3fc" />
          </div>
        </div>
      )}
    </div>
  );
}
