import type { ArchName } from "@/lib/types";

// Shared by the server and the browser. Paths, topics and databases of each architecture
// are read from config/architectures.json on the server (lib/architectures.ts).

export const ARCH_NAMES: readonly ArchName[] = ["parallel", "sequential"];

/** Cookie holding the architecture chosen with the switch in the top bar. */
export const ARCH_COOKIE = "arch";

export const isArchName = (value: unknown): value is ArchName =>
  typeof value === "string" && (ARCH_NAMES as readonly string[]).includes(value);

/** Short letter used on badges: A (sequential) or B (parallel). */
export const archLetter = (name: ArchName) => (name === "sequential" ? "A" : "B");
