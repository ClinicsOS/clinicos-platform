/* TEST-ONLY — never shipped, never required by the app.
 *
 * FerretDB v1 (the only database available in the verification sandbox) implements almost none of the aggregation operators the Phase 6
 * analytics use: no $dateToString / $hour / $dayOfWeek, no $cond / $ifNull / $addFields / $multiply / $subtract / $size, no $addToSet, …
 * On real MongoDB all of those exist, so this file is not needed there.
 *
 * What it does (loaded with NODE_OPTIONS="--require <this file>"): it replaces Aggregate#exec with a small, deterministic aggregation
 * ENGINE written for exactly the vocabulary the analytics code uses. The only thing the database does is hand over the clinic's raw
 * documents ({ clinicId } equality, taken from the first $match); EVERY stage — including every $match, so the doctor / date / status
 * scoping is exercised for real — is then executed here. A pipeline that uses an operator this engine does not know FAILS LOUDLY
 * (it never silently returns something plausible).
 *
 * Honest limit: this engine mirrors MongoDB semantics as documented; it is not MongoDB. The Phase 6 report therefore marks operator
 * semantics ($dateToString + timezone, $dayOfWeek, $hour, …) as "verified on the emulator, NOT on real MongoDB".
 */
const mongoose = require("mongoose");
const origExec = mongoose.Aggregate.prototype.exec;

const isOid = (v) => v && typeof v === "object" && v._bsontype === "ObjectId";
const isDate = (v) => v instanceof Date;
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v) && !isOid(v) && !isDate(v) && !(v instanceof RegExp);

/** A stable string for equality / grouping that keeps types apart. */
function keyOf(v) {
  if (v === undefined || v === null) return "n:";
  if (isOid(v)) return "o:" + v.toString();
  if (isDate(v)) return "d:" + v.getTime();
  if (Array.isArray(v)) return "a:[" + v.map(keyOf).join(",") + "]";
  if (isObj(v)) return "j:{" + Object.keys(v).sort().map((k) => k + "=" + keyOf(v[k])).join(",") + "}";
  return typeof v === "number" ? "x:" + v : typeof v === "boolean" ? "b:" + v : "s:" + v;
}
const eq = (a, b) => keyOf(a) === keyOf(b);
const rank = (v) => (isDate(v) ? v.getTime() : isOid(v) ? v.toString() : v);
function cmp(a, b) {
  const x = rank(a), y = rank(b);
  if (x === y) return 0;
  return x < y ? -1 : 1;
}
const comparable = (a, b) => {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return (isDate(a) && isDate(b)) || (typeof a === typeof b && !isObj(a) && !isObj(b));
};

/* ───────────── path access ───────────── */
function valuesAt(doc, path) {
  // all candidate values at a dotted path (arrays are traversed; a terminal array contributes itself AND its elements)
  let cur = [doc];
  for (const part of path.split(".")) {
    const next = [];
    for (const c of cur) {
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) { for (const e of c) if (isObj(e) && part in e) next.push(e[part]); }
      else if (isObj(c) && part in c) next.push(c[part]);
    }
    cur = next;
  }
  const out = [];
  for (const v of cur) { out.push(v); if (Array.isArray(v)) out.push(...v); }
  return out;
}
/** value of a "$a.b" expression: missing → undefined; a path through an array of sub-documents yields an array (MongoDB semantics). */
function getPath(doc, path) {
  const parts = path.split(".");
  const walk = (v, i) => {
    if (i === parts.length) return v;
    if (v === null || v === undefined) return undefined;
    if (Array.isArray(v)) { const r = v.map((e) => walk(e, i)).filter((e) => e !== undefined); return r; }
    if (!isObj(v)) return undefined;
    return walk(v[parts[i]], i + 1);
  };
  return walk(doc, 0);
}
function setPath(doc, path, value) {
  const out = { ...doc };
  const parts = path.split(".");
  let cur = out;
  for (let i = 0; i < parts.length - 1; i++) { cur[parts[i]] = isObj(cur[parts[i]]) ? { ...cur[parts[i]] } : {}; cur = cur[parts[i]]; }
  cur[parts[parts.length - 1]] = value;
  return out;
}

