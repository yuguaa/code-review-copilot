"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2 } from "lucide-react";

type ContributionPoint = {
  date: string;
  count: number;
};

type RepoOption = {
  id: string;
  name: string;
};

type ContributionResponse = {
  series: ContributionPoint[];
  dates: string[];
  authors: Array<{ name: string; counts: number[]; total: number }>;
  authorOptions: string[];
  repositories: RepoOption[];
};

const RANGE_OPTIONS = [
  { label: "1 个月", value: "1" },
  { label: "3 个月", value: "3" },
  { label: "6 个月", value: "6" },
  { label: "12 个月", value: "12" },
];

const LINE_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
];

function buildChartData(data: ContributionResponse, rangeMonths: number) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setMonth(cutoff.getMonth() - rangeMonths);
  const filtered = data.dates
    .map((date, index) => ({ date, index }))
    .filter((item) => new Date(`${item.date}T00:00:00`).getTime() >= cutoff.getTime());

  return filtered.map((item) => {
    const row: Record<string, number | string> = { date };
    let total = 0;
    data.authors.forEach((author) => {
      const value = author.counts[item.index] || 0;
      row[author.name] = value;
      total += value;
    });
    row.__total = total;
    return row;
  });
}

function formatDateLabel(value: string) {
  return value.slice(5).replace("-", "/");
}

function formatTooltipLabel(value: string) {
  return value.replace(/-/g, "/");
}

export function ContributionsChart() {
  const [repositoryId, setRepositoryId] = useState<string>("all");
  const [author, setAuthor] = useState<string>("all");
  const [range, setRange] = useState<string>("1");
  const [data, setData] = useState<ContributionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const params = new URLSearchParams();
    if (repositoryId !== "all") params.set("repositoryId", repositoryId);
    if (author !== "all") params.set("author", author);
    const query = params.toString() ? `?${params.toString()}` : "";
    fetch(`/api/dashboard/contributions${query}`)
      .then((res) => res.json())
      .then((json) => {
        if (mounted) setData(json);
      })
      .catch(() => {
        if (mounted) setData({ series: [], dates: [], authors: [], authorOptions: [], repositories: [] });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [repositoryId, author]);

  const chartData = useMemo(() => {
    if (!data) return [];
    return buildChartData(data, parseInt(range, 10));
  }, [data, range]);

  const totals = useMemo(() => {
    if (!data) return { total: 0, max: 0, authors: 0 };
    const total = chartData.reduce((sum, item) => sum + (Number(item.__total) || 0), 0);
    const max = chartData.reduce((m, item) => Math.max(m, Number(item.__total) || 0), 0);
    return { total, max, authors: data.authors.length };
  }, [data, chartData]);

  return (
    <Card className="border-border/40">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">贡献趋势</h3>
            <p className="text-sm text-muted-foreground">按天统计，被审查人员的审查触发记录（默认近 1 个月）</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Badge className="bg-sidebar text-foreground border-border/40 hover:bg-sidebar-accent">
              总提交 {totals.total}
            </Badge>
            <Badge className="bg-sidebar text-foreground border-border/40 hover:bg-sidebar-accent">
              作者 {totals.authors}
            </Badge>
            <Tabs value={range} onValueChange={setRange}>
              <TabsList className="grid grid-cols-4">
                {RANGE_OPTIONS.map((option) => (
                  <TabsTrigger key={option.value} value={option.value}>
                    {option.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Select value={repositoryId} onValueChange={(value) => setRepositoryId(value)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择仓库" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部仓库</SelectItem>
                {data?.repositories.map((repo) => (
                  <SelectItem key={repo.id} value={repo.id}>
                    {repo.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={author} onValueChange={(value) => setAuthor(value)}>
              <SelectTrigger className="w-[200px]">
                <SelectValue placeholder="选择人员" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">全部人员</SelectItem>
                {data?.authorOptions.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            正在拉取 GitLab 提交数据
          </div>
        ) : data && chartData.length > 0 ? (
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="total-gradient" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--chart-2)" stopOpacity={0.35} />
                    <stop offset="100%" stopColor="var(--chart-2)" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="4 4" className="stroke-border/40" />
                <XAxis
                  dataKey="date"
                  tickFormatter={formatDateLabel}
                  className="text-xs text-muted-foreground"
                  tickMargin={8}
                  minTickGap={24}
                />
                <YAxis className="text-xs text-muted-foreground" tickMargin={6} />
                <Tooltip
                  contentStyle={{
                    borderRadius: 12,
                    border: "1px solid var(--border)",
                    background: "var(--card)",
                    color: "var(--foreground)",
                  }}
                  labelFormatter={(value) => formatTooltipLabel(String(value))}
                />
                <Area
                  type="monotone"
                  dataKey="__total"
                  stroke="var(--chart-2)"
                  fill="url(#total-gradient)"
                  strokeWidth={2}
                  dot={false}
                />
                {data.authors.map((author, index) => (
                  <Line
                    key={author.name}
                    type="monotone"
                    dataKey={author.name}
                    stroke={LINE_COLORS[index % LINE_COLORS.length]}
                    strokeWidth={1.5}
                    dot={false}
                    opacity={0.75}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[300px] text-muted-foreground">
            暂无提交数据
          </div>
        )}

        {data && data.authors.length > 0 ? (
          <div className="mt-4 max-h-[160px] overflow-y-auto border border-border/40 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-2">作者列表（按总提交降序）</div>
            <div className="flex flex-wrap gap-2">
              {data.authors.map((author, index) => (
                <div key={author.name} className="flex items-center gap-2 text-xs text-foreground">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: LINE_COLORS[index % LINE_COLORS.length] }}
                  />
                  <span>{author.name}</span>
                  <span className="text-muted-foreground">({author.total})</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
