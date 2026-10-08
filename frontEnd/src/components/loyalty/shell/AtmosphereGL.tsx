"use client";
import { useEffect, useRef } from "react";
import * as THREE from "three";

/**
 * The ONE WebGL canvas of ClinicOS Loyalty — a slow field of golden dust behind the whole product (Phase 8).
 *
 * Lazy-loaded by LoyaltyAtmosphere only on capable, non-reduced-motion, non-small devices. ~380 points, one tiny generated sprite (64×64, no image
 * files), pixel ratio capped at 1.5, ~30 fps, paused while the tab is hidden, and every GPU resource is released on unmount (including the
 * context itself). If the context can't be created or is lost, `onFail` makes the parent keep the pure-CSS atmosphere.
 */
export default function AtmosphereGL({ onFail, onLive }: { onFail: () => void; onLive: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: false, powerPreference: "low-power" });
    } catch {
      onFail();
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.setClearColor(0x000000, 0);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 60);
    camera.position.set(0, 0, 9);

    // soft round sprite, generated (no network, no texture file)
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 64;
    const sctx = sprite.getContext("2d");
    if (sctx) {
      const g = sctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, "rgba(255,255,255,1)");
      g.addColorStop(0.35, "rgba(255,255,255,.55)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      sctx.fillStyle = g;
      sctx.fillRect(0, 0, 64, 64);
    }
    const texture = new THREE.CanvasTexture(sprite);

    const N = 380;
    const pos = new Float32Array(N * 3);
    const col = new Float32Array(N * 3);
    const palette = [new THREE.Color(0xe8c76a), new THREE.Color(0xf5eedf), new THREE.Color(0xe68a9c), new THREE.Color(0xc9a24a)];
    // deterministic scatter (no Math.random → identical look on every visit, and stable in tests)
    let seed = 20260;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    for (let i = 0; i < N; i++) {
      pos[i * 3] = (rnd() - 0.5) * 30;
      pos[i * 3 + 1] = (rnd() - 0.5) * 18;
      pos[i * 3 + 2] = -12 + rnd() * 16;
      const c = palette[rnd() < 0.62 ? 0 : rnd() < 0.55 ? 1 : rnd() < 0.5 ? 2 : 3];
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({ size: 0.16, map: texture, vertexColors: true, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true });
    const points = new THREE.Points(geo, mat);
    scene.add(points);

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
    const onPointer = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      px = (e.clientX / window.innerWidth - 0.5) * 2;
      py = (e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("pointermove", onPointer, { passive: true });

    let raf = 0;
    let last = 0;
    let t = 0;
    let live = false;
    let hidden = document.hidden;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      if (hidden || now - last < 33) return;
      const dt = Math.min(0.1, (now - last) / 1000 || 0.033);
      last = now;
      t += dt;
      points.rotation.y = t * 0.012;
      points.rotation.x = Math.sin(t * 0.05) * 0.035;
      points.position.y = Math.sin(t * 0.16) * 0.18;
      camera.position.x += (px * 0.55 - camera.position.x) * 0.04;
      camera.position.y += (-py * 0.35 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      if (!live) {
        live = true;
        onLive();
      }
    };
    raf = requestAnimationFrame(frame);

    const onVis = () => {
      hidden = document.hidden;
    };
    document.addEventListener("visibilitychange", onVis);
    const onLost = (e: Event) => {
      e.preventDefault();
      onFail();
    };
    canvas.addEventListener("webglcontextlost", onLost);

    return () => {
      cancelAnimationFrame(raf);
      ro?.disconnect();
      window.removeEventListener("pointermove", onPointer);
      document.removeEventListener("visibilitychange", onVis);
      canvas.removeEventListener("webglcontextlost", onLost);
      scene.remove(points);
      geo.dispose();
      mat.dispose();
      texture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return <canvas ref={ref} data-testid="lyx-gl-canvas" />;
}
