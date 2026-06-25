// Browser-native speech: shared SpeechRecognition factory + a streaming
// text-to-speech engine used by the hands-free voice mode ("Jarvis").
// No backend involved — everything runs on the Web Speech / SpeechSynthesis APIs.

// ── Speech recognition (input) ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const SpeechRecognitionAPI: (new () => SpeechRecognition) | undefined =
  typeof window !== "undefined"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ((window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition)
    : undefined;

export const speechRecognitionSupported = !!SpeechRecognitionAPI;

/** Create a configured recognizer, or null if the browser doesn't support it. */
export function createRecognition(opts?: {
  continuous?: boolean;
  interimResults?: boolean;
}): SpeechRecognition | null {
  if (!SpeechRecognitionAPI) return null;
  const r = new SpeechRecognitionAPI();
  r.continuous = opts?.continuous ?? false;
  r.interimResults = opts?.interimResults ?? true;
  r.lang = "en-US";
  return r;
}

// ── Text-to-speech (output) ─────────────────────────────────────────────────

export const ttsSupported = typeof window !== "undefined" && "speechSynthesis" in window;

interface SpeakCallbacks {
  /** Fired when the first queued utterance begins playing. */
  onStart?: () => void;
  /** Fired only once the queue has drained AND the turn was marked complete. */
  onAllDone?: () => void;
}

let cursor = 0; // chars of the current turn already enqueued
let queueLength = 0; // utterances still pending/playing
let complete = false; // turn finished streaming → safe to resume listening
let callbacks: SpeakCallbacks = {};
let startedNotified = false;

let voiceCache: SpeechSynthesisVoice | null = null;
function pickVoice(): SpeechSynthesisVoice | null {
  if (!ttsSupported) return null;
  if (voiceCache) return voiceCache;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;
  // Prefer a natural-sounding English voice.
  const preferred =
    voices.find(
      (v) => /en(-|_)/i.test(v.lang) && /natural|google|samantha|aria|jenny/i.test(v.name),
    ) ??
    voices.find((v) => /en-US/i.test(v.lang)) ??
    voices.find((v) => /^en/i.test(v.lang)) ??
    null;
  voiceCache = preferred;
  return preferred;
}

if (ttsSupported) {
  // Voice list often loads asynchronously.
  window.speechSynthesis.onvoiceschanged = () => {
    voiceCache = null;
    pickVoice();
  };
}

/** Strip markdown so the synthesizer reads clean prose, not symbols. */
function stripMarkdown(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ") // fenced code blocks
    .replace(/`([^`]+)`/g, "$1") // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ") // images
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1") // links → text
    .replace(/^#{1,6}\s+/gm, "") // headings
    .replace(/^\s*>\s?/gm, "") // blockquotes
    .replace(/^\s*[-*+]\s+/gm, "") // bullet markers
    .replace(/(\*\*|\*|__|_|~~)/g, "") // emphasis
    .replace(/\|/g, " ") // table pipes
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function speakChunk(text: string) {
  if (!ttsSupported || !text.trim()) return;
  const u = new SpeechSynthesisUtterance(text);
  const v = pickVoice();
  if (v) u.voice = v;
  u.rate = 1.05;
  u.pitch = 1;
  queueLength++;
  if (!startedNotified) {
    startedNotified = true;
    callbacks.onStart?.();
  }
  const finish = () => {
    queueLength = Math.max(0, queueLength - 1);
    if (queueLength === 0 && complete) callbacks.onAllDone?.();
  };
  u.onend = finish;
  u.onerror = finish;
  window.speechSynthesis.speak(u);
}

/** Begin a fresh spoken turn; cancels anything still playing. */
export function resetSpeech(cb: SpeakCallbacks) {
  cancelSpeech();
  cursor = 0;
  complete = false;
  startedNotified = false;
  callbacks = cb;
}

/**
 * Speak any newly *completed* sentences in `fullText` past the cursor.
 * Pass `flush: true` once the turn is done to speak the trailing remainder
 * and arm the onAllDone callback.
 */
export function enqueueFrom(fullText: string, flush = false) {
  if (!ttsSupported) {
    if (flush) {
      complete = true;
      if (queueLength === 0) callbacks.onAllDone?.();
    }
    return;
  }
  const stripped = stripMarkdown(fullText);
  let chunk = "";
  if (flush) {
    chunk = stripped.slice(cursor);
    cursor = stripped.length;
  } else {
    const region = stripped.slice(cursor);
    const matches = [...region.matchAll(/[.!?]+[\s\n]+/g)];
    if (matches.length === 0) return;
    const last = matches[matches.length - 1];
    const end = (last.index ?? 0) + last[0].length;
    chunk = region.slice(0, end);
    cursor += end;
  }
  chunk = chunk.trim();
  if (chunk) speakChunk(chunk);
  if (flush) {
    complete = true;
    if (queueLength === 0) callbacks.onAllDone?.();
  }
}

export function cancelSpeech() {
  if (ttsSupported) window.speechSynthesis.cancel();
  queueLength = 0;
  startedNotified = false;
}

export function isSpeaking(): boolean {
  return ttsSupported && (window.speechSynthesis.speaking || queueLength > 0);
}

export function getVoiceByGender(gender: "male" | "female"): SpeechSynthesisVoice | null {
  if (!ttsSupported) return null;
  const voices = window.speechSynthesis.getVoices();
  if (voices.length === 0) return null;

  // Filter English voices
  const enVoices = voices.filter((v) => /en(-|_)/i.test(v.lang) || /^en$/i.test(v.lang));
  if (enVoices.length === 0) return null;

  if (gender === "male") {
    // Look for typical male names or keywords
    const maleVoice = enVoices.find((v) =>
      /david|mark|george|alex|daniel|guy|male|james|microsoft/i.test(v.name),
    );
    if (maleVoice) return maleVoice;
  } else {
    // Look for typical female names or keywords
    const femaleVoice = enVoices.find((v) =>
      /samantha|zira|hazel|aria|jenny|female|susan|karen/i.test(v.name),
    );
    if (femaleVoice) return femaleVoice;
  }

  // Fallback if no specific gender match was found
  if (gender === "male") {
    // Avoid known female names if possible
    const fallbackMale = enVoices.find(
      (v) => !/samantha|zira|hazel|aria|jenny|female|susan|karen/i.test(v.name),
    );
    if (fallbackMale) return fallbackMale;
  } else {
    // Avoid known male names if possible
    const fallbackFemale = enVoices.find(
      (v) => !/david|mark|george|alex|daniel|guy|male|james/i.test(v.name),
    );
    if (fallbackFemale) return fallbackFemale;
  }

  return enVoices[0];
}

export function speakNotification(text: string, gender: "male" | "female") {
  if (!ttsSupported || !text.trim()) return;

  // Cancel any ongoing speech so the notification speaks immediately.
  window.speechSynthesis.cancel();

  const u = new SpeechSynthesisUtterance(text);
  const voice = getVoiceByGender(gender);
  if (voice) {
    u.voice = voice;
  }
  u.rate = 1.0;
  u.pitch = gender === "male" ? 0.95 : 1.05;

  window.speechSynthesis.speak(u);
}
