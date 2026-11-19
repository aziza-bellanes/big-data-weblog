"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Maximize2, Minimize2, Terminal } from "lucide-react";
import { useJobLog } from "@/hooks/use-job-log";
import { cn } from "@/lib/utils";
import type { Job } from "@/lib/types";
import { ACTION_LABELS } from "./pipeline-context";
import { JobStatusBadge } from "./job-status";

function lineTone(text: string): string {
  if (text.startsWith("$ ")) return "text-sage font-semibold";
  if (/\[ERROR]|Exception|FAILED|ERROR /.test(text))
    return "text-[oklch(0.75_0.16_25)]";
  if (/\[WARN]|WARN /.test(text)) return "text-[oklch(0.83_0.12_80)]";
  if (/\[INFO]/.test(text)) return "text-console-foreground";
  return "text-console-foreground/65";
}

/** Live output of the current (or last) job, like a terminal in the browser. */
export function LogConsole({ job }: { job: Job | null }) {
  const running = job?.status === "running";
  const lines = useJobLog(job?.id ?? null, running);
  const scroller = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (follow && scroller.current)
      scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [lines, follow, expanded]);

  // Full size: Escape closes it, and the page behind does not scroll.
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) =>
      e.key === "Escape" && setExpanded(false);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onKey);
    };
  }, [expanded]);

  return (
    <>
      {expanded && (
        <div
          className="fixed inset-0 z-40 bg-navy/60 backdrop-blur-sm"
          onClick={() => setExpanded(false)}
          aria-hidden
        />
      )}
      <div
        role={expanded ? "dialog" : undefined}
        aria-modal={expanded || undefined}
        aria-label={expanded ? "Job output" : undefined}
        className={cn(
          "flex flex-col overflow-hidden rounded-xl bg-console text-console-foreground ring-1 ring-foreground/10",
          expanded ? "fixed inset-3 z-50 shadow-2xl sm:inset-6" : "h-[30rem]",
        )}
      >
        <div className="flex items-center gap-3 bg-console-header px-4 py-2.5">
          <span className="flex gap-1.5" aria-hidden>
            <span className="size-2.5 rounded-full bg-[#e06c5b]" />
            <span className="size-2.5 rounded-full bg-[#e8b04a]" />
            <span className="size-2.5 rounded-full bg-sage" />
          </span>
          <Terminal className="size-3.5 opacity-70" />
          <span className="truncate font-mono text-xs">
            {job
              ? `${ACTION_LABELS[job.action]} · ${job.id}`
              : "client container"}
          </span>
          <span className="ml-auto flex items-center gap-2">
            {job && <JobStatusBadge status={job.status} onDark />}
            <button
              type="button"
              onClick={() => setFollow((f) => !f)}
              className={cn(
                "grid size-6 place-items-center rounded transition-colors",
                follow
                  ? "bg-white/15 text-white"
                  : "text-white/50 hover:text-white",
              )}
              title={follow ? "Following new lines" : "Follow new lines"}
              aria-pressed={follow}
            >
              <ArrowDownToLine className="size-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setExpanded((e) => !e)}
              className="grid size-6 place-items-center rounded text-white/70 transition-colors hover:bg-white/15 hover:text-white"
              title={expanded ? "Exit full size (Esc)" : "Full size"}
              aria-label={
                expanded ? "Exit full size" : "Show the output full size"
              }
            >
              {expanded ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </button>
          </span>
        </div>
        <div
          ref={scroller}
          onWheel={(e) => e.deltaY < 0 && setFollow(false)}
          className={cn(
            "min-h-0 flex-1 overflow-y-auto px-4 py-3 font-mono leading-relaxed",
            expanded ? "text-[0.8rem]" : "text-[0.72rem]",
          )}
        >
          {!job && (
            <p className="text-console-foreground/60">
              Nothing has run from the dashboard yet. Start the replay or the
              batch pipeline above; its output streams here line by line.
            </p>
          )}
          {lines.map((line) => (
            <div
              key={line.seq}
              className={cn(
                "break-all whitespace-pre-wrap",
                lineTone(line.text),
              )}
            >
              {line.text}
            </div>
          ))}
          {running && (
            <span className="inline-block h-3.5 w-2 animate-pulse bg-console-foreground/70 align-middle" />
          )}
        </div>
      </div>
    </>
  );
}
