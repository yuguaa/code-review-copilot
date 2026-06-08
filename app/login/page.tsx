"use client";

import { FormEvent, useState } from "react";
import { Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Bot, KeyRound, Loader2, LogIn, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [secret, setSecret] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!username.trim() || !secret) {
      toast.error("账号和密钥都要填写");
      return;
    }

    setSubmitting(true);
    fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, secret }),
    })
      .then((response) => {
        if (!response.ok) {
          return response
            .json()
            .then((body) => Promise.reject(new Error(body.error || "登录失败")));
        }

        const nextPath = getSafeNextPath(searchParams.get("next"));
        router.replace(nextPath);
        router.refresh();
      })
      .catch((error: Error) => {
        toast.error(error.message || "账号或密钥不正确");
      })
      .finally(() => setSubmitting(false));
  };

  return (
    <main className="flex min-h-svh items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[#181715] text-[#faf9f5] shadow-[0_14px_30px_rgba(24,23,21,0.22)]">
            <Bot className="size-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground">Code Review Copilot</p>
            <p className="text-xs text-muted-foreground">受保护的审查工作台</p>
          </div>
        </div>

        <Card className="rounded-lg border-border/50 shadow-[0_22px_70px_rgba(37,35,32,0.12)]">
          <CardHeader>
            <div className="mb-1 flex size-9 items-center justify-center rounded-md bg-primary/12 text-primary">
              <ShieldCheck className="size-4" />
            </div>
            <CardTitle className="text-2xl leading-tight">登录账号</CardTitle>
            <CardDescription>
              使用部署环境中初始化的账号密钥进入系统。
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form className="space-y-4" onSubmit={handleSubmit}>
              <div className="space-y-2">
                <Label htmlFor="username">账号</Label>
                <Input
                  id="username"
                  autoComplete="username"
                  value={username}
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="输入账号"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret">密钥</Label>
                <Input
                  id="secret"
                  type="password"
                  autoComplete="current-password"
                  value={secret}
                  onChange={(event) => setSecret(event.target.value)}
                  placeholder="输入密钥"
                />
              </div>

              <Button className="h-10 w-full" type="submit" disabled={submitting}>
                {submitting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <LogIn className="size-4" />
                )}
                登录
              </Button>
            </form>

            <div className="mt-5 flex items-start gap-2 rounded-md bg-muted/70 p-3 text-xs leading-5 text-muted-foreground">
              <KeyRound className="mt-0.5 size-3.5 shrink-0" />
              <span>账号和密钥只从服务端环境变量读取，不提供注册入口。</span>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function getSafeNextPath(nextPath: string | null): string {
  if (!nextPath) return "/";
  if (!nextPath.startsWith("/") || nextPath.startsWith("//") || nextPath.includes("\\")) {
    return "/";
  }

  return nextPath;
}
