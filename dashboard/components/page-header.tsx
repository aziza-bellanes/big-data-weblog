import type { ReactNode } from "react";
import { ArchitectureSwitch } from "@/components/architecture-switch";
import { TemplateBars } from "@/components/template-bars";
import { ThemeToggle } from "@/components/theme-toggle";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";

interface PageHeaderProps {
  /** Section number, shown large as in the template's divider pages. */
  number: string;
  eyebrow: string;
  title: string;
  description: ReactNode;
  /** Live indicators or actions, shown on the right of the title. */
  aside?: ReactNode;
}

/** Top bar, template band and page title, shared by every page. */
export function PageHeader({ number, eyebrow, title, description, aside }: PageHeaderProps) {
  return (
    <>
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b bg-background/85 px-4 backdrop-blur">
        <SidebarTrigger />
        <Separator orientation="vertical" className="mr-1 h-5" />
        <span className="eyebrow text-muted-foreground">{eyebrow}</span>
        <div className="ml-auto flex items-center gap-2">
          <ArchitectureSwitch />
          <ThemeToggle />
        </div>
      </header>
      <TemplateBars />
      <div className="relative overflow-hidden px-6 pt-10 pb-8 lg:px-10">
        <span
          className="pointer-events-none absolute -top-6 right-6 font-display text-[9rem] leading-none text-primary/[0.06] select-none lg:right-10"
          aria-hidden
        >
          {number}
        </span>
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl">
            <p className="eyebrow text-muted-foreground">
              <span className="text-primary">{number}</span> · {eyebrow}
            </p>
            <h1 className="mt-2 font-display text-3xl text-primary uppercase lg:text-4xl">{title}</h1>
            <div className="mt-3 text-sm leading-relaxed text-muted-foreground">{description}</div>
          </div>
          {aside && <div className="shrink-0">{aside}</div>}
        </div>
      </div>
    </>
  );
}

/** Standard page body padding and vertical rhythm. */
export function PageBody({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-6 px-6 pb-16 lg:px-10">{children}</div>;
}

/** Section title in the template style: a number block, a wide uppercase title and a lead. */
export function SectionTitle({ number, title, lead }: { number?: string; title: string; lead?: string }) {
  return (
    <div className="flex items-end gap-4 pt-4">
      {number ? (
        <span className="grid h-11 min-w-11 place-items-center rounded-md bg-primary px-2 font-display text-lg text-primary-foreground">
          {number}
        </span>
      ) : (
        <span className="grid h-11 w-3 grid-rows-2 overflow-hidden rounded-sm" aria-hidden>
          <span className="bg-navy" />
          <span className="bg-sage" />
        </span>
      )}
      <div>
        <h2 className="font-display text-lg text-primary uppercase">{title}</h2>
        {lead && <p className="text-sm text-muted-foreground">{lead}</p>}
      </div>
    </div>
  );
}

/** Which architecture's MySQL database the figures below come from. */
export function ResultsSource({ label, database }: { label: string; database: string }) {
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span className="rounded-md bg-primary px-2 py-0.5 font-display text-[0.65rem] text-primary-foreground uppercase">
        {label}
      </span>
      results from MySQL <code className="font-mono">{database}</code>. Switch architecture in the top bar.
    </p>
  );
}
