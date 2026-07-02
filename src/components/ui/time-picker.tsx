"use client";

import * as React from "react";
import { Clock, ChevronUp, ChevronDown } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export interface TimePickerProps {
  /** 24-hour "HH:mm" string, matching native input[type=time] value */
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  /** Minute increment for the quick-pick list */
  step?: number;
}

function pad(n: number) {
  return String(n).padStart(2, "0");
}

function parse24(value?: string) {
  if (!value) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (Number.isNaN(h) || Number.isNaN(min) || h > 23 || min > 59) return null;
  return { h, min };
}

function to12(h: number) {
  const meridiem: "AM" | "PM" = h >= 12 ? "PM" : "AM";
  const hour12 = h % 12 === 0 ? 12 : h % 12;
  return { hour12, meridiem };
}

function to24(hour12: number, meridiem: "AM" | "PM") {
  let h = hour12 % 12;
  if (meridiem === "PM") h += 12;
  return h;
}

function formatDisplay(value?: string) {
  const parsed = parse24(value);
  if (!parsed) return null;
  const { hour12, meridiem } = to12(parsed.h);
  return `${pad(hour12)}:${pad(parsed.min)} ${meridiem}`;
}

const clampHour = (n: number) => ((((n - 1) % 12) + 12) % 12) + 1;
const clampMinute = (n: number) => ((n % 60) + 60) % 60;

const TimePicker = React.forwardRef<HTMLButtonElement, TimePickerProps>(
  ({ value, onChange, placeholder = "Pick a time", disabled, className, step = 15 }, ref) => {
    const [open, setOpen] = React.useState(false);
    const display = formatDisplay(value);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            type="button"
            variant="outline"
            disabled={disabled}
            className={cn(
              "h-9 w-full justify-start gap-2 rounded-xl border-border/70 bg-gradient-to-b from-card to-muted/20 dark:from-zinc-900 dark:to-zinc-950 px-3 text-left font-normal shadow-sm hover:border-primary/30",
              !display && "text-muted-foreground",
              open && "border-primary/40 ring-2 ring-primary/25 shadow-md shadow-primary/10",
              className,
            )}
          >
            <Clock className="h-4 w-4 shrink-0 text-primary/70" />
            <span className="truncate text-sm">{display ?? placeholder}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[260px] p-3">
          {open && (
            <TimePickerPanel
              value={value}
              step={step}
              onChange={(v) => onChange?.(v)}
              onDone={() => setOpen(false)}
            />
          )}
        </PopoverContent>
      </Popover>
    );
  },
);
TimePicker.displayName = "TimePicker";

interface TimePickerPanelProps {
  value?: string;
  step: number;
  onChange: (value: string) => void;
  onDone: () => void;
}

// Mounted fresh each time the popover opens (see `{open && ...}` above), so
// local edit state can be seeded straight from `value` without an effect.
function TimePickerPanel({ value, step, onChange, onDone }: TimePickerPanelProps) {
  const parsed = parse24(value);
  const initial = parsed ? to12(parsed.h) : { hour12: 9, meridiem: "AM" as const };
  const initialMinute = parsed ? parsed.min : 0;

  const [hourInput, setHourInput] = React.useState(pad(initial.hour12));
  const [minuteInput, setMinuteInput] = React.useState(pad(initialMinute));
  const [meridiemState, setMeridiemState] = React.useState<"AM" | "PM">(initial.meridiem);

  const commit = (h12: number, min: number, mer: "AM" | "PM") => {
    onChange(`${pad(to24(h12, mer))}:${pad(min)}`);
  };

  const stepHour = (delta: number) => {
    const next = clampHour(Number(hourInput || 12) + delta);
    setHourInput(pad(next));
    commit(next, Number(minuteInput || 0), meridiemState);
  };
  const stepMinute = (delta: number) => {
    const next = clampMinute(Number(minuteInput || 0) + delta);
    setMinuteInput(pad(next));
    commit(Number(hourInput || 12), next, meridiemState);
  };

  const quickTimes = React.useMemo(() => {
    const times: { value: string; label: string }[] = [];
    for (let m = 0; m < 24 * 60; m += step) {
      const v = `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
      times.push({ value: v, label: formatDisplay(v)! });
    }
    return times;
  }, [step]);

  return (
    <>
      <div className="flex items-center justify-center gap-1.5">
        <TimeSegment
          value={hourInput}
          onValueChange={setHourInput}
          onCommit={() => {
            const n = clampHour(Number(hourInput || 12));
            setHourInput(pad(n));
            commit(n, Number(minuteInput || 0), meridiemState);
          }}
          onStep={stepHour}
        />
        <span className="pb-0.5 text-lg font-bold text-muted-foreground">:</span>
        <TimeSegment
          value={minuteInput}
          onValueChange={setMinuteInput}
          onCommit={() => {
            const n = clampMinute(Number(minuteInput || 0));
            setMinuteInput(pad(n));
            commit(Number(hourInput || 12), n, meridiemState);
          }}
          onStep={stepMinute}
        />
        <div className="ml-2 flex flex-col overflow-hidden rounded-lg border border-border/70">
          {(["AM", "PM"] as const).map((mer) => (
            <button
              key={mer}
              type="button"
              onClick={() => {
                setMeridiemState(mer);
                commit(Number(hourInput || 12), Number(minuteInput || 0), mer);
              }}
              className={cn(
                "px-2.5 py-1 text-xs font-bold transition-colors",
                meridiemState === mer
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:bg-accent",
              )}
            >
              {mer}
            </button>
          ))}
        </div>
      </div>

      <div className="section-label mb-1.5 mt-3">Quick pick</div>
      <div className="grid max-h-40 grid-cols-3 gap-1 overflow-y-auto pr-1">
        {quickTimes.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => {
              onChange(t.value);
              onDone();
            }}
            className={cn(
              "rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
              value === t.value
                ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                : "text-foreground/80 hover:bg-primary/10 hover:text-primary",
            )}
          >
            {t.label}
          </button>
        ))}
      </div>
    </>
  );
}

interface TimeSegmentProps {
  value: string;
  onValueChange: (v: string) => void;
  onCommit: () => void;
  onStep: (delta: number) => void;
}

function TimeSegment({ value, onValueChange, onCommit, onStep }: TimeSegmentProps) {
  return (
    <div className="flex flex-col items-center">
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onStep(1)}
        className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
      >
        <ChevronUp className="h-3.5 w-3.5" />
      </button>
      <input
        value={value}
        inputMode="numeric"
        maxLength={2}
        onChange={(e) => onValueChange(e.target.value.replace(/\D/g, "").slice(0, 2))}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === "Enter") onCommit();
          if (e.key === "ArrowUp") {
            e.preventDefault();
            onStep(1);
          }
          if (e.key === "ArrowDown") {
            e.preventDefault();
            onStep(-1);
          }
        }}
        onWheel={(e) => {
          e.preventDefault();
          onStep(e.deltaY < 0 ? 1 : -1);
        }}
        className="h-9 w-10 rounded-lg border border-border/70 bg-gradient-to-b from-card to-muted/20 text-center text-base font-bold tabular-nums shadow-[inset_0_1px_2px_rgba(15,23,42,0.04)] outline-none focus-visible:ring-2 focus-visible:ring-primary/25 dark:from-zinc-900 dark:to-zinc-950 dark:shadow-[inset_0_1px_2px_rgba(0,0,0,0.3)]"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => onStep(-1)}
        className="rounded-md p-0.5 text-muted-foreground transition-colors hover:bg-accent hover:text-primary"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export { TimePicker };
