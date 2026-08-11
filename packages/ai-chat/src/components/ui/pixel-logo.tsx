"use client";

/** 像素风 logo — 7 行 ◼◻ 阵列 */
export default function PixelLogo({ size = 12 }: { size?: number }) {
  const PX = size;
  const pixels = [
    "..██..",
    ".████.",
    "██████",
    ".████.",
    "..██..",
    "..██..",
    ".█..█.",
  ];

  return (
    <div className="relative" style={{ width: pixels[0].length * PX, height: pixels.length * PX }}>
      {pixels.map((row, y) =>
        row.split("").map((cell, x) =>
          cell === "█" ? (
            <div
              key={`${x}-${y}`}
              className="absolute"
              style={{
                left: x * PX,
                top: y * PX,
                width: PX,
                height: PX,
                background: "var(--primary)",
              }}
            />
          ) : null
        )
      )}
    </div>
  );
}