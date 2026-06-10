import React, { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useBuddyColors, useSettings } from "@/lib/settings-store";
import { useBuddyStore } from "@/lib/buddy-store";
import { useAuth } from "@/lib/auth-store";
import { X, Sparkles } from "lucide-react";
import { useChatStore } from "@/lib/chat-store";

interface GreetingBotSVGProps {
  colors: ReturnType<typeof useBuddyColors>;
  expression?: "normal" | "wink" | "happy" | "heart";
  isWaving?: boolean;
  size?: number;
  rotation?: number;
  isSitting?: boolean;
  activity?: "sitting" | "yoga" | "gaming" | "reading" | "music" | "indian-dance" | "hiphop-dance" | "zumba-dance" | "gym";
  gender?: "male" | "female";
  isPrivate?: boolean;
}

export function getBuddyGender(userName: string | undefined, setting: "male" | "female" | "auto"): "male" | "female" {
  if (setting === "male") return "male";
  if (setting === "female") return "female";
  if (!userName) return "female";
  const name = userName.toLowerCase();
  if (name.includes("shivam") || name.includes("shivam.sharma")) return "male";
  if (name.includes("bob") || name.includes("john") || name.includes("mike") || name.includes("david") || name.includes("robert") || name.includes("william") || name.includes("tom")) return "male";
  return "female";
}

/**
 * Rigged Wavy-Haired or Spiky-Haired Human Buddy companion character supporting multiple activities
 */
