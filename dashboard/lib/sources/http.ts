import "server-only";
import { config } from "@/lib/config";

/** GET a JSON document with a hard timeout. Throws on network errors and non-2xx answers. */
export async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(config.requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${url} answered ${response.status}`);
  }
  return (await response.json()) as T;
}

const lastFailure = new Map<string, string>();

/**
 * Run a probe and fall back to a default value when the system is unreachable.
 * Each new failure is logged once, so a stopped service does not flood the logs.
 */
export async function orFallback<T>(name: string, probe: () => Promise<T>, fallback: T): Promise<T> {
  try {
    const value = await probe();
    lastFailure.delete(name);
    return value;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (lastFailure.get(name) !== message) {
      lastFailure.set(name, message);
      console.warn(`[probe ${name}] unavailable: ${message}`);
    }
    return fallback;
  }
}
