import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import { cookies } from "next/headers";
import { ARCH_COOKIE, ARCH_NAMES, isArchName } from "@/lib/arch";
import type { ArchName, Architecture, ArchitectureChoice } from "@/lib/types";

// config/architectures.json, the single source of truth shared with the scripts. Mounted
// into the container by docker-compose.yml; next to the dashboard folder in development.
const CONFIG_FILE =
  process.env.ARCHITECTURES_FILE ?? path.resolve(process.cwd(), "../config/architectures.json");

interface ConfigFile {
  default: ArchName;
  architectures: Record<ArchName, Omit<Architecture, "name">>;
}

let loaded: ConfigFile | undefined;

/** Read once, at the first request (never at build time, when the file is not there). */
function load(): ConfigFile {
  if (!loaded) {
    // Read at runtime from a mounted file, so the build must not trace (bundle) it.
    const data = JSON.parse(readFileSync(/*turbopackIgnore: true*/ CONFIG_FILE, "utf8")) as ConfigFile;
    const names = Object.keys(data.architectures).sort().join(",");
    if (names !== [...ARCH_NAMES].sort().join(",") || !isArchName(data.default)) {
      throw new Error(`${CONFIG_FILE} must define exactly: ${ARCH_NAMES.join(", ")}`);
    }
    loaded = data;
  }
  return loaded;
}

export function getArchitecture(name: ArchName): Architecture {
  return { ...load().architectures[name], name };
}

export const defaultArch = (): ArchName => load().default;

export function architectureChoices(): ArchitectureChoice[] {
  return ARCH_NAMES.map((name) => {
    const { label, summary } = getArchitecture(name);
    return { name, label, summary };
  });
}

/** The architecture a request is about: an explicit, valid value, else the switch's cookie. */
export async function selectedArch(explicit?: string | null): Promise<ArchName> {
  if (isArchName(explicit)) return explicit;
  const chosen = (await cookies()).get(ARCH_COOKIE)?.value;
  return isArchName(chosen) ? chosen : defaultArch();
}