export function GreetingBotSVG({ colors, expression = "normal", isWaving = true, size = 64, rotation = 0, isSitting = false, activity = "sitting", gender = "female", isPrivate = false }: GreetingBotSVGProps) {
  const hairGradId = `hair-gradient-${colors.id}`;
  const hairHighlightId = `hair-highlight-${colors.id}`;
  const skinGradId = `skin-gradient-${colors.id}`;
  const jacketGradId = `jacket-gradient-${colors.id}`;

  // Check state modifiers for CSS classes
  const isYoga = activity === "yoga";
  const isGaming = activity === "gaming";
  const isReading = activity === "reading";
  const isMusic = activity === "music";
  const isIndianDance = activity === "indian-dance";
  const isHiphopDance = activity === "hiphop-dance";
  const isZumbaDance = activity === "zumba-dance";
  const isGym = activity === "gym";
  const isAnyDance = isIndianDance || isHiphopDance || isZumbaDance;
  const isStanding = isAnyDance || isGym;

  // Override expression for specific activities if not explicitly set to something else
  let activeExpression = expression;
  if (expression === "normal") {
    if (isGaming) activeExpression = "wink";
    else if (isYoga) activeExpression = "happy";
    else if (isMusic) activeExpression = "happy";
    else if (isAnyDance) activeExpression = "happy";
    else if (isGym) activeExpression = "happy";
  }
  
  return (
    <motion.svg
      width={size}
      height={size * 1.15}
      viewBox="0 0 80 92"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      animate={{ 
        rotate: rotation
      }}
      transition={{ 
        rotate: { duration: 0.5, ease: "easeOut" }
      }}
      /* Dual drop-shadow creates a high-contrast white border overlay to stand out on dark sidebars */
      style={{ filter: `drop-shadow(0 0 1.2px rgba(255, 255, 255, 0.8)) drop-shadow(0 4px 10px ${colors.shadow})` }}
      className={`select-none pointer-events-none ${
        isYoga
          ? "buddy-anim-yoga"
          : isIndianDance
          ? "buddy-anim-indian"
          : isHiphopDance
          ? "buddy-anim-hiphop"
          : isZumbaDance
          ? "buddy-anim-zumba"
          : isGym
          ? "buddy-anim-gym-body"
          : isSitting
          ? ""
          : "buddy-anim-float"
      }`}
    >
      <style>{`
        @keyframes buddy-sway-left {
          0%, 100% { transform: rotate(-8deg); }
          50% { transform: rotate(8deg); }
        }
        @keyframes buddy-sway-right {
          0%, 100% { transform: rotate(8deg); }
          50% { transform: rotate(-8deg); }
        }
        @keyframes buddy-float {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
        @keyframes buddy-yoga-float {
          0%, 100% { transform: translateY(0px) scaleY(1); }
          50% { transform: translateY(-6px) scaleY(0.98); }
        }
        @keyframes buddy-wave-hand {
          0%, 100% { transform: rotate(10deg); }
          50% { transform: rotate(-50deg); }
        }
        @keyframes buddy-read-tilt {
          0%, 100% { transform: rotate(-3deg); }
          50% { transform: rotate(3deg); }
        }
        @keyframes note-float-1 {
          0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
          15% { opacity: 0.8; }
          100% { transform: translate(-14px, -32px) scale(1.1); opacity: 0; }
        }
        @keyframes note-float-2 {
          0% { transform: translate(0, 0) scale(0.6); opacity: 0; }
          15% { opacity: 0.8; }
          100% { transform: translate(14px, -38px) scale(1.1); opacity: 0; }
        }
        @keyframes buddy-music-bob {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-2px) rotate(2deg); }
        }
        @keyframes buddy-tap {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.15) translate(-0.5px, -0.5px); }
        }
        @keyframes screen-glow {
          0%, 100% { filter: drop-shadow(0 0 1px rgba(34, 211, 238, 0.4)); opacity: 0.9; }
          50% { filter: drop-shadow(0 0 4px rgba(34, 211, 238, 0.8)); opacity: 1; }
        }
        @keyframes buddy-indian-dance {
          0%, 100% { transform: translateY(0px) translateX(-4px) rotate(-8deg); }
          50% { transform: translateY(-8px) translateX(4px) rotate(8deg); }
        }
        @keyframes buddy-hiphop-dance {
          0%, 100% { transform: translateY(0px) translateX(-6px) rotate(-4deg); }
          25% { transform: translateY(-6px) translateX(0px) scaleY(0.95); }
          50% { transform: translateY(0px) translateX(6px) rotate(4deg); }
          75% { transform: translateY(-6px) translateX(0px) scaleY(0.95); }
        }
        @keyframes buddy-zumba-dance {
          0%, 100% { transform: translateY(0px) translateX(-8px) rotate(-6deg); }
          50% { transform: translateY(-10px) translateX(8px) rotate(6deg); }
        }
        @keyframes indian-arm-left {
          0%, 100% { transform: rotate(30deg) translateY(0px); }
          50% { transform: rotate(-25deg) translateY(-2px); }
        }
        @keyframes indian-arm-right {
          0%, 100% { transform: rotate(-25deg) translateY(-2px); }
          50% { transform: rotate(30deg) translateY(0px); }
        }
        @keyframes hiphop-arm-left {
          0%, 100% { transform: rotate(-10deg) translate(0px, 0px); }
          50% { transform: rotate(-45deg) translate(-2px, 2px); }
        }
        @keyframes hiphop-arm-right {
          0%, 100% { transform: rotate(45deg) translate(2px, 2px); }
          50% { transform: rotate(10deg) translate(0px, 0px); }
        }
        @keyframes zumba-arm-left {
          0%, 100% { transform: translateY(0px) rotate(-15deg); }
          50% { transform: translateY(-6px) rotate(25deg); }
        }
        @keyframes zumba-arm-right {
          0%, 100% { transform: translateY(-6px) rotate(25deg); }
          50% { transform: translateY(0px) rotate(-15deg); }
        }
        @keyframes gym-lift-left {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-5px) rotate(-15deg); }
        }
        @keyframes gym-lift-right {
          0%, 100% { transform: translateY(-5px) rotate(15deg); }
          50% { transform: translateY(0px) rotate(0deg); }
        }
        @keyframes buddy-gym-workout {
          0%, 100% { transform: translateY(0px) scaleY(1); }
          50% { transform: translateY(-2.2px) scaleY(0.98); }
        }
        @keyframes left-leg-walk {
          0%, 100% { transform: translateY(0px) rotate(0deg); }
          50% { transform: translateY(-3px) rotate(15deg); }
        }
        @keyframes right-leg-walk {
          0%, 100% { transform: translateY(-3px) rotate(-15deg); }
          50% { transform: translateY(0px) rotate(0deg); }
        }
        @keyframes left-leg-dance {
          0%, 100% { transform: translateY(0px) scaleY(1); }
          50% { transform: translateY(-6px) scaleY(0.85); }
        }
        @keyframes right-leg-dance {
          0%, 100% { transform: translateY(-6px) scaleY(0.85); }
          50% { transform: translateY(0px) scaleY(1); }
        }
        @keyframes leg-gym-squat {
          0%, 100% { transform: scaleY(1); }
          50% { transform: scaleY(0.7) translateY(4px); }
        }
        .buddy-anim-sway-left {
          animation: buddy-sway-left 3s ease-in-out infinite;
        }
        .buddy-anim-sway-right {
          animation: buddy-sway-right 3s ease-in-out infinite;
        }
        .buddy-anim-float {
          animation: buddy-float 2.2s ease-in-out infinite;
        }
        .buddy-anim-yoga {
          animation: buddy-yoga-float 2.6s ease-in-out infinite;
        }
        .buddy-anim-wave {
          animation: buddy-wave-hand 1.8s ease-in-out infinite;
        }
        .buddy-anim-read {
          transform-origin: 40px 52px;
          animation: buddy-read-tilt 3s ease-in-out infinite;
        }
        .buddy-music-note-1 {
          animation: note-float-1 2.5s ease-in-out infinite;
          transform-origin: center;
        }
        .buddy-music-note-2 {
          animation: note-float-2 2.8s ease-in-out infinite;
          transform-origin: center;
        }
        .buddy-anim-music-head {
          transform-origin: 40px 45px;
          animation: buddy-music-bob 1.2s ease-in-out infinite;
        }
        .buddy-anim-tap {
          animation: buddy-tap 0.4s ease-in-out infinite;
        }
        .buddy-anim-screen-glow {
          animation: screen-glow 1.5s ease-in-out infinite;
        }
        .buddy-anim-indian {
          animation: buddy-indian-dance 0.9s ease-in-out infinite;
        }
        .buddy-anim-hiphop {
          animation: buddy-hiphop-dance 0.7s ease-in-out infinite;
        }
        .buddy-anim-zumba {
          animation: buddy-zumba-dance 0.45s ease-in-out infinite;
        }
        .buddy-anim-indian-arm-left {
          transform-origin: 16px 60px;
          animation: indian-arm-left 0.9s ease-in-out infinite;
        }
        .buddy-anim-indian-arm-right {
          transform-origin: 64px 60px;
          animation: indian-arm-right 0.9s ease-in-out infinite;
        }
        .buddy-anim-hiphop-arm-left {
          transform-origin: 16px 60px;
          animation: hiphop-arm-left 0.7s ease-in-out infinite;
        }
        .buddy-anim-hiphop-arm-right {
          transform-origin: 64px 60px;
          animation: hiphop-arm-right 0.7s ease-in-out infinite;
        }
        .buddy-anim-zumba-arm-left {
          transform-origin: 16px 60px;
          animation: zumba-arm-left 0.45s ease-in-out infinite;
        }
        .buddy-anim-zumba-arm-right {
          transform-origin: 64px 60px;
          animation: zumba-arm-right 0.45s ease-in-out infinite;
        }
        .buddy-anim-gym-arm-left {
          transform-origin: 16px 60px;
          animation: gym-lift-left 0.8s ease-in-out infinite;
        }
        .buddy-anim-gym-arm-right {
          transform-origin: 64px 60px;
          animation: gym-lift-right 0.8s ease-in-out infinite;
        }
        .buddy-anim-gym-body {
          animation: buddy-gym-workout 0.8s ease-in-out infinite;
        }
        .buddy-anim-left-leg-walk {
          transform-origin: 31px 76px;
          animation: left-leg-walk 0.6s ease-in-out infinite;
        }
        .buddy-anim-right-leg-walk {
          transform-origin: 47px 76px;
          animation: right-leg-walk 0.6s ease-in-out infinite;
        }
        .buddy-anim-left-leg-dance {
          transform-origin: 31px 76px;
          animation: left-leg-dance 0.45s ease-in-out infinite;
        }
        .buddy-anim-right-leg-dance {
          transform-origin: 47px 76px;
          animation: right-leg-dance 0.45s ease-in-out infinite;
        }
        .buddy-anim-legs-squat {
          transform-origin: 40px 76px;
          animation: leg-gym-squat 0.8s ease-in-out infinite;
        }
      `}</style>

      <defs>
        {/* Hair primary gradient (settings-driven, replaces hardcoded pink) */}
        <linearGradient id={hairGradId} x1="40" y1="0" x2="40" y2="50" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={colors.light} />
          <stop offset="60%" stopColor={colors.primary} />
          <stop offset="100%" stopColor={colors.accent} />
        </linearGradient>
        {/* Hair highlight */}
        <linearGradient id={hairHighlightId} x1="40" y1="0" x2="40" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor={colors.glow} />
          <stop offset="100%" stopColor={colors.primary} />
        </linearGradient>
        {/* Skin gradient */}
        <linearGradient id={skinGradId} x1="40" y1="20" x2="40" y2="55" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#fff1f2" />
          <stop offset="100%" stopColor="#fecdd3" />
        </linearGradient>
        {/* Jacket gradient (lightened slightly to stand out in dark mode sidebars) */}
        <linearGradient id={jacketGradId} x1="40" y1="58" x2="40" y2="82" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#4f5e75" />
          <stop offset="100%" stopColor="#334155" />
        </linearGradient>
      </defs>
  
      {/* Legs (swaying if sitting, crossed if doing yoga, walking/dancing if standing) */}
      {isSitting && !isStanding && !isYoga ? (
        <>
          {/* Left leg sways */}
          <g
            style={{ transformOrigin: "28px 76px" }}
            className="buddy-anim-sway-left"
          >
            {/* Pants leg */}
            <rect x="25" y="74" width="7" height="11" rx="2" fill={colors.primary} stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            {/* Shoe (lightened for dark sidebar) */}
            <ellipse cx="28.5" cy="85" rx="5" ry="3" fill="#334155" stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            <circle cx="28.5" cy="83.5" r="1.5" fill="white" opacity="0.6" />
          </g>

          {/* Right leg sways (offset) */}
          <g
            style={{ transformOrigin: "49px 76px" }}
            className="buddy-anim-sway-right"
          >
            {/* Pants leg */}
            <rect x="46" y="74" width="7" height="11" rx="2" fill={colors.primary} stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            {/* Shoe (lightened for dark sidebar) */}
            <ellipse cx="49.5" cy="85" rx="5" ry="3" fill="#334155" stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            <circle cx="49.5" cy="83.5" r="1.5" fill="white" opacity="0.6" />
          </g>
        </>
      ) : isYoga ? (
        <>
          {/* Crossed Legs (Lotus Pose) */}
          <path d="M 22 75 C 22 75 16 82 24 85 C 32 88 40 82 40 82" stroke={colors.primary} strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <path d="M 58 75 C 58 75 64 82 56 85 C 48 88 40 82 40 82" stroke={colors.primary} strokeWidth="5.5" strokeLinecap="round" fill="none" />
          {/* Little soles of feet showing */}
          <circle cx="22.5" cy="80.5" r="2.8" fill={`url(#${skinGradId})`} />
          <circle cx="57.5" cy="80.5" r="2.8" fill={`url(#${skinGradId})`} />
        </>
      ) : (
        /* Standing/dancing/gym walking legs (lifts, sways, and bends independently) */
        <>
          <g className={activity === "gym" ? "buddy-anim-legs-squat" : isAnyDance ? "buddy-anim-left-leg-dance" : "buddy-anim-left-leg-walk"}>
            <rect x="28" y="76" width="6" height="8" rx="1.5" fill={colors.primary} stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            <ellipse cx="31" cy="84.5" rx="4.5" ry="2.2" fill="#334155" style={{ stroke: "rgba(255,255,255,0.4)", strokeWidth: "0.8" }} />
          </g>
          <g className={activity === "gym" ? "buddy-anim-legs-squat" : isAnyDance ? "buddy-anim-right-leg-dance" : "buddy-anim-right-leg-walk"}>
            <rect x="44" y="76" width="6" height="8" rx="1.5" fill={colors.primary} stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            <ellipse cx="47" cy="84.5" rx="4.5" ry="2.2" fill="#334155" style={{ stroke: "rgba(255,255,255,0.4)", strokeWidth: "0.8" }} />
          </g>
        </>
      )}

      {/* Neck */}
      <rect x="35" y="52" width="10" height="8" rx="2" fill={`url(#${skinGradId})`} />
      
      {/* Dynamic Colored Inner Hoodie Collar */}
      <path d="M 26 56 Q 40 64 54 56 L 52 68 Q 40 76 28 68 Z" fill={colors.primary} />
      {/* Hoodie drawstring ties */}
      <line x1="36" y1="64" x2="36" y2="74" stroke={colors.light} strokeWidth="2" strokeLinecap="round" />
      <line x1="42" y1="64" x2="42" y2="74" stroke={colors.light} strokeWidth="2" strokeLinecap="round" />

      {/* Black Outer Jacket Shoulders (with white outline contour) */}
      <path d="M 16 68 C 16 68 20 62 28 64 L 28 78 L 14 78 Z" fill={`url(#${jacketGradId})`} stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.3" />
      <path d="M 64 68 C 64 68 60 62 52 64 L 52 78 L 66 78 Z" fill={`url(#${jacketGradId})`} stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.3" />

      {/* Left Arm (viewer's left) */}
      {isPrivate ? null : isYoga ? (
        /* Arm folded resting on left knee */
        <>
          <path d="M 16 60 Q 14 74 24 78" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 14 74 24 78" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="24" cy="78" r="3.2" fill={`url(#${skinGradId})`} />
        </>
      ) : isGaming ? (
        /* Arm holding smartphone in front */
        <>
          <path d="M 16 60 Q 24 72 34 64" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 24 72 34 64" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="34" cy="64" r="3.2" fill={`url(#${skinGradId})`} />
        </>
      ) : isReading ? (
        /* Arm holding book in front */
        <>
          <path d="M 16 60 Q 24 72 32 68" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 24 72 32 68" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="32" cy="68" r="3.2" fill={`url(#${skinGradId})`} />
        </>
      ) : isIndianDance ? (
        /* Indian dance left arm raised high */
        <g className="buddy-anim-indian-arm-left">
          <path d="M 16 60 Q 10 44 14 36" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 10 44 14 36" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="14" cy="36" r="3.2" fill={`url(#${skinGradId})`} />
        </g>
      ) : isHiphopDance ? (
        /* Hip hop cool hand style */
        <g className="buddy-anim-hiphop-arm-left">
          <path d="M 16 60 Q 8 66 10 74" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 8 66 10 74" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="10" cy="74" r="3.2" fill={`url(#${skinGradId})`} />
        </g>
      ) : isZumbaDance ? (
        /* Zumba pumping arm */
        <g className="buddy-anim-zumba-arm-left">
          <path d="M 16 60 Q 24 48 18 38" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 24 48 18 38" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="18" cy="38" r="3.2" fill={`url(#${skinGradId})`} />
        </g>
      ) : isGym ? (
        /* Gym lifting dumbbells left */
        <g className="buddy-anim-gym-arm-left">
          <path d="M 16 60 Q 12 50 16 42" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 16 60 Q 12 50 16 42" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="16" cy="42" r="3.2" fill={`url(#${skinGradId})`} />
          <g style={{ transformOrigin: "16px 42px" }}>
            <rect x="9" y="40" width="14" height="4" rx="1" fill="#64748b" />
            <rect x="7" y="36" width="4" height="12" rx="1.2" fill="#334155" stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            <rect x="21" y="36" width="4" height="12" rx="1.2" fill="#334155" stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
          </g>
        </g>
      ) : (
        /* Default hanging arm */
        <>
          <rect x="12" y="58" width="7" height="15" rx="3.2" fill="#334155" stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.35" />
          <circle cx="15.5" cy="73" r="3.5" fill={`url(#${skinGradId})`} />
        </>
      )}

      {/* Right Arm (viewer's right) */}
      {isPrivate ? null : isYoga ? (
        /* Arm folded resting on right knee */
        <>
          <path d="M 64 60 Q 66 74 56 78" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 66 74 56 78" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="56" cy="78" r="3.2" fill={`url(#${skinGradId})`} />
        </>
      ) : isGaming ? (
        /* Arm holding phone / tapping screen */
        <>
          <path d="M 64 60 Q 56 72 44 64" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 56 72 44 64" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <g className="buddy-anim-tap" style={{ transformOrigin: "44px 64px" }}>
            <circle cx="44" cy="64" r="3.2" fill={`url(#${skinGradId})`} />
          </g>
        </>
      ) : isReading ? (
        /* Arm holding book */
        <>
          <path d="M 64 60 Q 56 72 48 68" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 56 72 48 68" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="48" cy="68" r="3.2" fill={`url(#${skinGradId})`} />
        </>
      ) : isIndianDance ? (
        /* Indian dance right arm raised high */
        <g className="buddy-anim-indian-arm-right">
          <path d="M 64 60 Q 70 44 66 36" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 70 44 66 36" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="66" cy="36" r="3.2" fill={`url(#${skinGradId})`} />
        </g>
      ) : isHiphopDance ? (
        /* Hip hop cool hand style */
        <g className="buddy-anim-hiphop-arm-right">
          <path d="M 64 60 Q 72 66 70 74" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 72 66 70 74" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="70" cy="74" r="3.2" fill={`url(#${skinGradId})`} />
        </g>
      ) : isZumbaDance ? (
        /* Zumba pumping arm */
        <g className="buddy-anim-zumba-arm-right">
          <path d="M 64 60 Q 56 48 62 38" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 56 48 62 38" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="62" cy="38" r="3.2" fill={`url(#${skinGradId})`} />
        </g>
      ) : isGym ? (
        /* Gym lifting dumbbells right */
        <g className="buddy-anim-gym-arm-right">
          <path d="M 64 60 Q 68 50 64 42" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
          <path d="M 64 60 Q 68 50 64 42" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
          <circle cx="64" cy="42" r="3.2" fill={`url(#${skinGradId})`} />
          <g style={{ transformOrigin: "64px 42px" }}>
            <rect x="57" y="40" width="14" height="4" rx="1" fill="#64748b" />
            <rect x="55" y="36" width="4" height="12" rx="1.2" fill="#334155" stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
            <rect x="69" y="36" width="4" height="12" rx="1.2" fill="#334155" stroke="#fff" strokeWidth="0.5" strokeOpacity="0.2" />
          </g>
        </g>
      ) : (
        /* Default Arm / Waving arm */
        <g
          style={{ transformOrigin: "58px 62px", transform: isWaving ? undefined : "rotate(10deg)" }}
          className={isWaving ? "buddy-anim-wave" : ""}
        >
          <rect x="58" y="44" width="7" height="18" rx="3.2" fill="#334155" stroke="#ffffff" strokeWidth="0.8" strokeOpacity="0.35" />
          <circle cx="61.5" cy="42" r="3.5" fill={`url(#${skinGradId})`} />
          {isWaving && (
            <>
              <line x1="59.5" y1="39.5" x2="57.5" y2="35.5" stroke={`url(#${skinGradId})`} strokeWidth="1.2" strokeLinecap="round" />
              <line x1="61.5" y1="38.5" x2="61.5" y2="34.5" stroke={`url(#${skinGradId})`} strokeWidth="1.2" strokeLinecap="round" />
              <line x1="63.5" y1="39.5" x2="65.5" y2="35.5" stroke={`url(#${skinGradId})`} strokeWidth="1.2" strokeLinecap="round" />
            </>
          )}
        </g>
      )}
  
      {/* Held Accessories (Phone / Book / Gold Chain) */}
      {isGaming && (
        /* Glowing Smartphone */
        <g className="buddy-anim-screen-glow">
          <rect x="35" y="57" width="10" height="15" rx="2" fill="#334155" stroke="#475569" strokeWidth="0.8" />
          <rect x="36.5" y="58.5" width="7" height="12" rx="1.2" fill="#22d3ee" />
          <circle cx="40" cy="70.5" r="0.5" fill="#e2e8f0" />
        </g>
      )}
      
      {isReading && (
        /* Opened Book */
        <>
          <path d="M 28 62 Q 40 65 40 68 Q 40 65 52 62 L 50 72 Q 40 75 40 78 Q 40 75 30 72 Z" fill="#ffffff" stroke={colors.primary} strokeWidth="0.8" />
          <path d="M 30 72 L 28 62 M 50 72 L 52 62 M 40 78 L 40 68" stroke={colors.accent} strokeWidth="1" />
        </>
      )}

      {isHiphopDance && (
        /* Gold Chain necklace around collar */
        <path d="M 32 58 Q 40 68 48 58" stroke="#fbbf24" strokeWidth="2.5" fill="none" strokeDasharray="3, 1.5" style={{ filter: "drop-shadow(0 1px 2px rgba(251,191,36,0.5))" }} />
      )}

      {/* HEAD GROUP (Tilts automatically when reading, holds headphones so they tilt together) */}
      <g className={isReading ? "buddy-anim-read" : isMusic ? "buddy-anim-music-head" : ""}>
        {/* Ears */}
        <rect x="17" y="32" width="5" height="10" rx="2.5" fill={`url(#${skinGradId})`} />
        <rect x="58" y="32" width="5" height="10" rx="2.5" fill={`url(#${skinGradId})`} />

        {/* Head / Face base */}
        <rect x="20" y="18" width="40" height="38" rx="12" fill={`url(#${skinGradId})`} />
        
        {/* Blushing cheeks */}
        <ellipse cx="26" cy="44" rx="3.5" ry="1.8" fill="#f43f5e" opacity="0.45" />
        <ellipse cx="54" cy="44" rx="3.5" ry="1.8" fill="#f43f5e" opacity="0.45" />

        {/* Eyes and blinking eyelids */}
        <g>
          {!isPrivate && activeExpression === "normal" && (
            <>
              {/* Left Eye */}
              <ellipse cx="30" cy="37" rx="5" ry="6" fill="white" />
              <circle cx="30" cy="37" r="3.5" fill="#78350f" />
              <circle cx="30" cy="37" r="1.8" fill="#1e1b4b" />
              <circle cx="31.5" cy="35.5" r="0.8" fill="white" />

              {/* Right Eye */}
              <ellipse cx="50" cy="37" rx="5" ry="6" fill="white" />
              <circle cx="50" cy="37" r="3.5" fill="#78350f" />
              <circle cx="50" cy="37" r="1.8" fill="#1e1b4b" />
              <circle cx="51.5" cy="35.5" r="0.8" fill="white" />
            </>
          )}

          {!isPrivate && activeExpression === "wink" && (
            <>
              {/* Winking Left Eye */}
              <path d="M 25 38 Q 30 32 35 38" stroke="#334155" strokeWidth="2.8" fill="none" strokeLinecap="round" />
              
              {/* Normal Right Eye */}
              <ellipse cx="50" cy="37" rx="5" ry="6" fill="white" />
              <circle cx="50" cy="37" r="3.5" fill="#78350f" />
              <circle cx="50" cy="37" r="1.8" fill="#1e1b4b" />
              <circle cx="51.5" cy="35.5" r="0.8" fill="white" />
            </>
          )}

          {!isPrivate && activeExpression === "happy" && (
            <>
              <path d="M 25 38 Q 30 31 35 38" stroke="#334155" strokeWidth="3" fill="none" strokeLinecap="round" />
              <path d="M 45 38 Q 50 31 55 38" stroke="#334155" strokeWidth="3" fill="none" strokeLinecap="round" />
            </>
          )}

          {!isPrivate && activeExpression === "heart" && (
            <>
              <path
                d="M 30 32 C 28.5 30 26 30 25 32 C 24 34 25 36.5 30 40 C 35 36.5 36 34 35 32 C 34 30 31.5 30 30 32 Z"
                fill="#ef4444"
              />
              <path
                d="M 50 32 C 48.5 30 46 30 45 32 C 44 34 45 36.5 50 40 C 55 36.5 56 34 55 32 C 54 30 51.5 30 50 32 Z"
                fill="#ef4444"
              />
            </>
          )}

          {isPrivate && (
            <>
              {/* Closed eyes lines */}
              <path d="M 27 37 L 33 37" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
              <path d="M 47 37 L 53 37" stroke="#475569" strokeWidth="2.5" strokeLinecap="round" />
            </>
          )}
        </g>

        {/* Glasses (sits exactly on top of eyes) */}
        <circle cx="30" cy="37" r="8" stroke="#334155" strokeWidth="2.5" fill="none" />
        <circle cx="50" cy="37" r="8" stroke="#334155" strokeWidth="2.5" fill="none" />
        <path d="M 38 37 Q 40 35 42 37" stroke="#334155" strokeWidth="2.5" fill="none" />
        <path d="M 18 36 L 22 37" stroke="#334155" strokeWidth="2" />
        <path d="M 58 37 L 62 36" stroke="#334155" strokeWidth="2" />

        {/* Nose */}
        <path d="M 39 42 Q 40 44 41 42" stroke="#e11d48" strokeWidth="1.5" fill="none" opacity="0.6" />

        {/* Mouth */}
        {activeExpression === "happy" || activeExpression === "heart" ? (
          <path d="M 34 46 Q 40 52 46 46 Z" fill="white" />
        ) : (
          <path d="M 35 47 Q 40 50 45 47" stroke="#475569" strokeWidth="2.2" fill="none" strokeLinecap="round" />
        )}

        {/* Gender Hair Variation - Male: Spiky short hair, Female: Wavy pink hair */}
        {gender === "male" ? (
          <>
            {/* Back hair for male (short crop) */}
            <path d="M 22 24 C 18 16 30 10 40 10 C 50 10 62 16 58 24 Z" fill={`url(#${hairGradId})`} />
            {/* Front spikes / side sweep */}
            <path d="M 20 22 Q 26 14 36 14 Q 30 18 28 22 Z" fill={`url(#${hairHighlightId})`} />
            <path d="M 32 14 Q 40 10 48 14 Q 44 18 40 18 Z" fill={`url(#${hairGradId})`} />
            <path d="M 44 14 Q 54 14 60 22 Q 54 18 52 22 Z" fill={`url(#${hairHighlightId})`} />
            <path d="M 26 24 C 24 24 22 28 22 30 C 24 30 26 28 26 26 Z" fill={`url(#${hairGradId})`} />
            <path d="M 54 24 C 56 24 58 28 58 30 C 56 30 54 28 54 26 Z" fill={`url(#${hairGradId})`} />
          </>
        ) : (
          <>
            {/* Wavy Hair (front layers over face) */}
            {/* Back Hair layer (behind neck/shoulders) */}
            <path d="M 17 28 C 12 18 25 8 40 8 C 55 8 68 18 63 28 Z" fill={`url(#${hairGradId})`} opacity="0.85" />
            
            {/* Front Hair Locks (wavy chunks, layered gradient) */}
            <path d="M 20 24 C 18 16 32 10 38 16 C 36 20 30 26 26 28 Z" fill={`url(#${hairHighlightId})`} />
            <path d="M 28 16 C 32 6 48 4 52 14 C 48 18 38 22 32 18 Z" fill={`url(#${hairGradId})`} />
            <path d="M 44 14 C 50 8 62 14 60 24 C 56 24 48 22 46 18 Z" fill={`url(#${hairHighlightId})`} />
            <path d="M 24 20 Q 32 24 34 28 Q 28 26 26 24 Z" fill={`url(#${hairGradId})`} />
            <path d="M 44 18 Q 48 24 52 22 Q 48 20 46 18 Z" fill={`url(#${hairGradId})`} />
            <path d="M 32 10 C 36 2 46 2 50 8 C 44 10 38 12 34 10 Z" fill={`url(#${hairHighlightId})`} />
          </>
        )}

        {/* Music Headphones (only when listening to music) */}
        {isMusic && (
          <>
            {/* Headphone band */}
            <path d="M 21 25 C 21 8 59 8 59 25" stroke="#334155" strokeWidth="3" fill="none" />
            {/* Left earmuff */}
            <rect x="15" y="22" width="6" height="14" rx="3" fill={colors.primary} stroke="#334155" strokeWidth="1" />
            <rect x="18" y="25" width="2" height="8" rx="1" fill={colors.accent} />
            {/* Right earmuff */}
            <rect x="59" y="22" width="6" height="14" rx="3" fill={colors.primary} stroke="#334155" strokeWidth="1" />
            <rect x="60" y="25" width="2" height="8" rx="1" fill={colors.accent} />
          </>
        )}

        {/* Indian Dance: forehead red tikka/bindi */}
        {isIndianDance && (
          <circle cx="40" cy="30" r="1.5" fill="#f43f5e" />
        )}

        {/* Zumba: Forehead fitness neon sweatband */}
        {isZumbaDance && (
          <path d="M 22 28 Q 40 26 58 28" stroke={colors.light} strokeWidth="3.2" strokeLinecap="round" fill="none" />
        )}

        {/* Hip Hop Snapback Cap (tilted) */}
        {isHiphopDance && (
          <g style={{ transform: "rotate(-12deg) translate(-2px, -4px)", transformOrigin: "40px 18px" }}>
            {/* Cap dome */}
            <path d="M 26 20 C 26 10 54 10 54 20 Z" fill={colors.accent} stroke={colors.light} strokeWidth="0.8" />
            {/* Cap Brim */}
            <path d="M 22 20 L 58 17" stroke={colors.light} strokeWidth="3.2" strokeLinecap="round" />
          </g>
        )}

        {isPrivate && (
          <g>
            {/* Left Arm covering Left Eye */}
            <path d="M 16 60 Q 22 45 29 38" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
            <path d="M 16 60 Q 22 45 29 38" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
            <circle cx="30" cy="37" r="7" fill={`url(#${skinGradId})`} stroke="#ffffff" strokeWidth="0.8" />
            <line x1="28" y1="34" x2="28" y2="40" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="30" y1="33" x2="30" y2="41" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="32" y1="34" x2="32" y2="40" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />

            {/* Right Arm covering Right Eye */}
            <path d="M 64 60 Q 58 45 51 38" stroke="#ffffff" strokeWidth="7.5" strokeLinecap="round" fill="none" opacity="0.35" />
            <path d="M 64 60 Q 58 45 51 38" stroke="#334155" strokeWidth="5.5" strokeLinecap="round" fill="none" />
            <circle cx="50" cy="37" r="7" fill={`url(#${skinGradId})`} stroke="#ffffff" strokeWidth="0.8" />
            <line x1="48" y1="34" x2="48" y2="40" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="50" y1="33" x2="50" y2="41" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="52" y1="34" x2="52" y2="40" stroke="#475569" strokeWidth="1.2" strokeLinecap="round" />
          </g>
        )}
      </g>

      {/* Floating Music Notes */}
      {isMusic && (
        <>
          <text x="12" y="18" fill={colors.light} fontSize="13" className="buddy-music-note-1">♪</text>
          <text x="62" y="14" fill={colors.primary} fontSize="15" className="buddy-music-note-2">♫</text>
          <text x="26" y="10" fill={colors.accent} fontSize="11" className="buddy-music-note-1">♬</text>
        </>
      )}

      {/* Indian Dance sparkles */}
      {isIndianDance && (
        <>
          <text x="12" y="24" fill="#fbbf24" fontSize="11" className="buddy-music-note-1">✦</text>
          <text x="65" y="20" fill="#f59e0b" fontSize="13" className="buddy-music-note-2">✦</text>
          <text x="24" y="12" fill={colors.light} fontSize="10" className="buddy-music-note-1">✨</text>
        </>
      )}

      {/* Hip Hop cool floats */}
      {isHiphopDance && (
        <>
          <text x="10" y="20" fill={colors.light} fontSize="11" className="buddy-music-note-1">🎧</text>
          <text x="64" y="22" fill={colors.primary} fontSize="12" className="buddy-music-note-2">🎵</text>
        </>
      )}

      {/* Zumba starbursts / energy flashes */}
      {isZumbaDance && (
        <>
          <text x="11" y="22" fill="#eab308" fontSize="12" className="buddy-music-note-1">⚡</text>
          <text x="66" y="18" fill="#eab308" fontSize="15" className="buddy-music-note-2">⚡</text>
        </>
      )}
    </motion.svg>
  );
}

