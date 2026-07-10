/**
 * 根布局组件
 *
 * 所有页面的外层容器，定义 HTML 结构、全局元数据和字体。
 * Next.js App Router 要求必须有 RootLayout。
 */

import type { Metadata } from "next";
import "./globals.css";
import { cn } from "@/lib/utils";
import { Toaster } from "sonner";
import { BodyWrapper } from "./body-wrapper";


// 页面元数据 — 浏览器标签页标题和 SEO 描述
export const metadata: Metadata = {
  title: "小盛开AI",
  description: "小盛开AI - 像素风 AI 对话助手",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={cn("h-dvh antialiased", "font-sans")} suppressHydrationWarning>
      <body className="h-dvh overflow-hidden" suppressHydrationWarning>
        <BodyWrapper>
          <Toaster position="top-center" />
          {children}
        </BodyWrapper>
      </body>
    </html>
  );
}
