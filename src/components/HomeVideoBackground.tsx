import { useEffect, useRef } from "react";

export function HomeVideoBackground() {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    // React's SSR output doesn't always carry the `muted` IDL property before
    // hydration, so browsers can see it as unmuted for a moment and silently
    // block autoplay. Setting it imperatively + calling play() here avoids that race.
    video.muted = true;
    const tryPlay = () => video.play().catch(() => {});
    tryPlay();
    // Browsers can pause background media on tab/visibility changes; resume when it's back.
    document.addEventListener("visibilitychange", tryPlay);
    return () => document.removeEventListener("visibilitychange", tryPlay);
  }, []);

  return (
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden bg-background">
      <video
        ref={videoRef}
        className="h-full w-full object-cover opacity-30"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster={`${import.meta.env.BASE_URL}videos/home-hero-poster.jpg`}
      >
        <source src={`${import.meta.env.BASE_URL}videos/home-hero.mp4`} type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/45 to-black/70" />
    </div>
  );
}
