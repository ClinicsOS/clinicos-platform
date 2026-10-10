/* TEST-ONLY. Preloaded into the COMPILED server by walk-in.test.js (NODE_OPTIONS=--require …/fake-clock.js) so the suite can register a
   walk-in at a chosen clinic-local moment ("10:37", "23:59:58") on the real server code, with no change to production code.
   FAKE_NOW=<ISO instant> shifts `Date.now()` / `new Date()` by a constant offset; the clock keeps ticking from there. */
if (process.env.FAKE_NOW) {
  const RealDate = Date;
  const nativeNow = RealDate.now.bind(RealDate);
  const off = new RealDate(process.env.FAKE_NOW).getTime() - nativeNow();
  const fakeNow = () => nativeNow() + off;
  global.Date = new Proxy(RealDate, {
    construct(target, args, nt) { return args.length === 0 ? new target(fakeNow()) : Reflect.construct(target, args, nt === global.Date ? target : nt); },
    get(target, prop) { return prop === "now" ? fakeNow : Reflect.get(target, prop, target); },
    set(target, prop, value) { if (prop !== "now") target[prop] = value; return true; },
  });
}
