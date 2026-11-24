import { build } from "esbuild";
import { cp, mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Builds the static site into dist/. src/pages/config.json holds the public backend IDs for the staff page. */
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

/**
 * Search and social-share tags per page. Private pages (visits, staff, Stripe returns, 404)
 * get noindex so search engines skip them.
 */
const SITE = "https://ihealthe.net";
const SEO = {
  "/": {
    title: "iHealthé: See a licensed physician from your phone",
    description: "Private 20-minute video visits with a verified physician licensed in your state. $79 per visit. Ask for a doctor who speaks your language.",
  },
  "/physicians.html": {
    title: "iHealthé for Physicians: See patients on your schedule",
    description: "Go online when you're free and see patients in the states where you're licensed. Get paid directly. Founding physicians get 90 days free.",
  },
  "/apply.html": { title: "Apply to see patients on iHealthé", description: "Apply to join iHealthé as a physician. Have your NPI, state license numbers and CV ready. It takes about five minutes." },
  "/waitlist.html": { title: "Get early access to iHealthé", description: "Join the waitlist and we'll email you the day iHealthé opens in your state. We only ask for your name, email and state." },
  "/privacy.html": { title: "Privacy Policy | iHealthé", description: "What iHealthé collects, how it's protected, who it's shared with, and how to delete your account." },
  "/privacy-notice.html": { title: "Notice of Privacy Practices | iHealthé", description: "How your health information may be used and shared, and your rights to see and correct it." },
  "/terms.html": { title: "Terms of Service | iHealthé", description: "The terms for using iHealthé video visits, the AI assistant and the iHealthé apps." },
};
const seoTags = (path) => {
  const s = SEO[path];
  if (!s) return `<meta name="robots" content="noindex, nofollow">`;
  const url = SITE + path;
  const esc = (t) => t.replaceAll("&", "&amp;").replaceAll('"', "&quot;");
  return [
    `<meta name="description" content="${esc(s.description)}">`,
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="iHealthé">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:title" content="${esc(s.title)}">`,
    `<meta property="og:description" content="${esc(s.description)}">`,
    `<meta property="og:image" content="${SITE}/og-image.png">`,
    `<meta property="og:image:width" content="1200">`,
    `<meta property="og:image:height" content="630">`,
    `<meta property="og:image:alt" content="iHealthé: see a licensed physician by video">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="theme-color" content="#14254a">`,
  ].join("\n");
};
const ICONS = `<link rel="icon" href="/favicon.ico" sizes="32x32">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">`;

async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) await walk(f);
    else if (f.endsWith(".html")) {
      let html = fill(await readFile(f, "utf8"));
      const rel = "/" + f.slice("dist/".length).replaceAll("\\", "/");
      const path = rel === "/index.html" ? "/" : rel;
      if (!html.includes("Content-Security-Policy"))
        html = html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${HEAD}\n${ICONS}\n${seoTags(path)}`);
      await writeFile(f, html);
    }
  }
}
await walk("dist");
