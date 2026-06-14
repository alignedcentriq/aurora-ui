import { createRootRoute, Outlet, HeadContent, Scripts } from "@tanstack/react-router";
import * as React from "react";
import { DefaultCatchBoundary } from "../components/DefaultCatchBoundary";
import { NotFound } from "../components/NotFound";
import appCss from "../styles.css?url";
import { seo } from "../utils/seo";
import { MsalProvider } from "@azure/msal-react";
import { msalInstance } from "../lib/msal";
import { AuthProvider, useAuth } from "../lib/auth-store";
import { Toaster } from "sonner";
import { cn } from "../lib/utils";
import { Logo } from "../components/Logo";
import { BrandName } from "../components/BrandName";
import { AnimatedBackground } from "../components/AnimatedBackground";
import { FlyingBanner } from "../components/FlyingBanner";
import { motion } from "framer-motion";
import { LoadingCharacterDisplay, LoadingDots } from "../components/LoadingCharacter";
import { useSettings, useBuddyColors } from "../lib/settings-store";
import GreetingBot from "../components/assistant/GreetingBot";
import { useBuddyStore } from "../lib/buddy-store";
import { SplashOverlay } from "../components/assistant/SplashOverlay";
import { AuroraBackground } from "../components/ui/aurora-background";
import { SparklesCore } from "../components/ui/sparkles";
import { HoverBorderGradient } from "../components/ui/hover-border-gradient";
import { FlipWords } from "../components/ui/flip-words";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      {
        charSet: "utf-8",
      },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1",
      },
      ...seo({
        title: "Centriq AI",
        description:
          "Centriq is your intelligent workplace concierge, helping you manage HR tasks, IT requests, and admin services with ease.",
      }),
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", type: "image/png", href: `${import.meta.env.BASE_URL}logo.png` },
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

