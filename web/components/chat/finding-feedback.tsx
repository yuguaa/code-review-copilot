import { ThumbsDownIcon, ThumbsUpIcon } from 'lucide-react';
import { cn } from '@web/lib/utils';
import type { MessageFeedbackValue } from '@web/lib/types';
import { Badge } from '@web/components/ui/badge';
import { Button } from '@web/components/ui/button';
import type { ReviewFinding } from '@web/components/message/review-findings';

/** 审查结论反馈：标记真实问题或误报，结果会回流到后续审查。 */
export function FindingFeedbackList({
  findings,
  onFeedback,
}: {
  findings: ReviewFinding[];
  onFeedback: (feedback: MessageFeedbackValue, findingText: string) => void;
}) {
  return (
    <div className="mt-4 space-y-1.5 border-t pt-3">
      {findings.map((finding) => (
        <div
          key={finding.id}
          className="flex items-start gap-2.5 rounded-lg bg-muted/50 px-3 py-2"
        >
          <Badge variant="outline" className="mt-0.5 shrink-0 text-xs">
            {finding.severity}
          </Badge>
          <p className="min-w-0 flex-1 text-sm leading-6">{finding.text}</p>
          <div className="flex shrink-0 items-center gap-0.5">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-pressed={finding.feedback === 'up'}
              aria-label="确认这个问题真实存在"
              title="确认这个问题真实存在"
              className={cn(finding.feedback === 'up' && 'bg-success/15 text-success-foreground')}
              onClick={() => onFeedback('up', finding.text)}
            >
              <ThumbsUpIcon />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-pressed={finding.feedback === 'down'}
              aria-label="认为这个问题是误报"
              title="认为这个问题是误报"
              className={cn(finding.feedback === 'down' && 'bg-destructive/15 text-destructive')}
              onClick={() => onFeedback('down', finding.text)}
            >
              <ThumbsDownIcon />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