/* ───────────── time zones ───────────── */
const fmtCache = new Map();
function zoned(date, tz) {
  const zone = tz || "UTC";
  let f = fmtCache.get(zone);
  if (!f) { f = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }); fmtCache.set(zone, f); }
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { y: +p.year, m: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second };
}
const p2 = (n) => String(n).padStart(2, "0");

/* ───────────── expressions ───────────── */
function ev(expr, doc) {
  if (typeof expr === "string") return expr.startsWith("$") && !expr.startsWith("$$") ? getPath(doc, expr.slice(1)) : expr;
  if (expr === null || typeof expr !== "object" || isOid(expr) || isDate(expr) || expr instanceof RegExp) return expr;
  if (Array.isArray(expr)) return expr.map((e) => ev(e, doc));
  const keys = Object.keys(expr);
  if (keys.length === 1 && keys[0].startsWith("$")) return op(keys[0], expr[keys[0]], doc);
  const out = {};
  for (const k of keys) { const v = ev(expr[k], doc); if (v !== undefined) out[k] = v; }
  return out;
}
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
function op(name, a, doc) {
  const args = () => (Array.isArray(a) ? a.map((x) => ev(x, doc)) : [ev(a, doc)]);
  switch (name) {
    case "$literal": return a;
    case "$ifNull": { const [x, y] = args(); return x === undefined || x === null ? y : x; }
    case "$cond": {
      const [c, t, e] = Array.isArray(a) ? a : [a.if, a.then, a.else];
      return ev(c, doc) ? ev(t, doc) : ev(e, doc);
    }
    case "$eq": { const [x, y] = args(); return eq(x ?? null, y ?? null); }
    case "$ne": { const [x, y] = args(); return !eq(x ?? null, y ?? null); }
    case "$gt": { const [x, y] = args(); return comparable(x, y) && cmp(x, y) > 0; }
    case "$gte": { const [x, y] = args(); return comparable(x, y) && cmp(x, y) >= 0; }
    case "$lt": { const [x, y] = args(); return comparable(x, y) && cmp(x, y) < 0; }
    case "$lte": { const [x, y] = args(); return comparable(x, y) && cmp(x, y) <= 0; }
    case "$and": return args().every(Boolean);
    case "$or": return args().some(Boolean);
    case "$not": return !args()[0];
    case "$in": { const [x, list] = args(); return Array.isArray(list) && list.some((y) => eq(x, y)); }
    case "$add": { const v = args(); return v.some((x) => num(x) === null) ? null : v.reduce((s, x) => s + x, 0); }
    case "$subtract": { const [x, y] = args(); return num(x) === null || num(y) === null ? null : x - y; }
    case "$multiply": { const v = args(); return v.some((x) => num(x) === null) ? null : v.reduce((s, x) => s * x, 1); }
    case "$divide": { const [x, y] = args(); return num(x) === null || !num(y) ? null : x / y; }
    case "$sum": { // expression form: an array operand is summed (non-numbers ignored); a list of operands is added
      const v = Array.isArray(a) ? a.map((x) => ev(x, doc)) : [ev(a, doc)];
      const flat = v.flatMap((x) => (Array.isArray(x) ? x : [x]));
      return flat.reduce((s, x) => s + (num(x) ?? 0), 0);
    }
    case "$size": { const [x] = args(); if (!Array.isArray(x)) throw new Error("$size needs an array"); return x.length; }
    case "$toString": { const [x] = args(); return x === null || x === undefined ? null : isOid(x) ? x.toString() : String(x); }
    case "$dateToString": {
      const d = ev(a.date, doc);
      if (!isDate(d)) return null;
      const z = zoned(d, a.timezone);
      if (a.format !== "%Y-%m-%d") throw new Error("emulator: unsupported $dateToString format " + a.format);
      return `${String(z.y).padStart(4, "0")}-${p2(z.m)}-${p2(z.d)}`;
    }
    case "$hour": { const d = ev(a.date ?? a, doc); return isDate(d) ? zoned(d, a.timezone).h : null; }
    case "$dayOfWeek": { // 1 = Sunday … 7 = Saturday
      const d = ev(a.date ?? a, doc);
      if (!isDate(d)) return null;
      const z = zoned(d, a.timezone);
      return new Date(Date.UTC(z.y, z.m - 1, z.d)).getUTCDay() + 1;
    }
    default: throw new Error("emulator: unsupported expression operator " + name);
  }
}

