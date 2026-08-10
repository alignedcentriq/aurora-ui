import { useEffect, useRef, useCallback } from "react";
import { Canvas } from "@react-three/fiber";
import { X, Mic, RefreshCw, Volume2, Sparkles, AlertCircle } from "lucide-react";
import { useHumanoidStore } from "@/lib/humanoid-store";
import { useChatStore } from "@/lib/chat-store";
import { HumanoidThreeScene } from "./HumanoidThreeScene";
import {
  createRecognition,
  resetSpeech,
  enqueueFrom,
  cancelSpeech,
  ttsSupported,
} from "@/lib/speech";
import { cn } from "@/lib/utils";

const STATE_META = {
  starting: {
    label: "Initializing Hologram…",
    color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30 animate-pulse",
  },
  idle: { label: "Standing By", color: "bg-slate-500/20 text-slate-400 border-slate-500/30" },
  listening: {
    label: "Listening…",
    color:
      "bg-emerald-500/25 text-emerald-400 border-emerald-500/40 shadow-[0_0_12px_rgba(52,211,153,0.15)] animate-pulse",
  },
  thinking: {
    label: "Executing Command…",
    color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
  speaking: {
    label: "Speaking…",
    color:
      "bg-cyan-500/25 text-cyan-400 border-cyan-500/40 shadow-[0_0_12px_rgba(34,211,238,0.15)]",
  },
  executing: {
    label: "Executing Command…",
    color: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  },
};

export function HumanoidOverlay() {
  const {
    humanoidActive,
    setHumanoidActive,
    humanoidState,
    setHumanoidState,
    transcript,
    setTranscript,
    audioLevel,
    setAudioLevel,
  } = useHumanoidStore();

  const activeId = useChatStore((s) => s.activeId);
  const threads = useChatStore((s) => s.threads);
  const thinkingThreads = useChatStore((s) => s.thinkingThreads);

  const activeThread = activeId ? threads[activeId] : null;
  const lastTurn = activeThread?.turns[activeThread.turns.length - 1];
  const isThinking = activeId ? !!thinkingThreads[activeId] : false;

  const lastProcessedTurnRef = useRef<unknown>(null);

  // 1. Cancel speech on unmount
  useEffect(() => {
    return () => {
      cancelSpeech();
    };
  }, []);

  // 2. Manage Web Audio API microphone levels for visual ripples during "listening"
  useEffect(() => {
    if (humanoidState !== "listening") {
      setAudioLevel(0);
      return;
    }

    let audioContext: AudioContext | null = null;
    let analyser: AnalyserNode | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let stream: MediaStream | null = null;
    let animationFrameId: number;

    const startMicStream = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const AudioContextAPI = window.AudioContext || (window as any).webkitAudioContext;
        audioContext = new AudioContextAPI();
        analyser = audioContext.createAnalyser();
        analyser.fftSize = 256;
        source = audioContext.createMediaStreamSource(stream);
        source.connect(analyser);

        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        const updateVolume = () => {
          if (!analyser) return;
          analyser.getByteFrequencyData(dataArray);

          let sum = 0;
          for (let i = 0; i < dataArray.length; i++) {
            sum += dataArray[i];
          }
          const avg = sum / dataArray.length;
          // Normalize volume levels from 0 to 1
          const level = Math.min(1.0, avg / 120.0);
          setAudioLevel(level);

          animationFrameId = requestAnimationFrame(updateVolume);
        };
        updateVolume();
      } catch (err) {
        console.warn("Could not start microhpone audio analyzer for humanoid ripple:", err);
      }
    };

    startMicStream();

    return () => {
      cancelAnimationFrame(animationFrameId);
      if (source) source.disconnect();
      if (audioContext) audioContext.close();
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [humanoidState, setAudioLevel]);

  // 3. Simulate audio amplitude updates during "speaking" for brain core pulsation
  useEffect(() => {
    if (humanoidState !== "speaking") return;

    const interval = setInterval(() => {
      // Simulate verbal frequency fluctuations
      const simulatedLevel = 0.12 + Math.random() * 0.58;
      setAudioLevel(simulatedLevel);
    }, 60);

    return () => {
      clearInterval(interval);
      setAudioLevel(0);
    };
  }, [humanoidState, setAudioLevel]);

  // 4. Handle speech synthesis completion to transition back to listening
  const handleTtsComplete = useCallback(() => {
    setHumanoidState("listening");
  }, [setHumanoidState]);

  // 5. Submit recognized voice prompt to the assistant via CustomEvent
  const handlePromptSubmit = (text: string) => {
    if (!text.trim()) return;
    setHumanoidState("thinking");
    window.dispatchEvent(new CustomEvent("centriq:quick-action", { detail: { prompt: text } }));
  };

  // 6. Monitor assistant response completion and speak the result
  useEffect(() => {
    // If we transition to thinking/processing, keep state locked
    if (isThinking && humanoidState !== "thinking") {
      setHumanoidState("thinking");
      return;
    }

    if (!lastTurn || lastTurn.role !== "ai") return;

    // Check if thinking completes and we have a new fully streamed response
    if (
      !lastTurn.streaming &&
      lastProcessedTurnRef.current !== lastTurn &&
      humanoidState === "thinking"
    ) {
      lastProcessedTurnRef.current = lastTurn;

      setHumanoidState("speaking");
      setTranscript(lastTurn.text);

      resetSpeech({
        onStart: () => {},
        onAllDone: handleTtsComplete,
      });

      enqueueFrom(lastTurn.text, true);
    }
  }, [lastTurn, isThinking, humanoidState, setHumanoidState, setTranscript, handleTtsComplete]);

  // 7. Web Speech API Recognition loop for voice command input
  useEffect(() => {
    if (humanoidState !== "listening") return;

    const recognition = createRecognition({ continuous: false, interimResults: true });
    if (!recognition) {
      console.warn("SpeechRecognition not supported in this browser.");
      return;
    }

    recognition.onstart = () => {
      setTranscript("");
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let interim = "";
      let final = "";
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          final += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      setTranscript(final || interim);
    };

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onerror = (err: any) => {
      // Don't error out on silent timeouts, just restart
      if (err.error !== "aborted" && humanoidState === "listening") {
        setTimeout(() => {
          try {
            recognition.start();
          } catch (e) {
            console.debug("Silent restart fail", e);
          }
        }, 800);
      }
    };

    recognition.onend = () => {
      const currentTranscript = useHumanoidStore.getState().transcript;
      if (currentTranscript.trim()) {
        handlePromptSubmit(currentTranscript);
      } else {
        // Keep listening loop armed if no speech occurred
        if (useHumanoidStore.getState().humanoidState === "listening") {
          try {
            recognition.start();
          } catch (e) {
            console.debug("Silent start fail", e);
          }
        }
      }
    };

    try {
      recognition.start();
    } catch (e) {
      console.error(e);
    }

    return () => {
      try {
        recognition.abort();
      } catch (e) {
        console.debug("Silent abort fail", e);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [humanoidState]);

  if (!humanoidActive) return null;

  const currentMeta = STATE_META[humanoidState] ?? STATE_META.idle;

  const handleClose = () => {
    cancelSpeech();
    setHumanoidActive(false);
  };

  return (
    <div className="fixed inset-0 z-50 bg-[#060b13]/95 flex flex-col items-center justify-between p-6 sm:p-10 select-none overflow-hidden">
      {/* Sci-Fi glowing radial background gradient */}
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(56,189,248,0.08)_0%,transparent_65%)] pointer-events-none" />

      {/* ── TOP HEADER ── */}
      <div className="w-full flex items-center justify-between max-w-5xl z-10">
        <div className="flex items-center gap-2">
          <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse shadow-[0_0_8px_#22d3ee]" />
          <span className="text-[10px] font-bold text-cyan-400 tracking-[0.25em] uppercase">
            Apex Humanoid Interface
          </span>
        </div>

        {/* State status badge */}
        <div
          className={cn(
            "px-3 py-1 rounded-full border text-[11px] font-semibold transition-all duration-300 flex items-center gap-1.5",
            currentMeta.color,
          )}
        >
          {humanoidState === "listening" && <Mic className="h-3 w-3 text-emerald-400" />}
          {humanoidState === "thinking" && (
            <RefreshCw className="h-3 w-3 animate-spin text-amber-400" />
          )}
          {humanoidState === "speaking" && (
            <Volume2 className="h-3 w-3 text-cyan-400 animate-bounce" />
          )}
          <span>{currentMeta.label}</span>
        </div>

        {/* Close Button */}
        <button
          onClick={handleClose}
          className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-800 bg-slate-900/50 text-slate-400 hover:text-white hover:border-slate-700 hover:bg-slate-900 transition-all cursor-pointer shadow-lg"
          title="Exit Humanoid Mode"
        >
          <X className="h-4.5 w-4.5" />
        </button>
      </div>

      {/* ── MIDDLE 3D HOLOGRAM CANVAS ── */}
      <div className="w-full flex-1 max-w-4xl relative flex items-center justify-center min-h-0">
        <div className="absolute inset-0 pointer-events-none border border-cyan-500/10 rounded-2xl bg-cyan-500/[0.01]" />

        {/* Subtle grid lines matching typical sci-fi HUDs */}
        <div className="absolute inset-0 bg-[linear-gradient(rgba(56,189,248,0.03)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.03)_1px,transparent_1px)] bg-[size:32px_32px] pointer-events-none rounded-2xl" />

        <div className="w-full h-full max-h-[500px]">
          <Canvas
            gl={{ antialias: true, alpha: true }}
            camera={{ position: [0, 0, 3.2], fov: 45 }}
            style={{ width: "100%", height: "100%" }}
          >
            <HumanoidThreeScene />
          </Canvas>
        </div>
      </div>

      {/* ── BOTTOM TRANSCRIPT AREA ── */}
      <div className="w-full max-w-3xl z-10 flex flex-col items-center gap-3">
        {!ttsSupported && humanoidState === "starting" && (
          <div className="flex items-center gap-1.5 text-rose-400/80 text-[11px] mb-2 bg-rose-500/5 px-3 py-1 rounded-lg border border-rose-500/10">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>
              Speech synthesis not supported in this browser; response text will show in text
              format.
            </span>
          </div>
        )}

        {/* Live Text Transcript Panel */}
        <div className="w-full rounded-2xl border border-slate-800 bg-[#090f17]/80 p-5 backdrop-blur-xl shadow-2xl relative min-h-[90px] flex items-center justify-center">
          <div className="absolute left-4 top-4 flex items-center gap-1 opacity-40">
            <Sparkles className="h-3 w-3 text-cyan-400" />
            <span className="text-[9px] font-bold tracking-wider text-slate-400 uppercase">
              Console
            </span>
          </div>

          <p
            className={cn(
              "text-center text-[14px] leading-relaxed max-w-2xl px-6 transition-all duration-300 font-medium",
              humanoidState === "listening" && "text-emerald-300",
              humanoidState === "speaking" && "text-cyan-200",
              humanoidState === "thinking" && "text-amber-300/85 animate-pulse",
              humanoidState === "idle" && "text-slate-400",
            )}
          >
            {transcript
              ? transcript
              : humanoidState === "listening"
                ? "Say something..."
                : humanoidState === "thinking"
                  ? "Analysing and executing..."
                  : "Standing by. Toggle state to communicate."}
          </p>
        </div>

        {/* Visualizer audio bars when listening */}
        {humanoidState === "listening" && (
          <div className="flex items-center gap-1 h-5 mt-2">
            {Array.from({ length: 9 }).map((_, i) => {
              // Create dynamic wave bar levels based on mic input
              const heightMultiplier =
                i === 4 ? 1.0 : i === 3 || i === 5 ? 0.75 : i === 2 || i === 6 ? 0.5 : 0.25;
              const barHeight = Math.max(3, audioLevel * 20 * heightMultiplier);
              return (
                <div
                  key={i}
                  className="w-1 rounded-full bg-emerald-400 transition-all duration-75"
                  style={{ height: `${barHeight}px`, opacity: 0.35 + audioLevel * 0.65 }}
                />
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
