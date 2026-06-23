// Strata 3-skewed-bar "strata" logo mark.
// Two variants:
//  - "rail"   : 32px accent tile, inner 18×16 glyph with white bars (catalog 01 §3a)
//  - "header" : 34px transparent box, bars ramp accent→canvas (catalog 00 §6b)

const RAIL_BARS = [
  { top: 1, opacity: 0.55 },
  { top: 6, opacity: 0.78 },
  { top: 11, opacity: 1 },
];

const HEADER_BARS = [
  { top: 4, mix: 35 },
  { top: 13, mix: 62 },
  { top: 22, mix: 100 },
];

export function BrandMark({ size = "rail" }: { size?: "rail" | "header" }) {
  if (size === "header") {
    return (
      <div className="relative" style={{ width: 34, height: 34 }}>
        {HEADER_BARS.map((bar, i) => (
          <span
            key={i}
            className="absolute"
            style={{
              left: 2,
              top: bar.top,
              width: 30,
              height: 9,
              borderRadius: 3,
              transform: "skewX(-18deg)",
              background:
                bar.mix === 100
                  ? "var(--accent)"
                  : `color-mix(in srgb, var(--accent) ${bar.mix}%, var(--canvas))`,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div
      className="flex items-center justify-center bg-accent rounded-lg"
      style={{ width: 32, height: 32 }}
    >
      <div className="relative" style={{ width: 18, height: 16 }}>
        {RAIL_BARS.map((bar, i) => (
          <span
            key={i}
            className="absolute bg-white"
            style={{
              left: 0,
              top: bar.top,
              width: 18,
              height: 4,
              borderRadius: 1.5,
              transform: "skewX(-18deg)",
              opacity: bar.opacity,
            }}
          />
        ))}
      </div>
    </div>
  );
}
