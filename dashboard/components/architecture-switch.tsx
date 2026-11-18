"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { usePipelineContext } from "@/components/pipeline/pipeline-context";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { ARCH_COOKIE, archLetter, isArchName } from "@/lib/arch";
import type { ArchName, ArchitectureChoice } from "@/lib/types";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Chooses the architecture every page shows: its live pipeline, its HDFS zone and its MySQL
 * results. The choice is a cookie, so server-rendered pages and API routes see it too.
 */
export function ArchitectureSwitch() {
  const router = useRouter();
  const { snapshot, refresh } = usePipelineContext();
  const [choices, setChoices] = useState<ArchitectureChoice[] | null>(null);
  const [selected, setSelected] = useState<ArchName | null>(null);

  useEffect(() => {
    fetch("/api/architectures", { cache: "no-store" })
      .then((response) => response.json() as Promise<{ selected: ArchName; choices: ArchitectureChoice[] }>)
      .then((data) => {
        setChoices(data.choices);
        setSelected((current) => current ?? data.selected);
      })
      .catch(() => setChoices([]));
  }, []);

  if (!choices) return <Skeleton className="h-8 w-56 rounded-lg" />;
  if (choices.length === 0) return null;
  const value = selected ?? snapshot?.arch ?? null;

  function choose(name: ArchName) {
    if (name === value) return;
    document.cookie = `${ARCH_COOKIE}=${name}; path=/; max-age=${ONE_YEAR}; samesite=lax`;
    setSelected(name);
    refresh();
    router.refresh();
  }

  return (
    <ToggleGroup
      value={value ? [value] : []}
      onValueChange={(next: string[]) => isArchName(next[0]) && choose(next[0])}
      variant="outline"
      size="sm"
      aria-label="Architecture"
    >
      {choices.map((choice) => (
        <Tooltip key={choice.name}>
          <TooltipTrigger
            render={
              <ToggleGroupItem value={choice.name} className="gap-1.5 px-2.5 text-xs aria-pressed:bg-primary aria-pressed:text-primary-foreground aria-pressed:hover:bg-primary" />
            }
          >
            <span className="font-display">{archLetter(choice.name)}</span>
            <span className="hidden sm:inline">{choice.label.replace(/^[AB] · /, "")}</span>
          </TooltipTrigger>
          <TooltipContent>
            {choice.label}: {choice.summary}
          </TooltipContent>
        </Tooltip>
      ))}
    </ToggleGroup>
  );
}
