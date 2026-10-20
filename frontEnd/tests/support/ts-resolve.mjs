// Test-only module resolver: lets plain Node import the app's TypeScript sources (extensionless relative imports and the `@/` alias).
import { existsSync } from "node:fs";
import { pathToFileURL, fileURLToPath } from "node:url";
import path from "node:path";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../src");
const tryExt = (p) => {
  for (const c of [p, `${p}.ts`, `${p}.tsx`, path.join(p, "index.ts")]) if (existsSync(c) && /\.(ts|tsx)$/.test(c)) return c;
  return null;
};
export async function resolve(spec, ctx, next) {
  if (spec.startsWith("@/")) { const f = tryExt(path.join(SRC, spec.slice(2))); if (f) return { url: pathToFileURL(f).href, shortCircuit: true }; }
  if ((spec.startsWith("./") || spec.startsWith("../")) && ctx.parentURL?.startsWith("file:")) {
    const f = tryExt(path.resolve(path.dirname(fileURLToPath(ctx.parentURL)), spec));
    if (f) return { url: pathToFileURL(f).href, shortCircuit: true };
  }
  return next(spec, ctx);
}
