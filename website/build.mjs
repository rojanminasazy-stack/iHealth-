import { build } from "esbuild";
import { cp, mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Builds the static site into dist/. config.json is written at deploy time by CDK. */
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src/pages", "dist", { recursive: true });
await cp("src/site.css", "dist/site.css");
await mkdir("dist/fonts", { recursive: true });
const FONTS = "../node_modules";
await cp(`${FONTS}/@fontsource-variable/public-sans/files/public-sans-latin-wght-normal.woff2`, "dist/fonts/public-sans.woff2");
await cp(`${FONTS}/@fontsource/newsreader/files/newsreader-latin-500-normal.woff2`, "dist/fonts/newsreader-500.woff2");
await cp(`${FONTS}/@fontsource/newsreader/files/newsreader-latin-600-normal.woff2`, "dist/fonts/newsreader-600.woff2");
await build({
  entryPoints: { visit: "src/visit.ts", "staff/staff": "src/staff.ts" },
  outdir: "dist",
  bundle: true,
  minify: true,
  sourcemap: false,
  format: "esm",
  target: "es2020",
  platform: "browser",
  define: { global: "globalThis" },
  // The Chime SDK pulls in AWS SDK messaging clients we never call; stub their Node-only imports.
  plugins: [
    {
      name: "stub-node-builtins",
      setup(b) {
        b.onResolve({ filter: /^node:/ }, (a) => ({ path: a.path, namespace: "stub" }));
        b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({ contents: "export default {};", loader: "js" }));
      },
    },
  ],
  logLevel: "warning",
});
console.log("website built → dist/");

/**
 * Security headers for static hosting (GitHub Pages can't set response headers),
 * added to every page as meta tags, plus the favicon.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "media-src 'self' blob: mediastream:",
  "worker-src 'self' blob:",
  "connect-src 'self' https://*.amazonaws.com https://*.chime.aws wss://*.chime.aws",
  "base-uri 'none'",
  "form-action 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");
const HEAD = `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">`;
/** Shared header/footer, and the two outside form links (Tally) from src/links.json. */
const LOGO = (await readFile("src/partials/logo.svg", "utf8")).trim();
const HEADER = (await readFile("src/partials/header.html", "utf8")).replaceAll("{{LOGO}}", LOGO);
const FOOTER = (await readFile("src/partials/footer.html", "utf8")).replaceAll("{{LOGO}}", LOGO);
const links = JSON.parse(await readFile("src/links.json", "utf8"));
const safeUrl = (u) => (/^https:\/\/[\w.-]+\/[\w\-./?=&%]*$/.test(u ?? "") ? u : "");
const WAITLIST = safeUrl(links.waitlist);
const APPLY = safeUrl(links.apply);
const BODIES = {
  WAITLIST: WAITLIST
    ? `<p>We'll email you the day iHealthé opens in your state. We only ask for your name, email and state. Never anything about your health.</p>
  <p><a class="btn btn-navy" href="${WAITLIST}">Open the waitlist form</a></p>
  <p class="muted">The form is hosted by Tally, our secure form provider.</p>`
    : `<p>The waitlist opens very soon. Check back in a day or two.</p>`,
  APPLY: APPLY
    ? `<p>The application takes about five minutes. Have these ready:</p>
  <ul class="checks"><li>Your 10-digit NPI</li><li>Each state license number and its expiration date</li><li>Your CV or resume as a PDF</li></ul>
  <p><a class="btn btn-navy" href="${APPLY}">Start your application</a></p>
  <p class="muted">The form is hosted by Tally, our secure form provider. Your files go only to the iHealthé credentialing team.</p>`
    : `<p>Applications open very soon. Check back in a day or two.</p>`,
};
const fill = (html) =>
  html
    .replace("<!--HEADER-->", HEADER)
    .replace("<!--FOOTER-->", FOOTER)
    .replace("{{REDIRECT_WAITLIST}}", "")
    .replace("{{REDIRECT_APPLY}}", "")
    .replace("{{BODY_WAITLIST}}", BODIES.WAITLIST)
    .replace("{{BODY_APPLY}}", BODIES.APPLY);

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) await walk(f);
    else if (f.endsWith(".html")) {
      let html = fill(await readFile(f, "utf8"));
      if (!html.includes("Content-Security-Policy")) html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${HEAD}`);
      await writeFile(f, html);
    }
  }
}
await walk("dist");
