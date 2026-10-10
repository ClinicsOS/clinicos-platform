/* TEST-ONLY preload for the FerretDB sandbox (never shipped, never required by the app).
   FerretDB v1 does not implement the `$dateToString` aggregation operator, which the pre-existing dashboard (week series) and monthly report
   (daily series) use inside a $group. On real MongoDB the operator exists and this file is not needed.
   The shim runs everything BEFORE that $group on the database (so every $match, including the Phase 4 doctor/clinic scoping, is exercised
   for real) and performs only the date-bucketing $group (and a trailing $sort on _id) in JavaScript, with the same result shape.
     NODE_OPTIONS="--require <this file>" */
const mongoose = require("mongoose");
const origExec = mongoose.Aggregate.prototype.exec;
const fmt = (d) => new Date(d).toISOString().slice(0, 10); // "%Y-%m-%d" (UTC) — exactly what the app asks for
const get = (o, p) => p.split(".").reduce((a, k) => (a == null ? a : a[k]), o);
mongoose.Aggregate.prototype.exec = async function (...args) {
  const pipe = this.pipeline();
  const gi = pipe.findIndex((s) => s.$group && JSON.stringify(s.$group._id || "").includes("$dateToString"));
  if (gi === -1) return origExec.apply(this, args);
  const g = pipe[gi].$group;
  const datePath = String(g._id.$dateToString.date).replace(/^\$/, "");
  const rows = await origExec.apply(this._model.aggregate(pipe.slice(0, gi)), args);
  const out = new Map();
  for (const r of rows) {
    const k = fmt(get(r, datePath));
    const acc = out.get(k) || { _id: k };
    for (const [name, spec] of Object.entries(g)) {
      if (name === "_id") continue;
      const op = spec.$sum;
      acc[name] = (acc[name] || 0) + (op === 1 ? 1 : Number(get(r, String(op).replace(/^\$/, ""))) || 0);
    }
    out.set(k, acc);
  }
  let res = Array.from(out.values());
  for (const s of pipe.slice(gi + 1)) if (s.$sort && s.$sort._id) res.sort((a, b) => (a._id < b._id ? -1 : 1) * s.$sort._id);
  return res;
};
