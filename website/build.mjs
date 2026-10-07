import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";

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
