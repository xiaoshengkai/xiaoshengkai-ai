import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** API base path — 空字符串或 NEXT_PUBLIC_BASE_PATH（如 /ai） */
export const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';