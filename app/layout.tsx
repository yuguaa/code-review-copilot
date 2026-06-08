import type { Metadata } from "next";
import "./globals.css";
import "@relation-graph/react/style.css";
import { AppShell } from "@/components/app-shell";
import { Toaster } from "sonner";

export const metadata: Metadata = {
  title: "Code Review Copilot - GitLab 代码审查工具",
  description: "智能的 GitLab 代码审查助手",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