// ── Particle Emitter for Heart Bursts ───────────────────
interface HeartParticle {
  id: number;
  x: number;
  y: number;
  scale: number;
  rotate: number;
}

function HeartBurst() {
  const [particles, setParticles] = useState<HeartParticle[]>([]);

  useEffect(() => {
    const arr: HeartParticle[] = Array.from({ length: 8 }).map((_, i) => ({
      id: i,
      x: (Math.random() - 0.5) * 120,
      y: -50 - Math.random() * 80,
      scale: 0.6 + Math.random() * 0.7,
      rotate: (Math.random() - 0.5) * 60,
    }));
    setParticles(arr);
  }, []);

  return (
    <div className="absolute inset-0 pointer-events-none z-50">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute left-1/2 top-1/2"
          initial={{ x: 0, y: 0, opacity: 1, scale: 0 }}
          animate={{ x: p.x, y: p.y, opacity: 0, scale: p.scale, rotate: p.rotate }}
          transition={{ duration: 1.4, ease: "easeOut" }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="#ef4444" className="drop-shadow-sm">
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
        </motion.div>
      ))}
    </div>
  );
}

// ── Floating Tooltip Messages for the Sitting Buddy ───
const MOTIVATIONAL_PHRASES = [
  "Let's build something awesome today! 💻",
  "Remember to hydrate! 💧 Take a quick sip.",
  "I'm keeping watch over your workspace! 🛡️",
  "Shhh, I'm analyzing background logs... 🤖",
  "Your AI sidekick is active and online! 🚀",
  "You're doing great! Keep it up. 🌟",
  "Need help? Just type in the chat box! 💬",
  "Searching for clarity, connectivity, collaboration... 🌐",
  "Stand up and stretch! Good for your health. 🧘‍♂️",
];

