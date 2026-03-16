"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
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
  repositories: RepoOption[];
};

function buildPath(points: ContributionPoint[], width: number, height: number, padding: number) {
  if (points.length === 0) return "";
  const max = Math.max(...points.map((p) => p.count), 1);
  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);
  const scaleY = (height - padding * 2) / max;

  return points
    .map((point, index) => {
      const x = padding + index * stepX;
      const y = height - padding - point.count * scaleY;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildSeriesPath(values: number[], max: number, width: number, height: number, padding: number) {
  if (values.length === 0) return "";
  const stepX = (width - padding * 2) / Math.max(values.length - 1, 1);
  const scaleY = (height - padding * 2) / Math.max(max, 1);
  return values
    .map((value, index) => {
      const x = padding + index * stepX;
      const y = height - padding - value * scaleY;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");
}

function buildArea(points: ContributionPoint[], width: number, height: number, padding: number) {
  if (points.length === 0) return "";
  const max = Math.max(...points.map((p) => p.count), 1);
  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);
  const scaleY = (height - padding * 2) / max;

  const path = points
    .map((point, index) => {
      const x = padding + index * stepX;
      const y = height - padding - point.count * scaleY;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(" ");

  const lastX = padding + (points.length - 1) * stepX;
  const baselineY = height - padding;
  return `${path} L ${lastX.toFixed(2)} ${baselineY} L ${padding} ${baselineY} Z`;
}

function buildMonthTicks(points: ContributionPoint[], width: number, padding: number) {
  const ticks: Array<{ x: number; label: string }> = [];
  if (points.length === 0) return ticks;

  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);
  let lastMonth = "";
  points.forEach((point, index) => {
    const month = point.date.slice(0, 7);
    if (month !== lastMonth) {
      const label = `${point.date.slice(5, 7)}月`;
      ticks.push({ x: padding + index * stepX, label });
      lastMonth = month;
    }
  });
  return ticks;
}

export function ContributionsChart() {
  const [repositoryId, setRepositoryId] = useState<string>("all");
  const [data, setData] = useState<ContributionResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    setLoading(true);
    const query = repositoryId === "all" ? "" : `?repositoryId=${repositoryId}`;
    fetch(`/api/dashboard/contributions${query}`)
      .then((res) => res.json())
      .then((json) => {
        if (mounted) setData(json);
      })
      .catch(() => {
        if (mounted) setData({ series: [], repositories: [] });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, [repositoryId]);

  const totals = useMemo(() => {
    if (!data) return { total: 0, max: 0 };
    const total = data.series.reduce((sum, item) => sum + item.count, 0);
    const max = data.series.reduce((m, item) => Math.max(m, item.count), 0);
    return { total, max };
  }, [data]);

  const authorMax = useMemo(() => {
    if (!data) return 0;
    return data.authors.reduce((m, author) => {
      const localMax = author.counts.reduce((max, value) => Math.max(max, value), 0);
      return Math.max(m, localMax);
    }, 0);
  }, [data]);

  const width = 900;
  const height = 240;
  const padding = 28;
  const path = data ? buildPath(data.series, width, height, padding) : "";
  const area = data ? buildArea(data.series, width, height, padding) : "";
  const ticks = data ? buildMonthTicks(data.series, width, padding) : [];
  const lineColors = [
    "var(--color-chart-1)",
    "var(--color-chart-2)",
    "var(--color-chart-3)",
    "var(--color-chart-4)",
    "var(--color-chart-5)",
  ];

  return (
    <Card className="border-border/40">
      <CardContent className="p-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div>
            <h3 className="text-base font-semibold text-foreground mb-1">贡献趋势（最近一年）</h3>
            <p className="text-sm text-muted-foreground">所有作者按天提交数（多折线）</p>
          </div>
          <div className="flex items-center gap-3">
            <Badge className="bg-sidebar text-foreground border-border/40 hover:bg-sidebar-accent">
              总提交 {totals.total}
            </Badge>
            <Badge className="bg-sidebar text-foreground border-border/40 hover:bg-sidebar-accent">
              作者 {data?.authors.length || 0}
            </Badge>
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
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-[240px] text-muted-foreground">
            <Loader2 className="h-5 w-5 mr-2 animate-spin" />
            正在拉取 GitLab 提交数据
          </div>
        ) : data && data.series.length > 0 ? (
          <div className="w-full overflow-x-auto">
            <svg viewBox={`0 0 ${width} ${height}`} className="min-w-[900px] w-full h-[240px]">
              <defs>
                <linearGradient id="contribution-gradient" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity="0.35" />
                  <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity="0.04" />
                </linearGradient>
              </defs>

              <path d={area} fill="url(#contribution-gradient)" stroke="none" />
              <path d={path} fill="none" stroke="var(--color-chart-2)" strokeWidth="2.2" />

              {data.authors.map((author, index) => {
                const color = lineColors[index % lineColors.length];
                const authorPath = buildSeriesPath(author.counts, authorMax, width, height, padding);
                return (
                  <path
                    key={author.name}
                    d={authorPath}
                    fill="none"
                    stroke={color}
                    strokeWidth="1.6"
                    opacity="0.85"
                  />
                );
              })}

              {ticks.map((tick, idx) => (
                <g key={idx}>
                  <line
                    x1={tick.x}
                    y1={padding}
                    x2={tick.x}
                    y2={height - padding}
                    stroke="var(--border)"
                    strokeDasharray="4 6"
                    opacity="0.4"
                  />
                  <text
                    x={tick.x}
                    y={height - 6}
                    textAnchor="middle"
                    fontSize="11"
                    fill="var(--muted-foreground)"
                  >
                    {tick.label}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        ) : (
          <div className="flex items-center justify-center h-[240px] text-muted-foreground">
            暂无提交数据
          </div>
        )}

        {data && !loading ? (
          <div className="mt-3 text-xs text-muted-foreground">
            峰值 {totals.max} 次/天（单作者峰值 {authorMax}）
          </div>
        ) : null}

        {data && data.authors.length > 0 ? (
          <div className="mt-4 max-h-[160px] overflow-y-auto border border-border/40 rounded-lg p-3">
            <div className="text-xs text-muted-foreground mb-2">作者列表（按总提交降序）</div>
            <div className="flex flex-wrap gap-2">
              {data.authors.map((author, index) => (
                <div key={author.name} className="flex items-center gap-2 text-xs text-foreground">
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ backgroundColor: lineColors[index % lineColors.length] }}
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
