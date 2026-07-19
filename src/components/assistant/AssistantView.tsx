import { useState, useCallback, useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Composer } from "./Composer";
import { UserMessage, AIMessage, AnswerCard } from "./Message";
import {
  Download,
  Sparkles,
  X,
  ArrowDown,
  BookOpen,
  Library as LibraryIcon,
  RefreshCw,
  Activity,
} from "lucide-react";
import { Logo } from "@/components/Logo";
import { BrandName } from "@/components/BrandName";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth-store";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { InteractiveEmailDraft } from "./InteractiveEmailDraft";
import { ParkingForm } from "./ParkingForm";
import { VisitorPassForm } from "./VisitorPassForm";
import { TravelRequestForm } from "./TravelRequestForm";
import { TravelExpenseForm } from "./TravelExpenseForm";
import { DynamicFormWidget } from "./DynamicFormWidget";
import { ConnectorLinkCard } from "./ConnectorLinkCard";
import { ChoiceWidget } from "./ChoiceWidget";
import { QuickChoicePanel } from "./QuickChoicePanel";
import { FormBuilderWidget } from "./FormBuilderWidget";
import { RoomBookingWidget } from "./RoomBookingWidget";
import { CancelBookingWidget } from "./CancelBookingWidget";
import { CancelLeaveWidget } from "./CancelLeaveWidget";
import { LeaveApplicationWidget } from "./LeaveApplicationWidget";
import { DocumentGenerationWidget } from "./DocumentGenerationWidget";
import { MyScheduleWidget } from "./MyScheduleWidget";
import { SkillsEditorWidget } from "./SkillsEditorWidget";
import { AnnouncementWidget } from "./AnnouncementWidget";
import { PromptConfigWidget } from "./PromptConfigWidget";
import { AttendanceScheduleWidget } from "./AttendanceScheduleWidget";
import { MyAttendanceWidget } from "./MyAttendanceWidget";
import { ChartCanvas } from "@/components/analytics/ChartCanvas";
import { VoiceOrb } from "./VoiceOrb";
import { ThinkingBuddy } from "./ThinkingBuddy";
import { SmartWidgets } from "./SmartWidgets";
import { useVoiceStore } from "@/lib/voice-store";
import { createRecognition } from "@/lib/speech";
import { subscribeFormTrigger } from "@/lib/form-trigger";
import { parseFormCommand } from "@/lib/form-command-parser";
import { motion, AnimatePresence } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { SparklesCore } from "@/components/ui/sparkles";
import { AmbientField } from "@/components/three/AmbientField";
import { CitationsCard } from "@/components/assistant/CitationsCard";
import { MorningBriefing } from "@/components/assistant/MorningBriefing";
import { CHAT_MODES, parseModeCommand, type ModeKey } from "@/lib/chat-modes";
import { getPortalCopilot } from "@/lib/portal-copilot";

import type { Turn, DynamicFormField } from "@/lib/chat-store";
import { ICON_MAP } from "@/lib/quickQueries";
import { useQuickQueries } from "@/hooks/useQuickQueries";
import { Search, Lock } from "lucide-react";

function getGreeting(name: string): { heading: string; subheading: string } {
  const firstName = name.split(" ")[0];
  const hour = new Date().getHours();

  if (hour >= 5 && hour < 9) {
    return {
      heading: `Early start, ${firstName}.`,
      subheading: "Let's make the most of the morning.",
    };
  } else if (hour >= 9 && hour < 12) {
    return {
      heading: `Good morning, ${firstName}.`,
      subheading: "What can I help you with today?",
    };
  } else if (hour >= 12 && hour < 14) {
    return { heading: `Good afternoon, ${firstName}.`, subheading: "What's on your plate?" };
  } else if (hour >= 14 && hour < 17) {
    return {
      heading: `Afternoon, ${firstName}.`,
      subheading: "How can I help you power through the day?",
    };
  } else if (hour >= 17 && hour < 20) {
    return {
      heading: `Good evening, ${firstName}.`,
      subheading: "Wrapping up or just getting started?",
    };
  } else if (hour >= 20 && hour < 23) {
    return {
      heading: `Night owl mode, ${firstName}.`,
      subheading: "I'm here. What's on your mind?",
    };
  } else {
    return { heading: `Up late, ${firstName}.`, subheading: "The quiet hours. What do you need?" };
  }
}

interface ThreadData {
  id: string;
  turns: Turn[];
}

import { useChatStore } from "@/lib/chat-store";
import { useSettings } from "@/lib/settings-store";
import { useServerLoad } from "@/hooks/use-server-load";

// ── Book intent helpers ─────────────────────────────────────────────────────
// Client-side intercept for the most common book-discovery / status / return /
// extension intents. Matches the same phrasings the backend router covers, so
// the user is taken straight to the right page without waiting for an LLM call.

const BOOK_DISCOVER_RE =
  /\b(?:bookshelf|book\s*shelf|company\s+library|office\s+library|library\s+(?:catalog|catalogue|books?)|available\s+books?|books?\s+available|browse\s+(?:the\s+)?(?:library|books)|show\s+(?:me\s+)?(?:some\s+|the\s+|any\s+)?(?:books?|library)|recommend\s+(?:me\s+)?(?:a\s+)?book|(?:i\s+)?(?:want|need|like)\s+(?:a\s+|an\s+|some\s+)?book|looking\s+for\s+(?:a\s+|an\s+|some\s+)?(?:book|reading\s+material|something\s+to\s+read)|(?:learning|reading|study)\s+material|borrow\s+a\s+book|issue\s+a\s+book|lend\s+me\s+a\s+book)\b/i;

const BOOK_MY_RE =
  /\b(?:my\s+(?:borrowed\s+)?(?:books?|library|borrows?|book\s+requests?)|books?\s+i\s+(?:have\s+)?borrowed|check\s+(?:my\s+)?book\s+request|my\s+book\s+request\s+status|return\s+(?:my\s+|the\s+|a\s+)?book|i\s+(?:have\s+)?finished\s+(?:reading|the\s+book)|extend\s+(?:my\s+|the\s+)?(?:book|due\s+date|borrow)|renew\s+(?:my\s+|the\s+|a\s+)?book|(?:need|want)\s+more\s+time\s+(?:on|for|with)\s+(?:my\s+|the\s+)?book)\b/i;

// Stationery-style phrases that look like book intents but are not.
const NOT_BOOK_RE =
  /\bborrow\s+(?:a\s+)?(?:pen|pencil|charger|cable|notebook(?!\s+book)|stapler|marker)\b/i;

