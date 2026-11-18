"use client";

import { useEffect, useState } from "react";
import type { LogLine } from "@/lib/types";

const POLL_INTERVAL_MS = 1000;
const MAX_LINES = 1500;

/**
 * Follow the log of a job: fetch new lines every second while it runs, then once more
 * after it ends so the last lines are not missed.
 */
export function useJobLog(jobId: string | null, running: boolean): LogLine[] {
  const [log, setLog] = useState<{ jobId: string | null; lines: LogLine[] }>({ jobId: null, lines: [] });

  useEffect(() => {
    if (!jobId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    let after = -1;

    async function poll() {
      try {
        const response = await fetch(`/api/jobs/${jobId}/log?after=${after}`, { cache: "no-store" });
        if (response.ok) {
          const body = (await response.json()) as { lines: LogLine[] };
          if (cancelled) return;
          if (body.lines.length) {
            after = body.lines[body.lines.length - 1].seq;
            setLog((current) => {
              const kept = current.jobId === jobId ? current.lines : [];
              const lastSeq = kept.at(-1)?.seq ?? -1;
              const fresh = body.lines.filter((line) => line.seq > lastSeq);
              return { jobId, lines: [...kept, ...fresh].slice(-MAX_LINES) };
            });
          }
        }
      } finally {
        if (!cancelled && running) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, running]);

  return log.jobId === jobId ? log.lines : [];
}