// --- Mascot Door Unlock Rigged Animation for Loading/SSO Timeout screen ---
function MascotDoorUnlock({ authenticated }: { authenticated: boolean }) {
  const colors = useBuddyColors(); // Re-use chosen theme colors!

  const armVariants = {
    loop: {
      x: [0, 4, 4, 4, 0],
      y: [0, -9, -9, -9, 0],
      transition: {
        duration: 2.4,
        repeat: Infinity,
        ease: "easeInOut" as const,
        times: [0, 0.3, 0.6, 0.8, 1],
      },
    },
  };

  const cardVariants = {
    loop: {
      rotate: [0, 10, 10, 0, 0],
      transition: {
        duration: 2.4,
        repeat: Infinity,
        ease: "easeInOut" as const,
        times: [0, 0.3, 0.6, 0.8, 1],
      },
    },
  };

  const guardVariants = {
    loop: {
      y: [0, -1, 0, -1, 0],
      rotate: [0, 1, 0, -1, 0],
      transition: {
        duration: 4.8,
        repeat: Infinity,
        ease: "easeInOut" as const,
      },
    },
  };

  // State-driven dynamic animations
  const ledAnimate = authenticated ? "#22c55e" : ["#ef4444", "#ef4444", "#3b82f6", "#ef4444", "#ef4444"];
  const ledTransition = authenticated 
    ? { duration: 0.4 } 
    : { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const, times: [0, 0.28, 0.45, 0.65, 1] };

  const ledGlowAnimate = authenticated 
    ? { fill: "#22c55e", opacity: 0.8, scale: 2.2 } 
    : {
        fill: ["#ef4444", "#ef4444", "#3b82f6", "#ef4444", "#ef4444"],
        opacity: [0.15, 0.15, 0.5, 0.15, 0.15],
        scale: [1, 1, 1.8, 1, 1],
      };
  const ledGlowTransition = authenticated 
    ? { duration: 0.4 } 
    : { duration: 2.4, repeat: Infinity, ease: "easeInOut" as const, times: [0, 0.28, 0.45, 0.65, 1] };

  const doorAnimate = authenticated ? { x: 13, opacity: 0.25 } : { x: 0, opacity: 1 };
  const doorTransition = { duration: 0.8, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

  const glowAnimate = authenticated ? { opacity: 0.8, scale: 1.2 } : { opacity: 0, scale: 0.2 };
  const glowTransition = { duration: 0.8, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

  const lightBeamAnimate = authenticated ? { opacity: 0.85, scaleX: 1 } : { opacity: 0, scaleX: 0 };
  const lightBeamTransition = { duration: 0.8, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] };

  return (
    <div className="relative w-[min(92vw,760px)] aspect-[16/10] max-h-[60vh] flex items-center justify-center select-none pointer-events-none mb-4 overflow-visible">
      <svg width="100%" height="100%" viewBox="0 0 160 100" fill="none" preserveAspectRatio="xMidYMid meet" className="w-full h-full overflow-visible">
        {/* ===== AMBIENCE: Ceiling downlights ===== */}
        <rect x="36" y="0" width="10" height="1.4" rx="0.5" fill="#1e293b" />
        <rect x="99" y="0" width="11" height="1.4" rx="0.5" fill="#1e293b" />
        <polygon points="37,1.4 45,1.4 57,46 25,46" fill="url(#down-light)" />
        <polygon points="100,1.4 109,1.4 121,50 88,50" fill="url(#down-light)" />

        {/* ===== BACKLIT CORPORATE WALL SIGNAGE — Aligned Automation ===== */}
        <g>
          {/* Soft backlight halo */}
          <ellipse cx="42" cy="14" rx="34" ry="13" fill="#1b6fc8" opacity="0.10" className="blur-2xl" />
          <ellipse cx="42" cy="14" rx="24" ry="8" fill="#00c4bb" opacity="0.10" className="blur-xl" />
          {/* Emblem */}
          <g transform="translate(23, 13) scale(1.7)">
            <use href="#aa-chevron" />
          </g>
          {/* Wordmark */}
          <text x="31" y="12" fill="#ffffff" fontSize="3.8" fontWeight="900" letterSpacing="0.15" fontFamily="'Inter', sans-serif">ALIGNED</text>
          <text x="31.3" y="16.5" fill="#00c4bb" fontSize="2.3" fontWeight="800" letterSpacing="0.55" fontFamily="'Inter', sans-serif">AUTOMATION</text>
          {/* Underline accent */}
          <line x1="31" y1="18.4" x2="60" y2="18.4" stroke="#1b6fc8" strokeWidth="0.4" opacity="0.6" />
        </g>

        {/* Glow behind the door */}
        <motion.ellipse
          cx="136"
          cy="45"
          rx="18"
          ry="38"
          fill="#3b82f6"
          className="blur-md"
          animate={glowAnimate}
          transition={glowTransition}
        />

        {/* Light beam when door opens */}
        <motion.polygon
          points="136,10 160,0 160,90 136,80"
          fill="url(#door-beam-grad)"
          style={{ originX: 0 }}
          animate={lightBeamAnimate}
          transition={lightBeamTransition}
        />

        {/* Floor Line & Reflections */}
        <line x1="0" y1="85" x2="160" y2="85" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="1" />
        <rect x="0" y="85" width="160" height="15" fill="url(#floor-grad)" opacity="0.3" />

        {/* ===== LEFT: Security Reception & Professional Officers ===== */}
        <g>
          {/* Female Security Officer */}
          <motion.g variants={guardVariants} animate="loop" style={{ transformOrigin: "26px 46px" }}>
            {/* Long hair flowing to shoulders (behind cap) */}
            <path d="M 19.5 44 C 18.5 38 33.5 38 32.5 44 C 33.5 50 32.5 57 30.5 59 C 29.5 58 29 52 28 49 C 24.5 51 23 57 21.5 59 C 19.5 57 18.5 50 19.5 44 Z" fill="url(#hair-female)" />

            {/* Neck & Face */}
            <rect x="23.8" y="50" width="4.4" height="5" rx="1" fill="url(#skin-female)" />
            <circle cx="26" cy="46" r="5.3" fill="url(#skin-female)" />
            {/* Soft cheek contour shading */}
            <path d="M 21 46.5 Q 22 50 24 51.5" stroke="#e09d84" strokeWidth="0.25" fill="none" opacity="0.5" />
            <path d="M 31 46.5 Q 30 50 28 51.5" stroke="#e09d84" strokeWidth="0.25" fill="none" opacity="0.5" />

            {/* Blush */}
            <ellipse cx="22.2" cy="47.6" rx="1.1" ry="0.75" fill="#fda4af" opacity="0.28" />
            <ellipse cx="29.8" cy="47.6" rx="1.1" ry="0.75" fill="#fda4af" opacity="0.28" />

            {/* Eyes */}
            <ellipse cx="23.2" cy="45.6" rx="1" ry="0.55" fill="#ffffff" />
            <circle cx="23.2" cy="45.6" r="0.52" fill="#3a2415" />
            <circle cx="23.42" cy="45.4" r="0.18" fill="#ffffff" />
            <ellipse cx="28.8" cy="45.6" rx="1" ry="0.55" fill="#ffffff" />
            <circle cx="28.8" cy="45.6" r="0.52" fill="#3a2415" />
            <circle cx="29.02" cy="45.4" r="0.18" fill="#ffffff" />
            {/* Lashes */}
            <path d="M 22.2 45.1 Q 23.2 44.7 24.2 45.1" stroke="#1c1412" strokeWidth="0.3" fill="none" strokeLinecap="round" />
            <path d="M 27.8 45.1 Q 28.8 44.7 29.8 45.1" stroke="#1c1412" strokeWidth="0.3" fill="none" strokeLinecap="round" />

            {/* Eyebrows */}
            <path d="M 21.9 44.3 Q 23.2 43.7 24.5 44.3" stroke="#2d211a" strokeWidth="0.4" fill="none" strokeLinecap="round" />
            <path d="M 27.5 44.3 Q 28.8 43.7 30.1 44.3" stroke="#2d211a" strokeWidth="0.4" fill="none" strokeLinecap="round" />

            {/* Nose */}
            <path d="M 26 45.4 L 25.5 47.1 L 26.5 47.1" fill="none" stroke="#e09d84" strokeWidth="0.4" strokeLinecap="round" />

            {/* Lips */}
            <path d="M 23.9 48.9 C 24.6 48.4 25.4 48.4 26 48.6 C 26.6 48.4 27.4 48.4 28.1 48.9 C 27 49.3 25 49.3 23.9 48.9 Z" fill="#db2777" />
            <path d="M 23.9 49.1 C 25 50.4 27 50.4 28.1 49.1 C 27 49.4 25 49.4 23.9 49.1 Z" fill="#be185d" />

            {/* Pearl earrings */}
            <circle cx="20.2" cy="47.9" r="0.5" fill="#fbbf24" stroke="#d97706" strokeWidth="0.2" />
            <circle cx="31.8" cy="47.9" r="0.5" fill="#fbbf24" stroke="#d97706" strokeWidth="0.2" />

            {/* Hair crown — neat center-parted top (no cap) */}
            <path d="M 20.5 44 C 19.5 38 32.5 38 31.5 44 C 30 41.2 28 42 26 42 C 24 42 22 41.2 20.5 44 Z" fill="url(#hair-female)" />
            <path d="M 26 39 Q 26 41.5 26 43.5" stroke="#1c1310" strokeWidth="0.3" fill="none" opacity="0.5" />
            <path d="M 22.2 41 Q 26 39.2 29.8 41" stroke="#1c1310" strokeWidth="0.28" fill="none" opacity="0.4" />

            {/* Uniform shoulders */}
            <path d="M 16 62 L 36 62 L 33.5 52 L 28.5 52 L 26 55 L 23.5 52 L 18.5 52 Z" fill="url(#uniform-grad)" stroke="#0f1e44" strokeWidth="0.4" />
            <line x1="18.5" y1="52.2" x2="23.5" y2="52.2" stroke="#fbbf24" strokeWidth="0.5" />
            <line x1="28.5" y1="52.2" x2="33.5" y2="52.2" stroke="#fbbf24" strokeWidth="0.5" />
            <path d="M 23 52 L 26 56.5 L 29 52" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.4" />
            <polygon points="25.4,52.5 26.6,52.5 27,57 26,59 25,57" fill="#0f172a" />
            <polygon points="31,55 33,55 33.5,57 32,58.5 30.5,57" fill="#fbbf24" stroke="#d97706" strokeWidth="0.3" />
          </motion.g>

          {/* Male Security Officer */}
          <motion.g variants={guardVariants} animate="loop" style={{ transformOrigin: "54px 46px" }}>
            {/* Neck, ears & face */}
            <rect x="51.5" y="50" width="5" height="5" rx="1" fill="url(#skin-male)" />
            <circle cx="54" cy="46" r="5.4" fill="url(#skin-male)" />
            <ellipse cx="48.4" cy="46.5" rx="1" ry="1.5" fill="url(#skin-male)" />
            <ellipse cx="59.6" cy="46.5" rx="1" ry="1.5" fill="url(#skin-male)" />
            {/* Sideburns */}
            <rect x="48.4" y="42.5" width="1" height="2.6" rx="0.3" fill="#2a1a12" />
            <rect x="59.6" y="42.5" width="1" height="2.6" rx="0.3" fill="#2a1a12" />
            {/* Jaw / cheek shading */}
            <path d="M 49 46.5 Q 50 50 52 51.6" stroke="#c98a68" strokeWidth="0.25" fill="none" opacity="0.5" />
            <path d="M 59 46.5 Q 58 50 56 51.6" stroke="#c98a68" strokeWidth="0.25" fill="none" opacity="0.5" />

            {/* Eyebrows */}
            <path d="M 49.6 43.7 Q 51 43 52.4 43.7" stroke="#2a1a12" strokeWidth="0.55" fill="none" strokeLinecap="round" />
            <path d="M 55.6 43.7 Q 57 43 58.4 43.7" stroke="#2a1a12" strokeWidth="0.55" fill="none" strokeLinecap="round" />

            {/* Eyes */}
            <ellipse cx="51.2" cy="45.6" rx="1" ry="0.5" fill="#ffffff" />
            <circle cx="51.2" cy="45.6" r="0.5" fill="#26323f" />
            <circle cx="51.4" cy="45.4" r="0.18" fill="#ffffff" />
            <ellipse cx="56.8" cy="45.6" rx="1" ry="0.5" fill="#ffffff" />
            <circle cx="56.8" cy="45.6" r="0.5" fill="#26323f" />
            <circle cx="57" cy="45.4" r="0.18" fill="#ffffff" />

            {/* Nose */}
            <path d="M 54 45.4 L 53.4 47.2 L 54.6 47.2" fill="none" stroke="#c98a68" strokeWidth="0.4" strokeLinecap="round" />

            {/* Gentle smile */}
            <path d="M 51.9 49 Q 54 50.6 56.1 49" stroke="#7f1d1d" strokeWidth="0.7" fill="none" strokeLinecap="round" />

            {/* Short business haircut (no cap) */}
            <path d="M 48.4 44 C 47.4 37.8 60.6 37.8 59.6 44 C 58.3 41 56 42 54 42 C 52 42 49.7 41 48.4 44 Z" fill="url(#hair-male)" />
            <path d="M 50 41 Q 54 39 58 41" stroke="#2a1d16" strokeWidth="0.3" fill="none" opacity="0.5" />
            <path d="M 50.5 42.6 Q 54 41 57.5 42.6" stroke="#1f140f" strokeWidth="0.28" fill="none" opacity="0.4" />

            {/* Uniform shoulders */}
            <path d="M 44 62 L 64 62 L 61.5 52 L 56.5 52 L 54 55 L 51.5 52 L 46.5 52 Z" fill="url(#uniform-grad)" stroke="#0f1e44" strokeWidth="0.4" />
            <line x1="46.5" y1="52.2" x2="51.5" y2="52.2" stroke="#fbbf24" strokeWidth="0.5" />
            <line x1="56.5" y1="52.2" x2="61.5" y2="52.2" stroke="#fbbf24" strokeWidth="0.5" />
            <path d="M 51 52 L 54 56.5 L 57 52" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.4" />
            <polygon points="53.4,52.5 54.6,52.5 55,59 54,61 53,59" fill="#0f172a" />
            <polygon points="59,55 61,55 61.5,57 60,58.5 58.5,57" fill="#fbbf24" stroke="#d97706" strokeWidth="0.3" />
          </motion.g>

          {/* Potted plant beside the desk (warmth) */}
          <g transform="translate(76, 73)">
            <path d="M 0.5 11 L 7.5 11 L 6.5 18 L 1.5 18 Z" fill="#334155" />
            <rect x="0" y="10" width="8" height="2" rx="0.5" fill="#475569" />
            <path d="M 4 10 C 1 5 1.5 0 4 -3 C 6.5 0 7 5 4 10 Z" fill="#0f766e" />
            <path d="M 4 10 C 0 7 -2.5 3 -2.5 -0.5 C 2 0.5 5 5 4 10 Z" fill="#10b981" opacity="0.9" />
            <path d="M 4 10 C 8 7 10.5 3 10.5 -0.5 C 6 0.5 3 5 4 10 Z" fill="#10b981" opacity="0.9" />
            <path d="M 4 10 C 2.5 4 3 -1 5 -4 C 6 -1 5.5 4 4 10 Z" fill="#34d399" opacity="0.85" />
          </g>

          {/* Front Reception Desk */}
          <rect x="12" y="62" width="60" height="23" rx="4" fill="url(#desk-grad)" stroke="#334155" strokeWidth="1.2" />
          <rect x="18" y="68" width="48" height="12" rx="2" fill="rgba(15, 23, 42, 0.4)" stroke="rgba(255, 255, 255, 0.05)" />
          <line x1="20" y1="79.5" x2="64" y2="79.5" stroke="#06b6d4" strokeWidth="0.9" strokeLinecap="round" opacity="0.8" className="animate-pulse" />
          {/* Aligned Automation logo on desk front */}
          <g transform="translate(24, 73.5) scale(0.72)">
            <use href="#aa-chevron" />
          </g>
          <text x="29.5" y="72.4" fill="#ffffff" fontSize="2.5" fontWeight="900" letterSpacing="0.08" fontFamily="'Inter', sans-serif">ALIGNED</text>
          <text x="29.7" y="76" fill="#00c4bb" fontSize="1.7" fontWeight="800" letterSpacing="0.28" fontFamily="'Inter', sans-serif">AUTOMATION</text>
          {/* Polished desktop counter */}
          <rect x="10" y="59" width="64" height="3" rx="1" fill="#cbd5e1" />
          <rect x="10" y="60" width="64" height="1" fill="#ffffff" opacity="0.6" />
        </g>

        {/* ===== RIGHT: Sliding Glass Door ===== */}
        <rect x="128" y="8" width="16" height="74" rx="1.5" stroke="#64748b" strokeWidth="1.2" fill="#1e293b" />

        <motion.g animate={doorAnimate} transition={doorTransition} style={{ transformOrigin: "140px 45px" }}>
          <rect x="129" y="9" width="14" height="72" rx="1" fill="rgba(186, 230, 253, 0.15)" stroke="rgba(255, 255, 255, 0.4)" strokeWidth="0.8" />
          <rect x="130.5" y="10.5" width="11" height="69" rx="0.5" fill="none" stroke="rgba(255, 255, 255, 0.15)" strokeWidth="0.5" />
          <line x1="131" y1="18" x2="141" y2="38" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="0.8" />
          <line x1="131" y1="42" x2="141" y2="62" stroke="rgba(255, 255, 255, 0.25)" strokeWidth="0.8" />
          <rect x="130" y="32" width="1.2" height="26" rx="0.4" fill="#cbd5e1" stroke="#475569" strokeWidth="0.3" />
          <line x1="129.2" y1="34" x2="130" y2="34" stroke="#475569" strokeWidth="0.4" />
          <line x1="129.2" y1="56" x2="130" y2="56" stroke="#475569" strokeWidth="0.4" />
        </motion.g>

        {/* RFID Access Card Reader */}
        <g>
          <rect x="119" y="38" width="8" height="15" rx="1.2" fill="#1e293b" stroke="#475569" strokeWidth="0.6" />
          <rect x="120.5" y="44" width="5" height="7" rx="0.6" fill="#0f172a" />
          <path d="M 121.5 46.5 Q 123 47.5 121.5 48.5" stroke="#475569" strokeWidth="0.5" fill="none" />
          <motion.circle
            cx="123"
            cy="41.5"
            r="1.8"
            animate={ledGlowAnimate}
            transition={ledGlowTransition}
            className="blur-[0.5px]"
          />
          <motion.circle
            cx="123"
            cy="41.5"
            r="0.8"
            animate={{ fill: ledAnimate }}
            transition={ledTransition}
          />
        </g>

        {/* ===== CENTER-RIGHT: Employee (back view, badging in) ===== */}
        <g>
          {/* Shoes */}
          <ellipse cx="99" cy="83.8" rx="3.6" ry="1.4" fill="#0b1120" />
          <ellipse cx="107" cy="83.8" rx="3.6" ry="1.4" fill="#0b1120" />
          {/* Trousers (slim fit) */}
          <path d="M 98.6 72 L 102.4 72 L 101.9 83 L 99 83 Z" fill="#28303f" />
          <path d="M 103.6 72 L 107.4 72 L 107 83 L 104.1 83 Z" fill="#28303f" />
          <line x1="100.4" y1="73" x2="100.1" y2="82" stroke="#1b2230" strokeWidth="0.3" />
          <line x1="105.6" y1="73" x2="105.9" y2="82" stroke="#1b2230" strokeWidth="0.3" />

          {/* Belt */}
          <rect x="97.5" y="70.5" width="11" height="2.2" fill="#1b2230" />
          <rect x="102.3" y="70.7" width="1.6" height="1.8" fill="#64748b" />

          {/* Business shirt torso — athletic V-taper (broad shoulders, slim waist) */}
          <path d="M 94.5 60 Q 95.5 54.5 99 53.5 L 107 53.5 Q 110.5 54.5 111.5 60 L 108.5 71 L 97.5 71 Z" fill="url(#shirt-grad)" stroke="#9fb4d0" strokeWidth="0.3" />
          {/* Center back seam & pleat shading following the taper */}
          <line x1="103" y1="55" x2="103" y2="71" stroke="#9fb4d0" strokeWidth="0.3" opacity="0.7" />
          <path d="M 98.5 56 L 98 70" stroke="#c3d2e6" strokeWidth="0.3" opacity="0.5" />
          <path d="M 107.5 56 L 108 70" stroke="#9fb4d0" strokeWidth="0.3" opacity="0.5" />

          {/* Collar & neck */}
          <rect x="100.6" y="49.5" width="4.8" height="6" rx="1.2" fill="url(#skin-male)" />
          <path d="M 98.5 55 L 103 58.2 L 107.5 55 L 105.5 53 L 100.5 53 Z" fill="#ffffff" stroke="#cbd5e1" strokeWidth="0.3" />

          {/* Lanyard straps over shoulders */}
          <path d="M 100.4 55.5 L 101.6 63.5" stroke={colors.primary} strokeWidth="0.9" fill="none" />
          <path d="M 105.6 55.5 L 104.4 63.5" stroke={colors.primary} strokeWidth="0.9" fill="none" />
          {/* ID badge hanging on the lanyard */}
          <rect x="100.6" y="63.2" width="4.8" height="5.6" rx="0.6" fill="#f8fafc" stroke="#64748b" strokeWidth="0.3" />
          <rect x="101.3" y="63.9" width="1.6" height="2" rx="0.2" fill="#1b6fc8" />
          <rect x="103.4" y="64.1" width="1.5" height="0.5" rx="0.1" fill="#94a3b8" />
          <rect x="103.4" y="65.1" width="1.1" height="0.4" rx="0.1" fill="#cbd5e1" />
          <rect x="101.3" y="66.4" width="3.6" height="0.45" rx="0.1" fill="#cbd5e1" />
          <rect x="101.3" y="67.3" width="2.6" height="0.45" rx="0.1" fill="#e2e8f0" />

          {/* Head — front-facing, gaze toward the reader */}
          {/* Ears */}
          <ellipse cx="96.4" cy="45" rx="1" ry="1.6" fill="url(#skin-male)" />
          <ellipse cx="109.6" cy="45" rx="1" ry="1.6" fill="url(#skin-male)" />
          {/* Face */}
          <ellipse cx="103" cy="44" rx="6.8" ry="7.4" fill="url(#skin-male)" />
          {/* Neat modern haircut — hugs the head, light volume, hairline above the brows */}
          <path d="M 95.4 43 C 94.3 36 97.6 33.4 103 33.4 C 108.4 33.4 111.7 36 110.6 43 C 109.2 39.7 106.8 41.3 103 41.3 C 99.2 41.3 96.8 39.7 95.4 43 Z" fill="url(#hair-male)" />
          {/* Temple depth */}
          <path d="M 95.5 42.5 C 94.8 39 95.6 36 97.2 34.4" stroke="#1f140f" strokeWidth="0.45" fill="none" opacity="0.45" />
          <path d="M 110.5 42.5 C 111.2 39 110.4 36 108.8 34.4" stroke="#1f140f" strokeWidth="0.45" fill="none" opacity="0.45" />
          {/* Side-swept strands */}
          <path d="M 98 40.5 Q 102 37 107.5 38" stroke="#2a1d16" strokeWidth="0.35" fill="none" opacity="0.45" />
          <path d="M 98.5 38.5 Q 103 35.6 108 37" stroke="#2a1d16" strokeWidth="0.3" fill="none" opacity="0.4" />
          {/* Soft highlight */}
          <path d="M 99.5 36.5 Q 103.5 34.6 107.5 36" stroke="#5a4030" strokeWidth="0.3" fill="none" opacity="0.5" />
          {/* Sideburns */}
          <rect x="96.4" y="43" width="0.9" height="2.4" rx="0.3" fill="#2a1d16" />
          <rect x="109.7" y="43" width="0.9" height="2.4" rx="0.3" fill="#2a1d16" />
          {/* Cheek shading */}
          <path d="M 97.6 45 Q 98.6 48.5 100.4 50.2" stroke="#c98a68" strokeWidth="0.25" fill="none" opacity="0.4" />
          <path d="M 108.4 45 Q 107.4 48.5 105.6 50.2" stroke="#c98a68" strokeWidth="0.25" fill="none" opacity="0.4" />
          {/* Eyebrows */}
          <path d="M 99.1 43 Q 100.5 42.3 101.9 43" stroke="#2a1d16" strokeWidth="0.5" fill="none" strokeLinecap="round" />
          <path d="M 104.3 43 Q 105.7 42.3 107.1 43" stroke="#2a1d16" strokeWidth="0.5" fill="none" strokeLinecap="round" />
          {/* Eyes (looking toward the reader) */}
          <ellipse cx="100.5" cy="44.9" rx="1" ry="0.55" fill="#ffffff" />
          <circle cx="100.75" cy="44.9" r="0.5" fill="#26323f" />
          <circle cx="100.95" cy="44.7" r="0.16" fill="#ffffff" />
          <ellipse cx="105.5" cy="44.9" rx="1" ry="0.55" fill="#ffffff" />
          <circle cx="105.75" cy="44.9" r="0.5" fill="#26323f" />
          <circle cx="105.95" cy="44.7" r="0.16" fill="#ffffff" />
          {/* Nose */}
          <path d="M 103.2 45.1 L 102.7 46.8 L 103.7 46.8" fill="none" stroke="#c98a68" strokeWidth="0.4" strokeLinecap="round" />
          {/* Friendly smile */}
          <path d="M 100.9 48.1 Q 103.2 49.9 105.5 48.1" stroke="#7f1d1d" strokeWidth="0.7" fill="none" strokeLinecap="round" />

          {/* Static left arm */}
          <path d="M 95 58 Q 91.5 66 93 73" stroke="url(#shirt-grad)" strokeWidth="3" strokeLinecap="round" fill="none" />
          <circle cx="93" cy="73" r="1.5" fill="url(#skin-male)" />
        </g>

        {/* Rigged badging arm with access card */}
        <motion.g variants={armVariants} animate="loop">
          {/* Raised right arm toward the reader */}
          <path d="M 110 57 Q 114 54 118 51" stroke="url(#shirt-grad)" strokeWidth="3.1" strokeLinecap="round" fill="none" />
          <circle cx="118" cy="51" r="1.9" fill="url(#skin-male)" />

          {/* Access ID card in hand */}
          <motion.g style={{ x: 118, y: 51, originX: 0, originY: 0 }} variants={cardVariants}>
            <g style={{ transform: "translate(-1px, -2.5px) rotate(12deg)" }}>
              <rect x="0" y="0" width="8" height="5" rx="0.6" fill="#f8fafc" stroke="#64748b" strokeWidth="0.4" />
              <rect x="0.8" y="0.8" width="2.2" height="3.4" fill="#1b6fc8" rx="0.2" />
              <g transform="translate(1.9, 2.5) scale(0.22)">
                <use href="#aa-chevron" />
              </g>
              <rect x="3.8" y="1.2" width="3.4" height="0.6" fill="#475569" />
              <rect x="3.8" y="2.4" width="2.4" height="0.6" fill="#94a3b8" />
              <rect x="3.8" y="3.4" width="1.2" height="1" fill="#e2e8f0" rx="0.1" />
            </g>
          </motion.g>
        </motion.g>

        <defs>
          {/* Aligned Automation Chevron (reusable) */}
          <g id="aa-chevron">
            <path d="M -3.5 4.5 L 0 -4.5 L 3.5 4.5 L 2 4.5 L 0 0 L -2 4.5 Z" fill="#1b6fc8" />
            <path d="M 0 0 L 2 4.5 L 0.8 4.5 L -0.3 2 L -1.1 2 Z" fill="#00c4bb" />
          </g>

          <linearGradient id="skin-female" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#ffeedd" />
            <stop offset="100%" stopColor="#f5bca9" />
          </linearGradient>
          <linearGradient id="skin-male" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#fff3e0" />
            <stop offset="100%" stopColor="#e5a988" />
          </linearGradient>
          <linearGradient id="hair-female" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3a2a22" />
            <stop offset="100%" stopColor="#1c1310" />
          </linearGradient>
          <linearGradient id="hair-male" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4a3527" />
            <stop offset="100%" stopColor="#2a1d16" />
          </linearGradient>
          <linearGradient id="uniform-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#1e3a8a" />
            <stop offset="100%" stopColor="#16306e" />
          </linearGradient>
          <linearGradient id="shirt-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#eaf1fb" />
            <stop offset="100%" stopColor="#bccde4" />
          </linearGradient>
          <linearGradient id="desk-grad" x1="0" y1="62" x2="0" y2="85" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#243042" />
            <stop offset="100%" stopColor="#161f2e" />
          </linearGradient>
          <linearGradient id="down-light" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#bfdbfe" stopOpacity="0.22" />
            <stop offset="100%" stopColor="#bfdbfe" stopOpacity="0" />
          </linearGradient>

          <linearGradient id="door-beam-grad" x1="136" y1="45" x2="160" y2="45" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="floor-grad" x1="80" y1="85" x2="80" y2="100" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.1" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
      </svg>
    </div>
  );
}

/** Brand splash — Rigged Mascot Unlock sequence and pulsing status label */
function SplashScreen({ authenticated = false }: { authenticated?: boolean }) {
  const loadingPhrases = [
    "Unlocking workspace concierge...",
    "Finding the right AD group keys...",
    "Verifying operational credentials...",
    "Initializing secure connection...",
  ];
  const [phraseIdx, setPhraseIdx] = React.useState(0);

  React.useEffect(() => {
    const timer = setInterval(() => {
      setPhraseIdx((i) => (i + 1) % loadingPhrases.length);
    }, 2800);
    return () => clearInterval(timer);
  }, []);

  return (
    <AuroraBackground>
      <div className="flex flex-col items-center justify-center relative z-10 select-none">
        <MascotDoorUnlock authenticated={authenticated} />
        
        <motion.h1
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-2xl sm:text-3xl md:text-4xl font-black tracking-tight text-4c text-glow animate-pulse-glow"
        >
          Centriq AI
        </motion.h1>

        <motion.p
          key={authenticated ? "authenticated" : phraseIdx}
          initial={{ opacity: 0, y: 5 }}
          animate={{ opacity: 0.75, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.4 }}
          className="text-[10px] uppercase tracking-[0.22em] text-white/50 font-bold mt-2 text-center h-4"
        >
          {authenticated ? "Access Granted. Welcome!" : loadingPhrases[phraseIdx]}
        </motion.p>
      </div>
    </AuroraBackground>
  );
}

/** 4C Enterprise Login */
function LoginView() {
  const { login, isInteracting } = useAuth();
  const { loadingCharId = "centriq", loadingCharCustom = "" } = (typeof useSettings === "function" ? useSettings() : {}) as { loadingCharId?: string; loadingCharCustom?: string };

  const FOUR_C = [
    { key: "C", label: "Clarity", color: "var(--clarity)" },
    { key: "C", label: "Connectivity", color: "var(--connectivity)" },
    { key: "C", label: "Collaboration", color: "var(--collaboration)" },
    { key: "C", label: "Capacity", color: "var(--capacity)" },
  ] as const;

  return (
    <AuroraBackground>
      <div className="flex w-full h-full bg-transparent relative overflow-hidden z-10">
        <SparklesCore id="login-sparkles" minSize={0.4} maxSize={1.2} particleDensity={40} speed={0.5} particleColor="#3B8FE8" />

      {/* Left side — 4C brand panel */}
      <motion.div
        initial={{ opacity: 0, x: -40 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 relative p-12 border-r border-white/[0.06] overflow-hidden"
        style={{ background: "var(--gradient-sidebar)" }}
      >
        {/* Left brand strip */}
        <div className="absolute left-0 top-0 bottom-0 w-[3px]" style={{ background: "var(--gradient-primary)" }} />

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
              <span className="text-[14px] font-semibold" style={{ color: c.color }}>{c.label}</span>
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
                <LoadingCharacterDisplay charId={loadingCharId} customChar={loadingCharCustom} size="md" />
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.25 }}
              >
                <h1 className="text-2xl font-black tracking-tight mb-2">
                  Welcome to{" "}
                  <span className="text-4c">Centriq</span>
                </h1>
                <div className="text-[13px] text-muted-foreground font-medium flex items-center justify-center gap-1.5">
                  Your intelligent <FlipWords words={["Clarity", "Connectivity", "Collaboration", "Capacity"]} className="text-primary font-bold px-0 dark:text-[#00c4bb]" /> concierge
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
                    <svg className="h-5 w-5 shrink-0 text-primary" viewBox="0 0 23 23" fill="none">
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
          Your account is not authorized to use this application. Contact your administrator to request access.
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
  const [showSplash, setShowSplash] = React.useState(true);
  const [ssoCompleted, setSsoCompleted] = React.useState(false);

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
      {!showSplash && <GreetingBot />}
      {showSplash && <SplashOverlay onComplete={() => setShowSplash(false)} />}
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
