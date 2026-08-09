import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import * as React from "react";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";
import appCss from "../styles.css?url";
import { seo } from "../utils/seo";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "../lib/msal";
import { AuthProvider, useAuth } from "../lib/auth-store";
import { Toaster, toast } from "sonner";
import { cn } from "../lib/utils";
import { Logo } from "../components/Logo";
import { BrandName } from "../components/BrandName";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { FlyingBanner } from "../components/FlyingBanner";
import { motion, AnimatePresence } from "framer-motion";
import { LoadingCharacterDisplay, LoadingDots } from "../components/LoadingCharacter";
import { useSettings, useBuddyColors } from "../lib/settings-store";
import GreetingBot from "../components/assistant/GreetingBot";
import { useBuddyStore } from "../lib/buddy-store";
import { IntroTour } from "../components/intro/IntroTour";
import { useIntroStore } from "../lib/intro-store";
import { AuroraBackground } from "../components/ui/aurora-background";
import { SparklesCore } from "../components/ui/sparkles";
import { HoverBorderGradient } from "../components/ui/hover-border-gradient";
import { FlipWords } from "../components/ui/flip-words";
import { useServerLoad } from "../hooks/use-server-load";

const SERVER_BUSY_TOAST_ID = "server-busy";
const SERVER_SLOW_TOAST_ID = "server-slow";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      // PWA / mobile shell
      { name: "theme-color", content: "#1B6FC8" },
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-title", content: "Centriq AI" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      ...seo({
        title: "Centriq AI",
        description:
          "Centriq is your intelligent workplace concierge, helping you manage HR tasks, IT requests, and admin services with ease.",
      }),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: `${import.meta.env.BASE_URL}logo.png` },
      { rel: "apple-touch-icon", href: `${import.meta.env.BASE_URL}pwa-192.png` },
      // Warm the cache for the splash logo as early as possible, rather than
      // waiting for its component to mount after the JS bundle loads.
      { rel: "preload", href: `${import.meta.env.BASE_URL}logo.png`, as: "image", fetchpriority: "high" },
    ],
  }),
  errorComponent: (props) => (
    <RootDocument>
      <DefaultCatchBoundary {...props} />
    </RootDocument>
  ),
  notFoundComponent: () => (
    <RootDocument>
      <NotFound />
    </RootDocument>
  ),
  component: RootComponent,
});

function RootComponent() {
  const isBrowser = typeof window !== "undefined";
  const [isMsalInitialized, setIsMsalInitialized] = React.useState(false);

  // MSAL initialization — must run before any conditional returns (Rules of Hooks)
  React.useEffect(() => {
    if (isBrowser && msalInstance) {
      msalInstance
        .initialize()
        .then(() => {
          setIsMsalInitialized(true);
        })
        .catch((e) => {
          setIsMsalInitialized(true);
        });
    }
  }, [isBrowser]);

  if (!isBrowser || !isMsalInitialized) {
    return (
      <RootDocument>
        <SplashScreen />
      </RootDocument>
    );
  }

  return (
    <MsalProvider instance={msalInstance}>
      <AuthProvider>
        <RootDocument>
          <AuthenticatedApp />
        </RootDocument>
      </AuthProvider>
    </MsalProvider>
  );
}

