import { createLogger } from "@server/shared/logger/logger.service";
import { drainRssFetches, resumeRssFetching, runDueRssSubscriptions } from "./rss.service";

const log = createLogger("rss-scheduler");
let timer: NodeJS.Timeout | null = null;
let batch: Promise<void> | null = null;
let stopping: Promise<void> | null = null;

export function startRssScheduler(): void {
  if (timer) return;
  if (stopping) throw new Error("RSS 调度仍在停止");
  resumeRssFetching();
  const run = () => {
    if (batch) return;
    batch = runDueRssSubscriptions().then(() => undefined).catch(() => {
      log.error("RSS 调度执行失败");
    }).finally(() => { batch = null; });
  };
  timer = setInterval(run, 60_000);
  timer.unref();
  run();
}

export function stopRssScheduler(): Promise<void> {
  if (stopping) return stopping;
  if (timer) clearInterval(timer);
  timer = null;
  stopping = Promise.all([batch, drainRssFetches()]).then(() => undefined)
    .finally(() => { stopping = null; });
  return stopping;
}
