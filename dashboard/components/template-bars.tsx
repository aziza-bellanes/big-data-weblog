import { cn } from "@/lib/utils";

/** Alternating navy and sage blocks, the signature band of the report template. */
export function TemplateBars({ className }: { className?: string }) {
  return (
    <div className={cn("grid h-1.5 grid-cols-6", className)} aria-hidden>
      {Array.from({ length: 6 }, (_, i) => (
        <span key={i} className={i % 2 === 0 ? "bg-navy" : "bg-sage"} />
      ))}
    </div>
  );
}