function normalizeBullets(text: string): string {
  // Convert Unicode bullet markers (•) used as inline or line-start separators
  // into proper markdown list items so ReactMarkdown renders them correctly.
  // Only triggers when 2+ bullet-delimited segments are found.
  if (!/[•·]/.test(text)) return text;
  const parts = text
    .split(/\s*[•·]\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (parts.length < 2) return text;
  return parts.map((p) => `- ${p}`).join("\n");
}

function detectBookIntent(text: string): { path: string; label: string; reply: string } | null {
  const t = text.toLowerCase();
  if (NOT_BOOK_RE.test(t)) return null;
  if (BOOK_MY_RE.test(t)) {
    return {
      path: "/my-library",
      label: "Open My Library",
      reply: "Opening **My Library** so you can manage your borrows, requests, and extensions.",
    };
  }
  if (BOOK_DISCOVER_RE.test(t)) {
    return {
      path: "/books",
      label: "Open Book Catalog",
      reply: "Opening the **company library** — browse and request any book you'd like.",
    };
  }
  return null;
}

// ── Directory filter parsing ─────────────────────────────────────────────────
// When the copilot sidebar is open on the Employee Directory, a filter-style query
// ("resources with 5+ years in React") drives the visible grid instead of going to
// the backend. Deterministic, zero-LLM, strictly scoped to /directory by the caller.
export interface DirectoryFilter {
  skills?: string[];
  // Independent per-skill experience bounds ("more than 1 years experience in python"),
  // ANDed together and against `skills` — distinct from the single broad `minYears`/
  // `maxYears` below, which applies to whichever skill row a query names with no
  // per-skill number attached (e.g. a lone "5+ years").
  skillConstraints?: Array<{ skill: string; minYears?: number; maxYears?: number }>;
  minYears?: number;
  maxYears?: number;
  certified?: boolean;
  projects?: string[];
  // How multiple named projects combine: "worked on Alpha and Beta" requires BOTH (every
  // named project matched); "worked on Alpha or Beta" / a plain comma list ("Alpha, Beta")
  // requires at least one. Only meaningful when `projects` has 2+ entries.
  projectMode?: "and" | "or";
  usedWithinMonths?: number;
  available?: boolean;
  // A specific "N% free" threshold, distinct from the bare `available` flag above (see
  // parseDirectoryFilter's availability block for how the two combine).
  minAvailabilityPercent?: number;
  // Substring matches against the employee's department/designation fields — free text,
  // not the exact dropdown values, so "TSS" matches "TSS - Technical Support Services".
  department?: string;
  designation?: string;
}

const _DIR_STOPWORDS =
  /^(the|a|an|of|in|with|on|and|or|more|than|over|at|least|min|years?|yrs?|experience|expertise|skills?|project|projects|certified|certification|certificate|last|past|within|months?|weeks?|days?|recently|developers?|engineers?|experts?)$/i;

// Stripped from the start of the query before skill/experience extraction so a leading
// command verb ("find", "show me", ...) can never be swept into a lazy skill capture —
// e.g. without this, "find power bi developer" could capture "find power bi" as the skill.
const _DIR_LEADING_INTENT_RE =
  /^\s*(?:please\s+)?(?:find|show(?:\s+me)?|list|search(?:\s+for)?|get(?:\s+me)?|display|pull\s+up|i\s+(?:want|need)|looking\s+for|who\s+(?:is|are)|which\s+(?:employees?|people|resources?|developers?|engineers?)|give\s+me)\s+/i;

// Bound-direction vocabulary for a "N years [of experience]" clause.
const _DIR_MAX_BOUND_WORDS =
  "less\\s+than|under|fewer\\s+than|no\\s+more\\s+than|at\\s+most|up\\s+to|maximum\\s+of|max(?:imum)?";
const _DIR_MIN_BOUND_WORDS = "more\\s+than|over|at\\s+least|minimum\\s+of|min(?:imum)?|greater\\s+than|above";

interface _DirYearsClause {
  minYears?: number;
  maxYears?: number;
  skill?: string;
}

// Scans the whole query for every years-of-experience clause (a naive single .match() only
// ever sees the first one, silently dropping the rest when a query names more than one — the
// original bug behind "less than 3 years ... and more than 1 years experience in python"
// collapsing to a single misread constraint). Each clause is returned with the skill it's
// attached to ("... experience in python"), if any; unattached clauses apply broadly.
// Strips a stray leading connector ("and python" → "python") that a lazy, boundary-agnostic
// capture can sweep in when the word immediately before it was already consumed by an
// earlier clause match, leaving only the joining "and"/"or" behind.
function _stripLeadingConnector(s: string): string {
  return s.replace(/^\s*(?:and|or|&|,)\s*/i, "").trim();
}

function _extractYearsClauses(src: string): { clauses: _DirYearsClause[]; masked: string } {
  const clauses: _DirYearsClause[] = [];
  let masked = src;
  const blank = (index: number, len: number) => {
    masked = masked.slice(0, index) + " ".repeat(len) + masked.slice(index + len);
  };

  // Terminated by the shared clause-boundary lookahead (not just and/or/punctuation/end)
  // so a clause followed by an unrelated new clause ("3 years worked on PMP", "5+ years
  // certified") still matches instead of failing outright and silently dropping the whole
  // years constraint.
  const rangeRes = [
    new RegExp(
      `\\bbetween\\s+(\\d+(?:\\.\\d+)?)\\s+and\\s+(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*(?:years?|yrs?)(?:\\s+(?:of\\s+)?experience)?(?:\\s+(?:in|with|on|of)\\s+([A-Za-z][A-Za-z0-9+.#/&, ]*?))?${_DIR_LIST_END}`,
      "gi",
    ),
    new RegExp(
      `\\b(\\d+(?:\\.\\d+)?)\\s*(?:-|to)\\s*(\\d+(?:\\.\\d+)?)\\s*\\+?\\s*(?:years?|yrs?)(?:\\s+(?:of\\s+)?experience)?(?:\\s+(?:in|with|on|of)\\s+([A-Za-z][A-Za-z0-9+.#/&, ]*?))?${_DIR_LIST_END}`,
      "gi",
    ),
  ];
  for (const re of rangeRes) {
    for (const m of masked.matchAll(re)) {
      const a = parseFloat(m[1]);
      const b = parseFloat(m[2]);
      clauses.push({ minYears: Math.min(a, b), maxYears: Math.max(a, b), skill: m[3]?.trim() });
      blank(m.index!, m[0].length);
    }
  }

  const boundRe = new RegExp(
    `\\b(?:(${_DIR_MAX_BOUND_WORDS})|(${_DIR_MIN_BOUND_WORDS}))?\\s*(\\d+(?:\\.\\d+)?)(\\+)?\\s*(?:years?|yrs?)(?:\\s+(?:of\\s+)?experience)?(?:\\s+(?:in|with|on|of)\\s+([A-Za-z][A-Za-z0-9+.#/&, ]*?))?${_DIR_LIST_END}`,
    "gi",
  );
  for (const m of masked.matchAll(boundRe)) {
    const isMax = !!m[1];
    const isMin = !!m[2] || !!m[4];
    const n = parseFloat(m[3]);
    const skill = m[5]?.trim();
    if (isMax) clauses.push({ maxYears: n, skill });
    else if (isMin) clauses.push({ minYears: n, skill });
    else clauses.push({ minYears: n, skill }); // bare "N years" defaults to a minimum threshold
    blank(m.index!, m[0].length);
  }
  return { clauses, masked };
}

const _DIR_PROJECT_STOPWORDS =
  /^(a|an|the|any|some|this|that|particular|certain|specific|which|what|various|and|or)$/i;

// Split a comma/"and"/"or" delimited phrase ("React, Node and AWS") into individual
// tokens, dropping stopwords/empties so trailing filler words don't become fake entries.
function _splitDirList(chunk: string, stopwords: RegExp, maxLen: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of chunk.split(/\s*,\s*|\s+(?:and|or|&)\s+|\s*\/\s*/i)) {
    const tok = raw.trim().replace(/^["“']|["”']$/g, "");
    if (!tok || tok.length < 2 || tok.length > maxLen || stopwords.test(tok)) continue;
    const key = tok.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tok);
    if (out.length >= 8) break;
  }
  return out;
}

// Lookahead marking where a skill/project list chunk ends — the next filter clause
// (experience, role noun, certification, availability, recency, a new "and is/are/has/
// have" compound clause, punctuation) or end of string. Shared by skill AND project
// capture so a query that keeps going after the list ("worked on PMP and is 50% free")
// doesn't get swallowed whole — only "and <name>" (another list item) passes through.
const _DIR_LIST_END =
  "(?=\\s+(?:experience|developers?|engineers?|experts?|specialists?|who|that|having|for|with|worked|working|in\\s+the\\s+last|within|during|certified|certification|available|availability|unallocated|free|spare|projects?)\\b" +
  "|\\s+and\\s+(?:is|are|has|have|who|that|worked|working|certified|available|more\\s+than|over|at\\s+least|minimum|min|less\\s+than|under|fewer\\s+than|no\\s+more\\s+than|at\\s+most|max(?:imum)?|\\d+(?:\\.\\d+)?\\+?\\s*(?:years?|yrs?)|\\d+(?:\\.\\d+)?\\s*%)\\b" +
  "|,?\\s*(?:more\\s+than|over|at\\s+least|minimum|min|\\d+(?:\\.\\d+)?\\+?\\s*(?:years?|yrs?)|\\d+(?:\\.\\d+)?\\s*%)" +
  "|[?.!]|$)";

function parseDirectoryFilter(text: string): DirectoryFilter | null {
  const t = text.trim();
  const lower = t.toLowerCase();

  // Must read as a search/filter intent, so plain questions ("who is the CTO?",
  // "what does the directory show?") still fall through to the backend agent.
  const isFilterIntent =
    /\b(filter|show|find|list|search|who|which|people|resources?|employees?|colleagues?|developers?|engineers?|experts?|certified|certification|worked?|used?|using|with|having|have)\b/i.test(
      lower,
    );
  if (!isFilterIntent) return null;

  // Certification: "certified in React", "who has a React certificate".
  const certified = /\bcertif(?:ied|ication|icate)\b/i.test(lower) || undefined;

  // Strip a leading command verb ("find", "show me", ...) before any lazy skill capture
  // runs, so it can never be swept into the captured phrase (see _DIR_LEADING_INTENT_RE).
  let core = t.replace(_DIR_LEADING_INTENT_RE, "").trim();

  // Designation: a title-adjective + role-noun combo ("Sr. Engineer", "Senior Consultant"),
  // or an explicit "designation of/: X". Checked — and masked out of `core` — BEFORE the
  // generic skill/role-noun capture further down, since that capture also keys off a
  // trailing "engineer/developer/..." word and would otherwise misread "Sr. Engineer" as a
  // skill named "Sr" for an "engineer" role.
  let designation: string | undefined;
  const desigTitleRe =
    /\b((?:sr\.?|senior|jr\.?|junior|lead|principal|staff|chief|head|associate|assistant)\s+(?:engineers?|developers?|consultants?|managers?|architects?|analysts?|directors?|specialists?|designers?|leads?|executives?|officers?|administrators?|coordinators?))\b/i;
  const desigExplicitRe = new RegExp(
    `\\bdesignation\\s*(?:of|:|as)?\\s*([A-Za-z][A-Za-z0-9&/.\\- ]{1,40}?)${_DIR_LIST_END}`,
    "i",
  );
  const desigM = core.match(desigTitleRe) || core.match(desigExplicitRe);
  if (desigM) {
    designation = desigM[1].trim();
    core = core.slice(0, desigM.index!) + " ".repeat(desigM[0].length) + core.slice(desigM.index! + desigM[0].length);
  }

  // Department: "from <Dept>", "in the <Dept> department", "department of <Dept>" — masked
  // out of `core` for the same reason as designation above, so a department name (e.g.
  // "TSS") never leaks into the skill/project capture that follows.
  let department: string | undefined;
  const deptRe1 = new RegExp(`\\bfrom\\s+(?:the\\s+)?([A-Za-z][A-Za-z0-9&/.\\- ]{1,40}?)${_DIR_LIST_END}`, "i");
  // Requires a leading "in (the)?" anchor and caps the name at 3 words — otherwise the
  // capture has no left-side anchor and greedily sweeps back to the start of the query
  // (e.g. "react developers in Engineering department" would capture "react developers in
  // Engineering" instead of just "Engineering").
  const deptRe2 = /\bin\s+(?:the\s+)?([A-Za-z][A-Za-z0-9&.-]*(?:\s+[A-Za-z][A-Za-z0-9&.-]*){0,2})\s+department\b/i;
  const deptRe3 = new RegExp(`\\bdepartment\\s*(?:of|:)?\\s*([A-Za-z][A-Za-z0-9&/.\\- ]{1,40}?)${_DIR_LIST_END}`, "i");
  const deptM = core.match(deptRe1) || core.match(deptRe2) || core.match(deptRe3);
  if (deptM) {
    department = deptM[1].trim();
    core = core.slice(0, deptM.index!) + " ".repeat(deptM[0].length) + core.slice(deptM.index! + deptM[0].length);
  }

  const coreLower = core.toLowerCase();

  // Availability — either a bare mention ("who is available", "free React devs", "on the
  // bench", "unallocated") or a specific "N% free" threshold ("50% free", "at least 60%
  // available"). The percentage clause is masked out before testing for a bare mention so
  // "50% free" alone doesn't ALSO trip the generic flag — if it did, the threshold would be
  // pointless, since any positive availability would already satisfy the (broader) generic
  // flag. A genuinely separate mention elsewhere ("50% free or free") still sets it,
  // correctly loosening the filter to "any availability" exactly as literally asked.
  let minAvailabilityPercent: number | undefined;
  const availPctRe =
    /\b(?:at\s+least|over|more\s+than|min(?:imum)?(?:\s+of)?)?\s*(\d+(?:\.\d+)?)\s*%\s*\+?\s*(?:free|available|availab(?:le|ility)|capacity)\b/i;
  const availPctM = coreLower.match(availPctRe);
  let availabilitySource = coreLower;
  if (availPctM) {
    minAvailabilityPercent = parseFloat(availPctM[1]);
    availabilitySource =
      coreLower.slice(0, availPctM.index!) +
      " ".repeat(availPctM[0].length) +
      coreLower.slice(availPctM.index! + availPctM[0].length);
  }
  const available =
    /\b(available|availability|unallocated|not\s+allocated|on\s+(?:the\s+)?bench|free|spare\s+capacity)\b/i.test(
      availabilitySource,
    ) || undefined;

  // Recency on last-used: "used X in the last 2 months", "past 6 weeks", "within 1 year".
  // Matched first and masked out of the years-experience source below so it can't also be
  // misread as an experience-years clause.
  let usedWithinMonths: number | undefined;
  const recRe =
    /\b(?:last|past|within|in\s+the\s+last|over\s+the\s+last)\s+(\d+)\s*(year|years|month|months|week|weeks|day|days)\b/i;
  const recM = core.match(recRe);
  let yearsSource = core;
  if (recM) {
    const n = parseInt(recM[1], 10);
    const unit = recM[2].toLowerCase();
    usedWithinMonths = unit.startsWith("year")
      ? n * 12
      : unit.startsWith("week")
        ? Math.max(1, Math.round(n / 4.345))
        : unit.startsWith("day")
          ? Math.max(1, Math.round(n / 30))
          : n;
    yearsSource = core.slice(0, recM.index!) + " ".repeat(recM[0].length) + core.slice(recM.index! + recM[0].length);
  }

  // Project(s): "worked on <X>", "on the <X> project", "project <X>, <Y>", "<X> and <Y>
  // projects". A placeholder like "a particular project" yields no concrete name and is
  // ignored (falls through to backend).
  let projects: string[] | undefined;
  // Explicit "and" between project names means the person must have worked on ALL of
  // them; anything else (an "or", or a plain comma list with no connector) means at
  // least one — checked on the un-split candidate so the connector word itself is seen
  // before _splitDirList discards it as a delimiter.
  let projectMode: "and" | "or" | undefined;
  const projM =
    core.match(
      new RegExp(
        `\\b(?:worked|work(?:ing)?)\\s+on\\s+(?:the\\s+)?(?:projects?\\s+)?["“']?([A-Za-z0-9][\\w .&/,-]{1,120}?)["”']?(?:\\s+projects?)?${_DIR_LIST_END}`,
        "i",
      ),
    ) ||
    core.match(
      new RegExp(
        `\\bprojects?\\s+(?:called\\s+|named\\s+|titled\\s+)?["“']?([A-Za-z0-9][\\w .&/,-]{1,120}?)["”']?${_DIR_LIST_END}`,
        "i",
      ),
    );
  if (projM) {
    const cand = projM[1].trim().replace(/\s+projects?$/i, "").trim();
    const list = _splitDirList(cand, _DIR_PROJECT_STOPWORDS, 60);
    if (list.length) {
      projects = list;
      projectMode = /\band\b/i.test(cand) ? "and" : "or";
    }
  }

  // Years of experience — every clause in the query is scanned (not just the first), each
  // recognizing both a minimum ("more than 5 years", "5+ years", "at least 3 yrs") and a
  // maximum ("less than 3 years", "under 3 yrs", "at most 3 years") direction, plus ranges
  // ("between 3 and 5 years", "3-5 years"). A clause naming its own skill ("more than 1
  // years experience in python") becomes an independent per-skill constraint; an unattached
  // clause ("5+ years" on its own) applies broadly to any matched skill row.
  let minYears: number | undefined;
  let maxYears: number | undefined;
  const skillConstraints: Array<{ skill: string; minYears?: number; maxYears?: number }> = [];
  const { clauses: yearsClauses, masked: maskedForSkills } = _extractYearsClauses(yearsSource);
  for (const clause of yearsClauses) {
    if (clause.skill) {
      for (const s of _splitDirList(_stripLeadingConnector(clause.skill), _DIR_STOPWORDS, 24)) {
        const existing = skillConstraints.find((sc) => sc.skill.toLowerCase() === s.toLowerCase());
        if (existing) {
          if (clause.minYears !== undefined) existing.minYears = clause.minYears;
          if (clause.maxYears !== undefined) existing.maxYears = clause.maxYears;
        } else {
          skillConstraints.push({ skill: s, minYears: clause.minYears, maxYears: clause.maxYears });
        }
      }
    } else {
      if (clause.minYears !== undefined)
        minYears = minYears === undefined ? clause.minYears : Math.max(minYears, clause.minYears);
      if (clause.maxYears !== undefined)
        maxYears = maxYears === undefined ? clause.maxYears : Math.min(maxYears, clause.maxYears);
    }
  }

  // Skill(s) / technology mentioned WITHOUT their own experience clause: "experience in
  // React, Node and AWS", "certified in AWS", "used Python or Java", "knows SAP", "React and
  // Node developers", "power bi developer". Scanned globally (not just the first match) so
  // an earlier skill/role mention survives even when a later clause names another skill.
  const skillMatches: string[] = [];
  const expRe = new RegExp(
    `\\b(?:experience|expertise|skill(?:s|ed)?|proficien\\w*|knowledge|hands?[- ]on|certified|certification)\\s+(?:in|with|on|of)\\s+([A-Za-z][A-Za-z0-9+.#/&, ]*?)${_DIR_LIST_END}`,
    "gi",
  );
  const useRe = new RegExp(
    `\\b(?:used|using|use|worked\\s+with|working\\s+with)\\s+([A-Za-z][A-Za-z0-9+.#/&, ]*?)${_DIR_LIST_END}`,
    "gi",
  );
  const roleRe = /\b([A-Za-z][A-Za-z0-9+.#/&, ]{1,60}?)\s+(?:developers?|engineers?|experts?|specialists?)\b/gi;
  // Scanned over the years-clauses-masked text so an already-consumed clause ("under 3
  // years") can never bleed into the next capture as leftover words. Each pattern's own
  // matches are then ALSO masked before the next pattern runs — expRe/useRe are anchored
  // by an explicit keyword ("experience in", "used") and take precedence; without this,
  // roleRe's unanchored capture can sweep up an already-claimed clause from its own
  // leftmost starting point ("experience in React and Node **developers**" would
  // otherwise also match roleRe starting at "experience", capturing the whole prefix).
  let skillScanSource = maskedForSkills;
  const blankSkillMatch = (index: number, len: number) => {
    skillScanSource = skillScanSource.slice(0, index) + " ".repeat(len) + skillScanSource.slice(index + len);
  };
  for (const re of [expRe, useRe, roleRe]) {
    for (const m of skillScanSource.matchAll(re)) {
      skillMatches.push(_stripLeadingConnector(m[1]));
      blankSkillMatch(m.index!, m[0].length);
    }
  }
  if (!skillMatches.length) {
    const knowM = skillScanSource.match(
      /\b(?:know|knows|knowing|in|with|on)\s+([A-Za-z][A-Za-z0-9+.#/&, ]{1,60})\s*[?.!]*\s*$/i,
    );
    if (knowM) skillMatches.push(_stripLeadingConnector(knowM[1]));
  }
  let skills: string[] | undefined;
  if (skillMatches.length) {
    const list = _splitDirList(skillMatches.join(", "), _DIR_STOPWORDS, 24);
    // A skill that already has its own experience clause is tracked via skillConstraints,
    // not the plain skill list — keep it in exactly one place.
    const rest = list.filter((s) => !skillConstraints.some((sc) => sc.skill.toLowerCase() === s.toLowerCase()));
    if (rest.length) skills = rest;
  }

  // Don't double-capture a project mention (or its surrounding words, from the "on X
  // project" fallback capture below) as a skill — check both directions since either
  // string can be the more specific one ("Alpha" vs. a leaked "the alpha project").
  if (projects && skills) {
    skills = skills.filter(
      (s) =>
        !projects!.some(
          (p) => p.toLowerCase().includes(s.toLowerCase()) || s.toLowerCase().includes(p.toLowerCase()),
        ),
    );
    if (!skills.length) skills = undefined;
  }

  // Only act when we actually parsed a filterable dimension.
  if (
    !skills &&
    !skillConstraints.length &&
    minYears === undefined &&
    maxYears === undefined &&
    !certified &&
    !projects &&
    usedWithinMonths === undefined &&
    !available &&
    minAvailabilityPercent === undefined &&
    !department &&
    !designation
  )
    return null;
  return {
    skills,
    skillConstraints: skillConstraints.length ? skillConstraints : undefined,
    minYears,
    maxYears,
    certified,
    projects,
    projectMode,
    usedWithinMonths,
    minAvailabilityPercent,
    available,
    department,
    designation,
  };
}

// ── My Requests filter parsing ───────────────────────────────────────────────
// When the copilot sidebar is open on the My Requests page, a query like "find all my
// leave records from June" drives the requests list (type + status + date range) instead
// of going to the backend. Deterministic, zero-LLM, strictly scoped to /my-requests.
export interface RequestsFilter {
  type: string; // RequestType key (e.g. "leave") or "all"
  status: "all" | "open" | "closed" | "in-progress";
  dateFrom?: string; // YYYY-MM-DD inclusive
  dateTo?: string; // YYYY-MM-DD inclusive
  rangeLabel?: string; // human label for the date chip, e.g. "June 2026"
}

const _MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};
const _MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

// Request-type synonyms, ordered so the more specific phrase wins (travel expense before
// travel request before expense; leave before the rest).
const _REQUEST_TYPE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(leaves?|time[- ]?off|vacations?|pto|days?\s?off|holidays?)\b/i, "leave"],
  [/\btravel\s+(?:expenses?|claims?|reimbursements?)\b/i, "travel_expense"],
  [/\b(?:travel\s+requests?|business\s+travel|trips?|travel)\b/i, "travel_request"],
  [/\b(?:reimbursements?|expense\s+claims?|expenses?|claims?)\b/i, "expense"],
  [/\b(?:udemy|courses?|licen[sc]es?|trainings?)\b/i, "udemy"],
  [/\b(?:facilit(?:y|ies)|maintenance|repairs?|complaints?)\b/i, "facility"],
  [/\bparking\b/i, "parking"],
  [/\b(?:hr\s+quer(?:y|ies)|quer(?:y|ies)|questions?)\b/i, "query"],
  [/\bescalations?\b/i, "escalation"],
  [/\bgrievances?\b/i, "grievance"],
  [/\b(?:documents?|letters?|certificates?|noc|relieving|payslips?)\b/i, "document"],
  [/\b(?:forms?|submissions?)\b/i, "form"],
];

function parseRequestsFilter(text: string): RequestsFilter | null {
  const t = text.trim();

  // Pure action intents (apply / submit / cancel a NEW request) belong to the backend,
  // not the list filter — unless clearly a view/lookup phrasing.
  const isViewIntent =
    /\b(find|show|see|view|list|filter|display|pull\s+up|get|how\s+many|count|all|my|track|history|records?|status)\b/i.test(
      t,
    );
  const isActionIntent = /\b(apply|submit|file|raise|create|new|cancel|withdraw|book|reserve)\b/i.test(t);
  if (isActionIntent && !/\b(show|find|list|view|filter|see|display|records?|history|status|all\s+my)\b/i.test(t))
    return null;

  // Request type
  let type = "all";
  for (const [re, key] of _REQUEST_TYPE_PATTERNS) {
    if (re.test(t)) {
      type = key;
      break;
    }
  }

  // Status
  let status: RequestsFilter["status"] = "all";
  if (/\b(pending|open|waiting|submitted|awaiting|unresolved|not\s+yet)\b/i.test(t)) status = "open";
  else if (/\b(approved|done|completed|resolved|closed|finished|processed|cancelled|rejected)\b/i.test(t))
    status = "closed";
  else if (/\b(in[- ]?progress|processing|under\s+review|in\s+review|acknowledged|active)\b/i.test(t))
    status = "in-progress";

  // Date range — "this month", "last month", "June", "June 2026", "in 2025".
  let dateFrom: string | undefined;
  let dateTo: string | undefined;
  let rangeLabel: string | undefined;
  const monthRange = (year: number, monthIdx: number) => {
    const mm = String(monthIdx + 1).padStart(2, "0");
    const lastDay = new Date(year, monthIdx + 1, 0).getDate();
    dateFrom = `${year}-${mm}-01`;
    dateTo = `${year}-${mm}-${String(lastDay).padStart(2, "0")}`;
    rangeLabel = `${_MONTH_NAMES[monthIdx]} ${year}`;
  };
  const now = new Date();
  if (/\bthis\s+month\b/i.test(t)) {
    monthRange(now.getFullYear(), now.getMonth());
  } else if (/\blast\s+month\b/i.test(t)) {
    const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    monthRange(d.getFullYear(), d.getMonth());
  } else {
    const monthM = t.match(
      /\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i,
    );
    const yearM = t.match(/\b(20\d{2})\b/);
    if (monthM) {
      const monthIdx = _MONTHS[monthM[1].toLowerCase().slice(0, 3)];
      // Infer year: explicit if given, else current year — or last year if the month is still
      // ahead of us this year (records are historical, so a future month means last year).
      const year = yearM
        ? parseInt(yearM[1], 10)
        : monthIdx > now.getMonth()
          ? now.getFullYear() - 1
          : now.getFullYear();
      monthRange(year, monthIdx);
    } else if (yearM) {
      const y = parseInt(yearM[1], 10);
      dateFrom = `${y}-01-01`;
      dateTo = `${y}-12-31`;
      rangeLabel = `${y}`;
    }
  }

  // Require at least one concrete dimension, and a view-style phrasing.
  if (type === "all" && status === "all" && !dateFrom && !isViewIntent) return null;
  if (type === "all" && status === "all" && !dateFrom) return null;

  return { type, status, dateFrom, dateTo, rangeLabel };
}

// ── Access Management filter parsing ─────────────────────────────────────────
// When the copilot sidebar is open on the Access Management tab, a role-filter query
// ("who has super admin access") drives the users list instead of going to the backend.
// Deterministic, zero-LLM, strictly scoped to /control-hub/role-control by the caller.
export interface AccessFilter {
  panel: "users" | "roles";
  role?: string; // normalised role slug to filter users by, e.g. "super admin"
}

// Fallback used only before the live roles list loads.
const _FALLBACK_ROLES = ["super admin", "admin", "hr", "it", "pmo", "functional manager", "employee"];

function parseAccessFilter(text: string, roles: string[]): AccessFilter | null {
  const lower = text.trim().toLowerCase();

  // Match against the live roles list (slugs and names, longest first to avoid
  // "admin" matching before "super admin").
  const sorted = [...roles].sort((a, b) => b.length - a.length);
  const matchedRole = sorted.find((r) => lower.includes(r.toLowerCase()));
  if (!matchedRole) return null;

  // Capability/portal questions → navigate to Roles tab and select the role.
  // The role's capability matrix is already shown there; no need to hit the LLM.
  const isCapabilityQuestion =
    /\b(what|which)\b.{0,60}\b(portal|capabilit|feature|permission|can|do|have|access)\b/i.test(lower) ||
    /\b(portal|capabilit|feature|permission)\b.{0,40}\b(hr|it|pmo|admin|employee|manager|role)\b/i.test(lower) ||
    /\b(can|does|do)\b.{0,20}\b(role|access|see|use|do)\b/i.test(lower);
  if (isCapabilityQuestion) return { panel: "roles", role: matchedRole };

  // Explicit people-listing queries → filter Users tab.
  const isUserLookup =
    /\bwho\s+(has|have|is|are)\b/i.test(lower) ||
    /\b(list|show|find|filter)\b.{0,30}\b(users?|people|members?|employees?)\b/i.test(lower) ||
    /\b(users?|people|members?|employees?)\b.{0,20}\b(with|having|assigned)\b/i.test(lower);
  if (isUserLookup) return { panel: "users", role: matchedRole };

  return null;
}

// ── Role-gate definitions ────────────────────────────────────────────────────
// Checked before any intercept fires. If the user's role isn't in `allowed`,
// the assistant returns a friendly denial instead of routing to the LLM.
const ROLE_GATES: Array<{ re: RegExp; allowed: string[]; denial: string }> = [
  {
    re: /\b(hr\s+portal|hr\s+(?:admin|tools?|dashboard|management)|manage\s+(?:all\s+)?employees|employee\s+management)\b/i,
    allowed: ["hr"],
    denial:
      "The HR Portal is only available to the HR team. If you have an HR-related question, just ask and I'll help.",
  },
  {
    re: /\b(admin\s+portal|admin\s+(?:panel|tools?|dashboard|settings))\b/i,
    allowed: ["admin", "super admin"],
    denial: "The Admin Portal is only accessible to Admin and Super Admin roles.",
  },
  {
    re: /\b(it\s+portal|it\s+(?:admin|dashboard|tools?)|manage\s+(?:support\s+)?tickets|it\s+admin)\b/i,
    allowed: ["it", "super admin"],
    denial: "The IT Portal is only available to the IT team.",
  },
  {
    re: /\b(pmo\s+portal|pmo\s+(?:admin|dashboard|tools?))\b/i,
    allowed: ["pmo", "super admin"],
    denial: "The PMO Portal is only available to the PMO team.",
  },
  {
    re: /\b(llm\s+controls?|model\s+controls?|ai\s+model\s+settings|configure\s+(?:ai|llm)\s+models?)\b/i,
    allowed: ["super admin"],
    denial: "LLM Controls are reserved for Super Admin only.",
  },
  {
    re: /\b(manager\s+portal|manage\s+(?:my\s+)?team'?s?\s+(?:leaves?|attendance|requests?)|approve\s+(?:team|my\s+team'?s?)\s+(?:leave|request))\b/i,
    allowed: ["hr", "it", "pmo", "admin", "functional manager", "rm", "super admin"],
    denial: "Manager features are only available to team managers and above.",
  },
];

// ── Document types the catalogue supports ────────────────────────────────────
const DOC_TYPE_RE =
  /\b(?:noc|no[- ]?objection(?:\s+cert(?:ificate)?)?|experience\s+cert(?:ificate)?|employment\s+verif(?:ication)?|address\s+proof|relieving\s+letter|internship\s+cert(?:ificate)?|recommendation\s+letter|travel\s+support(?:\s+letter)?|project\s+proposal)\b/i;
const DOC_GEN_RE =
  /\b(?:generate|create|make|draft|prepare|issue)\b.{0,60}\b(?:letter|certificate|document)\b/i;

// Placeholder turn left when the user navigates away while their request is still
// waiting in the server queue (pre-first-token). The generation keeps running
// server-side; the pickup effect below swaps this for the finished answer, and the
// nudge bell notifies when it's ready. The prefix doubles as the detection marker.
const BG_PENDING_PREFIX = "⏳ Still working on this in the background";
const BG_PENDING_TEXT =
  `${BG_PENDING_PREFIX} — you left while it was waiting in line. ` +
  "You'll get a bell notification when it's ready, and the answer will appear here when you come back.";

// ── My-requests navigation ────────────────────────────────────────────────────
const MY_REQUESTS_VIEW_RE =
  /\b(?:show|see|view|check|open|list|find|what(?:'s|\s+are)?)\b.{0,30}\bmy\b.{0,30}\b(?:requests?|leave\s+(?:requests?|history|applications?)|it\s+tickets?|support\s+tickets?|travel\s+(?:requests?|history)|expense\s+claims?|escalations?|applications?|submissions?|documents?)\b/i;

const TOP_PROMPTS_POOL = [
  "What's my leave balance?",
  "Apply for casual leave next Monday",
  "Cancel my leave on the 14th",
  "What are the holidays this month?",
  "What's next in my onboarding?",
  "What's the maternity leave policy?",
  "How do I claim travel expenses?",
  "Who is the manager for Project Aurora?",
  "Show me my payslip for last month",
];

export function AssistantView({ isCopilot = false, portalContext }: { isCopilot?: boolean; portalContext?: string }) {
  const {
    threads,
    activeId,
    thinkingThreads,
    setActiveId,
    setThinking,
    addTurn,
    updateLastAITurn,
    createThread,
  } = useChatStore();
  // The active chat is "thinking" only if it is the thread currently generating a response
  // (pre-first-token phase — drives the ThinkingBuddy bubble).
  const thinking = activeId ? !!thinkingThreads[activeId] : false;
  // "busy" stays true for the whole in-flight response (thinking OR tokens still streaming),
  // so the Stop button and input lock persist until the active chat's reply completes.
  const activeTurnsForBusy = (activeId && threads[activeId]?.turns) || [];
  const lastActiveTurn = activeTurnsForBusy[activeTurnsForBusy.length - 1];
  const busy = thinking || (lastActiveTurn?.role === "ai" && lastActiveTurn.streaming === true);
  const { theme } = useSettings();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [input, setInput] = useState("");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // URL Library links — pre-fetched once so the leave intercept can resolve a Zoho URL synchronously.
  const urlLinksRef = useRef<
    { name: string; url: string; purpose?: string; trigger_keywords?: string }[]
  >([]);
  const formsRef = useRef<
    {
      id: number;
      name: string;
      description: string;
      fields: DynamicFormField[];
      trigger_keywords?: string;
    }[]
  >([]);
  // Last form created/edited via the assistant this session — lets follow-up edit requests
  // ("add a phone field", "make email required") target it without the admin naming it.
  const lastFormRef = useRef<{ id: number; name: string } | null>(null);
  const [showDocModal, setShowDocModal] = useState(false);
  const [docType, setDocType] = useState("project_status_report");
  const [docTitle, setDocTitle] = useState("");
  const [isGeneratingDoc, setIsGeneratingDoc] = useState(false);

  const { queries, addQuery } = useQuickQueries();
  const [savePromptOpen, setSavePromptOpen] = useState(false);
  const [promptToSave, setPromptToSave] = useState("");
  const [promptLabel, setPromptLabel] = useState("");
  const [promptCategory, setPromptCategory] = useState<"it" | "admin" | "hr">("it");

  // Live role slugs for the Access Management intercept — fetched once when the
  // user opens the access management portal context so custom roles are included.
  const [accessRoles, setAccessRoles] = useState<string[]>(_FALLBACK_ROLES);

  const [topPrompts, setTopPrompts] = useState<string[]>([]);

  useEffect(() => {
    // Simulate fetching most used prompts that change over time based on data
    const fetchTopPrompts = () => {
      const shuffled = [...TOP_PROMPTS_POOL].sort(() => 0.5 - Math.random());
      setTopPrompts(shuffled.slice(0, 3));
    };
    fetchTopPrompts();
    const interval = setInterval(fetchTopPrompts, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleOpenSavePrompt = (text: string) => {
    setPromptToSave(text);
    setPromptLabel(text.slice(0, 30));
    setPromptCategory("it");
    setSavePromptOpen(true);
  };

  const handleSavePrompt = () => {
    if (!promptLabel.trim() || !promptToSave.trim()) return;
    addQuery(promptLabel.trim(), promptToSave.trim(), promptCategory);
    setSavePromptOpen(false);
    toast.success("Saved to your quick searches!");
  };
  const [activity, setActivity] = useState("");
  const [activeMode, setActiveMode] = useState<ModeKey | null>(null);
  const [transitionState, setTransitionState] = useState<{
    active: boolean;
    targetMode: ModeKey | null;
  } | null>(null);

  const changeModeWithAnimation = useCallback((newMode: ModeKey | null) => {
    if (newMode === activeMode) return;
    setTransitionState({ active: true, targetMode: newMode });
    window.setTimeout(() => {
      setActiveMode(newMode);
    }, 450);
    window.setTimeout(() => {
      setTransitionState(null);
    }, 950);
  }, [activeMode]);
  // Proactive load awareness: warn (but never block) when the shared LLM server
  // has no free slots. `serverBusy` is independent of the per-thread `busy` above.
  const { serverBusy, waiting } = useServerLoad();
  const [loadBannerDismissed, setLoadBannerDismissed] = useState(false);
  // Re-arm the banner each time the server transitions back to "busy".
  useEffect(() => {
    if (!serverBusy) setLoadBannerDismissed(false);
  }, [serverBusy]);

  // Pre-fetch URL Library links and Forms once (fail-soft) for chat intercepts.
  useEffect(() => {
    if (!user?.email) return;
    const headers = {
      "x-user-email": user.email,
      "x-user-role": (user.role || "employee").toLowerCase(),
    };
    fetch("/api/links", { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) urlLinksRef.current = data;
      })
      .catch(() => { });
    fetch("/api/forms/list", { headers })
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (Array.isArray(data)) formsRef.current = data;
      })
      .catch(() => { });
    // Role-aware "what can you do" starters + live signals for the empty state.
    fetch("/api/capabilities", { headers })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.starters)) {
          setCaps({ starters: data.starters, live: Array.isArray(data.live) ? data.live : [] });
        }
      })
      .catch(() => { });
  }, [user?.email, user?.role]);

  // Fetch live roles when the copilot opens on the Access Management page so
  // custom roles created through the UI are recognised by parseAccessFilter.
  useEffect(() => {
    if (portalContext !== "/control-hub/role-control" || !user?.email) return;
    fetch("/api/access/roles", {
      headers: { "x-user-email": user.email, "x-user-role": user.role ?? "super admin" },
    })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: Array<{ slug: string; name: string }> | null) => {
        if (Array.isArray(data) && data.length > 0) {
          // Include both slug ("super admin") and name ("Super Admin") so either matches.
          const roleStrings = data.flatMap((r) =>
            r.slug === r.name.toLowerCase() ? [r.slug] : [r.slug, r.name.toLowerCase()],
          );
          setAccessRoles(roleStrings);
        }
      })
      .catch(() => { });
  }, [portalContext, user?.email, user?.role]);

  // Open a form from the announcement banner image click.
  useEffect(() => {
    return subscribeFormTrigger((detail) => {
      const tid = activeId;
      if (!tid) return;
      addTurn(tid, {
        role: "ai",
        text: detail.description || `Here is the ${detail.name} form:`,
        interactive: {
          type: "dynamic_form",
          data: {
            template_id: detail.formId,
            name: detail.name,
            description: detail.description,
            fields: detail.fields,
            submit_endpoint: detail.submitEndpoint,
          },
        },
      });
    });
  }, [activeId, addTurn]);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [starterPage, setStarterPage] = useState(0);
  // Role-aware capability discovery for the empty state (fail-soft; falls back
  // to local quick-queries if unavailable). `live` carries pending signals.
  const [caps, setCaps] = useState<{
    starters: { title: string; prompt: string }[];
    live: { title: string; prompt: string }[];
  } | null>(null);

  // Hands-free voice mode ("Jarvis")
  const { voiceMode, voiceState, setVoiceState, setLiveTranscript } = useVoiceStore();
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalTranscriptRef = useRef("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // In-flight request control, keyed by thread id, so each chat can be stopped
  // independently and a stopped abort isn't mistaken for a timeout.
  const controllersRef = useRef<Map<string, AbortController>>(new Map());
  const stoppedRef = useRef<Set<string>>(new Set());
  // Threads whose abort came from navigating away (unmount) rather than the Stop
  // button — those leave a "still working in the background" placeholder instead
  // of "Response stopped." (the server finishes the answer and nudges the user).
  const backgroundRef = useRef<Set<string>>(new Set());
  // The copilot sidebar keeps streaming in the background if it's closed mid-response —
  // the fetch has no consumer left, but nothing told it to stop. Abort every in-flight
  // request this instance owns on unmount (sidebar close, portal navigation away, etc.)
  // so closing/cancelling actually pauses the response instead of letting it run to
  // completion unseen.
  useEffect(() => {
    return () => {
      controllersRef.current.forEach((controller, threadId) => {
        stoppedRef.current.add(threadId);
        backgroundRef.current.add(threadId);
        controller.abort();
        setThinking(threadId, false);
      });
    };
  }, [setThinking]);
  // Pickup for background-completed answers: while the active thread's last turn
  // is the "still working in the background" placeholder, poll the server (which
  // kept generating after we disconnected and stores the result for 24h) and swap
  // the placeholder for the real answer as soon as it's ready.
  useEffect(() => {
    if (!activeId) return;
    const thread = threads[activeId];
    const last = thread?.turns[thread.turns.length - 1];
    if (!last || last.role !== "ai" || !last.text?.startsWith(BG_PENDING_PREFIX)) return;
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch(`/api/chat/background-answer/${encodeURIComponent(activeId)}`, {
          headers: { ...(user?.email ? { "x-user-email": user.email } : {}) },
        });
        if (!res.ok || cancelled) return;
        const d = await res.json();
        if (d.ready && d.answer && !cancelled) {
          updateLastAITurn(activeId, {
            text: d.answer as string,
            domain: (d.domain as string) ?? undefined,
            streaming: false,
          });
        }
      } catch {
        /* still pending — next poll will retry */
      }
    };
    check();
    const id = setInterval(check, 15000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [activeId, threads, updateLastAITurn, user?.email]);
  // Set right before a recursive send() re-run so the /directory intercept below skips
  // itself once (the query already failed both the regex and LLM-SQL fallback) and falls
  // through to the general backend agent instead of looping.
  const directoryLlmBypassRef = useRef(false);
  // True once any directory filter has been applied this session — lets the confirmation
  // message say "Added ..." for a follow-up turn instead of "Filtering by ..." as if it
  // replaced everything, since turns now merge (see EmployeeDirectory's event handlers).
  // Reset when the grid's own "Clear" is clicked or the sidebar leaves /directory.
  const dirHasActiveFilterRef = useRef(false);
  // Guards against duplicate submissions of the *same* text fired in quick succession —
  // e.g. the directory grid's re-render (many avatar images + backdrop-blur cards) can
  // freeze the main thread long enough that a user's repeated clicks/Enters all queue up
  // reading the still-uncleared `input` state, each triggering its own send() once the
  // thread frees up. A short cooldown on identical text collapses those into one send.
  const lastSendRef = useRef<{ text: string; at: number } | null>(null);

  // Forget the accumulated directory-filter context whenever the grid's "Clear" button
  // fires (EmployeeDirectory dispatches this) or the copilot leaves /directory — otherwise
  // the next filter turn on a fresh search would still say "Added ..." as if refining
  // something the user just wiped.
  useEffect(() => {
    const reset = () => {
      dirHasActiveFilterRef.current = false;
    };
    window.addEventListener("centriq:directory-filter-reset", reset);
    return () => window.removeEventListener("centriq:directory-filter-reset", reset);
  }, []);
  useEffect(() => {
    if (portalContext !== "/directory") dirHasActiveFilterRef.current = false;
  }, [portalContext]);

  // Create a thread whenever there is no active one
  useEffect(() => {
    if (!activeId) {
      createThread();
    }
  }, [activeId, createThread]);

  // Start a fresh thread whenever the user's role changes (prevents previous-role
  // AI responses — which may reference other users' names from seeded data — from
  // persisting visibly across role switches).
  const prevRoleRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (prevRoleRef.current !== undefined && prevRoleRef.current !== user?.role) {
      createThread();
    }
    prevRoleRef.current = user?.role;
  }, [user?.role, createThread]);

  // Clear suggestion chips whenever the active thread changes
  useEffect(() => {
    setSuggestions([]);
  }, [activeId]);

  // Cycle starter prompts every 4s on empty state
  const STARTER_PAGE_SIZE = 3;
  const starterTotal = Math.ceil(queries.length / STARTER_PAGE_SIZE);
  useEffect(() => {
    const id = setInterval(() => setStarterPage((p) => (p + 1) % starterTotal), 4000);
    return () => clearInterval(id);
  }, [starterTotal]);

  // Listen for quick-action events from CommandPalette
  useEffect(() => {
    const handler = (e: CustomEvent<{ prompt: string }>) => {
      if (e.detail?.prompt) {
        send(e.detail.prompt);
      }
    };
    window.addEventListener("centriq:quick-action", handler as EventListener);
    return () => window.removeEventListener("centriq:quick-action", handler as EventListener);
  }, [activeId, threads]);

  const activeThread = activeId && threads[activeId] ? threads[activeId] : { id: "", turns: [] };

  // The newest unanswered quick-choice — rendered as a panel docked above the composer
  // (Claude-style) instead of a card buried in the message stream. Once the user replies,
  // the turn is no longer last and the options collapse back into the history bubble.
  const lastTurn =
    activeThread.turns.length > 0 ? activeThread.turns[activeThread.turns.length - 1] : undefined;
  const pendingChoice =
    lastTurn?.role === "ai" &&
      lastTurn.interactive?.type === "quick_choice" &&
      lastTurn.interactive.data
      ? (lastTurn.interactive.data as import("@/lib/chat-store").QuickChoiceData)
      : null;

  // Scroll handling
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [activeThread.turns.length, thinking]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    setShowScrollBtn(scrollHeight - scrollTop - clientHeight > 100);
  }, []);

  // Parse room-booking entities from a natural-language message (no LLM)
  function parseRoomBooking(text: string) {
    const lower = text.toLowerCase();

    // Date: "tomorrow" / "today"
    let date: string | undefined;
    const localISO = (offsetDays = 0) => {
      const d = new Date();
      d.setDate(d.getDate() + offsetDays);
      return [
        d.getFullYear(),
        String(d.getMonth() + 1).padStart(2, "0"),
        String(d.getDate()).padStart(2, "0"),
      ].join("-");
    };
    if (/\btomorrow\b/.test(lower)) date = localISO(1);
    else if (/\btoday\b/.test(lower)) date = localISO(0);

    // Time range: "10 am to 11 am", "10:30am-11:30am", "10 to 11 pm"
    let startTime: string | undefined;
    let endTime: string | undefined;
    const to24 = (h: number, m: number, p: string) => {
      let hr = h;
      if (p.toLowerCase() === "pm" && h !== 12) hr = h + 12;
      if (p.toLowerCase() === "am" && h === 12) hr = 0;
      return `${String(hr).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    };
    const tRe =
      /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:to|-)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i;
    const tm = text.match(tRe);
    if (tm) {
      const p2 = tm[6];
      const p1 = tm[3] ?? p2;
      startTime = to24(parseInt(tm[1]), parseInt(tm[2] ?? "0"), p1);
      endTime = to24(parseInt(tm[4]), parseInt(tm[5] ?? "0"), p2);
    }

    // If a time was parsed but no date keyword found, default to today
    if (startTime && !date) date = localISO(0);

    // Room hint: words after "book"/"reserve" before a preposition/date word
    let roomHint: string | undefined;
    const rRe =
      /\b(?:book|reserve)(?:ing)?\s+([\w\s]+?)\s+(?:for\b|on\b|at\b|from\b|tomorrow\b|today\b|\d)/i;
    const rm = text.match(rRe);
    if (rm) roomHint = rm[1].trim();

    // Title: explicit "titled"/"called" keyword takes priority
    let title: string | undefined;
    const titRe =
      /\b(?:title(?:d)?|called)\s+([^\n]+?)(?:\s+(?:no\s+attendees?|with(?:\s+no)?\s+attendees?|attendees?\s*(?:needed)?)\b.*)?$/i;
    const tit = text.match(titRe);
    if (tit)
      title = tit[1]
        .trim()
        .replace(/\s+(?:no\s+attendees?|attendees?\s*(?:needed)?).*$/i, "")
        .trim();

    // Fallback: extract purpose from "for [Purpose] from/at/between/on ..."
    // e.g. "book salween room for Interview from 4 am to 4:30 am"
    if (!title) {
      const purposeRe =
        /\bfor\s+([\w][\w\s]{0,40}?)\s+(?:from\b|at\b|between\b|on\b|tomorrow\b|today\b|\d)/i;
      const pm2 = text.match(purposeRe);
      if (pm2) {
        const candidate = pm2[1].trim();
        // Exclude generic room-type words that belong to the room hint
        if (!/\b(?:room|conf|conference|cabin|hall)\b/i.test(candidate)) {
          title = candidate;
        }
      }
    }

    // Default title to empty string (not undefined) so autoBookMode can trigger;
    // the booking call will fall back to "Meeting" if the title is empty.
    if (title === undefined) title = "";

    // Attendees: explicit "no attendees" → empty string
    let attendees: string | undefined;
    if (/\bno\s+attendees?\b/.test(lower) || /\battendees?\s+(?:not\s+)?needed\b/.test(lower))
      attendees = "";

    return { date, startTime, endTime, roomHint, title, attendees };
  }

  // Parse an announcement command (no LLM). Structural — keyword for the
  // domain, topic after "about/titled/saying", remainder becomes the body.
  function parseAnnouncement(text: string) {
    const lower = text.toLowerCase();
    const DOMAIN_KW: Record<string, string> = {
      hr: "hr",
      "human resource": "hr",
      it: "it_support",
      "it support": "it_support",
      tech: "it_support",
      pmo: "pmo",
      project: "pmo",
      admin: "admin",
      facilit: "admin",
      office: "admin",
    };
    let domain: string | undefined;
    let category: string | undefined;
    for (const [kw, dom] of Object.entries(DOMAIN_KW)) {
      if (lower.includes(kw)) {
        domain = dom;
        break;
      }
    }
    if (/\bholiday\b/.test(lower)) category = "Holiday";
    else if (/\bpolicy\b/.test(lower)) category = "Policy Update";
    else if (/\bhiring\b|\bjob\b/.test(lower)) category = "Hiring";
    else if (/\btraining\b/.test(lower)) category = "Training";
    else if (/\bevent\b/.test(lower)) category = "Events";

    let title: string | undefined;
    const m = text.match(/\b(?:about|titled|called|saying|regarding|on)\s+(.+)$/i);
    if (m) title = m[1].trim().replace(/[.?!]+$/, "");
    return { title, category, domain } as { title?: string; category?: string; domain?: string };
  }

  // Parse a prompt-config command (no LLM). Domain keyword + section + value.
  function parsePromptConfig(text: string) {
    const lower = text.toLowerCase();
    const DOMAIN_KW: Record<string, string> = {
      hr: "hr",
      "human resource": "hr",
      "it support": "it_support",
      it: "it_support",
      pmo: "pmo",
      project: "pmo",
      admin: "admin",
      manager: "functional_manager",
    };
    let domain: string | undefined;
    for (const [kw, dom] of Object.entries(DOMAIN_KW)) {
      if (lower.includes(kw)) {
        domain = dom;
        break;
      }
    }
    const promptKey = /\bguardrail\b/.test(lower) ? "guardrail" : "system_prompt";
    let value: string | undefined;
    const m = text.match(/\b(?:to|say(?:ing)?|that|with)\s+(.+)$/i);
    if (m) value = m[1].trim();
    return { domain, promptKey, value } as { domain?: string; promptKey?: string; value?: string };
  }

  const scrollToBottom = () => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  };

  const send = useCallback(
    (override?: string) => {
      let text = (override ?? input).trim();
      if (!text || !activeId) return;

      const now = Date.now();
      if (lastSendRef.current && lastSendRef.current.text === text && now - lastSendRef.current.at < 800) {
        return;
      }
      lastSendRef.current = { text, at: now };

      // ── "/exit <question>" — a focus-mode agent decided this turn wasn't actually
      // for its mode (e.g. a policy question asked while in Analytics Builder) and
      // asked the user to confirm leaving the mode to get a real answer. Clicking
      // "Yes" sends this token: turn the mode off and re-send the question as a
      // normal message, in one step. `activeMode` (component state) won't reflect
      // the change until next render, so `effectiveMode` below carries the override
      // through the rest of this call.
      let effectiveMode: ModeKey | null = activeMode;
      if (activeMode) {
        const exitAndAsk = /^\/exit\s+(.+)/is.exec(text);
        if (exitAndAsk) {
          text = exitAndAsk[1].trim();
          setActiveMode(null);
          effectiveMode = null;
        }
      }

      // ── Mode command detection ─────────────────────────────────────────────
      // On an empty thread we skip the chat-turn confirmation entirely — the mode
      // banner plus the empty-state heading/cards already say "mode on", and adding
      // turns here would make the thread non-empty, hiding that empty-state UI before
      // it ever renders. Mid-conversation switches still get an inline confirmation.
      const modeCmd = parseModeCommand(text);
      const threadIsEmpty = activeThread.turns.length === 0;
      if (modeCmd === "exit") {
        if (activeMode) {
          changeModeWithAnimation(null);
          if (!threadIsEmpty) {
            addTurn(activeId, { role: "user", text });
            addTurn(activeId, {
              role: "ai",
              text: `**${CHAT_MODES[activeMode].label}** mode off. Back to general assistant.`,
            });
          }
        } else {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, { role: "ai", text: "No active mode to exit." });
        }
        setInput("");
        return;
      }
      if (modeCmd) {
        const mode = CHAT_MODES[modeCmd];
        changeModeWithAnimation(modeCmd);
        if (!threadIsEmpty) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: `**${mode.label}** mode on. I'll focus on ${mode.description.toLowerCase()}.${
              modeCmd === "me"
                ? "\n\n🔒 This is your private space — nothing here is logged or traced in AI observability."
                : ""
            }\n\nType \`/exit\` to return to general mode.`,
          });
        }
        setInput("");
        return;
      }

      // ── Role-gate: block portal/admin access for unauthorised roles ────────
      const role = (user?.role || "employee").toLowerCase();
      const gateHit = ROLE_GATES.find((g) => g.re.test(text) && !g.allowed.includes(role));
      if (gateHit) {
        addTurn(activeId, { role: "user", text });
        addTurn(activeId, { role: "ai", text: gateHit.denial });
        setInput("");
        return;
      }

      // ── Portal-scoped intercept: Employee Directory filter ────────────────────
      // When the copilot sidebar is open on /directory, a filter-style query drives the
      // visible grid via a CustomEvent (same pattern as My Requests) — deterministic and
      // instant, no backend round-trip, for the phrasings the regex parser recognizes.
      // Strictly scoped to /directory so it can't hijack other portals. If the regex finds
      // no filterable dimension, we ask the backend's LLM-over-SQL fallback (real SQL over
      // the composed directory handles arbitrary skill/project lists + ranges the regex
      // can't) before finally letting genuinely non-filter queries fall through to the
      // general backend agent below. `directoryLlmBypassRef` prevents that final fallthrough
      // from re-entering this block and looping.
      if (!activeMode && portalContext === "/directory") {
        if (directoryLlmBypassRef.current) {
          directoryLlmBypassRef.current = false;
        } else {
          const dirFilter = parseDirectoryFilter(text);
          if (dirFilter) {
            addTurn(activeId, { role: "user", text });
            const parts = [
              dirFilter.designation ? `**${dirFilter.designation}**` : null,
              dirFilter.certified && dirFilter.skills?.length
                ? `**${dirFilter.skills.join(", ")}**-certified`
                : dirFilter.skills?.length
                  ? `**${dirFilter.skills.join(", ")}**`
                  : dirFilter.certified
                    ? "certified"
                    : null,
              dirFilter.skillConstraints?.length
                ? dirFilter.skillConstraints
                    .map((sc) =>
                      sc.minYears !== undefined && sc.maxYears !== undefined
                        ? `**${sc.skill}** (${sc.minYears}-${sc.maxYears}y)`
                        : sc.minYears !== undefined
                          ? `**${sc.skill}** (${sc.minYears}+y)`
                          : `**${sc.skill}** (<${sc.maxYears}y)`,
                    )
                    .join(", ")
                : null,
              dirFilter.minYears !== undefined || dirFilter.maxYears !== undefined
                ? dirFilter.minYears !== undefined && dirFilter.maxYears !== undefined
                  ? `${dirFilter.minYears}-${dirFilter.maxYears} years' experience`
                  : dirFilter.minYears !== undefined
                    ? `${dirFilter.minYears}+ years' experience`
                    : `under ${dirFilter.maxYears} years' experience`
                : null,
              dirFilter.usedWithinMonths !== undefined
                ? `used in the last ${dirFilter.usedWithinMonths} month${dirFilter.usedWithinMonths === 1 ? "" : "s"}`
                : null,
              dirFilter.projects?.length
                ? dirFilter.projects.length > 1
                  ? `${dirFilter.projectMode === "and" ? "all of" : "any of"} projects **${dirFilter.projects.join(", ")}**`
                  : `project **${dirFilter.projects.join(", ")}**`
                : null,
              dirFilter.minAvailabilityPercent !== undefined
                ? `at least ${dirFilter.minAvailabilityPercent}% free`
                : dirFilter.available
                  ? "currently **available**"
                  : null,
              dirFilter.department ? `in **${dirFilter.department}**` : null,
            ].filter(Boolean);
            const isFollowUp = dirHasActiveFilterRef.current;
            addTurn(activeId, {
              role: "ai",
              text: parts.length
                ? isFollowUp
                  ? `Added ${parts.join(" · ")} to your search. Tweak or clear the filters from the directory header anytime.`
                  : `Filtering the directory by ${parts.join(" · ")}. Tweak or clear the filters from the directory header anytime.`
                : `Filtering the directory. Tweak or clear the filters from the directory header anytime.`,
            });
            dirHasActiveFilterRef.current = true;
            setInput("");
            window.dispatchEvent(new CustomEvent("centriq:directory-filter", { detail: dirFilter }));
            return;
          }

          // Regex found nothing filterable — try the SQL-over-LLM fallback so odd
          // phrasing still works. Nothing is echoed to the thread until we know whether
          // this query is actually a filter, so a no-match can safely recurse below.
          fetch("/api/employees/directory/query", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...(user?.email ? { "x-user-email": user.email } : {}),
              ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
            },
            body: JSON.stringify({ query: text }),
          })
            .then((r) => (r.ok ? r.json() : { matched: false }))
            .then((result: { matched?: boolean; employee_codes?: string[]; summary?: string }) => {
              if (result?.matched) {
                addTurn(activeId, { role: "user", text });
                const isFollowUp = dirHasActiveFilterRef.current;
                addTurn(activeId, {
                  role: "ai",
                  text: isFollowUp
                    ? `Narrowed down to **${result.summary}**. Tweak or clear the filters from the directory header anytime.`
                    : `Filtering the directory by **${result.summary}**. Tweak or clear the filters from the directory header anytime.`,
                });
                dirHasActiveFilterRef.current = true;
                setInput("");
                window.dispatchEvent(
                  new CustomEvent("centriq:directory-query-result", {
                    detail: { employeeCodes: result.employee_codes ?? [], summary: result.summary },
                  }),
                );
              } else {
                directoryLlmBypassRef.current = true;
                sendRef.current(text);
              }
            })
            .catch(() => {
              directoryLlmBypassRef.current = true;
              sendRef.current(text);
            });
          return;
        }
      }

      // ── Portal-scoped intercept: My Requests filter ───────────────────────────
      // When the copilot sidebar is open on /my-requests, a filter/lookup query drives the
      // requests list (type · status · date range) via a CustomEvent — deterministic, instant.
      // Non-filter queries fall through to the backend agent below.
      if (!activeMode && portalContext === "/my-requests") {
        const reqFilter = parseRequestsFilter(text);
        if (reqFilter) {
          addTurn(activeId, { role: "user", text });
          const typeLabel: Record<string, string> = {
            all: "all requests",
            leave: "leave requests",
            travel_request: "travel requests",
            travel_expense: "travel expenses",
            expense: "expense claims",
            udemy: "Udemy licenses",
            facility: "facility issues",
            parking: "parking permits",
            query: "HR queries",
            escalation: "escalations",
            grievance: "grievances",
            document: "documents",
            form: "form submissions",
          };
          const parts = [
            typeLabel[reqFilter.type] ?? reqFilter.type,
            reqFilter.status !== "all" ? reqFilter.status.replace("-", " ") : null,
            reqFilter.rangeLabel ? `in ${reqFilter.rangeLabel}` : null,
          ].filter(Boolean);
          addTurn(activeId, {
            role: "ai",
            text: `Filtering your ${parts.join(" · ")}. Adjust or clear the filters from the page header anytime.`,
          });
          setInput("");
          window.dispatchEvent(
            new CustomEvent("centriq:requests-filter", { detail: reqFilter }),
          );
          return;
        }
      }

      // ── Portal-scoped intercept: Access Management navigation ────────────────────
      // Capability questions → select the role in the Roles tab (matrix already shown there).
      // User-listing questions → filter the Users tab by role.
      // No backend round-trip needed for either.
      if (!activeMode && portalContext === "/control-hub/role-control") {
        const accessFilter = parseAccessFilter(text, accessRoles);
        if (accessFilter) {
          addTurn(activeId, { role: "user", text });
          const aiText = accessFilter.panel === "roles"
            ? `Opening the **${accessFilter.role}** role in the Roles tab — its portals, modes, and features are shown there.`
            : `Filtering the Users list to show users with the **${accessFilter.role ?? "selected"}** role. Click the filter chip to clear it.`;
          addTurn(activeId, { role: "ai", text: aiText });
          setInput("");
          window.dispatchEvent(
            new CustomEvent("centriq:access-filter", { detail: accessFilter }),
          );
          return;
        }
      }

      // ── Local heuristic routing (doc-gen, forms, leave, travel, URL/form library…) ──
      // Skipped entirely while a focus mode is active, OR when the copilot sidebar is open
      // inside a specific portal (portalContext set). In both cases the user is working within
      // a scoped context, so every message goes straight to the backend — generic interceptors
      // like "years of experience" or "skills" must not hijack portal-specific queries.
      if (!activeMode && !portalContext) {
        // ── Document generation navigation ─────────────────────────────────────
        const isDocGen =
          (DOC_TYPE_RE.test(text) || DOC_GEN_RE.test(text)) &&
          /\b(?:generate|create|make|draft|prepare|issue|get|need|want|request)\b/i.test(text) &&
          !/\b(?:expense|claim|reimburse)\b/i.test(text);
        if (isDocGen) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Zoho People handles document generation. Pick your template and fill it in below — you'll generate, download, or e-sign it directly in Zoho.",
            interactive: { type: "document_generation_form" },
            domain: "hr",
          });
          setInput("");
          return;
        }

        // ── My-requests navigation ─────────────────────────────────────────────
        if (MY_REQUESTS_VIEW_RE.test(text)) {
          const statusFilter: "all" | "open" | "in-progress" | "closed" =
            /\b(pending|open|waiting|submitted|new)\b/i.test(text)
              ? "open"
              : /\b(approved|done|completed|resolved|closed|finished|processed|cancelled)\b/i.test(
                text,
              )
                ? "closed"
                : /\b(in[- ]?progress|processing|under\s+review|in\s+review|acknowledged|active)\b/i.test(
                  text,
                )
                  ? "in-progress"
                  : "all";
          const statusLabel: Record<string, string> = {
            all: "all",
            open: "pending",
            "in-progress": "in-progress",
            closed: "approved / closed",
          };
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: `Opening **My Requests** — showing ${statusLabel[statusFilter]} requests.\n\n<<NAV:/my-requests|View My Requests>>`,
          });
          setInput("");
          window.setTimeout(() => {
            navigate({ to: "/my-requests" });
            window.dispatchEvent(
              new CustomEvent("centriq:requests-filter", { detail: { status: statusFilter } }),
            );
          }, 400);
          return;
        }

        // Intercept parking sticker requests
        if (
          text.toLowerCase().includes("parking sticker") ||
          (text.toLowerCase().includes("parking") && text.toLowerCase().includes("sticker"))
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Please fill in your vehicle details below to submit a parking sticker request.",
            interactive: { type: "parking_form" },
          });
          setInput("");
          return;
        }

        // Intercept travel request submissions (exclude document/letter requests like "travel support letter")
        const travelLower = text.toLowerCase();
        if (
          !DOC_TYPE_RE.test(text) &&
          (travelLower.includes("travel") ||
            travelLower.includes("trip") ||
            travelLower.includes("visa")) &&
          (travelLower.includes("business") ||
            travelLower.includes("official") ||
            travelLower.includes("work") ||
            travelLower.includes("request") ||
            travelLower.includes("apply") ||
            travelLower.includes("submit") ||
            travelLower.includes("create") ||
            travelLower.includes("plan") ||
            travelLower.includes("book") ||
            travelLower.includes("need to travel") ||
            travelLower.includes("travelling for"))
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Let me help you submit a business travel request. Please fill in the details below.",
            interactive: { type: "travel_request_form" },
            domain: "admin",
          });
          setInput("");
          return;
        }

        // Intercept travel expense submissions
        if (
          (travelLower.includes("travel") || travelLower.includes("trip")) &&
          (travelLower.includes("expense") ||
            travelLower.includes("claim") ||
            travelLower.includes("back from") ||
            travelLower.includes("post-trip") ||
            travelLower.includes("post trip") ||
            travelLower.includes("after trip"))
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Welcome back! Let me help you submit your post-trip expense claim.",
            interactive: { type: "travel_expense_form" },
            domain: "admin",
          });
          setInput("");
          return;
        }

        // Intercept book-related intents → route to /books or /my-library directly.
        // This is the spec's "User Query → Intent Detection → Route to Page" path.
        const bookIntent = detectBookIntent(text);
        if (bookIntent) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: `${bookIntent.reply}\n\n<<NAV:${bookIntent.path}|${bookIntent.label}>>`,
            domain: "admin",
          });
          setInput("");
          // Auto-navigate a moment later so the message is visible first.
          window.setTimeout(() => navigate({ to: bookIntent.path }), 400);
          return;
        }

        // Intercept room booking requests.
        // Matches: "book/reserve a room", "book [named room] for/on/at [time or date]"
        // Does NOT rely on hardcoded room names — uses structure instead.
        const isRoomBooking =
          /\b(book|reserve)\b.{0,40}\b(rooms?|conference|meeting rooms?|conf rooms?)\b/i.test(text) ||
          /\b(rooms?|conference rooms?|meeting rooms?)\b.{0,40}\b(book|reserve|available|availability|free)\b/i.test(
            text,
          ) ||
          /\b(available|free|availability)\b.{0,25}\b(rooms?|meeting rooms?|conference rooms?)\b/i.test(
            text,
          ) ||
          /\b(?:book|reserve)\s+\w[\w\s]{1,25}\s+(?:for|on|at)\s+(?:tomorrow|today|\d{1,2}(?:\s*(?:am|pm|:\d)))/i.test(
            text,
          ) ||
          // "book salween room for Interview from 4 am to 4:30 am"
          /\b(?:book|reserve)\s+\w[\w\s]{1,25}\s+for\s+\w[\w\s]{0,30}\s+from\s+\d{1,2}/i.test(
            text,
          );
        if (isRoomBooking) {
          const prefill = parseRoomBooking(text);
          const hasContext = !!(
            prefill.roomHint &&
            prefill.date &&
            prefill.startTime &&
            prefill.endTime
          );
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: hasContext
              ? "On it — checking availability and booking your room."
              : "Let's book a meeting room. Pick your date, time, and duration — I'll show you what's available.",
            interactive: { type: "room_booking_form", data: prefill },
          });
          setInput("");
          return;
        }

        // Intercept room cancellation requests
        if (
          /\b(cancel|cancell?ation|delete|remove)\b.{0,30}\b(booking|reservation|room|meeting room|conference)\b/i.test(
            text,
          ) ||
          /\b(booking|reservation|room booking)\b.{0,30}\b(cancel|delete|remove)\b/i.test(text)
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Here are your upcoming room bookings — select one to cancel.",
            interactive: { type: "cancel_booking_form" },
          });
          setInput("");
          return;
        }

        // Intercept leave cancellation / withdrawal requests
        if (
          /\b(cancel|withdraw|revoke|recall|rescind|retract)\b.{0,30}\b(leave|time[- ]?off)\b/i.test(
            text,
          ) ||
          /\b(leave|time[- ]?off)\b.{0,30}\b(cancel|withdraw|revoke|recall)\b/i.test(text)
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Here are your pending and approved leaves — select one to cancel.",
            interactive: { type: "cancel_leave_form" },
          });
          setInput("");
          return;
        }

        // Intercept leave *application* requests → embed the Zoho People apply-leave form.
        // Placed AFTER cancellation so "cancel my leave" still wins. Excludes balance/policy
        // questions ("how many leaves", "leave balance", "leave policy") which aren't form actions.
        const leaveLower = text.toLowerCase();
        const isApplyLeave =
          (/\b(apply|book|take|request|submit|put in|raise|file)\b.{0,30}\b(leave|time[- ]?off|day off|days off|vacation|pto)\b/i.test(
            text,
          ) ||
            /\b(leave|time[- ]?off|vacation|pto)\b.{0,20}\b(application|request)\b/i.test(text) ||
            /\bi\s+(want|need|would like|wish)\s+(to\s+)?(take|apply|book|request)\b.{0,20}\b(leave|time[- ]?off|day off|vacation)\b/i.test(
              text,
            )) &&
          !/\b(balance|how many|remaining|left|available|status|policy|cancel|withdraw|revoke|recall)\b/i.test(
            text,
          );
        if (isApplyLeave) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Let's apply for your leave. Fill in the Zoho People leave form below and submit it there.",
            interactive: { type: "leave_application_form" },
            domain: "hr",
          });
          setInput("");
          return;
        }

        // Intercept "show my schedule / my meetings / upcoming bookings" — read-only calendar pull, zero LLM.
        if (
          /\b(my|today'?s|upcoming|this week'?s)\b.{0,20}\b(schedule|meetings?|calendar|bookings?|agenda)\b/i.test(
            text,
          ) ||
          /\bwhat('?s| is| are)\b.{0,30}\b(my )?(schedule|meetings?|calendar|agenda)\b/i.test(text)
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Here's what's on your calendar.",
            interactive: { type: "my_schedule" },
          });
          setInput("");
          return;
        }

        // Intercept "update/add my skills / certifications", "set primary skill",
        // "years of experience". Self-serve for all roles — zero LLM. Structural, not name-based.
        const isSkillsEditor =
          /\b(update|edit|add|change|manage|set)\b.{0,30}\b(skill|skills|certification|certificate|cert|expertise)\b/i.test(
            text,
          ) ||
          /\b(skill|skills|certification|certificate|expertise)\b.{0,30}\b(update|edit|add|upload|manage|change)\b/i.test(
            text,
          ) ||
          /\bprimary skill\b/i.test(text) ||
          /\byears? of experience\b/i.test(text) ||
          /\bupload\b.{0,20}\bcertif/i.test(text);
        if (isSkillsEditor) {
          const m = text.match(
            /\badd\s+(?:a\s+|an\s+|my\s+)?([A-Za-z][A-Za-z0-9+.# ]{1,30}?)\s+(?:skill|certification|cert)\b/i,
          );
          const prefill = { skill: m?.[1]?.trim() };
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Here's your skills profile — add or update skills, set your primary skill, years of experience, when you last used it, and attach a certification.",
            interactive: { type: "skills_editor", data: prefill },
          });
          setInput("");
          return;
        }

        // Admin commands — only for domain managers; others fall through to chat.
        const isManager = ["hr", "it", "pmo", "admin"].includes(role);

        // Intercept team attendance requests — Functional Managers only. Zero-LLM, structural.
        // "generate/show attendance for everyone under me / my team / my hierarchy" -> report view.
        // "email me / schedule / automate ... attendance ... every month/week/day" -> schedule setup.
        const mentionsAttendance = /\battendance\b/i.test(text);
        const mentionsTeamScope =
          /\b(everyone|all)\b.{0,20}\b(under|below|report)|my\s+(team|hierarchy|reportees|reports|org|department)|whole\s+hierarchy|team'?s/i.test(
            text,
          );
        if (role === "functional manager" && mentionsAttendance && mentionsTeamScope) {
          const isRecurring =
            /\b(every|each|daily|weekly|monthly|recurring|automat\w*|schedule|remind|regularly)\b/i.test(
              text,
            );
          addTurn(activeId, { role: "user", text });
          if (isRecurring) {
            // Parse cadence cues.
            const freq = /\b(daily|every day|each day|every weekday)\b/i.test(text)
              ? "daily"
              : /\b(weekly|every week|each week)\b/i.test(text)
                ? "weekly"
                : /\b(monthly|every month|each month)\b/i.test(text)
                  ? "monthly"
                  : "monthly";
            const dows = [
              "monday",
              "tuesday",
              "wednesday",
              "thursday",
              "friday",
              "saturday",
              "sunday",
            ];
            const dowIdx = dows.findIndex((d) => new RegExp(`\\b${d}\\b`, "i").test(text));
            const hourM = text.match(/\bat\s+(\d{1,2})\s*(am|pm)?\b/i);
            let hour: number | undefined;
            if (hourM) {
              hour = Number(hourM[1]) % 12;
              if (/pm/i.test(hourM[2] || "")) hour += 12;
            }
            const prefill: Record<string, number | string> = {
              frequency: dowIdx >= 0 ? "weekly" : freq,
            };
            if (dowIdx >= 0) prefill.day_of_week = dowIdx;
            if (hour !== undefined) prefill.hour = hour;
            addTurn(activeId, {
              role: "ai",
              text: "Let's set up an automated attendance email for your team. Confirm the schedule below.",
              interactive: { type: "attendance_schedule", data: prefill },
            });
          } else {
            addTurn(activeId, {
              role: "ai",
              text: "Here's the attendance for everyone in your reporting hierarchy.",
              interactive: { type: "team_attendance" },
            });
          }
          setInput("");
          return;
        }

        // Intercept "my attendance" — any logged-in employee. Zero-LLM.
        if (
          mentionsAttendance &&
          !mentionsTeamScope &&
          /\b(my\s+attendance|attendance\s+(this|for)\s+(month|june|july|august|september|october|november|december|january|february|march|april|may)|show\s+(my\s+)?attendance|view\s+(my\s+)?attendance|attendance\s+(summary|report)|days?\s+present|days?\s+absent|wfh\s+days?|late\s+mark)\b/i.test(
            text,
          )
        ) {
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Here's your attendance for this month.",
            interactive: { type: "my_attendance" },
          });
          setInput("");
          return;
        }

        // Intercept "create/add an announcement …"
        if (
          isManager &&
          /\b(create|add|post|publish|make|send)\b.{0,40}\bannouncement\b/i.test(text)
        ) {
          const prefill = parseAnnouncement(text);
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Let's publish an announcement. Review the details below — add a message or let me draft one, then publish.",
            interactive: { type: "announcement_form", data: prefill },
          });
          setInput("");
          return;
        }

        // Intercept "update/change the … prompt/guardrail/system prompt …"
        if (
          isManager &&
          /\b(update|change|edit|set|add|configure|tweak)\b.{0,40}\b(prompt|config(?:uration)?|guardrail|system prompt|instruction)\b/i.test(
            text,
          )
        ) {
          const prefill = parsePromptConfig(text);
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "Here's the prompt configuration — confirm the domain and section, edit the text, then save.",
            interactive: { type: "prompt_config_form", data: prefill },
          });
          setInput("");
          return;
        }

        // Information-style questions ("what is the process for reporting…", "how do I…",
        // "what's the policy on…") must reach the backend so the policy/HR agents can actually
        // answer them. The leave/URL-link interceptors below are for ACTION intents only —
        // hijacking a question with an "Open X portal?" card is a misroute.
        const isInfoQuery =
          /\bwhat(?:'s|\s+is|\s+are)?\s|\bhow\s+(?:do|can|does|should|to)\b|\bwhy\b|\bexplain\b|\btell\s+me\b|\bprocess\s+(?:for|of|to)\b|\bpolic(?:y|ies)\b|\bprocedure\b|\bguidelines?\b|\bsteps?\s+(?:for|to)\b/i.test(
            text,
          );

        // Suffix appended when the user picks "Let the assistant handle it" — prevents
        // re-interception of the follow-up message. Using endsWith prevents a natural phrase
        // mid-sentence from accidentally matching.
        const ASSISTANT_HANDOFF_SUFFIX = " via the assistant";

        // Single-word generic keywords that are too broad to safely trigger a URL/form intercept.
        // Multi-word phrases are always allowed. This is evaluated by keywordMatches() below.
        const GENERIC_KEYWORDS = new Set([
          "request",
          "requests",
          "report",
          "reports",
          "form",
          "forms",
          "ticket",
          "tickets",
          "apply",
          "status",
          "help",
          "issue",
          "issues",
          "new",
          "portal",
          "app",
          "submit",
          "my",
        ]);

        // Shared keyword matcher used by both the URL Library and Form Library intercepts.
        // Skips single-word keywords that are too generic to safely hijack a message.
        const keywordMatches = (triggerKeywords: string | undefined, msgText: string): boolean => {
          if (!triggerKeywords) return false;
          return triggerKeywords
            .split(",")
            .map((k) => k.trim().toLowerCase())
            .filter(Boolean)
            .filter((kw) => kw.includes(" ") || (kw.length >= 4 && !GENERIC_KEYWORDS.has(kw)))
            .some((kw) =>
              new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(msgText),
            );
        };

        // Create-form intent — hoist detection so the intercept block can run BEFORE URL/form
        // intercepts. Without this, a generic keyword like "requests" on a URL Library link
        // would hijack "create a form for gym membership reimbursement requests".
        const isCreateFormIntent =
          /\b(create|make|build|generate|set\s*up|add|design)\b[\s\S]{0,60}?\bform\b/i.test(text) &&
          !/\b(fill|submit|open)\b/i.test(text);

        // Edit-an-existing-form intent — admin only. Targets a form the message names, or the
        // one most recently created/edited this session. Runs BEFORE the create intercept so
        // "add a date field to the form" revises it rather than spawning a brand-new draft.
        const editVerb =
          /\b(add|remove|delete|drop|rename|change|make|set|mark|update|include|require|reorder|move)\b/i.test(
            text,
          );
        const fieldSignal =
          /\bfield\b/i.test(text) ||
          /\b(required|optional|mandatory)\b/i.test(text) ||
          /\b(this|that|the)\s+form\b/i.test(text);
        // A form explicitly named in the message wins over the last-touched one.
        const namedForm = formsRef.current.find(
          (f) =>
            f.name &&
            new RegExp(`\\b${f.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
        );
        const editTarget = namedForm
          ? { id: namedForm.id, name: namedForm.name }
          : lastFormRef.current;
        const isEditFormIntent =
          role === "admin" &&
          !isInfoQuery &&
          editVerb &&
          fieldSignal &&
          !!editTarget &&
          !/\b(fill|submit|open)\b/i.test(text) &&
          !/\bcreate\b|\bnew\s+form\b/i.test(text);

        if (isEditFormIntent && editTarget) {
          const capturedId = activeId;
          addTurn(capturedId, { role: "user", text });
          setInput("");
          addTurn(capturedId, {
            role: "ai",
            text: `Updating **"${editTarget.name}"** — one moment…`,
          });
          const editHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (user?.email) editHeaders["X-User-Email"] = user.email;
          if (user?.role) editHeaders["X-User-Role"] = user.role.toLowerCase();
          fetch("/api/admin/form-library/generate-edit", {
            method: "POST",
            headers: editHeaders,
            credentials: "include",
            body: JSON.stringify({ form_id: editTarget.id, instruction: text }),
          })
            .then((res) =>
              res.json().then((data) => {
                if (res.ok) {
                  const d = data as import("@/lib/chat-store").FormBuilderDraft;
                  if (typeof d.id === "number") lastFormRef.current = { id: d.id, name: d.name };
                  addTurn(capturedId, {
                    role: "ai",
                    text: `Here's the revised **"${d.name}"** — review the changes and save when ready.`,
                    interactive: { type: "form_builder", data: d },
                  });
                } else {
                  addTurn(capturedId, {
                    role: "ai",
                    text: `Could not update the form: ${(data as { detail?: string }).detail || "Unknown error"}`,
                    isError: true,
                  });
                }
              }),
            )
            .catch(() => {
              addTurn(capturedId, {
                role: "ai",
                text: "Could not reach the server. Please try again.",
                isError: true,
              });
            });
          return;
        }

        // Create-form intercept — admin only. Runs BEFORE leave/URL/form intercepts so a
        // generic trigger keyword can't steal this intent. Any "create/make/build a form …"
        // phrasing is accepted: the strict command syntax is parsed locally, everything else
        // is drafted by the LLM. Either way the admin reviews an editable preview before
        // anything is created — no silent misinterpretation.
        if (role === "admin" && isCreateFormIntent && !isInfoQuery) {
          const capturedId = activeId;
          addTurn(capturedId, { role: "user", text });
          setInput("");
          const parsed = parseFormCommand(text);
          if (parsed && parsed.fields.length > 0) {
            addTurn(capturedId, {
              role: "ai",
              text: `Here's the draft for **"${parsed.name}"** — review the fields and create it when ready.`,
              interactive: {
                type: "form_builder",
                data: parsed as import("@/lib/chat-store").FormBuilderDraft,
              },
            });
            return;
          }
          // Free-form request → let the LLM design the fields, then show the same preview.
          addTurn(capturedId, { role: "ai", text: "Designing your form — one moment…" });
          const genHeaders: Record<string, string> = { "Content-Type": "application/json" };
          if (user?.email) genHeaders["X-User-Email"] = user.email;
          if (user?.role) genHeaders["X-User-Role"] = user.role.toLowerCase();
          fetch("/api/admin/form-library/generate", {
            method: "POST",
            headers: genHeaders,
            credentials: "include",
            body: JSON.stringify({ prompt: text }),
          })
            .then((res) =>
              res.json().then((data) => {
                if (res.ok) {
                  addTurn(capturedId, {
                    role: "ai",
                    text: `Here's a draft of **"${(data as { name: string }).name}"** — edit anything you like, then create it.`,
                    interactive: {
                      type: "form_builder",
                      data: data as import("@/lib/chat-store").FormBuilderDraft,
                    },
                  });
                } else {
                  addTurn(capturedId, {
                    role: "ai",
                    text: `Could not draft the form: ${(data as { detail?: string }).detail || "Unknown error"}`,
                    isError: true,
                  });
                }
              }),
            )
            .catch(() => {
              addTurn(capturedId, {
                role: "ai",
                text: "Could not reach the server. Please try again.",
                isError: true,
              });
            });
          return;
        }

        // Intercept leave application intent — offer self-serve vs. assistant-handled choice.
        // The handoff suffix on the continuation message prevents re-interception.
        const isLeaveApplication =
          !isInfoQuery &&
          !isCreateFormIntent &&
          !text.endsWith(ASSISTANT_HANDOFF_SUFFIX) &&
          (/\b(apply|request|submit|file)\b.{0,30}\b(leave|day off|time off|vacation|annual leave|sick leave|casual leave)\b/i.test(
            text,
          ) ||
            /\b(take|want|need)\b.{0,20}\b(leave|day off|time off|vacation)\b/i.test(text) ||
            /\b(leave|day off|time off)\b.{0,30}\b(apply|request|submit|file|want|need)\b/i.test(
              text,
            ));
        if (isLeaveApplication) {
          const zohoPeopleLink =
            urlLinksRef.current.find((l) => /leave|people/i.test(l.purpose ?? "")) ??
            urlLinksRef.current.find((l) => /people/i.test(l.name) || /leave/i.test(l.name)) ??
            urlLinksRef.current.find((l) => /zoho/i.test(l.name) && !/expense/i.test(l.name));
          const zohoLink = zohoPeopleLink?.url ?? "https://people.zoho.com";
          const zohoName = zohoPeopleLink?.name ?? "Zoho People";
          addTurn(activeId, { role: "user", text });
          addTurn(activeId, {
            role: "ai",
            text: "How would you like to apply for leave?",
            interactive: {
              type: "quick_choice",
              data: {
                question: "How would you like to apply for leave?",
                options: [
                  {
                    label: `I'll apply myself (${zohoName})`,
                    action: "link",
                    value: zohoLink,
                    icon: "external-link",
                  },
                  {
                    label: "Let the assistant handle it",
                    action: "message",
                    value: `${text}${ASSISTANT_HANDOFF_SUFFIX}`,
                    icon: "sparkles",
                  },
                ],
              },
            },
          });
          setInput("");
          return;
        }

        // Generic URL Library intercept — fire for any active link with matching trigger_keywords.
        // Skipped for create-form, handoff continuations, and information-style questions.
        // Uses keywordMatches() which filters out single generic words like "requests".
        if (!isInfoQuery && !isCreateFormIntent && !text.endsWith(ASSISTANT_HANDOFF_SUFFIX)) {
          const triggeredLink = urlLinksRef.current.find((l) =>
            keywordMatches(l.trigger_keywords, text),
          );
          if (triggeredLink) {
            addTurn(activeId, { role: "user", text });
            addTurn(activeId, {
              role: "ai",
              text: `How would you like to access ${triggeredLink.name}?`,
              interactive: {
                type: "quick_choice",
                data: {
                  question: `How would you like to access ${triggeredLink.name}?`,
                  options: [
                    {
                      label: `Open ${triggeredLink.name}`,
                      action: "link",
                      value: triggeredLink.url,
                      icon: "external-link",
                    },
                    {
                      label: "Let the assistant handle it",
                      action: "message",
                      value: `${text}${ASSISTANT_HANDOFF_SUFFIX}`,
                      icon: "sparkles",
                    },
                  ],
                },
              },
            });
            setInput("");
            return;
          }
        }

        // Form Library intercept — open the matched form inline without going through the LLM.
        // Uses keywordMatches() with the same specificity rules as URL Library.
        if (!isInfoQuery && !isCreateFormIntent && !text.endsWith(ASSISTANT_HANDOFF_SUFFIX)) {
          const triggeredForm = formsRef.current.find((f) =>
            keywordMatches(f.trigger_keywords, text),
          );
          if (triggeredForm) {
            addTurn(activeId, { role: "user", text });
            addTurn(activeId, {
              role: "ai",
              text: triggeredForm.description || `Here is the ${triggeredForm.name} form:`,
              interactive: {
                type: "dynamic_form",
                data: {
                  template_id: triggeredForm.id,
                  name: triggeredForm.name,
                  description: triggeredForm.description,
                  fields: triggeredForm.fields,
                  submit_endpoint: "/api/forms/submit",
                },
              },
            });
            setInput("");
            return;
          }
        }
      } // end: local heuristic routing (bypassed while a focus mode is active)

      // Pin the originating thread so the streaming closure writes to the chat that
      // asked, even if the user switches to another chat mid-response.
      const threadId = activeId;

      setSuggestions([]);
      addTurn(threadId, { role: "user", text });
      setInput("");
      setThinking(threadId, true);

      const history = (threads[threadId]?.turns || []).map((t) => ({
        role: t.role === "user" ? "user" : "assistant",
        content: t.text,
      }));

      const controller = new AbortController();
      controllersRef.current.set(threadId, controller);
      // Idle-reset timeout: abort only after 180s of *no* output. Reset on every token
      // so a slow-but-progressing answer (e.g. a long policy reply on a busy LLM server)
      // streams to completion instead of being killed at a fixed wall-clock deadline.
      let timeoutId = window.setTimeout(() => controller.abort(), 180000);
      const activitySteps = getActivitySteps(text, effectiveMode);
      setActivity(activitySteps[0]);
      const activityTimers = activitySteps
        .slice(1)
        .map((step, index) => window.setTimeout(() => setActivity(step), (index + 1) * 1800));

      // Tracked outside the streaming closure so the catch handler below can tell,
      // on Stop/abort, whether any reply text had already reached the chat turn.
      let aiTurnAdded = false;
      let accumulatedText = "";

      const fetchSuggestions = (userText: string, aiText: string, domain: string) => {
        fetch("/api/suggestions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(user?.email ? { "x-user-email": user.email } : {}),
          },
          body: JSON.stringify({ message: userText, response: aiText, domain }),
        })
          .then((r) => (r.ok ? r.json() : { suggestions: [] }))
          .then((d) => {
            if (Array.isArray(d.suggestions) && d.suggestions.length > 0) {
              setSuggestions(d.suggestions);
            }
          })
          .catch(() => { });
      };

      fetch("/api/chat", {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(user?.email ? { "x-user-email": user.email } : {}),
          ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
        },
        body: JSON.stringify({
          message: text,
          history,
          session_id: threadId,
          preferences: {},
          is_private: false,
          active_mode: effectiveMode ?? undefined,
          portal_context: portalContext
            ? { page: portalContext.replace(/^\//, "").replace(/-/g, "_") || "home", active_filters: {} }
            : undefined,
        }),
      })
        .then(async (res) => {
          // Non-2xx responses still return JSON error bodies
          if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            const detail = errorData.detail;
            throw new Error(
              typeof detail === "string" ? detail : "Server error. Please try again.",
            );
          }

          // SSE stream reader
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buffer = "";

          const processLine = (line: string) => {
            if (!line.startsWith("data: ")) return;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(line.slice(6));
            } catch {
              return;
            }

            if (evt.type === "queued") {
              // Server is at capacity; our request is waiting for a slot. The
              // backend refreshes our live position with each update.
              const pos = typeof evt.position === "number" ? (evt.position as number) : null;
              setActivity(
                pos
                  ? `In queue — #${pos} in line. Your turn is coming…`
                  : ((evt.message as string) ?? "High demand — waiting in queue…"),
              );
            } else if (evt.type === "status") {
              // Real pipeline progress from the backend — replaces fake timer steps.
              // Only update if we haven't received the first token yet (pre-stream phase).
              if (!aiTurnAdded) {
                const stage = (evt.stage as string) ?? "";
                setActivity(stage);
              }
            } else if (evt.type === "warning") {
              // Non-fatal degraded-mode signal (e.g. embedding model warming up).
              toast.warning("Degraded routing", {
                description:
                  (evt.message as string) ??
                  "AI routing is limited right now — accuracy should improve on your next message.",
                duration: 5000,
              });
            } else if (evt.type === "busy") {
              // Queue is full — degrade gracefully instead of timing out.
              setThinking(threadId, false);
              activityTimers.forEach((t) => window.clearTimeout(t));
              setActivity("");
              toast.error("AI server is busy", {
                description: "The server is still processing a previous request. Please try again in a moment.",
                duration: 6000,
              });
              if (!aiTurnAdded) {
                addTurn(threadId, {
                  role: "ai",
                  text:
                    (evt.message as string) ??
                    "Centriq is handling a lot of requests right now. Please try again in a moment.",
                });
                aiTurnAdded = true;
              }
            } else if (evt.type === "token") {
              // Output is flowing — restart the idle window so streaming isn't cut off.
              window.clearTimeout(timeoutId);
              timeoutId = window.setTimeout(() => controller.abort(), 180000);
              const content = (evt.content as string) ?? "";
              accumulatedText += content;
              if (!aiTurnAdded) {
                // First token — switch from "thinking" to streaming message
                setThinking(threadId, false);
                activityTimers.forEach((t) => window.clearTimeout(t));
                setActivity("");
                addTurn(threadId, { role: "ai", text: content, streaming: true });
                aiTurnAdded = true;
              } else {
                updateLastAITurn(threadId, { text: accumulatedText });
              }
            } else if (evt.type === "replace") {
              accumulatedText = (evt.content as string) ?? accumulatedText;
              updateLastAITurn(threadId, { text: accumulatedText });
            } else if (evt.type === "done") {
              updateLastAITurn(threadId, {
                streaming: false,
                domain: (evt.domain as string) ?? undefined,
                interactive:
                  evt.interactive &&
                    typeof (evt.interactive as { type?: unknown }).type === "string" &&
                    (evt.interactive as { type?: unknown }).type
                    ? (evt.interactive as Turn["interactive"])
                    : undefined,
                downloadUrl: (evt.download_url as string) ?? undefined,
                images:
                  Array.isArray(evt.images) && evt.images.length > 0
                    ? (evt.images as string[])
                    : undefined,
                citations:
                  Array.isArray(evt.citations) && evt.citations.length > 0
                    ? (evt.citations as Turn["citations"])
                    : undefined,
              });
              fetchSuggestions(text, accumulatedText, (evt.domain as string) ?? "general");
            } else if (evt.type === "error") {
              if (!aiTurnAdded) {
                setThinking(threadId, false);
                setActivity("");
                const errCode = (evt.code as string) ?? "";
                const errMsg = (evt.message as string) ?? "";
                const friendlyText =
                  errCode === "TOOL_FAILURE"
                    ? `I couldn't complete that step — ${errMsg || "a tool call failed"}. Please try rephrasing or try again.`
                    : errCode === "CONTEXT_LIMIT"
                      ? "This conversation is getting long. Start a new chat to continue with a fresh context."
                      : errCode === "MODEL_UNAVAILABLE"
                        ? "The AI model is temporarily unavailable. Please try again in a moment."
                        : errMsg || "Something went wrong. Please try again.";
                addTurn(threadId, { role: "ai", text: friendlyText, isError: true });
                aiTurnAdded = true;
              }
            }
          };

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";
            for (const line of lines) processLine(line.trim());
          }
          if (buffer.trim()) processLine(buffer.trim());

          // If stream ended without a done event and we never got tokens
          if (!aiTurnAdded) {
            setThinking(threadId, false);
            setActivity("");
            toast.error("AI server is busy", {
              description: "The server is still processing a previous request. Please try again in a moment.",
              duration: 6000,
            });
            addTurn(threadId, {
              role: "ai",
              text: "I didn't receive a response — the server may be busy. Please try again.",
              isError: true,
            });
          }
        })
        .catch((err: Error & { code?: string }) => {
          // User pressed Stop — finalize any partial reply instead of a timeout/error
          // message. If nothing had streamed in yet, leave a visible "stopped" turn
          // rather than silently returning to a blank screen.
          if (err.name === "AbortError" && stoppedRef.current.has(threadId)) {
            const leftWhileWaiting = backgroundRef.current.has(threadId) && !aiTurnAdded;
            backgroundRef.current.delete(threadId);
            if (aiTurnAdded && accumulatedText.trim()) {
              updateLastAITurn(threadId, { streaming: false });
            } else if (aiTurnAdded) {
              updateLastAITurn(threadId, { streaming: false, text: "Response stopped." });
            } else if (leftWhileWaiting) {
              // Navigated away before the answer started — the server keeps
              // generating; leave a placeholder the pickup effect can replace.
              addTurn(threadId, { role: "ai", text: BG_PENDING_TEXT });
            } else {
              addTurn(threadId, { role: "ai", text: "Response stopped." });
            }
            return;
          }

          // Network drop mid-stream: the AI turn may already exist with streaming:true.
          // Clear it so the input unlocks; then add the error turn below.
          updateLastAITurn(threadId, { streaming: false });

          const isTimeout = err.name === "AbortError";

          addTurn(threadId, {
            role: "ai",
            text: isTimeout
              ? "This request is taking too long. Please try again."
              : "I couldn't complete that request right now. Please try again in a moment.",
            isError: true,
          });

          toast.error("Service unavailable", {
            description: isTimeout
              ? "The request timed out after 3 minutes."
              : err.message || "Please try again later.",
          });
        })
        .finally(() => {
          window.clearTimeout(timeoutId);
          activityTimers.forEach((timer) => window.clearTimeout(timer));
          setActivity("");
          setThinking(threadId, false);
          controllersRef.current.delete(threadId);
          stoppedRef.current.delete(threadId);
          backgroundRef.current.delete(threadId);
        });
    },
    [activeId, input, threads, addTurn, updateLastAITurn, setThinking, user?.email, user?.role, activeMode, portalContext],
  );

  // Stop the in-flight response for the active chat.
  const stop = useCallback(() => {
    if (!activeId) return;
    const controller = controllersRef.current.get(activeId);
    if (!controller) return;
    stoppedRef.current.add(activeId);
    controller.abort();
    setThinking(activeId, false);
    setActivity("");
    // Dismiss any answer_ready nudges so the bell notification doesn't fire
    // for a deliberately stopped response (only background nav-away should notify).
    const authH = {
      ...(user?.email ? { "x-user-email": user.email } : {}),
      ...(user?.role ? { "x-user-role": user.role.toLowerCase() } : {}),
    };
    fetch("/api/nudges", { headers: authH })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { nudges: { id: number; nudge_type: string }[] } | null) => {
        if (!data?.nudges) return;
        data.nudges
          .filter((n) => n.nudge_type === "answer_ready")
          .forEach((n) => {
            fetch(`/api/nudges/${n.id}/dismiss`, { method: "POST", headers: authH }).catch(() => { });
          });
      })
      .catch(() => { });
  }, [activeId, setThinking, user?.email, user?.role]);

  // ── Hands-free voice loop ("Jarvis") ──────────────────────────────────────
  // Keep a live ref to send() so recognition callbacks never capture a stale one.
  const sendRef = useRef(send);
  sendRef.current = send;

  const stopListening = useCallback(() => {
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
    const rec = recognitionRef.current;
    if (rec) {
      rec.onend = null; // prevent auto-restart on a deliberate stop
      try {
        rec.stop();
      } catch {
        /* already stopped */
      }
      recognitionRef.current = null;
    }
  }, []);

  const startListening = useCallback(() => {
    if (recognitionRef.current) return; // already running
    const rec = createRecognition({ continuous: true, interimResults: true });
    if (!rec) return;
    finalTranscriptRef.current = "";

    const resetSilence = () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const transcript = finalTranscriptRef.current.trim();
        if (!transcript) return;
        finalTranscriptRef.current = "";
        setLiveTranscript("");
        useVoiceStore.getState().setVoiceState("thinking"); // pauses recognition
        sendRef.current(transcript);
      }, 1500);
    };

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) finalTranscriptRef.current += t + " ";
        else interim = t;
      }
      setLiveTranscript((finalTranscriptRef.current + interim).trim());
      resetSilence();
    };
    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      if (event.error === "not-allowed" || event.error === "service-not-allowed") {
        toast.error("Microphone access denied. Allow it to use voice mode.");
        useVoiceStore.getState().setVoiceMode(false);
      }
    };
    rec.onend = () => {
      recognitionRef.current = null;
      // Browsers auto-stop after a while; restart if we're still listening.
      const s = useVoiceStore.getState();
      if (s.voiceMode && s.voiceState === "listening") startListening();
    };
    recognitionRef.current = rec;
    try {
      rec.start();
    } catch {
      /* already started */
    }
  }, [setLiveTranscript]);

  // Drive the microphone from the loop phase: listen only while "listening".
  useEffect(() => {
    if (voiceMode && voiceState === "listening") startListening();
    else stopListening();
  }, [voiceMode, voiceState, startListening, stopListening]);

  // Entering/leaving voice mode: stop listening and clear transcript.
  useEffect(() => {
    if (!voiceMode) {
      stopListening();
      setLiveTranscript("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode]);

  // Mark the thinking phase while a streamed reply is being generated.
  useEffect(() => {
    if (voiceMode && thinking) setVoiceState("thinking");
  }, [voiceMode, thinking, setVoiceState]);

  // Resume listening after AI reply completes (no TTS — go straight back to listening).
  useEffect(() => {
    if (!voiceMode) return;
    const turn = [...activeThread.turns].reverse().find((t) => t.role === "ai");
    if (turn && turn.streaming !== true) {
      useVoiceStore.getState().setVoiceState("listening");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceMode, activeThread.turns]);

  const handleNewChat = () => {
    createThread();
    changeModeWithAnimation(null);
    setIsSidebarOpen(false);
  };

  const handleThreadSelect = (id: string) => {
    setActiveId(id);
    setIsSidebarOpen(false);
  };

  const handleFeedback = (rating: "up" | "down", index: number, feedbackText?: string) => {
    const turns = (activeId ? threads[activeId]?.turns : undefined) || [];
    const aiTurn = turns[index];
    const prevUserTurn = turns
      .slice(0, index)
      .reverse()
      .find((t: Turn) => t.role === "user");
    fetch("/api/feedback", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rating,
        threadId: activeId,
        domain: aiTurn?.role === "ai" ? aiTurn.domain : undefined,
        user_message: prevUserTurn?.text || "",
        ai_response: aiTurn?.text || "",
        feedback_text: feedbackText || "",
      }),
    })
      .then(() => {
        if (rating === "up") toast.success("Glad I could help!");
      })
      .catch(() => toast.error("Failed to save feedback"));
  };

  const openDocModal = () => {
    const firstUserTurn = activeThread.turns.find((turn) => turn.role === "user");
    setDocTitle(firstUserTurn ? firstUserTurn.text.slice(0, 60) : "Centriq Report");
    setShowDocModal(true);
  };

  const handleGenerateDoc = async () => {
    if (!activeId) return;

    setIsGeneratingDoc(true);
    try {
      const conversationText = activeThread.turns
        .map((turn) => `${turn.role === "user" ? "User" : "Centriq"}: ${turn.text}`)
        .join("\n\n");

      const res = await fetch("/api/documents/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          doc_type: docType,
          title: docTitle,
          content: conversationText,
          thread_id: activeId,
          generated_by: "Centriq AI",
        }),
      });

      if (!res.ok) throw new Error("Generation failed");

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `${docTitle.replace(/\s+/g, "_").toLowerCase().slice(0, 50)}.pdf`;
      anchor.click();
      URL.revokeObjectURL(url);

      setShowDocModal(false);
      toast.success("Document downloaded successfully");
    } catch {
      toast.error("Failed to generate document");
    } finally {
      setIsGeneratingDoc(false);
    }
  };

  return (
    <div className="relative flex h-full w-full overflow-hidden bg-background">
      <main className="relative flex min-w-0 flex-1 flex-col">
        {/* Server busy — proactive heads-up; input stays usable (requests queue). */}
        <AnimatePresence>
          {serverBusy && !loadBannerDismissed && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              className="flex items-center gap-3 border-b border-amber-300/60 bg-amber-50 px-4 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-950/40 dark:text-amber-300 overflow-hidden"
            >
              <Activity className="h-4 w-4 shrink-0" />
              <span>
                <strong>Server is busy right now</strong> — replies may take a little longer than
                usual. You can still send your message
                {waiting > 0 ? ` (${waiting} ahead of you)` : ""}; it'll be answered as soon as a
                slot frees up.
              </span>
              <button
                onClick={() => setLoadBannerDismissed(true)}
                className="ml-auto shrink-0 rounded-lg p-1 text-amber-700 hover:bg-amber-200/60 dark:text-amber-400 dark:hover:bg-amber-800/40 transition-colors"
                aria-label="Dismiss"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Active mode banner */}
        <AnimatePresence>
          {activeMode && (() => {
            const mode = CHAT_MODES[activeMode];
            const ModeIcon = mode.Icon;
            return (
              <motion.div
                key="mode-banner"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className={`flex items-center gap-3 border-b px-4 py-2 text-sm overflow-hidden ${mode.color.banner}`}
              >
                <span className={`flex h-1.5 w-1.5 rounded-full shrink-0 animate-pulse ${mode.color.dot}`} />
                <ModeIcon className="h-3.5 w-3.5 shrink-0" />
                <span className="font-semibold">{mode.label}</span>
                <span className="text-xs opacity-70 hidden sm:inline">{mode.description}</span>
                <button
                  onClick={() => changeModeWithAnimation(null)}
                  className="ml-auto shrink-0 rounded-lg p-1 opacity-60 hover:opacity-100 transition-opacity"
                  aria-label="Exit mode"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            );
          })()}
        </AnimatePresence>

        {/* Messages Area */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          className="relative flex-1 overflow-y-auto scroll-smooth"
        >
          <div
            className={cn(
              "mx-auto w-full flex flex-col",
              isCopilot ? "max-w-xl px-4" : "max-w-5xl px-4 sm:px-8",
              activeThread.turns.length === 0
                ? "min-h-full justify-center pt-2 md:pt-8 pb-2 md:pb-12"
                : "pt-4 md:pt-8 pb-6 md:pb-12",
            )}
          >
            {activeThread.turns.length === 0 ? (
              isCopilot ? (
                /* ──── Portal-themed Copilot Empty State ──── */
                (() => {
                  const portal = getPortalCopilot(portalContext);
                  const PortalIcon = portal.Icon;
                  // Starters: portal-specific in a focus mode use the mode's; else the portal's.
                  const chips = activeMode ? CHAT_MODES[activeMode].starters : portal.starters;
                  return (
                    <motion.section
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.5 }}
                      className="flex w-full flex-col items-center justify-center text-center max-w-md mx-auto relative py-10 px-4 select-none"
                    >
                      <motion.div
                        className="relative shrink-0 flex items-center justify-center mb-5"
                        animate={{ y: [0, -6, 0] }}
                        transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
                      >
                        <div
                          className="flex h-14 w-14 items-center justify-center rounded-2xl border"
                          style={{
                            background: `color-mix(in oklab, ${portal.accent} 12%, var(--background))`,
                            borderColor: `color-mix(in oklab, ${portal.accent} 30%, transparent)`,
                          }}
                        >
                          <PortalIcon className="h-7 w-7" style={{ color: portal.accent }} />
                        </div>
                        <motion.div
                          className="absolute -inset-2 rounded-2xl opacity-40 blur-md pointer-events-none"
                          style={{ background: portal.accent }}
                          animate={{ opacity: [0.18, 0.4, 0.18] }}
                          transition={{ duration: 2, repeat: Infinity }}
                        />
                      </motion.div>
                      <h2 className="text-base font-bold tracking-tight mb-2 text-foreground">
                        {activeMode ? CHAT_MODES[activeMode].label : portal.heading}
                      </h2>
                      <p className="text-xs text-muted-foreground max-w-xs leading-relaxed mb-5">
                        {activeMode ? CHAT_MODES[activeMode].description : portal.tagline}
                      </p>

                      {activeMode === "me" && (
                        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/80 max-w-xs leading-relaxed -mt-3 mb-5">
                          <Lock className="h-3 w-3 shrink-0" />
                          Your private space — nothing here is logged or traced in AI observability.
                        </p>
                      )}

                      {activeMode && CHAT_MODES[activeMode].cards ? (
                        <div className="flex flex-col gap-2 w-full max-w-xs">
                          {CHAT_MODES[activeMode].cards!.map((c) => (
                            <button
                              key={c.label}
                              onClick={() => !busy && send(c.prompt)}
                              className="group flex items-start gap-3 rounded-xl border bg-card/70 backdrop-blur-sm px-3.5 py-2.5 text-left shadow-sm transition-all hover:shadow-md hover:scale-[1.02]"
                              style={{
                                borderColor: `color-mix(in oklab, ${portal.accent} 22%, var(--border))`,
                              }}
                            >
                              <span
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                                style={{
                                  background: `color-mix(in oklab, ${portal.accent} 14%, transparent)`,
                                }}
                              >
                                <c.Icon className="h-3.5 w-3.5" style={{ color: portal.accent }} />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[12.5px] font-semibold text-foreground">
                                  {c.label}
                                </span>
                                <span className="block text-[11px] text-muted-foreground leading-snug">
                                  {c.description}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : (
                        chips.length > 0 && (
                          <div className="flex flex-col gap-2 w-full max-w-xs">
                            {chips.map((s) => (
                              <button
                                key={s}
                                onClick={() => !busy && send(s)}
                                className="group flex items-center gap-2.5 rounded-xl border bg-card/70 backdrop-blur-sm px-3.5 py-2.5 text-left text-[12.5px] font-medium text-muted-foreground shadow-sm transition-all hover:text-foreground hover:shadow-md hover:scale-[1.02]"
                                style={{
                                  borderColor: `color-mix(in oklab, ${portal.accent} 22%, var(--border))`,
                                }}
                              >
                                <span
                                  className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
                                  style={{
                                    background: `color-mix(in oklab, ${portal.accent} 14%, transparent)`,
                                  }}
                                >
                                  <Sparkles className="h-2.5 w-2.5" style={{ color: portal.accent }} />
                                </span>
                                {s}
                              </button>
                            ))}
                          </div>
                        )
                      )}
                    </motion.section>
                  );
                })()
              ) : (
                /* ──── Empty State ──── */
                <motion.section
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.6 }}
                  className="flex w-full flex-col items-center justify-center text-center max-w-5xl mx-auto relative min-h-0 py-2 sm:py-4"
                >
                  <div className="absolute inset-0 w-full h-[300px] pointer-events-none opacity-40">
                    <SparklesCore
                      id="chat-sparkles"
                      minSize={0.4}
                      maxSize={1.0}
                      particleDensity={60}
                      speed={0.4}
                      particleColor="#3B8FE8"
                    />
                  </div>
                  {/* Subtle three.js accent layered above the 2D sparkles — auto-skips on
                      low-power/reduced-motion devices via useDeviceTier, so the 2D layer
                      above always carries the effect on its own. */}
                  <div className="absolute inset-0 w-full h-[300px] pointer-events-none opacity-70">
                    <AmbientField />
                  </div>
                  {(() => {
                    const { heading, subheading } = getGreeting(user?.name || "there");
                    return (
                      <>
                        <motion.h1
                          initial={{ opacity: 0, y: 20 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
                          className="text-2xl sm:text-4xl font-extrabold tracking-tight md:text-5xl mb-1 sm:mb-2 text-glow"
                        >
                          <span className="text-gradient">{heading}</span>
                        </motion.h1>
                        <motion.p
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ duration: 0.5, delay: 0.2 }}
                          className="text-xs sm:text-base text-muted-foreground mb-4 sm:mb-8"
                        >
                          {subheading}
                        </motion.p>
                      </>
                    );
                  })()}

                  {/* Morning Briefing — proactive daily digest (ARB #39) */}
                  {!activeMode && (
                    <MorningBriefing onAction={(prompt) => !busy && send(prompt)} />
                  )}

                  {/* Smart Widgets */}
                  <motion.div
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.5, delay: 0.3 }}
                    className="w-full max-w-4xl mb-4 sm:mb-6 hidden sm:block"
                  >
                    <SmartWidgets onAction={(prompt) => !busy && send(prompt)} />
                  </motion.div>

                  {/* Starter prompt chips */}
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.4 }}
                    className="w-full max-w-4xl mb-3 sm:mb-5 hidden sm:block"
                  >
                    <div className="try-asking-container">
                      <p className="text-[10px] sm:text-[11px] text-muted-foreground font-semibold mb-2 sm:mb-3 text-center tracking-wide">
                        Try asking…
                      </p>
                      {activeMode && CHAT_MODES[activeMode].cards ? (
                        /* Mode-specific suggestion cards (icon + description) */
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 w-full max-w-xl mx-auto">
                          {CHAT_MODES[activeMode].cards!.map((c) => (
                            <button
                              key={c.label}
                              onClick={() => !busy && send(c.prompt)}
                              className="group flex items-start gap-3 rounded-xl border border-border/80 bg-card/70 backdrop-blur-sm px-3.5 py-3 text-left shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:shadow-md hover:scale-[1.02]"
                            >
                              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/60 group-hover:bg-primary/10 transition-colors">
                                <c.Icon className="h-4 w-4 text-primary" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[12.5px] font-semibold text-foreground">
                                  {c.label}
                                </span>
                                <span className="block text-[11px] text-muted-foreground leading-snug">
                                  {c.description}
                                </span>
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : activeMode ? (
                        /* Mode-specific starters */
                        <div className="flex flex-wrap justify-center gap-2">
                          {CHAT_MODES[activeMode].starters.map((s) => {
                            const ModeIcon = CHAT_MODES[activeMode].Icon;
                            return (
                              <button
                                key={s}
                                onClick={() => !busy && send(s)}
                                className="group flex items-center gap-2 rounded-full border border-border/80 bg-card/70 backdrop-blur-sm px-3 py-1.5 text-[11px] sm:text-[12px] font-medium text-muted-foreground shadow-sm transition-all hover:border-primary/40 hover:bg-primary/5 hover:text-foreground hover:shadow-md hover:scale-[1.02]"
                              >
                                <span className="flex h-4.5 w-4.5 items-center justify-center rounded-full bg-muted/60 group-hover:bg-primary/10 transition-colors">
                                  <ModeIcon className="h-2.5 w-2.5 text-primary" />
                                </span>
                                {s}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="flex flex-wrap justify-center gap-2">
                          {topPrompts.map((prompt) => (
                            <button
                              key={prompt}
                              onClick={() => !busy && send(prompt)}
                              className="group flex items-center gap-2 rounded-full border border-primary/20 bg-primary/5 px-3 py-1.5 text-[11px] sm:text-[12px] font-medium text-foreground shadow-sm transition-all hover:bg-primary/10 hover:scale-[1.02]"
                            >
                              <Sparkles className="h-3 w-3 text-primary/70" />
                              {prompt}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </motion.div>
                </motion.section>
              )
            ) : (
              /* ──── Chat Messages ──── */
              <section className="space-y-6 pb-6">
                <AnimatePresence mode="popLayout">
                  {activeThread.turns.map((t, i) =>
                    t.role === "user" ? (
                      <motion.div
                        key={`msg-${i}`}
                        initial={{ opacity: 0, y: 16, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: "spring", stiffness: 400, damping: 30 }}
                        layout
                      >
                        <UserMessage
                          initials={
                            user?.name
                              ?.split(" ")
                              .map((n) => n[0])
                              .join("") || "U"
                          }
                          text={t.text}
                          onSaveQuickSearch={handleOpenSavePrompt}
                        >
                          {t.text}
                        </UserMessage>
                      </motion.div>
                    ) : (
                      <motion.div
                        key={`msg-${i}`}
                        initial={{ opacity: 0, y: 20, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                          type: "spring",
                          stiffness: 300,
                          damping: 30,
                          delay: 0.05,
                        }}
                        layout
                      >
                        <AIMessage
                          onFeedback={(rating, feedbackText) =>
                            handleFeedback(rating, i, feedbackText)
                          }
                          domain={t.role === "ai" ? t.domain : undefined}
                          text={t.text}
                          live={t.streaming}
                          isError={t.isError}
                          sessionId={activeId ?? undefined}
                          originalQuery={
                            i > 0 && activeThread.turns[i - 1]?.role === "user"
                              ? activeThread.turns[i - 1].text
                              : undefined
                          }
                        >
                          <div className="space-y-4">
                            {t.text &&
                              (() => {
                                const navTokens: { path: string; label: string }[] = [];
                                const cleaned = normalizeBullets(
                                  t.text
                                    .replace(/<<NAV:([^|>]+)\|([^>]+)>>/g, (_m, path, label) => {
                                      navTokens.push({
                                        path: String(path).trim(),
                                        label: String(label).trim(),
                                      });
                                      return "";
                                    })
                                    .trim(),
                                );
                                return (
                                  <>
                                    {cleaned && (
                                      <div className="text-[15px] leading-relaxed text-foreground/90 prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5 prose-headings:mt-3 prose-headings:mb-1 prose-table:my-2 prose-th:px-3 prose-th:py-2 prose-td:px-3 prose-td:py-2 prose-th:bg-muted/60 prose-th:font-semibold prose-th:text-foreground prose-tr:border-b prose-tr:border-border/50 prose-table:border prose-table:border-border/50 prose-table:rounded-lg prose-table:overflow-hidden prose-table:text-sm [&_table]:block [&_table]:max-w-full [&_table]:overflow-x-auto">
                                        <ReactMarkdown
                                          remarkPlugins={[remarkGfm]}
                                          components={{
                                            a: ({ href, children }) => (
                                              <a
                                                href={href}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                              >
                                                {children}
                                              </a>
                                            ),
                                          }}
                                        >
                                          {cleaned}
                                        </ReactMarkdown>
                                        {t.streaming && (
                                          <span className="inline-block w-[2px] h-[1em] ml-[1px] bg-foreground/70 align-middle animate-pulse" />
                                        )}
                                      </div>
                                    )}
                                    {navTokens.length > 0 && !t.streaming && (
                                      <div className="flex flex-wrap gap-2 mt-2">
                                        {navTokens.map((n, idx) => {
                                          const Icon =
                                            n.path === "/my-library" ? LibraryIcon : BookOpen;
                                          return (
                                            <button
                                              key={idx}
                                              onClick={() => navigate({ to: n.path })}
                                              className="inline-flex items-center gap-2 rounded-xl bg-primary/15 px-3 py-1.5 text-[13px] font-medium text-primary hover:bg-primary/25 transition-colors border border-primary/20"
                                            >
                                              <Icon className="h-3.5 w-3.5" />
                                              {n.label}
                                            </button>
                                          );
                                        })}
                                      </div>
                                    )}
                                  </>
                                );
                              })()}
                            {t.images && t.images.length > 0 && (
                              <div className="mt-3 flex flex-col gap-3">
                                {t.images.map((url, imgIdx) => (
                                  <a
                                    key={imgIdx}
                                    href={url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                  >
                                    <img
                                      src={url}
                                      alt={`Policy image ${imgIdx + 1}`}
                                      className="max-w-full rounded-xl border border-border shadow-sm hover:shadow-md transition-shadow cursor-zoom-in"
                                      loading="lazy"
                                    />
                                  </a>
                                ))}
                              </div>
                            )}
                            {t.role === "ai" && !t.streaming && t.citations && (
                              <CitationsCard citations={t.citations} />
                            )}
                            {t.downloadUrl && (
                              <motion.a
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.97 }}
                                href={t.downloadUrl}
                                download={t.downloadTitle ?? "report"}
                                className="mt-1 inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md shadow-primary/20 transition-all hover:bg-primary/90"
                              >
                                <Download className="h-4 w-4" />
                                {t.downloadTitle ?? "Download Report"}
                              </motion.a>
                            )}
                            {t.card && (
                              <AnswerCard
                                title="Leave Balance · 2026"
                                meta="System Source: HR Connect"
                                rows={[
                                  {
                                    label: "Total Earned Leaves",
                                    value: "12 days",
                                    highlight: true,
                                  },
                                  { label: "Casual Leaves", value: "4 days" },
                                  { label: "Sick Leaves", value: "7 days" },
                                  { label: "Upcoming (May 4)", value: "2 days" },
                                ]}
                                cta={{
                                  label: "File Leave Request",
                                  onClick: () => {
                                    toast.promise(
                                      new Promise((resolve) => setTimeout(resolve, 1500)),
                                      {
                                        loading: "Processing request...",
                                        success: "Leave request filed with Priya!",
                                        error: "Failed to file request",
                                      },
                                    );
                                  },
                                }}
                              />
                            )}
                            {t.interactive?.type === "parking_form" && (
                              <ParkingForm
                                userEmail={user?.email || ""}
                                onSubmitted={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "visitor_pass_form" && (
                              <VisitorPassForm
                                userEmail={user?.email || ""}
                                prefill={
                                  t.interactive.data as
                                  | import("@/lib/chat-store").VisitorPassPrefill
                                  | undefined
                                }
                                onSubmitted={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "travel_request_form" && (
                              <TravelRequestForm
                                userEmail={user?.email || ""}
                                onSubmitted={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "travel_expense_form" && (
                              <TravelExpenseForm
                                userEmail={user?.email || ""}
                                onSubmitted={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "dynamic_form" && t.interactive.data && (
                              <DynamicFormWidget
                                data={
                                  t.interactive.data as import("@/lib/chat-store").DynamicFormData
                                }
                                userEmail={user?.email || ""}
                                userRole={user?.role}
                                onSubmitted={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg })
                                }
                              />
                            )}
                            {t.interactive?.type === "connector_link" && t.interactive.data && (
                              <ConnectorLinkCard
                                data={
                                  t.interactive.data as import("@/lib/chat-store").ConnectorLinkData
                                }
                                userEmail={user?.email || ""}
                                userRole={user?.role}
                                onLinked={(msg) =>
                                  activeId && addTurn(activeId, { role: "ai", text: msg })
                                }
                              />
                            )}
                            {t.interactive?.type === "form_builder" && t.interactive.data && (
                              <FormBuilderWidget
                                draft={
                                  t.interactive.data as import("@/lib/chat-store").FormBuilderDraft
                                }
                                userEmail={user?.email || ""}
                                userRole={user?.role || ""}
                                onCreated={(msg, form) => {
                                  if (activeId) addTurn(activeId, { role: "ai", text: msg });
                                  // Remember this form so a follow-up "add a field…" edits it.
                                  if (form) lastFormRef.current = form;
                                  // Refresh forms cache so new trigger keywords work immediately.
                                  const h: Record<string, string> = {};
                                  if (user?.email) h["X-User-Email"] = user.email;
                                  fetch("/api/forms/list", { headers: h })
                                    .then((r) => (r.ok ? r.json() : []))
                                    .then((d) => {
                                      if (Array.isArray(d)) formsRef.current = d;
                                    })
                                    .catch(() => { });
                                }}
                              />
                            )}
                            {t.interactive?.type === "quick_choice" &&
                              t.interactive.data &&
                              i !== activeThread.turns.length - 1 && (
                                <ChoiceWidget
                                  data={
                                    t.interactive.data as import("@/lib/chat-store").QuickChoiceData
                                  }
                                  onMessage={(text) => send(text)}
                                />
                              )}
                            {t.interactive?.type === "chart" && t.interactive.data && (
                              // Explicit clamp width: the parent chat bubble is a flex item
                              // that shrinks to its intrinsic content, and ResponsiveContainer
                              // has zero intrinsic width — so without this the chart collapses
                              // to the caption width. clamp keeps it full yet responsive.
                              <div
                                className="mt-2 rounded-xl border border-border/70 bg-card/60 p-3 max-w-full"
                                style={{ width: "clamp(320px, 62vw, 820px)" }}
                              >
                                <ChartCanvas
                                  spec={
                                    t.interactive.data as import("@/components/analytics/ChartCanvas").ChartSpec
                                  }
                                  height={360}
                                  exportBar
                                />
                              </div>
                            )}
                            {t.interactive?.type === "email_draft" && t.interactive.data && (
                              <InteractiveEmailDraft
                                data={
                                  t.interactive.data as import("@/lib/chat-store").EmailDraftData
                                }
                                userEmail={user?.email}
                                onSent={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "it_support" })
                                }
                              />
                            )}
                            {t.interactive?.type === "room_booking_form" && (
                              <RoomBookingWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={
                                  t.interactive.data as
                                  | import("@/lib/chat-store").RoomBookingPrefill
                                  | undefined
                                }
                                onBooked={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "ms365" })
                                }
                              />
                            )}
                            {t.interactive?.type === "cancel_booking_form" && (
                              <CancelBookingWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                onCancelled={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "ms365" })
                                }
                              />
                            )}
                            {t.interactive?.type === "cancel_leave_form" && (
                              <CancelLeaveWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                onCancelled={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "hr" })
                                }
                              />
                            )}
                            {t.interactive?.type === "leave_application_form" && (
                              <LeaveApplicationWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                              />
                            )}
                            {t.interactive?.type === "document_generation_form" && (
                              <DocumentGenerationWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                              />
                            )}
                            {t.interactive?.type === "my_schedule" && (
                              <MyScheduleWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                              />
                            )}
                            {t.interactive?.type === "skills_editor" && (
                              <SkillsEditorWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={
                                  t.interactive.data as
                                  | import("@/lib/chat-store").SkillsEditorPrefill
                                  | undefined
                                }
                                onSaved={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "hr" })
                                }
                              />
                            )}
                            {t.interactive?.type === "announcement_form" && (
                              <AnnouncementWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={
                                  t.interactive.data as
                                  | import("@/lib/chat-store").AnnouncementPrefill
                                  | undefined
                                }
                                onPublished={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {t.interactive?.type === "prompt_config_form" && (
                              <PromptConfigWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                                prefill={
                                  t.interactive.data as
                                  | import("@/lib/chat-store").PromptConfigPrefill
                                  | undefined
                                }
                                onSaved={(msg) =>
                                  activeId &&
                                  addTurn(activeId, { role: "ai", text: msg, domain: "admin" })
                                }
                              />
                            )}
                            {(t.interactive?.type === "team_attendance" ||
                              t.interactive?.type === "attendance_schedule") && (
                                <AttendanceScheduleWidget
                                  userEmail={user?.email || ""}
                                  userRole={user?.role || "employee"}
                                  mode={
                                    t.interactive.type === "attendance_schedule"
                                      ? "schedule"
                                      : "report"
                                  }
                                  prefill={
                                    t.interactive.data as
                                    | import("@/lib/chat-store").AttendanceSchedulePrefill
                                    | undefined
                                  }
                                  onDone={(msg) =>
                                    activeId &&
                                    addTurn(activeId, { role: "ai", text: msg, domain: "hr" })
                                  }
                                />
                              )}
                            {t.interactive?.type === "my_attendance" && (
                              <MyAttendanceWidget
                                userEmail={user?.email || ""}
                                userRole={user?.role || "employee"}
                              />
                            )}
                          </div>
                        </AIMessage>
                      </motion.div>
                    ),
                  )}
                </AnimatePresence>

                {/* Thinking state */}
                <AnimatePresence>
                  {thinking && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ type: "spring", stiffness: 300, damping: 30 }}
                    >
                      <AIMessage live>
                        <ThinkingBuddy activity={activity} />
                      </AIMessage>
                    </motion.div>
                  )}
                </AnimatePresence>
              </section>
            )}
          </div>

          {/* Scroll-to-bottom FAB */}
          <AnimatePresence>
            {showScrollBtn && activeThread.turns.length > 0 && (
              <motion.button
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                whileHover={{ scale: 1.1 }}
                whileTap={{ scale: 0.9 }}
                onClick={scrollToBottom}
                className="fixed bottom-44 right-4 md:bottom-28 md:right-8 z-20 flex h-10 w-10 items-center justify-center rounded-full bg-card border border-border shadow-lg text-muted-foreground hover:text-foreground transition-colors"
              >
                <ArrowDown className="h-4 w-4" />
              </motion.button>
            )}
          </AnimatePresence>
        </div>

        {/* Input Area */}
        <motion.footer
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative border-t border-border bg-background/60 backdrop-blur-xl px-3 pb-3 pt-3 sm:px-8 md:pb-8 md:pt-4 shrink-0"
        >
          <div className="mx-auto w-full max-w-4xl space-y-3">
            <AnimatePresence>
              {pendingChoice && !thinking && !busy && (
                <QuickChoicePanel
                  data={pendingChoice}
                  onMessage={(text) => send(text)}
                  hotkeysEnabled={!input}
                />
              )}
            </AnimatePresence>
            <VoiceOrb />
            <Composer
              value={input}
              onChange={setInput}
              onSubmit={() => send()}
              disabled={busy}
              busy={busy}
              onStop={stop}
              onAttach={() =>
                toast("Attachments", { description: "This feature is currently in preview." })
              }
              onQuickAction={(p) => !busy && send(p)}
              onNavigate={(path) => navigate({ to: path })}
              onGenerateDoc={activeThread.turns.length > 0 ? openDocModal : undefined}
              suggestions={suggestions}
              onSuggestionSelect={(t) => !busy && send(t)}
              placeholders={portalContext ? getPortalCopilot(portalContext).placeholders : undefined}
              hideAttach={isCopilot}
              hideSlash={isCopilot}
            />
          </div>
        </motion.footer>
      </main>

      {/* Document Generation Modal */}
      <Dialog open={showDocModal} onOpenChange={setShowDocModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Document</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Document Type</Label>
              <Select value={docType} onValueChange={setDocType}>
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="project_status_report">Project Status Report</SelectItem>
                  <SelectItem value="sprint_summary">Sprint Summary</SelectItem>
                  <SelectItem value="meeting_minutes">Meeting Minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Document Title</Label>
              <Input
                value={docTitle}
                onChange={(event) => setDocTitle(event.target.value)}
                placeholder="e.g. Project Aurora Sprint 5 Summary"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowDocModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleGenerateDoc} disabled={isGeneratingDoc || !docTitle.trim()}>
              {isGeneratingDoc ? "Generating..." : "Download PDF"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Save Prompt Modal */}
      <Dialog open={savePromptOpen} onOpenChange={setSavePromptOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save to Quick Searches</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Label</Label>
              <Input
                value={promptLabel}
                onChange={(event) => setPromptLabel(event.target.value)}
                placeholder="e.g. Check leave balance"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Category</Label>
              <Select
                value={promptCategory}
                onValueChange={(v) => setPromptCategory(v as "it" | "admin" | "hr")}
              >
                <SelectTrigger className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="it">IT Support</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="hr">HR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium text-foreground">Prompt Text</Label>
              <Textarea
                value={promptToSave}
                onChange={(event) => setPromptToSave(event.target.value)}
                className="min-h-[80px] rounded-xl resize-none"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSavePromptOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleSavePrompt}
              disabled={!promptLabel.trim() || !promptToSave.trim()}
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Mode Transition Overlay */}
      <AnimatePresence>
        {transitionState?.active && (() => {
          const targetMode = transitionState.targetMode;
          const modeInfo = targetMode ? CHAT_MODES[targetMode] : null;
          const ModeIcon = modeInfo ? modeInfo.Icon : Sparkles;

          let color = "#3b82f6";
          if (targetMode === "analytics") color = "#8b5cf6";
          if (targetMode === "training") color = "#10b981";
          if (targetMode === "project") color = "#f59e0b";
          if (targetMode === "resource") color = "#06b6d4";

          return (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}
              className="absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/5 pointer-events-auto"
              style={{
                backdropFilter: "blur(12px)",
                WebkitBackdropFilter: "blur(12px)",
              }}
            >
              <motion.div
                initial={{ scale: 0, opacity: 0.3 }}
                animate={{
                  scale: 60,
                  opacity: [0.3, 0.75, 0.75],
                }}
                transition={{
                  duration: 0.8,
                  ease: [0.16, 1, 0.3, 1]
                }}
                className="absolute rounded-full shrink-0 w-20 h-20"
                style={{
                  background: `radial-gradient(circle, color-mix(in srgb, ${color} 45%, transparent) 0%, color-mix(in srgb, ${color} 20%, transparent) 60%, transparent 100%)`,
                  transformOrigin: "center",
                  willChange: "transform",
                }}
              />

              <motion.div
                initial={{ scale: 0, rotate: -30, opacity: 0 }}
                animate={{ scale: [0, 1.25, 1], rotate: 0, opacity: 1 }}
                transition={{
                  duration: 0.55,
                  ease: [0.34, 1.56, 0.64, 1],
                  delay: 0.1
                }}
                className="relative z-10 flex h-28 w-28 items-center justify-center rounded-[32px] border border-white/20 bg-white/10 backdrop-blur-xl shadow-2xl"
              >
                <ModeIcon className="h-14 w-14 text-white drop-shadow-[0_4px_16px_rgba(0,0,0,0.35)] animate-pulse" />
              </motion.div>
            </motion.div>
          );
        })()}
      </AnimatePresence>
    </div>
  );
}

function getActivitySteps(text: string, activeMode?: ModeKey | null) {
  if (activeMode === "analytics") {
    return ["Reading your request...", "Querying the data...", "Building your chart..."];
  }
  const lower = text.toLowerCase();
  if (
    lower.includes("install") ||
    lower.includes("software") ||
    lower.includes("nodejs") ||
    lower.includes("node.js") ||
    lower.includes("figma")
  ) {
    return ["Routing to IT Support...", "Preparing email draft...", "Waiting for response..."];
  }

  if (/\b(yes|send|confirm|ok|okay)\b/.test(lower)) {
    return ["Checking pending draft...", "Sending email...", "Finalizing response..."];
  }

  return ["Routing request...", "Selecting the right service...", "Preparing response..."];
}
