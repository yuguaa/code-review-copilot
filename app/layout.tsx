import type { Metadata } from "next";
import "./globals.css";
import { AppSidebar } from "@/components/app-sidebar";
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
        <AppSidebar>{children}</AppSidebar>
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