/* ───────────── $match ───────────── */
function matches(doc, filter) {
  for (const [k, cond] of Object.entries(filter)) {
    if (k === "$and") { if (!cond.every((f) => matches(doc, f))) return false; continue; }
    if (k === "$or") { if (!cond.some((f) => matches(doc, f))) return false; continue; }
    if (k === "$nor") { if (cond.some((f) => matches(doc, f))) return false; continue; }
    if (k.startsWith("$")) throw new Error("emulator: unsupported $match operator " + k);
    if (!fieldOk(valuesAt(doc, k), cond)) return false;
  }
  return true;
}
const looseEq = (v, c) => (c === null ? v === null || v === undefined : eq(v, c));
function fieldOk(vals, cond) {
  if (cond instanceof RegExp) return vals.some((v) => typeof v === "string" && cond.test(v));
  if (isObj(cond) && Object.keys(cond).length && Object.keys(cond).every((k) => k.startsWith("$"))) {
    for (const [o, c] of Object.entries(cond)) {
      const miss = vals.length === 0;
      switch (o) {
        case "$eq": if (!(c === null ? miss || vals.some((v) => v === null) : vals.some((v) => eq(v, c)))) return false; break;
        case "$ne": if (c === null ? !(miss || vals.some((v) => v === null)) === false : vals.some((v) => eq(v, c))) return false; break;
        case "$gt": if (!vals.some((v) => comparable(v, c) && cmp(v, c) > 0)) return false; break;
        case "$gte": if (!vals.some((v) => comparable(v, c) && cmp(v, c) >= 0)) return false; break;
        case "$lt": if (!vals.some((v) => comparable(v, c) && cmp(v, c) < 0)) return false; break;
        case "$lte": if (!vals.some((v) => comparable(v, c) && cmp(v, c) <= 0)) return false; break;
        case "$in": if (!c.some((x) => (x === null ? miss || vals.some((v) => v === null) : vals.some((v) => eq(v, x))))) return false; break;
        case "$nin": if (c.some((x) => (x === null ? miss || vals.some((v) => v === null) : vals.some((v) => eq(v, x))))) return false; break;
        case "$exists": if ((!miss) !== !!c) return false; break;
        default: throw new Error("emulator: unsupported $match operator " + o);
      }
    }
    return true;
  }
  return vals.length === 0 ? cond === null : vals.some((v) => looseEq(v, cond));
}