// ── GREETING OVERLAY (Mounts Globally on Greeting) ───────
export function GreetingOverlay() {
  const colors = useBuddyColors();
  const { botState, setBotState } = useBuddyStore();
  const { user } = useAuth();
  const { buddyEnabled } = useSettings();
  
  const [expression, setExpression] = useState<"normal" | "wink" | "happy" | "heart">("wink");
  const [showHearts, setShowHearts] = useState(false);
  const [textStage, setTextStage] = useState(0);

  // Expression cycling during greeting
  useEffect(() => {
    if (showHearts) return;
    const interval = setInterval(() => {
      setExpression((e) => {
        if (e === "normal") return "wink";
        if (e === "wink") return "happy";
        return "normal";
      });
    }, 3000);
    return () => clearInterval(interval);
  }, [showHearts]);

  // Auto-dismiss safety timer (15 seconds)
  useEffect(() => {
    const timer = setTimeout(() => {
      setBotState("sitting");
    }, 15000);
    return () => clearTimeout(timer);
  }, [setBotState]);

  if (!buddyEnabled || botState !== "greeting") return null;

  const handleHiBack = () => {
    setExpression("heart");
    setShowHearts(true);
    setTextStage(1);
    
    // Wave, wink, and fly away after a moment
    setTimeout(() => {
      setBotState("sitting");
    }, 1800);
  };

  const firstName = user?.name ? user.name.split(" ")[0] : "there";

  return (
    <div className="fixed inset-0 z-50 pointer-events-none flex items-end justify-end p-6 md:p-12">
      <div className="relative pointer-events-auto flex flex-col items-end gap-4">
        {/* Thought / Greeting Bubble */}
        <motion.div
          initial={{ opacity: 0, scale: 0.85, y: 15 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 260, damping: 20 }}
          className="relative max-w-[280px] md:max-w-[320px] rounded-2xl border p-4 shadow-xl select-none"
          style={{
            background: "rgba(255, 255, 255, 0.85)",
            borderColor: "rgba(27, 111, 200, 0.15)",
            backdropFilter: "blur(16px)",
            color: "#1e293b",
          }}
        >
          {/* Arrow pointing down to robot */}
          <div className="absolute -bottom-2 right-12 w-4 h-4 rotate-45 border-r border-b"
            style={{
              background: "rgba(255, 255, 255, 0.85)",
              borderColor: "rgba(27, 111, 200, 0.15)",
            }}
          />

          {/* Close button */}
          <button
            onClick={() => setBotState("sitting")}
            className="absolute top-2 right-2 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="h-4 w-4" />
          </button>

          <div className="space-y-3">
            <div className="flex items-center gap-1.5 text-blue-600 font-bold text-[11px] uppercase tracking-wider">
              <Sparkles className="h-3 w-3" />
              <span>Workspace Greeting</span>
            </div>
            
            <p className="text-[13px] leading-relaxed font-semibold">
              {textStage === 0 ? (
                <>Hi, {firstName}! 👋 Welcome to <span className="text-blue-600 font-bold">Centriq</span>. Ready to make today highly productive?</>
              ) : (
                <>Aww, thanks! ❤️ Let's rock! Landing on your profile card...</>
              )}
            </p>

            {textStage === 0 && (
              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                onClick={handleHiBack}
                className="w-full text-center py-2 px-3 rounded-xl text-white text-[12px] font-bold shadow-md hover:shadow-lg transition-all"
                style={{ background: "var(--gradient-primary)" }}
              >
                Hi back! 👋
              </motion.button>
            )}
          </div>
        </motion.div>

        {/* The Animated SVG Character Wrapper */}
        <motion.div
          layoutId="sidebar-buddy-character"
          transition={{ type: "spring", stiffness: 180, damping: 22 }}
          className="relative mr-8"
        >
          {showHearts && <HeartBurst />}
          <GreetingBotSVG
            colors={colors}
            expression={expression}
            isWaving={textStage === 0}
            size={88}
          />
        </motion.div>
      </div>
    </div>
  );
}

