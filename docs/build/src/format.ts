const integer = new Intl.NumberFormat("en-US");

export const int = (value: number) => integer.format(Math.round(value));
export const pct = (value: number, digits = 2) => `${value.toFixed(digits)}%`;
export const hour = (h: number) => `${String(h).padStart(2, "0")}:00`;

export function bytes(value: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = value;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

/** "1995-07-13" -> "Jul 13" */
export const day = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/** Escape text for safe interpolation into HTML. */
export const esc = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
