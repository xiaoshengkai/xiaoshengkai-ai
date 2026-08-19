"use client";

import type { ReactNode } from "react";

interface TooltipIconProps {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  side?: "top" | "bottom" | "left" | "right";
  clickable?: boolean;
}

const positionClasses: Record<string, string> = {
  top: "-top-7 left-1/2 -translate-x-1/2",
  bottom: "-bottom-7 left-1/2 -translate-x-1/2",
  left: "top-1/2 -translate-y-1/2 right-full mr-2",
  right: "top-1/2 -translate-y-1/2 left-full ml-2",
};

export default function TooltipIcon({
  icon,
  label,
  onClick,
  side = "top",
  clickable = true,
}: TooltipIconProps) {
  return (
    <div
      role="button"
      onClick={clickable ? onClick : undefined}
      className="group relative cursor-pointer text-muted-foreground/50 hover:text-primary inline-block"
    >
      {icon}
      <span
        className={`pointer-events-none absolute whitespace-nowrap px-2 py-0.5 text-xs font-mono bg-primary text-primary-foreground border-2 opacity-0 group-hover:opacity-100 transition-opacity z-50 ${positionClasses[side]}`}
      >
        {label}
      </span>
    </div>
  );
}