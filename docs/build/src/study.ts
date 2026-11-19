// Print the complete Markdown walkthrough and demo checklist in the existing A4 style.
import { readFile, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { architectureSvg } from "./diagram.ts";
import { esc } from "./format.ts";
import { bars, DOCS_DIR, htmlDocument } from "./layout.ts";

interface Block { html: string; chapter?: string; }

function inline(value: string): string {
  const pieces = value.split(/(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g);
  return pieces.map((part) => {
    if (part.startsWith("`")) return `<code>${esc(part.slice(1, -1))}</code>`;
    if (part.startsWith("**")) return `<strong>${esc(part.slice(2, -2))}</strong>`;
    const link = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (link) {
      const href = /^https?:\/\//.test(link[2]) ? link[2]
        : `https://github.com/JedidiAymen/weblogs-pipeline/blob/main/docs/${link[2]}`;
      return `<a href="${esc(href)}">${esc(link[1])}</a>`;
    }
    return esc(part);
  }).join("");
}

function markdown(source: string, appendix = false): Block[] {
  const lines = source.replace(/[\u2010-\u2015]/g, "-").split("\n");
  const result: Block[] = [];
  let i = 0;
  const listPattern = /^(\s*)([-*]|\d+\.)\s+(.+)$/;
  function list(indent: number): string {
    const first = lines[i].match(listPattern)!;
    const ordered = /\d/.test(first[2]);
    const tag = ordered ? "ol" : "ul";
    let body = "";
    while (i < lines.length) {
      const item = lines[i].match(listPattern);
      if (!item || item[1].length !== indent || /\d/.test(item[2]) !== ordered) break;
      let value = inline(item[3]);
      i += 1;
      const next = lines[i]?.match(listPattern);
      if (next && next[1].length > indent) value += list(next[1].length);
      body += `<li>${value}</li>`;
    }
    return `<${tag}${ordered ? ` start="${parseInt(first[2])}"` : ""}>${body}</${tag}>`;
  }
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || /^# /.test(line)) { i += 1; continue; }
    if (line.trimStart().startsWith("```")) {
      const code: string[] = [];
      const indent = line.length - line.trimStart().length;
      i += 1;
      while (i < lines.length && !lines[i].trimStart().startsWith("```")) code.push(lines[i++].slice(indent));
      i += 1;
      const value = code.join("\n");
      const diagram = value.startsWith("NASA archives");
      result.push({ html: diagram ? `<div class="figure">${architectureSvg()}</div>`
        : `<pre class="code"><code>${esc(value)}</code></pre>` });
      continue;
    }
    const heading = line.match(/^(#{2,3}) (.+)$/);
    if (heading) {
      const chapter = heading[1].length === 2 && !appendix;
      result.push(chapter ? { html: "", chapter: heading[2] }
        : { html: `<h3>${inline(heading[2])}</h3>` });
      i += 1;
      continue;
    }
    if (line.startsWith("|")) {
      const rows: string[][] = [];
      while (i < lines.length && lines[i].startsWith("|")) {
        rows.push(lines[i++].slice(1, -1).split("|").map((cell) => cell.trim()));
      }
      const head = rows.shift()!;
      if (rows[0]?.every((cell) => /^:?-+:?$/.test(cell))) rows.shift();
      result.push({ html: `<table class="data"><thead><tr>${head.map((cell) => `<th>${inline(cell)}</th>`).join("")}</tr></thead>
        <tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${inline(cell)}</td>`).join("")}</tr>`).join("")}</tbody></table>` });
      continue;
    }
    if (listPattern.test(line)) {
      result.push({ html: list(line.match(listPattern)![1].length) });
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) quote.push(lines[i++].replace(/^>\s?/, ""));
      result.push({ html: `<blockquote><p>${inline(quote.join(" "))}</p></blockquote>` });
      continue;
    }
    const paragraph = [line];
    i += 1;
    while (i < lines.length && lines[i].trim() && !/^(#|\||>)/.test(lines[i]) && !lines[i].trimStart().startsWith("```") && !listPattern.test(lines[i])) {
      paragraph.push(lines[i++]);
    }
    result.push({ html: `<p>${inline(paragraph.join(" "))}</p>` });
  }
  return result;
}

async function main() {
  const [source, demo, metaText] = await Promise.all([
    readFile(`${DOCS_DIR}DEFENSE_PREPARATION.md`, "utf8"),
    readFile(`${DOCS_DIR}DEMO.md`, "utf8"),
    readFile(`${DOCS_DIR}meta.json`, "utf8"),
  ]);
  const meta = JSON.parse(metaText);
  const parsed = markdown(source);
  const firstChapter = parsed.findIndex((block) => block.chapter);
  const introduction = parsed.slice(0, firstChapter).map((block) => block.html).join("");
  const blocks = [...parsed.slice(firstChapter), { html: "", chapter: "Appendix - Record the full demo" }, ...markdown(demo, true)];
  const cover = `<section class="page cream study-cover">${bars("top")}
    <div class="cover"><p class="brand label-light">${esc(meta.institution)}</p>
    <h1 class="display">The project,<br>in detail</h1>
    <p class="subtitle">Every tool, the speed layer, the important code and the questions to rehearse</p>
    <p class="authors">${meta.authors.map(esc).join(" · ")}</p>
    <p class="meta">${esc(meta.course)}</p>
    <p class="reading-note">A complete presentation-preparation guide, with the full recording checklist.</p>
    <p class="date">${esc(meta.date)}</p></div>${bars("bottom")}</section>`;
  const topics = [
    [1, "Purpose, input and every tool"], [4, "Hadoop and the pipeline"],
    [6, "Flume, Kafka and HDFS"], [8, "The speed layer: Spark"],
    [10, "Hive, Sqoop and MySQL"], [12, "The website, ports and Docker"],
    [16, "Read the important code"], [17, "Verification and recovery"],
    [19, "Reports, commands and questions"], [23, "Record the full demo"],
  ];
  const contents = `<section class="page cream study-contents">${bars("top")}
    <div class="content study-body"><h2 class="label-strong">Read it in order</h2>
    <p>Start with the data and the architecture. Then follow one line through the code, rehearse the questions and use the appendix when recording.</p>
    <ol class="contents-list">${topics.map(([number, title], index) => `<li><a href="#chapter-${number}">
      <span class="num">${String(index + 1).padStart(2, "0")}</span><span class="topic">${title}</span>
      <span class="folio" data-chapter="${number}"></span></a></li>`).join("")}</ol>
    <div class="panel"><p><strong>The central distinction:</strong> the three ingestion branches run concurrently, and Kafka feeds both HDFS and the Spark speed layer. Verification, Hive analysis with its speed check, and final export are ordered phases afterward.</p></div>${introduction}
    </div>${bars("bottom")}</section>`;
  const htmlPath = `${DOCS_DIR}study/study.html`;
  await writeFile(htmlPath, await htmlDocument("The project, in detail", ["report/report.css", "study/study.css"], cover + contents));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 1200 } });
    // tsx preserves local function names with this helper when serializing evaluate.
    await page.addInitScript({ content: "globalThis.__name = (fn, name) => Object.defineProperty(fn, 'name', { value: name, configurable: true });" });
    await page.goto(`file://${htmlPath}`);
    await page.evaluate(() => document.fonts.ready);
    const result = await page.evaluate(({ blocks, barsHtml }) => {
      let body: HTMLElement = document.createElement("div");
      let title = "";
      let chapter = 0;
      const pageForChapter: Record<number, number> = {};
      function newPage(first = false) {
        const section = document.createElement("section");
        section.className = "page";
        section.dataset.continuation = String(!first);
        section.innerHTML = `${barsHtml}<span class="study-running">Weblogs / Presentation preparation</span>
          <div class="content study-body"><h2 class="label-strong" ${first ? `id="chapter-${chapter}"` : ""}></h2></div>`;
        body = section.querySelector(".content")!;
        body.querySelector("h2")!.textContent = title;
        if (!first) body.querySelector("h2")!.insertAdjacentHTML("beforeend", ' <span class="continued">/ continued</span>');
        document.body.append(section);
        if (first) pageForChapter[chapter] = document.querySelectorAll(".page").length;
      }
      function fits() {
        return Math.max(...[...body.children].map((element) => element.getBoundingClientRect().bottom)) <= body.getBoundingClientRect().bottom + 0.5
          && body.scrollWidth <= body.clientWidth + 1;
      }
      function nextPage() {
        const last = body.lastElementChild;
        const label = last?.tagName === "P" && (last.textContent?.trim().length || 0) < 100
          && last.textContent?.trim().endsWith(":");
        const carry = last?.tagName === "H3" || label ? last : null;
        carry?.remove();
        newPage();
        if (carry) body.append(carry);
      }
      function place(node: Element) {
        body.append(node);
        if (fits()) return;
        node.remove();
        nextPage();
        body.append(node);
        if (!fits()) throw new Error(`Block too tall or wide in ${title}: ${node.textContent?.slice(0, 100)}`);
      }
      for (const block of blocks) {
        if (block.chapter) {
          title = block.chapter;
          chapter += 1;
          const section = body.closest<HTMLElement>(".page");
          const used = body.isConnected ? body.lastElementChild!.getBoundingClientRect().bottom - body.getBoundingClientRect().top : Infinity;
          if (section?.dataset.continuation === "true" && used < body.clientHeight * 0.45) {
            const heading = document.createElement("h2");
            heading.className = "label-strong";
            heading.id = `chapter-${chapter}`;
            heading.textContent = title;
            body.append(heading);
            pageForChapter[chapter] = document.querySelectorAll(".page").length;
          } else {
            newPage(true);
          }
          continue;
        }
        if (!body.isConnected) throw new Error("Content appeared before the first chapter");
        const template = document.createElement("template");
        template.innerHTML = block.html;
        const node = template.content.firstElementChild!;
        if (node.tagName === "TABLE") {
          const original = node as HTMLTableElement;
          const rows = [...original.tBodies[0].rows];
          function freshTable() {
            const table = original.cloneNode(false) as HTMLTableElement;
            table.append(original.tHead!.cloneNode(true));
            table.createTBody();
            body.append(table);
            return table;
          }
          let table = freshTable();
          for (const row of rows) {
            table.tBodies[0].append(row);
            if (!fits()) {
              row.remove();
              if (!table.tBodies[0].rows.length) table.remove();
              nextPage();
              table = freshTable();
              table.tBodies[0].append(row);
              if (!fits()) throw new Error(`Table row too large: ${row.textContent}`);
            }
          }
        } else if (node.tagName === "UL" || node.tagName === "OL") {
          const items = [...node.children];
          const initial = Number(node.getAttribute("start") || 1);
          let list = node.cloneNode(false) as HTMLElement;
          body.append(list);
          for (let index = 0; index < items.length; index++) {
            list.append(items[index]);
            if (!fits()) {
              items[index].remove();
              if (!list.children.length) list.remove();
              nextPage();
              list = node.cloneNode(false) as HTMLElement;
              if (node.tagName === "OL") list.setAttribute("start", String(initial + index));
              body.append(list);
              list.append(items[index]);
              if (!fits()) throw new Error("List item too large");
            }
          }
        } else {
          place(node);
        }
      }
      const pages = [...document.querySelectorAll<HTMLElement>(".page")];
      pages.forEach((section, index) => {
        if (index === 0) return;
        const footer = document.createElement("span");
        footer.className = "page-number";
        footer.textContent = `${String(index + 1).padStart(2, "0")} / ${pages.length}`;
        section.append(footer);
      });
      document.querySelectorAll<HTMLElement>("[data-chapter]").forEach((entry) => {
        entry.textContent = String(pageForChapter[Number(entry.dataset.chapter)]).padStart(2, "0");
      });
      const failures = pages.flatMap((section, index) => {
        const content = section.querySelector<HTMLElement>(".content");
        if (!content) return [];
        const bottom = Math.max(...[...content.children].map((node) => node.getBoundingClientRect().bottom));
        return bottom > content.getBoundingClientRect().bottom + 1 || content.scrollWidth > content.clientWidth + 1
          || ["H2", "H3"].includes(content.lastElementChild?.tagName || "") ? [`Page ${index + 1} overflow/orphan`] : [];
      });
      if (failures.length) throw new Error(failures.join("; "));
      return { pages: pages.length, chapters: chapter, pageForChapter };
    }, { blocks, barsHtml: bars("top") + bars("bottom") });
    await writeFile(htmlPath, await page.content());
    await page.pdf({ path: `${DOCS_DIR}study.pdf`, preferCSSPageSize: true, printBackground: true, outline: true, tagged: true });
    console.log(JSON.stringify(result));
    console.log("Wrote docs/study.pdf");
  } finally {
    await browser.close();
  }
}

main().catch((error: unknown) => { console.error(error); process.exit(1); });
