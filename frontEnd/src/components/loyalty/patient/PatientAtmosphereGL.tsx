"use client";
import { useEffect, useRef, type MutableRefObject } from "react";
import * as THREE from "three";

/**
 * The ONE WebGL canvas of the patient app (Phase 9) — a calm light field behind everything.
 *
 *  • ~120 dust points + ONE large soft light sprite at the app's virtual light position (upper-left, the same place the card's highlight rests).
 *  • GPU budget: pixel ratio ≤ `dpr` (1.5), no antialias, a generated 64×64 sprite (no texture file), simple additive points, ~30 fps.
 *  • Pauses while the page is hidden AND after ~25 s without any touch / pointer / scroll; resumes instantly on activity. Never runs under
 *    reduced motion or in lite/static mode (the parent doesn't mount it).
 *  • Depth: the field drifts against the scroll position and the pointer — subtle parallax, never competing with content.
 *  • Every GPU resource (geometry, material, texture, renderer, the context itself) is released on unmount; `onFail` hands over to the CSS atmosphere.
 */
export default function PatientAtmosphereGL({ accent, dpr, scrollRef, onFail, onLive }: { accent: string; dpr: number; scrollRef: MutableRefObject<number>; onFail: () => void; onLive: () => void }) {
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const holder = host.current;
    if (!holder) return;
    // a FRESH canvas per mount: a canvas whose context was force-lost on cleanup can never be re-used (React strict-mode remounts, hot reload)
    const canvas = document.createElement("canvas");
    canvas.setAttribute("data-testid", "pw-gl-canvas");
    holder.appendChild(canvas);
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      canvas.remove();
      onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, dpr));
    renderer.setClearColor(0x000000, 0);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 50);
    camera.position.set(0, 0, 8);

    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const sc = sprite.getContext("2d");
    if (sc) {
      const g = sc.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.3, "rgba(255,255,255,.5)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      sc.fillStyle = g;
      sc.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(sprite);

    const [ar, ag, ab] = accent.split(",").map((n) => Number(n) / 255);
    const N = 120;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const palette = [new THREE.Color(ar, ag, ab), new THREE.Color(0xe8c76a), new THREE.Color(0xf5eedf), new THREE.Color(0xe68a9c)];
    let seed = 90210;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 16;
      pos[i * 3 + 1] = (rnd() - 0.5) * 24;
      pos[i * 3 + 2] = -9 + rnd() * 11;
      const c = palette[rnd() < 0.5 ? 0 : rnd() < 0.5 ? 1 : rnd() < 0.6 ? 2 : 3];
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.14, map: texture, vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

    // the virtual light itself (upper-left) — one big soft sprite
    const lightMat = new THREE.SpriteMaterial({ map: texture, color: new THREE.Color(ar, ag, ab), transparent: true, opacity: 0.2, depthWrite: false, blending: THREE.AdditiveBlending });
    const light = new THREE.Sprite(lightMat);
    light.scale.set(11, 11, 1);
    light.position.set(-3.2, 4.6, -4);
    scene.add(light);

    const size = () => {
      const w = canvas.clientWidth || window.innerWidth;
      const h = canvas.clientHeight || window.innerHeight;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    size();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(size) : null;
    ro?.observe(canvas);

    let px = 0;
    let py = 0;
    let lastInput = performance.now();
    let wake: () => void = () => undefined;
    const onInput = (e: Event) => {
      const wasIdle = performance.now() - lastInput > 25_000;
      lastInput = performance.now();
      if (wasIdle) wake();
      const pe = e as PointerEvent;
      if (pe.clientX !== undefined) {
        px = (pe.clientX / window.innerWidth - 0.5) * 2;
        py = (pe.clientY / window.innerHeight - 0.5) * 2;
      }
    };
    window.addEventListener("pointermove", onInput, { passive: true });
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("touchmove", onInput, { passive: true });
    window.addEventListener("scroll", onInput, { passive: true, capture: true });

    let raf = 0;
    let timer = 0;
    let last = 0;
    let t = 0;
    let live = false;
    let hidden = document.hidden;
    const schedule = () => {
      if (raf || timer) return;
      raf = requestAnimationFrame(frame);
    };
    // the loop STOPS (no requestAnimationFrame at all) while the page is hidden, and drops to a 4 fps timer when the patient has been idle
    function frame(now: number) {
      raf = 0;
      if (hidden) return;
      const idle = now - lastInput > 25_000;
      if (now - last >= (idle ? 250 : 33)) {
        const dt = Math.min(0.1, (now - last) / 1000 || 0.033);
        last = now;
        t += idle ? 0 : dt;
        const sy = scrollRef.current || 0;
        points.rotation.y = t * 0.015;
        points.position.y = Math.sin(t * 0.18) * 0.2 + sy * 0.0016;
        light.position.y = 4.6 + sy * 0.0007;
        camera.position.x += (px * 0.5 - camera.position.x) * 0.04;
        camera.position.y += (-py * 0.35 - camera.position.y) * 0.04;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
        if (!live) {
          live = true;
          onLive();
        }
      }
      if (idle) {
        timer = window.setTimeout(() => {
          timer = 0;
          schedule();
        }, 250);
      } else {
        raf = requestAnimationFrame(frame);
      }
    }
    wake = () => {
      if (timer) {
        window.clearTimeout(timer);
        timer = 0;
      }
      schedule();
    };
    schedule();

    const onVis = () => {
      hidden = document.hidden;
      if (!hidden) {
        lastInput = performance.now();
        wake();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      onFail();
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      ro?.disconnect();
      window.removeEventListener("pointermove", onInput);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("touchmove", onInput);
      window.removeEventListener("scroll", onInput, true);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.remove(points);
      scene.remove(light);
      geo.dispose();
      mat.dispose();
      lightMat.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <div ref={host} aria-hidden="true" style={{ display: "contents" }} />;
}
