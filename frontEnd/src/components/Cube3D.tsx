"use client";

/** The ClinicOS 3D cube — brand signature used across every screen. */
export default function Cube3D({
  size = 110,
  spin = true,
  className = "",
}: {
  size?: number;
  spin?: boolean;
  className?: string;
}) {
  const half = size / 2;
  const barL = Math.round(size * 0.47);
  const barW = Math.round(size * 0.13);
  const faces = [
    `translateZ(${half}px)`,
    `rotateY(180deg) translateZ(${half}px)`,
    `rotateY(90deg) translateZ(${half}px)`,
    `rotateY(-90deg) translateZ(${half}px)`,
    `rotateX(90deg) translateZ(${half}px)`,
    `rotateX(-90deg) translateZ(${half}px)`,
  ];
  return (
    <div className={className} style={{ width: size, height: size, perspective: size * 8 }}>
      <div
        className={`preserve-3d relative ${spin ? "spin-3d" : ""}`}
        style={{ width: size, height: size, transform: spin ? undefined : "rotateX(-16deg) rotateY(24deg)" }}
      >
        {faces.map((f, i) => (
          <div key={i} className="cube-face" style={{ transform: f }} />
        ))}
        <div
          className="absolute rounded-sm bg-teal"
          style={{ width: barL, height: barW, top: half - barW / 2, left: (size - barL) / 2, transform: "translateZ(2px)" }}
        />
        <div
          className="absolute rounded-sm bg-teal"
          style={{ width: barW, height: barL, top: (size - barL) / 2, left: half - barW / 2, transform: "translateZ(2px)" }}
        />
      </div>
    </div>
  );
}