const ACTIVITY_PHRASES = {
  sitting: [
    "Always monitoring your workspace! 🛡️",
    "I'm here if you need help! 🤖",
    "Let's build something awesome today! 💻",
    "Need help? Just type in the chat box! 💬",
  ],
  yoga: [
    "Inhale clarity, exhale distraction... 🧘‍♂️",
    "Finding my zen... 🧘",
    "Stand up and stretch! Good for your health. 🧘‍♂️",
  ],
  gaming: [
    "Just one more level... 🎮",
    "High score achieved! 👾",
    "Can't talk, final boss fight! ⚔️",
  ],
  reading: [
    "Reading through the Centriq handbooks... 📖",
    "This chapter is getting interesting! 📚",
    "Gaining knowledge is a superpower! ⚡",
  ],
  music: [
    "Lo-fi coding beats to work to... 🎧",
    "This rhythm is fire! 🎵",
    "Dancing in my mind... 🕺✨",
  ],
  "indian-dance": [
    "Taka-dhimi-ta! Dancing to the beat! 💃",
    "Bhangra style! Let's bring the energy! 🕺💥",
    "Indian classical rhythms keep me grooving! 🪕✨",
  ],
  "hiphop-dance": [
    "Yo, check the flow! 🎤🕶️",
    "Dropping beats in the workspace! 🎧🔥",
    "Double-bouncing to the hip hop rhythm! 👟⚡",
  ],
  "zumba-dance": [
    "Keep moving! Zumba energy! ⚡🏃‍♂️",
    "1, 2, slide, and clap! 🤸‍♀️✨",
    "Burn those calories! Fitness fun! 🏋️‍♂️💦",
  ],
  gym: [
    "Feeling the burn! Gym time! 🏋️‍♂️💪",
    "No pain, no gain! Pumping iron! 🏋️‍♀️",
    "Just a quick dumbbell set! 🏋️",
    "Building strength, one rep at a time! 📈💪",
  ],
};

