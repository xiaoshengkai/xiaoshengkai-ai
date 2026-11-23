/**
 * 根布局组件
 *
 * 所有页面的外层容器，定义 HTML 结构、全局元数据和字体。
 * Next.js App Router 要求必须有 RootLayout。
 */

import type { Metadata, Viewport } from "next";
import "./globals.css";
import { cn } from "@/lib/utils/utils";
import { Toaster } from "sonner";


export const metadata: Metadata = {
  title: "小盛开AI",
  description: "小盛开AI - 像素风 AI 对话助手",
  applicationName: "小盛开AI",
  manifest: "/ai/manifest.json",
  icons: {
    apple: "/ai/icons/icon-180.png",
  },
  appleWebApp: {
    capable: true,
    title: "小盛开AI",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
  themeColor: "#FFE135",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const theme = process.env.UI_THEME || "default";
  return (
    <html lang="zh-CN" data-theme={theme} className={cn("min-h-dvh antialiased", "font-sans")} suppressHydrationWarning>
      <body className="min-h-dvh" suppressHydrationWarning>
        <Toaster position="top-center" />
        {children}
      </body>
    </html>
  );
}
