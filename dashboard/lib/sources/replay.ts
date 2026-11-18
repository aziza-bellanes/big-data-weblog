import "server-only";
import { stat, readFile } from "node:fs/promises";
import type { ReplayStatus } from "@/lib/types";

// Both writers rewrite their checkpoint after every batch, several times per second.
const ACTIVE_WINDOW_MS = 3000;

/**
 * Progress read from a resumable checkpoint file: the replayer's (lines written to the live
 * log) or, in architecture B, the Kafka producer's (events acknowledged by Kafka).
 */
export async function fetchCheckpoint(file: string): Promise<ReplayStatus> {
  try {
    const [content, info] = await Promise.all([readFile(file, "utf8"), stat(file)]);
    const active = Date.now() - info.mtimeMs < ACTIVE_WINDOW_MS;
    return { state: active ? "active" : "idle", linesWritten: Number(content.trim()) || 0 };
  } catch {
    // No checkpoint yet: nothing has run since the last reset.
    return { state: "idle", linesWritten: 0 };
  }
}
