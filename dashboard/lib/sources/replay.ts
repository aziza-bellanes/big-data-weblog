import "server-only";
import { stat, readFile } from "node:fs/promises";
import { config } from "@/lib/config";
import type { ReplayStatus } from "@/lib/types";

// The replayer rewrites its offset file after every batch (10 per second).
const ACTIVE_WINDOW_MS = 3000;

/** Lines replayed so far, read from the replayer's resumable offset file. */
export async function fetchReplayStatus(): Promise<ReplayStatus> {
  try {
    const [content, info] = await Promise.all([
      readFile(config.replayOffsetFile, "utf8"),
      stat(config.replayOffsetFile),
    ]);
    const active = Date.now() - info.mtimeMs < ACTIVE_WINDOW_MS;
    return { state: active ? "active" : "idle", linesWritten: Number(content.trim()) || 0 };
  } catch {
    // No offset file yet: the replayer has never run.
    return { state: "idle", linesWritten: 0 };
  }
}
