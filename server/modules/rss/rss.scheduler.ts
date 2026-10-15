import { createLogger } from '../../shared/logger/logger.service';
import { runDueRssSubscriptions } from './rss.service';

const log = createLogger('rss-scheduler');
const CHECK_INTERVAL_MS = 60_000;

let timer: NodeJS.Timeout | null = null;

/** 每分钟检查一次到期订阅；订阅自身的抓取间隔决定实际抓取频率。 */
export function startRssScheduler(): void {
  if (timer) return;

  const run = () => {
    runDueRssSubscriptions()
      .then((result) => {
        if (result.failed > 0) {
          log.warn(`订阅检查完成，${result.failed} 个订阅抓取失败`);
        }
      })
      .catch((error) => {
        log.error(`RSS 调度失败：${error instanceof Error ? error.message : String(error)}`);
      });
  };

  run();
  timer = setInterval(run, CHECK_INTERVAL_MS);
}

export function stopRssScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