// ── SITTING BUDDY (Mounts in Sidebar above User Profile) ──
// ── SITTING BUDDY (Mounts in Sidebar above User Profile) ──
export function SittingBuddy() {
  const colors = useBuddyColors();
  const { buddyEnabled, buddyGender } = useSettings();
  const { botState } = useBuddyStore();
  const { user } = useAuth();
  
  const activeId = useChatStore((s) => s.activeId);
  const threads = useChatStore((s) => s.threads);
  const activeThread = activeId ? threads[activeId] : null;
  const isPrivate = activeThread?.isPrivate || false;

  const [activity, setActivity] = useState<"sitting" | "yoga" | "gaming" | "reading" | "music" | "indian-dance" | "hiphop-dance" | "zumba-dance" | "gym">("sitting");
  const [expression, setExpression] = useState<"normal" | "wink" | "happy">("normal");
  const [isWaving, setIsWaving] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [tooltip, setTooltip] = useState<string | null>(null);

  // Track previous activity to detect standing/sitting transitions
  const [prevActivity, setPrevActivity] = useState<typeof activity>("sitting");
  const [isPullingChair, setIsPullingChair] = useState(false);

  // Helper to trigger tooltip message and clear after 4s
  const showSpeechBubble = useCallback((text: string) => {
    setTooltip(text);
    const timer = setTimeout(() => {
      setTooltip(null);
    }, 4000);
    return timer;
  }, []);

  // Handle standing-to-sitting transition ("pulling chair emote")
  useEffect(() => {
    const isPrevStanding = ["gym", "indian-dance", "hiphop-dance", "zumba-dance", "yoga"].includes(prevActivity);
    const isNewSitting = ["sitting", "reading", "gaming", "music"].includes(activity);

    if (isPrevStanding && isNewSitting) {
      setIsPullingChair(true);
      setTooltip("Let me pull up my chair... 🪑");
      
      const timer = setTimeout(() => {
        setIsPullingChair(false);
        setTooltip(null);
      }, 1500);
      
      return () => clearTimeout(timer);
    }
  }, [activity, prevActivity]);

  // Trigger speech bubble automatically when activity changes
  useEffect(() => {
    if (botState !== "sitting" || !buddyEnabled || isPullingChair || isPrivate) return;
    
    // Tiny delay so the transition animation can trigger
    const timer = setTimeout(() => {
      const phrases = ACTIVITY_PHRASES[activity] || ACTIVITY_PHRASES.sitting;
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      showSpeechBubble(randomPhrase);
    }, 500);

    return () => clearTimeout(timer);
  }, [activity, botState, buddyEnabled, showSpeechBubble, isPullingChair, isPrivate]);

  // Random activity cycling (every 15 to 20 seconds)
  useEffect(() => {
    if (botState !== "sitting" || !buddyEnabled || isPrivate) return;

    const cycle = () => {
      setActivity((curr) => {
        setPrevActivity(curr);
        const list: ("sitting" | "yoga" | "gaming" | "reading" | "music" | "indian-dance" | "hiphop-dance" | "zumba-dance" | "gym")[] = [
          "sitting", "yoga", "gaming", "reading", "music", "indian-dance", "hiphop-dance", "zumba-dance", "gym"
        ];
        const available = list.filter(item => item !== curr);
        return available[Math.floor(Math.random() * available.length)];
      });
    };

    const interval = setInterval(cycle, 15000 + Math.random() * 5000);
    return () => clearInterval(interval);
  }, [botState, buddyEnabled, isPrivate]);

  // Random idle fidgets based on active state
  useEffect(() => {
    if (botState !== "sitting" || !buddyEnabled || isPrivate) return;

    const interval = setInterval(() => {
      const rand = Math.random();
      if (activity === "gaming") {
        setExpression("wink");
        setTimeout(() => setExpression("normal"), 800);
      } else if (activity === "sitting") {
        if (rand < 0.2) {
          setExpression("wink");
          setTimeout(() => setExpression("normal"), 400);
        } else if (rand < 0.4) {
          setIsWaving(true);
          setExpression("happy");
          setTimeout(() => {
            setIsWaving(false);
            setExpression("normal");
          }, 2000);
        }
      } else if (
        activity === "music" || 
        activity === "yoga" || 
        activity === "indian-dance" || 
        activity === "hiphop-dance" || 
        activity === "zumba-dance" ||
        activity === "gym"
      ) {
        if (rand < 0.3) {
          setExpression("happy");
          setTimeout(() => setExpression("normal"), 1500);
        }
      }
    }, 4500);

    return () => clearInterval(interval);
  }, [botState, activity, buddyEnabled, isPrivate]);

  // Spontaneous speech bubble timer (every 22 to 32 seconds)
  useEffect(() => {
    if (botState !== "sitting" || !buddyEnabled || isPrivate) return;

    let bubbleTimer: any;
    let scheduleTimer: any;

    const triggerSpontaneousSpeech = () => {
      const phrases = ACTIVITY_PHRASES[activity] || ACTIVITY_PHRASES.sitting;
      const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
      bubbleTimer = showSpeechBubble(randomPhrase);
      
      const nextDelay = 22000 + Math.random() * 10000;
      scheduleTimer = setTimeout(triggerSpontaneousSpeech, nextDelay);
    };

    const initialDelay = 22000 + Math.random() * 10000;
    scheduleTimer = setTimeout(triggerSpontaneousSpeech, initialDelay);

    return () => {
      clearTimeout(bubbleTimer);
      clearTimeout(scheduleTimer);
    };
  }, [botState, activity, buddyEnabled, showSpeechBubble, isPrivate]);

  if (botState !== "sitting" || !buddyEnabled) return null;

  const handleClick = () => {
    if (isPrivate) {
      setExpression("happy");
      showSpeechBubble("Strictly confidential! 🔒🤫");
      setTimeout(() => setExpression("normal"), 2000);
      return;
    }
    // 360 backflip spin
    setRotation(360);
    setExpression("happy");
    
    // Choose random phrase matching current activity
    const phrases = ACTIVITY_PHRASES[activity] || ACTIVITY_PHRASES.sitting;
    const randomPhrase = phrases[Math.floor(Math.random() * phrases.length)];
    setTooltip(randomPhrase);

    // Reset rotation and tooltip
    setTimeout(() => {
      setRotation(0);
    }, 600);

    setTimeout(() => {
      setTooltip(null);
      setExpression("normal");
    }, 4000);
  };

  const handleMouseEnter = () => {
    if (isPrivate) {
      showSpeechBubble("Shhh... your chat is private! 🤫");
      return;
    }
    const hoverPhrases = [
      "Hey! Let's get to work! 🚀",
      "Need a hand? Ask me anything! 🤝",
      "Checking in! How's your day going? 😊",
      "Let's make today productive! ✨",
      ...(ACTIVITY_PHRASES[activity] || [])
    ];
    const randomPhrase = hoverPhrases[Math.floor(Math.random() * hoverPhrases.length)];
    showSpeechBubble(randomPhrase);
  };

  const isStanding = activity === "gym" || activity === "indian-dance" || activity === "hiphop-dance" || activity === "zumba-dance";
  const isYogaState = activity === "yoga";
  const isSittingState = !isStanding && !isYogaState;
  const resolvedGender = getBuddyGender(user?.name, buddyGender);

  return (
    <div className="relative cursor-pointer flex flex-col items-center justify-end h-[90px] w-full select-none">
      {/* Motivational Tooltip on the Right */}
      <AnimatePresence>
        {tooltip && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8, x: -10 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            exit={{ opacity: 0, scale: 0.8 }}
            className="absolute left-[85%] bottom-1/2 ml-3 text-[12px] leading-snug font-semibold w-52 p-2.5 rounded-2xl shadow-xl border pointer-events-none z-[100]"
            style={{
              background: "rgba(15, 23, 42, 0.95)",
              color: "#fff",
              borderColor: "rgba(255, 255, 255, 0.15)",
              backdropFilter: "blur(8px)",
            }}
          >
            {tooltip}
            {/* Arrow pointing left to mini bot */}
            <div className="absolute right-full top-1/2 -translate-y-1/2 mr-[-4px] w-2.5 h-2.5 rotate-45 bg-[#0f172a] border-l border-b border-white/10" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Swivel Chair behind character */}
      <AnimatePresence>
        {isSittingState && (
          <motion.svg
            width="32"
            height="32"
            viewBox="0 0 36 36"
            fill="none"
            initial={isPullingChair ? { x: -35, opacity: 0, scale: 0.8 } : { x: 0, opacity: 0.8, scale: 1 }}
            animate={{ x: 0, opacity: 0.85, scale: 1 }}
            exit={{ x: -35, opacity: 0, scale: 0.8 }}
            transition={{ type: "spring", stiffness: 120, damping: 14 }}
            className="absolute bottom-0.5 z-10 pointer-events-none"
          >
            {/* Chair Backrest */}
            <rect x="10" y="4" width="16" height="14" rx="3.5" fill={colors.primary} opacity="0.85" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
            {/* Support brackets */}
            <path d="M 12 18 L 18 22 L 24 18" stroke="#1e293b" strokeWidth="2.5" />
            {/* Seat cushion */}
            <rect x="7" y="21" width="22" height="3.5" rx="1.5" fill="#334155" stroke="rgba(255,255,255,0.2)" strokeWidth="0.8" />
            {/* Swivel cylinder */}
            <rect x="16.5" y="24" width="3" height="6" fill="#1e293b" />
            {/* Swivel Base */}
            <path d="M 10 30 L 26 30" stroke="#1e293b" strokeWidth="2" strokeLinecap="round" />
            <path d="M 14 30 L 18 32 M 22 30 L 18 32" stroke="#1e293b" strokeWidth="1.5" />
          </motion.svg>
        )}
      </AnimatePresence>

      {/* Yoga Mat under character */}
      <AnimatePresence>
        {isYogaState && (
          <motion.svg
            width="44"
            height="8"
            viewBox="0 0 44 8"
            fill="none"
            initial={{ scaleX: 0, opacity: 0 }}
            animate={{ scaleX: 1, opacity: 0.95 }}
            exit={{ scaleX: 0, opacity: 0 }}
            transition={{ duration: 0.4 }}
            className="absolute bottom-0.5 z-10 pointer-events-none origin-center"
          >
            <ellipse cx="22" cy="4" rx="20" ry="2" fill="#10b981" />
            <path d="M 3 4 Q 5 2 5 4 Q 5 6 3 4" stroke="#047857" strokeWidth="0.8" />
            <path d="M 41 4 Q 39 2 39 4 Q 39 6 41 4" stroke="#047857" strokeWidth="0.8" />
          </motion.svg>
        )}
      </AnimatePresence>

      <motion.div
        layoutId="sidebar-buddy-character"
        transition={{ type: "spring", stiffness: 180, damping: 22 }}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        className="relative z-20"
        animate={{
          y: isStanding ? -6 : isYogaState ? 2 : isPullingChair ? -16 : 0,
          scale: isPullingChair ? 1.05 : 1
        }}
        whileHover={{ 
          scale: 1.12, 
          y: isStanding ? -10 : isYogaState ? 0 : -2 
        }}
      >
        <GreetingBotSVG
          colors={colors}
          expression={isPullingChair ? "happy" : expression}
          isWaving={isPullingChair || isWaving}
          size={46}
          rotation={rotation}
          isSitting={!isStanding && !isPullingChair}
          activity={isPullingChair ? "sitting" : (isPrivate ? "sitting" : activity)}
          gender={resolvedGender}
          isPrivate={isPrivate}
        />
      </motion.div>
    </div>
  );
}

// Global default export coordinates both
export default function GreetingBot() {
  const { checkGreetingTrigger } = useBuddyStore();
  const { buddyEnabled } = useSettings();

  useEffect(() => {
    if (!buddyEnabled) return;
    // Trigger on mount
    checkGreetingTrigger();
  }, [checkGreetingTrigger, buddyEnabled]);

  if (!buddyEnabled) return null;

  return <GreetingOverlay />;
}