/* ───────────── stages ───────────── */
function group(docs, spec) {
  const buckets = new Map();
  for (const d of docs) {
    let id = ev(spec._id, d);
    if (id === undefined) id = null;
    const k = keyOf(id);
    let b = buckets.get(k);
    if (!b) { b = { _id: id, acc: {}, seen: {} }; buckets.set(k, b); }
    for (const [name, def] of Object.entries(spec)) {
      if (name === "_id") continue;
      const [accOp] = Object.keys(def);
      const v = ev(def[accOp], d);
      switch (accOp) {
        case "$sum": b.acc[name] = (b.acc[name] ?? 0) + (num(v) ?? 0); break;
        case "$min": if (v !== null && v !== undefined && (b.acc[name] === undefined || cmp(v, b.acc[name]) < 0)) b.acc[name] = v; else if (b.acc[name] === undefined) b.acc[name] = null; break;
        case "$max": if (v !== null && v !== undefined && (b.acc[name] === undefined || cmp(v, b.acc[name]) > 0)) b.acc[name] = v; else if (b.acc[name] === undefined) b.acc[name] = null; break;
        case "$first": if (!(name in b.acc)) b.acc[name] = v ?? null; break;
        case "$last": b.acc[name] = v ?? null; break;
        case "$push": (b.acc[name] ??= []).push(v); break;
        case "$addToSet": { const s = (b.seen[name] ??= new Set()); const kk = keyOf(v); if (!s.has(kk)) { s.add(kk); (b.acc[name] ??= []).push(v); } break; }
        case "$avg": { const a = (b.acc[name] ??= { s: 0, n: 0 }); if (num(v) !== null) { a.s += v; a.n += 1; } break; }
        default: throw new Error("emulator: unsupported $group accumulator " + accOp);
      }
    }
  }
  return Array.from(buckets.values()).map((b) => {
    const o = { _id: b._id };
    for (const [n, v] of Object.entries(b.acc)) o[n] = v && typeof v === "object" && "s" in v && "n" in v ? (v.n ? v.s / v.n : null) : v;
    return o;
  });
}
function unwind(docs, spec) {
  const path = (typeof spec === "string" ? spec : spec.path).replace(/^\$/, "");
  const out = [];
  for (const d of docs) {
    const v = getPath(d, path);
    if (Array.isArray(v)) for (const e of v) out.push(setPath(d, path, e));
    else if (v !== null && v !== undefined) out.push(d);
  }
  return out;
}
function sortDocs(docs, spec) {
  const keys = Object.entries(spec);
  return [...docs].sort((x, y) => {
    for (const [k, dir] of keys) {
      const a = getPath(x, k), b = getPath(y, k);
      const c = a === undefined || a === null ? (b === undefined || b === null ? 0 : -1) : b === undefined || b === null ? 1 : cmp(a, b);
      if (c) return c * dir;
    }
    return 0;
  });
}

function run(docs, pipeline) {
  let cur = docs;
  for (const stage of pipeline) {
    const [name] = Object.keys(stage);
    const arg = stage[name];
    switch (name) {
      case "$match": cur = cur.filter((d) => matches(d, arg)); break;
      case "$unwind": cur = unwind(cur, arg); break;
      case "$group": cur = group(cur, arg); break;
      case "$addFields": case "$set": cur = cur.map((d) => { let o = d; for (const [k, e] of Object.entries(arg)) o = setPath(o, k, ev(e, d)); return o; }); break;
      case "$project": cur = cur.map((d) => { const o = {}; if (!("_id" in arg) || arg._id) o._id = d._id; for (const [k, e] of Object.entries(arg)) { if (k === "_id") continue; if (e === 1 || e === true) o[k] = getPath(d, k); else if (e !== 0 && e !== false) o[k] = ev(e, d); } return o; }); break;
      case "$sort": cur = sortDocs(cur, arg); break;
      case "$limit": cur = cur.slice(0, arg); break;
      case "$skip": cur = cur.slice(arg); break;
      case "$count": cur = [{ [arg]: cur.length }]; break;
      default: throw new Error("emulator: unsupported pipeline stage " + name);
    }
  }
  return cur;
}

/** the clinicId equality of the first $match (every analytics / expense / dashboard pipeline has one) — the only thing handed to the database */
function clinicFilterOf(pipe) {
  const first = pipe[0] && pipe[0].$match;
  if (!first) return {};
  if (first.clinicId !== undefined) return { clinicId: first.clinicId };
  if (Array.isArray(first.$and)) { const f = first.$and.find((x) => x && x.clinicId !== undefined); if (f) return { clinicId: f.clinicId }; }
  return {};
}

mongoose.Aggregate.prototype.exec = async function (...args) {
  const pipe = this.pipeline();
  if (process.env.AGG_EMULATOR === "0") return origExec.apply(this, args);
  const raw = await this._model.collection.find(clinicFilterOf(pipe)).toArray();
  // AGG_EMULATOR_FALLBACK=1 (browser runs of OTHER pages only): a pipeline this engine does not know goes to whatever exec was installed before it
  // (e.g. ferret-date-shim.js). The analytics test never sets it, so an unsupported analytics operator still fails loudly there.
  if (process.env.AGG_EMULATOR_FALLBACK === "1") { try { return run(raw, pipe); } catch (e) { if (/^emulator: unsupported/.test(String(e && e.message))) return origExec.apply(this, args); throw e; } }
  return run(raw, pipe);
};
module.exports = { run, keyOf, ev, matches };
