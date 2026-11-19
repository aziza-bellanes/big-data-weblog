// A4 page builders shared by the report and the guide: plain and cream pages with the template's
// block bars, content pages with a page number, and the big numbered section dividers.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { esc } from "./format.ts";
import { asset, bars } from "./layout.ts";

export interface PageOptions {
  cream?: boolean;
  bars?: "both" | "none";
  className?: string;
}

/** Page builders for one document; they number pages in the order they are called. */
export function createPages(sections: readonly string[]) {
  let pageNo = 0;

  const page = (body: string, opts: PageOptions = {}): string => {
    pageNo += 1;
    const showBars = (opts.bars ?? "both") === "both";
    return `<section class="page ${opts.cream ? "cream" : ""} ${opts.className ?? ""}">
    ${showBars ? bars("top") : ""}${body}${showBars ? bars("bottom") : ""}
  </section>`;
  };

  const contentPage = (title: string, body: string) =>
    page(`<div class="content"><h2 class="label-strong">${title}</h2>${body}</div>
    <span class="page-number">${String(pageNo + 1).padStart(2, "0")}</span>`);

  const divider = (index: number) =>
    page(
      `<div class="display vertical-title">${sections[index]}</div>
     <div class="display big-number">${String(index + 1).padStart(2, "0")}</div>`,
      { cream: true, bars: "none", className: "divider" },
    );

  const contents = (institution: string) =>
    page(
      `<p class="brand label-light">${esc(institution)}</p>
     <div class="display vertical-title">Contents</div>
     <ol>${sections.map((s, i) => `<li><span class="num">${i + 1}</span><span class="entry">${s}</span></li>`).join("")}</ol>`,
      { cream: true, bars: "none", className: "toc" },
    );

  return { page, contentPage, divider, contents };
}

/** An image under docs/ with its caption. */
export const figure = (src: string, caption: string, className = "") =>
  `<div class="figure ${className}"><img src="${asset(src)}" alt="${esc(caption)}"><p class="caption">${caption}</p></div>`;

/** True when the image exists: screenshots only appear in the documents once `make screenshots` has captured them. */
export const hasAsset = (src: string) => existsSync(fileURLToPath(asset(src)));

/** Like `figure`, but empty while the screenshot has not been captured. */
export const optionalFigure = (src: string, caption: string, className = "") => hasAsset(src) ? figure(src, caption, className) : "";
