import { build } from "esbuild";
import { cp, mkdir, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Builds the static site into dist/. config.json is written at deploy time by CDK. */
await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("src/pages", "dist", { recursive: true });
await cp("src/site.css", "dist/site.css");
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
  "object-src 'none'",
  "upgrade-insecure-requests",
].join("; ");
const HEAD = `<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">\n<link rel="icon" href="/favicon.svg" type="image/svg+xml">`;
async function walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const f = join(dir, e.name);
    if (e.isDirectory()) await walk(f);
    else if (f.endsWith(".html")) {
      const html = await readFile(f, "utf8");
      if (!html.includes("Content-Security-Policy")) await writeFile(f, html.replace('<meta charset="utf-8">', `<meta charset="utf-8">\n${HEAD}`));
    }
  }
}
await walk("dist");
