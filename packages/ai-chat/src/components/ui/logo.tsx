"use client";

/** Neo-Brutalism 品牌 Logo — 粉色方块 + 文字，黑边硬阴影 */
export default function Logo({ size = 12 }: { size?: number }) {
  const px = size * 3.5;
  return (
    <div
      className="flex items-center justify-center text-foreground select-none font-heading font-extrabold"
      style={{
        width: px,
        height: px,
        background: "var(--primary)",
        border: "3px solid #000",
        boxShadow: "3px 3px 0 #000",
        fontSize: px * 0.5,
        transform: "rotate(-4deg)",
      }}
    >
      开
    </div>
  );
}
