// HTML shell shared by the report, the slides and the guide: bundled fonts, the theme and a page stylesheet.
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DOCS_DIR = fileURLToPath(new URL("../../", import.meta.url));
const require = createRequire(import.meta.url);

/** file:// URL of a font file shipped in an @fontsource package. */
function fontUrl(pkg: string, file: string): string {
  const root = dirname(require.resolve(`${pkg}/package.json`));
  return pathToFileURL(`${root}/files/${file}`).href;
}

// Fonts are bundled with the build (no network): Archivo (variable width and weight) stands in
// for the template's CyGrotesk Wide; Poppins is the template's body font.
export const FONT_FACES = `
@font-face { font-family: "Archivo Variable"; font-weight: 100 900; font-stretch: 62% 125%;
  src: url("${fontUrl("@fontsource-variable/archivo", "archivo-latin-standard-normal.woff2")}") format("woff2"); }
@font-face { font-family: "Poppins"; font-weight: 400;
  src: url("${fontUrl("@fontsource/poppins", "poppins-latin-400-normal.woff2")}") format("woff2"); }
@font-face { font-family: "Poppins"; font-weight: 500;
  src: url("${fontUrl("@fontsource/poppins", "poppins-latin-500-normal.woff2")}") format("woff2"); }
@font-face { font-family: "Poppins"; font-weight: 600;
  src: url("${fontUrl("@fontsource/poppins", "poppins-latin-600-normal.woff2")}") format("woff2"); }
@font-face { font-family: "JetBrains Mono Variable"; font-weight: 100 800;
  src: url("${fontUrl("@fontsource-variable/jetbrains-mono", "jetbrains-mono-latin-wght-normal.woff2")}") format("woff2"); }
`;

export const bars = (position: "top" | "bottom") =>
  `<div class="bars ${position}">${"<span></span>".repeat(6)}</div>`;

/** Complete HTML document with fonts, the shared theme and the document's own stylesheets. */
export async function htmlDocument(title: string, stylesheets: string | string[], body: string): Promise<string> {
  const files = ["theme.css", ...(Array.isArray(stylesheets) ? stylesheets : [stylesheets])];
  const css = await Promise.all(files.map((file) => readFile(`${DOCS_DIR}${file}`, "utf8")));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${title}</title>
<style>${FONT_FACES}${css.join("\n")}</style>
</head>
<body>${body}</body>
</html>`;
}

/** file:// URL of an image under docs/, for <img src>. */
export const asset = (relativePath: string) => pathToFileURL(`${DOCS_DIR}${relativePath}`).href;