// --- Enterprise HUD Loading Animation (Photorealistic / Professional) ---
function MascotDoorUnlock({ authenticated }: { authenticated: boolean }) {
  const colors = useBuddyColors();

  const [tick, setTick] = React.useState(0);
  React.useEffect(() => {
    const id = setInterval(() => setTick((t) => (t + 1) % 100), 80);
    return () => clearInterval(id);
  }, []);

  // Simulated live metric data that changes with tick
  const metrics = [
    { label: "Active Users", value: 2847 + (tick % 7), unit: "", color: "#3b82f6" },
    { label: "Tasks Completed", value: 14329 + (tick % 13), unit: "", color: "#10b981" },
    {
      label: "Avg Response",
      value: (1.2 + (tick % 4) * 0.05).toFixed(1),
      unit: "s",
      color: "#f59e0b",
    },
    { label: "Uptime", value: "99.98", unit: "%", color: "#8b5cf6" },
  ];

  const ringProgress = authenticated ? 100 : Math.min(35 + tick * 0.65, 92);
  const innerRingProgress = authenticated ? 100 : Math.min(20 + tick * 0.48, 78);

  const polarToXY = (cx: number, cy: number, r: number, angleDeg: number) => {
    const rad = (angleDeg - 90) * (Math.PI / 180);
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  };

  const describeArc = (cx: number, cy: number, r: number, pct: number) => {
    const endAngle = (pct / 100) * 360;
    const end = polarToXY(cx, cy, r, endAngle);
    const largeArc = endAngle > 180 ? 1 : 0;
    const start = polarToXY(cx, cy, r, 0);
    if (pct >= 99.9) {
      return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`;
    }
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };

  // Bar chart data (normalized 0-1)
  const barData = [0.72, 0.58, 0.85, 0.63, 0.91, 0.44, 0.78, 0.66, 0.82, 0.55, 0.73, 0.88];
  const months = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];

  return (
    <div className="relative w-[min(88vw,720px)] aspect-[16/9] max-h-[55vh] flex items-center justify-center select-none pointer-events-none mb-6">
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 320 180"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
        className="w-full h-full"
      >
        <defs>
          <linearGradient id="hud-bg-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#0d1526" />
            <stop offset="100%" stopColor="#060d1a" />
          </linearGradient>
          <linearGradient id="ring-grad-blue" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#3b82f6" />
            <stop offset="100%" stopColor="#60a5fa" />
          </linearGradient>
          <linearGradient id="ring-grad-teal" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#06b6d4" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
          <linearGradient id="shield-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1b6fc8" />
            <stop offset="100%" stopColor="#0d4fa0" />
          </linearGradient>
          <linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#1d4ed8" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="bar-grad-teal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#0891b2" stopOpacity="0.4" />
          </linearGradient>
          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <filter id="glow-blue">
            <feGaussianBlur stdDeviation="1.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter id="glow-soft">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <clipPath id="card-clip-main">
            <rect x="0" y="0" width="320" height="180" rx="12" />
          </clipPath>
        </defs>

        {/* ===== BACKGROUND ===== */}
        <rect x="0" y="0" width="320" height="180" rx="12" fill="url(#hud-bg-grad)" />

        {/* Grid lines — subtle, professional */}
        {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
          <line
            key={`vg${i}`}
            x1={i * 40}
            y1="0"
            x2={i * 40}
            y2="180"
            stroke="rgba(255,255,255,0.028)"
            strokeWidth="0.5"
          />
        ))}
        {[0, 1, 2, 3, 4, 5, 6].map((i) => (
          <line
            key={`hg${i}`}
            x1="0"
            y1={i * 30}
            x2="320"
            y2={i * 30}
            stroke="rgba(255,255,255,0.028)"
            strokeWidth="0.5"
          />
        ))}

        {/* Top border accent */}
        <rect
          x="0"
          y="0"
          width="320"
          height="1.5"
          rx="0"
          fill="url(#ring-grad-blue)"
          opacity="0.8"
        />

        {/* Corner brackets — HUD style */}
        {/* Top-left */}
        <path d="M 12 2 L 2 2 L 2 12" stroke="#3b82f6" strokeWidth="1" fill="none" opacity="0.7" />
        {/* Top-right */}
        <path
          d="M 308 2 L 318 2 L 318 12"
          stroke="#3b82f6"
          strokeWidth="1"
          fill="none"
          opacity="0.7"
        />
        {/* Bottom-left */}
        <path
          d="M 12 178 L 2 178 L 2 168"
          stroke="#3b82f6"
          strokeWidth="1"
          fill="none"
          opacity="0.7"
        />
        {/* Bottom-right */}
        <path
          d="M 308 178 L 318 178 L 318 168"
          stroke="#3b82f6"
          strokeWidth="1"
          fill="none"
          opacity="0.7"
        />

        {/* ===== LEFT PANEL — Bar Chart ===== */}
        <g transform="translate(12, 12)">
          {/* Panel label */}
          <text
            x="0"
            y="6"
            fill="#94a3b8"
            fontSize="4"
            fontWeight="700"
            letterSpacing="0.8"
            fontFamily="Inter, sans-serif"
          >
            WORKFORCE ANALYTICS
          </text>
          <line x1="0" y1="9" x2="88" y2="9" stroke="#1e3a5f" strokeWidth="0.5" />

          {/* Bar chart */}
          {barData.map((v, i) => {
            const bh = v * 44;
            const bx = i * 7.5;
            const isHighlighted = i === 5 || i === 10;
            return (
              <g key={i}>
                <rect
                  x={bx}
                  y={54 - bh}
                  width="5"
                  height={bh}
                  rx="1"
                  fill={isHighlighted ? "url(#bar-grad-teal)" : "url(#bar-grad)"}
                  opacity={0.75 + (i % 3) * 0.08}
                />
                <text
                  x={bx + 2.5}
                  y="59"
                  fill="#475569"
                  fontSize="3"
                  textAnchor="middle"
                  fontFamily="Inter, sans-serif"
                >
                  {months[i]}
                </text>
              </g>
            );
          })}

          {/* X-axis */}
          <line x1="0" y1="55" x2="88" y2="55" stroke="#1e3a5f" strokeWidth="0.5" />

          {/* Trend line overlay */}
          <polyline
            points="2.5,30 10,22 17.5,26 25,18 32.5,14 40,20 47.5,12 55,16 62.5,10 70,15 77.5,13 85,8"
            stroke="#06b6d4"
            strokeWidth="1"
            fill="none"
            opacity="0.6"
            strokeDasharray="2 1"
          />

          {/* Metric summary below chart */}
          <rect
            x="0"
            y="64"
            width="88"
            height="22"
            rx="3"
            fill="rgba(30,58,95,0.4)"
            stroke="rgba(59,130,246,0.15)"
            strokeWidth="0.5"
          />
          <text x="6" y="72" fill="#94a3b8" fontSize="3.5" fontFamily="Inter, sans-serif">
            YTD Growth
          </text>
          <text
            x="6"
            y="79"
            fill="#3b82f6"
            fontSize="7"
            fontWeight="900"
            fontFamily="Inter, sans-serif"
          >
            +24.3%
          </text>
          <text x="52" y="72" fill="#94a3b8" fontSize="3.5" fontFamily="Inter, sans-serif">
            Peak Month
          </text>
          <text
            x="52"
            y="79"
            fill="#06b6d4"
            fontSize="7"
            fontWeight="900"
            fontFamily="Inter, sans-serif"
          >
            Sep
          </text>
        </g>

        {/* ===== CENTER — Orbital Progress Rings ===== */}
        <g transform="translate(160, 90)">
          {/* Outer decorative ring */}
          <circle
            cx="0"
            cy="0"
            r="62"
            stroke="rgba(59,130,246,0.08)"
            strokeWidth="0.5"
            fill="none"
            strokeDasharray="3 3"
          />

          {/* Outer ring track */}
          <circle cx="0" cy="0" r="54" stroke="rgba(30,58,95,0.6)" strokeWidth="4" fill="none" />
          {/* Outer ring progress */}
          <path
            d={describeArc(0, 0, 54, ringProgress)}
            stroke="url(#ring-grad-blue)"
            strokeWidth="4"
            fill="none"
            strokeLinecap="round"
            filter="url(#glow-blue)"
          />
          {/* Outer ring tip glow */}
          {(() => {
            const p = polarToXY(0, 0, 54, (ringProgress / 100) * 360);
            return (
              <circle
                cx={p.x}
                cy={p.y}
                r="3"
                fill="#60a5fa"
                opacity="0.8"
                filter="url(#glow-soft)"
              />
            );
          })()}

          {/* Inner ring track */}
          <circle cx="0" cy="0" r="40" stroke="rgba(6,182,212,0.15)" strokeWidth="3" fill="none" />
          {/* Inner ring progress */}
          <path
            d={describeArc(0, 0, 40, innerRingProgress)}
            stroke="url(#ring-grad-teal)"
            strokeWidth="3"
            fill="none"
            strokeLinecap="round"
          />

          {/* Innermost decorative ring */}
          <circle
            cx="0"
            cy="0"
            r="28"
            stroke="rgba(139,92,246,0.12)"
            strokeWidth="1"
            fill="none"
            strokeDasharray="2 4"
          />

          {/* Center shield icon */}
          <g>
            {/* Shield background */}
            <path
              d="M 0 -16 C -12 -12 -12 -4 -12 0 C -12 8 -6 14 0 17 C 6 14 12 8 12 0 C 12 -4 12 -12 0 -16 Z"
              fill="url(#shield-grad)"
              opacity="0.9"
            />
            <path
              d="M 0 -14 C -10 -10 -10 -3 -10 0 C -10 7 -5 12 0 15 C 5 12 10 7 10 0 C 10 -3 10 -10 0 -14 Z"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="0.5"
              fill="none"
            />
            {/* Shield checkmark */}
            <path
              d={authenticated ? "M -4 0 L -1 3 L 5 -4" : "M -3.5 -1 L 3.5 -1 M 0 -4 L 0 4"}
              stroke={authenticated ? "#22c55e" : "#93c5fd"}
              strokeWidth="1.5"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </g>

          {/* Percentage text */}
          <text
            x="0"
            y="28"
            fill="#e2e8f0"
            fontSize="8"
            fontWeight="900"
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
          >
            {authenticated ? "100%" : `${Math.round(ringProgress)}%`}
          </text>
          <text
            x="0"
            y="35"
            fill="#64748b"
            fontSize="3.5"
            textAnchor="middle"
            fontFamily="Inter, sans-serif"
            letterSpacing="0.5"
          >
            {authenticated ? "VERIFIED" : "AUTHENTICATING"}
          </text>

          {/* Tick marks around outer ring */}
          {Array.from({ length: 36 }).map((_, i) => {
            const angle = i * 10;
            const inner = polarToXY(0, 0, 58, angle);
            const outer = polarToXY(0, 0, 60, angle);
            return (
              <line
                key={i}
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke="rgba(148,163,184,0.3)"
                strokeWidth={i % 3 === 0 ? "0.8" : "0.4"}
              />
            );
          })}
        </g>

        {/* ===== RIGHT PANEL — Metric Cards ===== */}
        <g transform="translate(222, 12)">
          <text
            x="0"
            y="6"
            fill="#94a3b8"
            fontSize="4"
            fontWeight="700"
            letterSpacing="0.8"
            fontFamily="Inter, sans-serif"
          >
            LIVE METRICS
          </text>
          <line x1="0" y1="9" x2="86" y2="9" stroke="#1e3a5f" strokeWidth="0.5" />

          {metrics.map((m, i) => (
            <g key={m.label} transform={`translate(0, ${14 + i * 22})`}>
              <rect
                x="0"
                y="0"
                width="86"
                height="18"
                rx="3"
                fill="rgba(15,23,42,0.6)"
                stroke={`${m.color}22`}
                strokeWidth="0.5"
              />
              {/* Left accent bar */}
              <rect x="0" y="0" width="2" height="18" rx="1" fill={m.color} opacity="0.8" />

              {/* Sparkline (mini) */}
              <polyline
                points={`60,14 64,10 68,12 72,7 76,9 80,5 84,8`}
                stroke={m.color}
                strokeWidth="0.8"
                fill="none"
                opacity="0.6"
              />

              <text
                x="6"
                y="7"
                fill="#64748b"
                fontSize="3.2"
                fontFamily="Inter, sans-serif"
                letterSpacing="0.2"
              >
                {m.label}
              </text>
              <text
                x="6"
                y="14"
                fill="#e2e8f0"
                fontSize="7.5"
                fontWeight="900"
                fontFamily="Inter, sans-serif"
              >
                {m.value}
                {m.unit}
              </text>
            </g>
          ))}

          {/* Status indicator */}
          <g transform="translate(0, 106)">
            <rect
              x="0"
              y="0"
              width="86"
              height="14"
              rx="3"
              fill="rgba(16,185,129,0.08)"
              stroke="rgba(16,185,129,0.2)"
              strokeWidth="0.5"
            />
            <circle cx="6" cy="7" r="2" fill={authenticated ? "#22c55e" : "#f59e0b"} />
            <motion.circle
              cx="6"
              cy="7"
              r="4"
              fill="none"
              stroke={authenticated ? "#22c55e" : "#f59e0b"}
              strokeWidth="0.5"
              animate={{ scale: [1, 1.8, 1], opacity: [0.8, 0, 0.8] }}
              transition={{ duration: 1.8, repeat: Infinity }}
            />
            <text
              x="12"
              y="8.5"
              fill={authenticated ? "#22c55e" : "#f59e0b"}
              fontSize="3.5"
              fontFamily="Inter, sans-serif"
              fontWeight="700"
            >
              {authenticated ? "AUTHENTICATED" : "VERIFYING IDENTITY"}
            </text>
          </g>
        </g>

        {/* ===== BOTTOM — Activity Timeline ===== */}
        <g transform="translate(12, 148)">
          <line x1="0" y1="0" x2="296" y2="0" stroke="rgba(30,58,95,0.6)" strokeWidth="0.5" />
          <text
            x="0"
            y="8"
            fill="#475569"
            fontSize="3.2"
            fontFamily="Inter, sans-serif"
            letterSpacing="0.5"
          >
            SYSTEM ACTIVITY
          </text>

          {/* Pulse bars */}
          {Array.from({ length: 60 }).map((_, i) => {
            const h = 2 + Math.sin(i * 0.7 + tick * 0.1) * 5 + Math.random() * 3;
            const isActive = i > 45;
            return (
              <rect
                key={i}
                x={i * 5}
                y={22 - h}
                width="3.5"
                height={h}
                rx="0.8"
                fill={isActive ? "#3b82f6" : "#1e3a5f"}
                opacity={isActive ? 0.8 : 0.4}
              />
            );
          })}
        </g>

        {/* Scanning line animation */}
        <motion.line
          x1="0"
          y1="0"
          x2="320"
          y2="0"
          stroke="rgba(59,130,246,0.15)"
          strokeWidth="1"
          animate={{ y: [0, 180, 0] }}
          transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
        />
      </svg>
    </div>
  );
}

/** Premium SSO Loading Screen */
function SplashScreen({ authenticated = false }: { authenticated?: boolean }) {
  const steps = [
    { id: 0, label: "Contacting Microsoft Entra ID", sublabel: "Establishing secure channel" },
    { id: 1, label: "Verifying AD group membership", sublabel: "Checking role assignments" },
    { id: 2, label: "Decrypting identity token", sublabel: "Validating SAML assertion" },
    { id: 3, label: "Provisioning workspace access", sublabel: "Loading your environment" },
  ];

  const [currentStep, setCurrentStep] = React.useState(0);
  const [progress, setProgress] = React.useState(0);
  const [orb1Pos] = React.useState({ x: -15, y: -20 });
  const [orb2Pos] = React.useState({ x: 20, y: 15 });
  const [orb3Pos] = React.useState({ x: -5, y: 25 });

  React.useEffect(() => {
    if (authenticated) {
      setCurrentStep(steps.length);
      setProgress(100);
      return;
    }
    const pInterval = setInterval(() => {
      setProgress((p) => {
        if (p >= 92) return p;
        return p + 0.4;
      });
    }, 60);
    const stepInterval = setInterval(() => {
      setCurrentStep((s) => Math.min(s + 1, steps.length - 1));
    }, 2200);
    return () => {
      clearInterval(pInterval);
      clearInterval(stepInterval);
    };
  }, [authenticated]);

  const displayProgress = authenticated ? 100 : Math.round(progress);

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-hidden"
      style={{ background: "#050914" }}
    >
      {/* ── Soft gradient orbs ── */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {/* Orb 1 — blue */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "55vw",
            height: "55vw",
            background:
              "radial-gradient(circle, rgba(59,130,246,0.22) 0%, rgba(37,99,235,0.08) 50%, transparent 70%)",
            top: `calc(50% + ${orb1Pos.y}%)`,
            left: `calc(50% + ${orb1Pos.x}%)`,
            transform: "translate(-50%, -50%)",
          }}
          animate={{ scale: [1, 1.08, 1], opacity: [0.7, 1, 0.7] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        {/* Orb 2 — violet */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "45vw",
            height: "45vw",
            background:
              "radial-gradient(circle, rgba(139,92,246,0.2) 0%, rgba(109,40,217,0.07) 50%, transparent 70%)",
            top: `calc(50% + ${orb2Pos.y}%)`,
            left: `calc(50% + ${orb2Pos.x}%)`,
            transform: "translate(-50%, -50%)",
          }}
          animate={{ scale: [1, 1.12, 0.95, 1], opacity: [0.6, 0.9, 0.6] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut", delay: 1 }}
        />
        {/* Orb 3 — cyan/teal accent */}
        <motion.div
          className="absolute rounded-full"
          style={{
            width: "30vw",
            height: "30vw",
            background:
              "radial-gradient(circle, rgba(6,182,212,0.15) 0%, rgba(8,145,178,0.05) 50%, transparent 70%)",
            top: `calc(50% + ${orb3Pos.y}%)`,
            left: `calc(50% + ${orb3Pos.x}%)`,
            transform: "translate(-50%, -50%)",
          }}
          animate={{ scale: [0.9, 1.15, 0.9], opacity: [0.5, 0.8, 0.5] }}
          transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 2 }}
        />
        {/* Subtle grid */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: `linear-gradient(rgba(255,255,255,0.018) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.018) 1px, transparent 1px)`,
            backgroundSize: "48px 48px",
          }}
        />
      </div>

      {/* ── Main card ── */}
      <motion.div
        initial={{ opacity: 0, y: 24, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="relative z-10 w-full max-w-md mx-4"
      >
        {/* Glass card */}
        <div
          className="relative rounded-3xl overflow-hidden"
          style={{
            background: "rgba(255, 255, 255, 0.04)",
            border: "1px solid rgba(255, 255, 255, 0.09)",
            boxShadow:
              "0 32px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), inset 0 1px 0 rgba(255,255,255,0.08)",
            backdropFilter: "blur(32px)",
          }}
        >
          {/* Top gradient shimmer */}
          <div
            className="absolute top-0 left-0 right-0 h-px"
            style={{
              background:
                "linear-gradient(90deg, transparent, rgba(139,92,246,0.6), rgba(59,130,246,0.6), transparent)",
            }}
          />

          <div className="p-8 sm:p-10">
            {/* Logo + Brand */}
            <div className="flex flex-col items-center mb-8">
              {/* Animated logo ring */}
              <div className="relative mb-5">
                {/* Outer glow */}
                <motion.div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background: "radial-gradient(circle, rgba(59,130,246,0.3) 0%, transparent 70%)",
                    transform: "scale(1.8)",
                  }}
                  animate={{ opacity: [0.4, 0.8, 0.4], scale: [1.6, 2, 1.6] }}
                  transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                />
                {/* Rotating conic ring */}
                <motion.div
                  className="w-20 h-20 rounded-full p-0.5"
                  style={{
                    background: "conic-gradient(from 0deg, #3b82f6, #8b5cf6, #06b6d4, #3b82f6)",
                  }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                >
                  <div
                    className="w-full h-full rounded-full flex items-center justify-center"
                    style={{ background: "#050914" }}
                  >
                    <motion.div
                      animate={authenticated ? { scale: [1, 1.2, 1], rotate: [0, 5, -5, 0] } : {}}
                      transition={{ duration: 0.6 }}
                    >
                      <img
                        src={`${import.meta.env.BASE_URL}logo.png`}
                        alt="Centriq"
                        className="w-9 h-9 object-contain"
                      />
                    </motion.div>
                  </div>
                </motion.div>
                {/* Success ring */}
                <AnimatePresence>
                  {authenticated && (
                    <motion.div
                      initial={{ scale: 0.5, opacity: 0 }}
                      animate={{ scale: 1, opacity: 1 }}
                      className="absolute -bottom-1 -right-1 w-6 h-6 rounded-full flex items-center justify-center"
                      style={{
                        background: "linear-gradient(135deg, #22c55e, #16a34a)",
                        border: "2px solid #050914",
                        boxShadow: "0 0 12px rgba(34,197,94,0.6)",
                      }}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                        <path
                          d="M2 6l3 3 5-5"
                          stroke="white"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <motion.h1
                className="text-white font-bold text-2xl tracking-tight"
                style={{ fontFamily: "Inter, sans-serif" }}
              >
                {authenticated ? "Welcome back!" : "Signing you in"}
              </motion.h1>
              <p className="text-white/40 text-sm mt-1" style={{ fontFamily: "Inter, sans-serif" }}>
                {authenticated ? "Workspace ready" : "Microsoft Entra ID · Aligned Automation"}
              </p>
            </div>

            {/* ── Progress bar ── */}
            <div className="mb-7">
              <div className="flex justify-between items-center mb-2">
                <span
                  className="text-white/40 text-xs font-medium"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  Authentication progress
                </span>
                <motion.span
                  key={displayProgress}
                  className="text-white/70 text-xs font-bold tabular-nums"
                  style={{ fontFamily: "Inter, sans-serif" }}
                >
                  {displayProgress}%
                </motion.span>
              </div>
              <div
                className="h-1.5 rounded-full overflow-hidden"
                style={{ background: "rgba(255,255,255,0.07)" }}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: "linear-gradient(90deg, #3b82f6, #8b5cf6, #06b6d4)" }}
                  animate={{ width: `${displayProgress}%` }}
                  transition={{ duration: 0.6, ease: "easeOut" }}
                />
              </div>
            </div>

            {/* ── Auth steps ── */}
            <div className="space-y-3">
              {steps.map((step, i) => {
                const isDone = authenticated || i < currentStep;
                const isActive = !authenticated && i === currentStep;
                return (
                  <motion.div
                    key={step.id}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: i * 0.12, duration: 0.4 }}
                    className="flex items-center gap-3.5"
                  >
                    {/* Step icon */}
                    <div className="relative shrink-0">
                      <AnimatePresence mode="wait">
                        {isDone ? (
                          <motion.div
                            key="done"
                            initial={{ scale: 0, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0, opacity: 0 }}
                            transition={{ type: "spring", stiffness: 400, damping: 20 }}
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{
                              background: "rgba(34,197,94,0.15)",
                              border: "1px solid rgba(34,197,94,0.4)",
                            }}
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path
                                d="M2.5 6.5l3 3 5-5"
                                stroke="#22c55e"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                            </svg>
                          </motion.div>
                        ) : isActive ? (
                          <motion.div
                            key="active"
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{
                              background: "rgba(59,130,246,0.15)",
                              border: "1px solid rgba(59,130,246,0.4)",
                            }}
                          >
                            <motion.div
                              className="w-2.5 h-2.5 rounded-full"
                              style={{ background: "#3b82f6" }}
                              animate={{ scale: [0.7, 1.2, 0.7], opacity: [0.6, 1, 0.6] }}
                              transition={{ duration: 1.2, repeat: Infinity, ease: "easeInOut" }}
                            />
                          </motion.div>
                        ) : (
                          <motion.div
                            key="pending"
                            className="w-7 h-7 rounded-full flex items-center justify-center"
                            style={{
                              background: "rgba(255,255,255,0.04)",
                              border: "1px solid rgba(255,255,255,0.1)",
                            }}
                          >
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{ background: "rgba(255,255,255,0.15)" }}
                            />
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>

                    {/* Step text */}
                    <div className="min-w-0">
                      <div
                        className="text-sm font-semibold leading-tight"
                        style={{
                          fontFamily: "Inter, sans-serif",
                          color: isDone
                            ? "rgba(255,255,255,0.85)"
                            : isActive
                              ? "rgba(255,255,255,0.9)"
                              : "rgba(255,255,255,0.3)",
                        }}
                      >
                        {step.label}
                      </div>
                      <div
                        className="text-xs mt-0.5"
                        style={{
                          fontFamily: "Inter, sans-serif",
                          color: isDone
                            ? "rgba(34,197,94,0.7)"
                            : isActive
                              ? "rgba(59,130,246,0.7)"
                              : "rgba(255,255,255,0.18)",
                        }}
                      >
                        {isDone ? "Completed" : isActive ? step.sublabel : "Waiting"}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>

            {/* ── Footer status ── */}
            <div className="mt-7 pt-6" style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <motion.div
                    className="w-1.5 h-1.5 rounded-full"
                    style={{ background: authenticated ? "#22c55e" : "#3b82f6" }}
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  />
                  <AnimatePresence mode="wait">
                    <motion.span
                      key={authenticated ? "done" : "loading"}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.3 }}
                      className="text-xs font-medium"
                      style={{
                        fontFamily: "Inter, sans-serif",
                        color: authenticated ? "rgba(34,197,94,0.8)" : "rgba(255,255,255,0.4)",
                      }}
                    >
                      {authenticated
                        ? "Access granted — redirecting"
                        : "Secure TLS 1.3 connection active"}
                    </motion.span>
                  </AnimatePresence>
                </div>
                <div className="flex items-center gap-1.5">
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path
                      d="M6 1L7.5 4H11L8.5 6.2L9.5 9.5L6 7.5L2.5 9.5L3.5 6.2L1 4H4.5L6 1Z"
                      fill="rgba(255,255,255,0.2)"
                    />
                  </svg>
                  <span
                    className="text-xs"
                    style={{ fontFamily: "Inter, sans-serif", color: "rgba(255,255,255,0.2)" }}
                  >
                    Enterprise SSO
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Bottom hint */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="text-center text-xs mt-4"
          style={{ fontFamily: "Inter, sans-serif", color: "rgba(255,255,255,0.2)" }}
        >
          Powered by Centriq AI · End-to-end encrypted
        </motion.p>
      </motion.div>
    </div>
  );
}

/** 4C Enterprise Login */
function LoginView() {
  const { login, isInteracting } = useAuth();
  const { loadingCharId = "centriq", loadingCharCustom = "" } = (
    typeof useSettings === "function" ? useSettings() : {}
  ) as { loadingCharId?: string; loadingCharCustom?: string };

  const FOUR_C = [
    { key: "C", label: "Clarity", color: "var(--clarity)" },
    { key: "C", label: "Connectivity", color: "var(--connectivity)" },
    { key: "C", label: "Collaboration", color: "var(--collaboration)" },
    { key: "C", label: "Capacity", color: "var(--capacity)" },
  ] as const;

  return (
    <AuroraBackground>
      <div className="flex w-full h-full bg-transparent relative overflow-hidden z-10">
        <SparklesCore
          id="login-sparkles"
          minSize={0.4}
          maxSize={1.2}
          particleDensity={40}
          speed={0.5}
          particleColor="#3B8FE8"
        />

        {/* Left side — 4C brand panel */}
        <motion.div
          initial={{ opacity: 0, x: -40 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 relative p-12 border-r border-white/[0.06] overflow-hidden"
          style={{ background: "var(--gradient-sidebar)" }}
        >
          {/* Left brand strip */}
          <div
            className="absolute left-0 top-0 bottom-0 w-[3px]"
            style={{ background: "var(--gradient-primary)" }}
          />

          {/* Hex overlay */}
          <div
            className="absolute inset-0 pointer-events-none opacity-[0.05]"
            style={{
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='100'%3E%3Cpath d='M28 66L0 50V16L28 0l28 16v34L28 66zm0-6l22-13V19L28 6 6 19v28l22 13z' fill='none' stroke='%233B8FE8' stroke-width='0.5'/%3E%3C/svg%3E")`,
              backgroundSize: "56px 100px",
            }}
          />

          {/* Top logo */}
          <div className="flex items-center gap-3 relative z-10">
            <Logo size="sm" />
            <BrandName className="text-[16px] text-white font-bold" withAI={true} />
          </div>

          {/* 4C cards */}
          <div className="space-y-5 relative z-10">
            <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-white/30 mb-6">
              Built on 4 Pillars
            </p>
            {FOUR_C.map((c, i) => (
              <motion.div
                key={c.label}
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.12, duration: 0.5 }}
                className="flex items-center gap-4 group"
              >
                <div
                  className="flex h-10 w-10 items-center justify-center rounded-xl shrink-0 font-black text-white text-[16px]"
                  style={{
                    background: `color-mix(in oklab, ${c.color} 18%, transparent)`,
                    border: `1px solid color-mix(in oklab, ${c.color} 25%, transparent)`,
                    color: c.color,
                  }}
                >
                  {c.key}
                </div>
                <span className="text-[14px] font-semibold" style={{ color: c.color }}>
                  {c.label}
                </span>
              </motion.div>
            ))}
          </div>

          {/* Bottom tagline */}
          <p className="text-[11px] text-white/20 font-medium relative z-10">
            Enterprise Intelligence · Unified Workforce
          </p>
        </motion.div>

        {/* Right side — login card */}
        <div className="flex flex-1 items-center justify-center px-6">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="relative w-full max-w-sm z-10"
          >
            {/* Card */}
            <div
              className="rounded-3xl border p-8 shadow-2xl space-y-7 relative overflow-hidden"
              style={{
                background: "rgba(255,255,255,0.92)",
                borderColor: "rgba(27,111,200,0.12)",
                backdropFilter: "blur(24px)",
              }}
            >
              {/* Scan-line effect */}
              <div className="scan-line-overlay absolute inset-0 pointer-events-none" />

              {/* Logo */}
              <div className="flex flex-col items-center gap-4 text-center">
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, duration: 0.5, type: "spring", stiffness: 200 }}
                  className="relative"
                >
                  <LoadingCharacterDisplay
                    charId={loadingCharId}
                    customChar={loadingCharCustom}
                    size="md"
                  />
                </motion.div>

                <motion.div
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.25 }}
                >
                  <h1 className="text-2xl font-black tracking-tight mb-2">
                    Welcome to <span className="text-4c">Centriq</span>
                  </h1>
                  <div className="text-[13px] text-muted-foreground font-medium flex items-center justify-center gap-1.5">
                    Your intelligent{" "}
                    <FlipWords
                      words={["Clarity", "Connectivity", "Collaboration", "Capacity"]}
                      className="text-primary font-bold px-0 dark:text-[#00c4bb]"
                    />{" "}
                    concierge
                  </div>
                </motion.div>
              </div>

              {/* 4C indicator dots */}
              <div className="flex justify-center gap-2">
                {FOUR_C.map((c) => (
                  <motion.div
                    key={c.label}
                    className="h-1.5 w-8 rounded-full"
                    style={{ background: c.color }}
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 2, repeat: Infinity, delay: FOUR_C.indexOf(c) * 0.5 }}
                    title={c.label}
                  />
                ))}
              </div>

              {/* Sign-in button */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.4 }}
                className="flex justify-center"
              >
                <HoverBorderGradient
                  as="button"
                  onClick={() => login()}
                  disabled={isInteracting}
                  containerClassName="w-full rounded-2xl"
                  className={cn(
                    "group relative flex w-full items-center justify-center gap-3 rounded-2xl bg-zinc-950/40 p-4 text-[14px] font-bold text-white transition-all overflow-hidden",
                    isInteracting && "opacity-70 cursor-not-allowed",
                  )}
                >
                  {isInteracting ? (
                    <>
                      <LoadingDots />
                      <span>Signing in...</span>
                    </>
                  ) : (
                    <>
                      <svg
                        className="h-5 w-5 shrink-0 text-primary"
                        viewBox="0 0 23 23"
                        fill="none"
                      >
                        <path
                          d="M10.8 10.8H6.5V6.5h4.3v4.3zm5.7 0h-4.3V6.5h4.3v4.3zM10.8 16.5H6.5v-4.3h4.3v4.3zm5.7 0h-4.3v-4.3h4.3v4.3z"
                          fill="currentColor"
                        />
                      </svg>
                      <span>Sign in with Microsoft</span>
                    </>
                  )}
                </HoverBorderGradient>
              </motion.div>

              {/* Footer */}
              <p className="text-center text-[11px] text-muted-foreground/50 font-medium">
                Powered by AI · Enterprise-grade security
              </p>
            </div>
          </motion.div>
        </div>
      </div>
    </AuroraBackground>
  );
}

