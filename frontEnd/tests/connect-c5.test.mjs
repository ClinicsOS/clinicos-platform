// C5 — production build guard in next.config.mjs (NEXT_PUBLIC_API_URL must never silently fall back to localhost on a hosted build).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const cfg = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "next.config.mjs");
function load(env) {
  const base = { PATH: process.env.PATH, HOME: process.env.HOME };
  const r = spawnSync(process.execPath, ["-e", `import(${JSON.stringify("file://" + cfg)}).then(()=>console.log("LOADED"),e=>{console.log("THROWN:"+e.message);process.exit(3)})`], { env: { ...base, ...env }, encoding: "utf8" });
  return { code: r.status, out: String(r.stdout), err: String(r.stderr) };
}

test("hosted production build (VERCEL) without NEXT_PUBLIC_API_URL fails", () => {
  const r = load({ NODE_ENV: "production", VERCEL: "1" });
  assert.equal(r.code, 3);
  assert.match(r.out, /NEXT_PUBLIC_API_URL must be set/);
});
test("hosted production build pointing at localhost / 127.0.0.1 / http fails", () => {
  for (const u of ["http://localhost:5000/api", "https://localhost/api", "https://127.0.0.1:5000/api", "http://api.example.com/api", "not a url"]) {
    const r = load({ NODE_ENV: "production", VERCEL: "1", NEXT_PUBLIC_API_URL: u });
    assert.equal(r.code, 3, u);
  }
});
test("hosted production build with a public https API URL loads silently", () => {
  const r = load({ NODE_ENV: "production", VERCEL: "1", NEXT_PUBLIC_API_URL: "https://api.example.com/api" });
  assert.equal(r.code, 0);
  assert.match(r.out, /LOADED/);
  assert.doesNotMatch(r.err, /WARNING/);
});
test("REQUIRE_PUBLIC_API_URL=1 enforces it outside Vercel too", () => {
  assert.equal(load({ NODE_ENV: "production", REQUIRE_PUBLIC_API_URL: "1" }).code, 3);
});
test("a plain local production build only warns (local e2e builds keep working)", () => {
  const r = load({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "http://localhost:5701/api" });
  assert.equal(r.code, 0);
  assert.match(r.err, /Do not deploy this build/);
});
test("development is never blocked", () => {
  assert.equal(load({ NODE_ENV: "development" }).code, 0);
  assert.equal(load({ VERCEL: "1" }).code, 0);
});
test("the warning never prints anything but the API URL itself", () => {
  const r = load({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "http://localhost:5701/api" });
  assert.ok(!/token|secret|mongo/i.test(r.err));
});
