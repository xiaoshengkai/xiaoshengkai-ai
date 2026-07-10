"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function BodyWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  useEffect(() => {
    if (pathname.startsWith("/admin")) {
      document.body.style.overflow = "auto";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [pathname]);

  return <>{children}</>;
}