import { ThemeManager } from "@/lib/ThemeManager";

function AccessDeniedView() {
  const { logout } = useAuth();
  return (
    <div className="flex min-h-screen items-center justify-center bg-background relative overflow-hidden">
      <AnimatedBackground />
      <div className="relative z-10 text-center space-y-4 p-8 max-w-sm">
        <div className="text-5xl">🔒</div>
        <h1 className="text-2xl font-black tracking-tight">Access Denied</h1>
        <p className="text-sm text-muted-foreground">
          Your account is not authorized to use this application. Contact your administrator to
          request access.
        </p>
        <button
          onClick={logout}
          className="mt-4 px-5 py-2 rounded-xl text-sm font-semibold text-white"
          style={{ background: "var(--gradient-primary)" }}
        >
          Sign out
        </button>
      </div>
    </div>
  );
}

function AuthenticatedApp() {
  const { user, isLoading, accessDenied } = useAuth();
  const { updateActiveTime } = useBuddyStore();
  const {
    isOpen: introOpen,
    maybeAutoPlay: maybeAutoPlayIntro,
    close: closeIntro,
  } = useIntroStore();
  const [ssoCompleted, setSsoCompleted] = React.useState(false);
  const { serverBusy, waiting, serverSlow } = useServerLoad();
  const appVisible = !isLoading && !!user && !accessDenied && ssoCompleted;
  const wasServerBusyRef = React.useRef(false);
  const wasServerSlowRef = React.useRef(false);

  // Global heads-up: whenever the shared AI server saturates (queue/concurrency),
  // surface it as a top toast (independent of which screen/panel is open) so
  // users see it before they start typing a prompt, not just after they send one.
  React.useEffect(() => {
    if (!appVisible) return;

    if (serverBusy && !wasServerBusyRef.current) {
      toast.warning("AI server is busy right now", {
        id: SERVER_BUSY_TOAST_ID,
        description:
          waiting > 0
            ? `Requests are queued (${waiting} ahead). Replies may take longer than usual.`
            : "Replies may take longer than usual right now.",
        duration: Infinity,
      });
    } else if (!serverBusy && wasServerBusyRef.current) {
      toast.success("AI server load is back to normal", {
        id: SERVER_BUSY_TOAST_ID,
        duration: 4000,
      });
    }
    wasServerBusyRef.current = serverBusy;
  }, [appVisible, serverBusy, waiting]);

  // Separate signal: generation runs on CPU, so it can be slow to start even
  // with a free concurrency slot (serverBusy stays false). Skipped while the
  // busy toast is already up so users don't get two overlapping warnings.
  React.useEffect(() => {
    if (!appVisible) return;

    if (serverSlow && !serverBusy && !wasServerSlowRef.current) {
      toast.warning("AI responses are slower than usual", {
        id: SERVER_SLOW_TOAST_ID,
        description: "The model server is under heavy load — replies may take a bit longer to start.",
        duration: Infinity,
      });
    } else if ((!serverSlow || serverBusy) && wasServerSlowRef.current) {
      toast.dismiss(SERVER_SLOW_TOAST_ID);
    }
    wasServerSlowRef.current = serverSlow && !serverBusy;
  }, [appVisible, serverSlow, serverBusy]);

  // Auto-play the guided intro once the user is authenticated.
  React.useEffect(() => {
    if (user && !accessDenied) {
      maybeAutoPlayIntro();
    }
  }, [user, accessDenied, maybeAutoPlayIntro]);

  React.useEffect(() => {
    if (!isLoading && user && !accessDenied) {
      // SSO succeeded! Allow 1.8s for the door opening animation before transitioning
      const timer = setTimeout(() => {
        setSsoCompleted(true);
      }, 1800);
      return () => clearTimeout(timer);
    } else {
      setSsoCompleted(false);
    }
  }, [isLoading, user, accessDenied]);

  React.useEffect(() => {
    if (!user) return;

    let lastLogged = 0;
    const handleActivity = () => {
      const now = Date.now();
      // Throttle localStorage writes to once every 30 seconds
      if (now - lastLogged > 30000) {
        lastLogged = now;
        updateActiveTime();
      }
    };

    window.addEventListener("mousedown", handleActivity);
    window.addEventListener("keydown", handleActivity);
    window.addEventListener("scroll", handleActivity);
    window.addEventListener("touchstart", handleActivity);

    // Initial ping
    handleActivity();

    return () => {
      window.removeEventListener("mousedown", handleActivity);
      window.removeEventListener("keydown", handleActivity);
      window.removeEventListener("scroll", handleActivity);
      window.removeEventListener("touchstart", handleActivity);
    };
  }, [user, updateActiveTime]);

  if (isLoading || (user && !accessDenied && !ssoCompleted)) {
    return <SplashScreen authenticated={!isLoading && !!user && !accessDenied} />;
  }

  if (accessDenied) {
    return <AccessDeniedView />;
  }

  if (!user) {
    return <LoginView />;
  }

  return (
    <>
      <ThemeManager />
      <AnimatedBackground />
      <Outlet />
      <Toaster position="top-right" expand={false} richColors />
      <FlyingBanner />
      <GreetingBot />
      <AnimatePresence>{introOpen && <IntroTour onComplete={closeIntro} />}</AnimatePresence>
    </>
  );
}

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html>
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
