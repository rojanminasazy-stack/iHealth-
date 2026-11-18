import { execSync } from "node:child_process";
import { readFile, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";

/**
 * Builds the patient and physician apps for the web into the website:
 *   ihealthe.net/app       → patient app
 *   ihealthe.net/provider  → physician app
 * Public settings (API address, sign-in pool ids, Stripe publishable key) come from EXPO_PUBLIC_* environment
 * variables. Until they're set, both apps show an "opening soon" screen.
 */
const dist = resolve("dist");
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.amazonaws.com https://*.amazoncognito.com",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

for (const [app, path] of [["patient", "app"], ["physician", "provider"]]) {
  const out = resolve(dist, path);
  await rm(out, { recursive: true, force: true });
  execSync(`npx expo export --platform web --clear --output-dir ${out}`, { cwd: resolve("../apps", app), stdio: "inherit", env: { ...process.env, CI: "1" } });
  const file = resolve(out, "index.html");
  const html = await readFile(file, "utf8");
  await writeFile(
    file,
    html.replace(
      "<head>",
      `<head>\n<meta http-equiv="Content-Security-Policy" content="${CSP}">\n<meta name="referrer" content="no-referrer">\n<meta name="robots" content="noindex">`,
    ),
  );
  console.log(`built ${app} → /${path}`);
}
