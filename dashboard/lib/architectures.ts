import "server-only";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { Architecture } from "@/lib/types";

// config/architectures.json, the single source of truth shared with the scripts. Mounted
// into the container by docker-compose.yml; next to the dashboard folder in development.
const CONFIG_FILE =
  process.env.ARCHITECTURES_FILE ?? path.resolve(process.cwd(), "../config/architectures.json");

interface ConfigFile {
  architectures: { parallel: Omit<Architecture, "name"> };
}

let loaded: Architecture | undefined;

/** Read once, at the first request (never at build time, when the file is not there). */
export function getArchitecture(): Architecture {
  if (!loaded) {
    // Read at runtime from a mounted file, so the build must not trace (bundle) it.
    const data = JSON.parse(readFileSync(/*turbopackIgnore: true*/ CONFIG_FILE, "utf8")) as ConfigFile;
    if (!data.architectures?.parallel) throw new Error(`${CONFIG_FILE} must define "parallel"`);
    loaded = { ...data.architectures.parallel, name: "parallel" };
  }
  return loaded;
}
