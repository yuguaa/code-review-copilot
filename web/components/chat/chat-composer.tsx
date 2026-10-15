import { ScanSearchIcon, SquareIcon } from 'lucide-react';
import type { ChatStatus } from 'ai';
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputSelect,
  PromptInputSelectContent,
  PromptInputSelectItem,
  PromptInputSelectTrigger,
  PromptInputSelectValue,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@web/components/ai-elements/prompt-input';
import type { ChatModelOption } from '@web/lib/types';

/** 会话输入器：模型选择、重新审查指令与停止生成都在同一条工具栏上。 */
export function ChatComposer({
  status,
  disabled,
  placeholder,
  modelOptions,
  modelsLoading,
  selectedModelId,
  onModelChange,
  onSubmit,
  onStop,
  canRunReview,
  runningReview,
  onRunReview,
}: {
  status: ChatStatus;
  disabled: boolean;
  placeholder: string;
  modelOptions: ChatModelOption[];
  modelsLoading: boolean;
  selectedModelId: string;
  onModelChange: (modelId: string) => void;
  onSubmit: (text: string) => void;
  onStop: () => void;
  canRunReview: boolean;
  runningReview: boolean;
  onRunReview: () => void;
}) {
  const busy = status === 'submitted' || status === 'streaming';

  return (
    <div className="px-3 pb-3 sm:px-4 sm:pb-4">
      <div className="mx-auto w-full max-w-3xl">
        <PromptInput
          onSubmit={({ text }) => {
            const trimmed = text.trim();
            if (!trimmed) return;
            onSubmit(trimmed);
          }}
        >
          <PromptInputBody>
            <PromptInputTextarea
              placeholder={placeholder}
              disabled={disabled}
              className="min-h-16"
            />
          </PromptInputBody>
          <PromptInputFooter>
            <PromptInputTools>
              <PromptInputSelect
                value={selectedModelId}
                onValueChange={(value) => onModelChange(String(value))}
              >
                <PromptInputSelectTrigger className="max-w-56" disabled={modelsLoading}>
                  <PromptInputSelectValue placeholder={modelsLoading ? '加载模型…' : '默认模型'} />
                </PromptInputSelectTrigger>
                <PromptInputSelectContent>
                  {modelOptions.map((option) => (
                    <PromptInputSelectItem key={option.id} value={option.id}>
                      <span className="truncate">{option.label}</span>
                    </PromptInputSelectItem>
                  ))}
                </PromptInputSelectContent>
              </PromptInputSelect>
              {canRunReview ? (
                <PromptInputButton
                  onClick={onRunReview}
                  disabled={runningReview}
                  title="重新执行当前审查，完成后按仓库配置回写评论或钉钉"
                >
                  <ScanSearchIcon />
                  <span>{runningReview ? '执行中…' : '重新审查'}</span>
                </PromptInputButton>
              ) : null}
            </PromptInputTools>
            {busy ? (
              <PromptInputButton onClick={onStop} title="停止生成">
                <SquareIcon />
              </PromptInputButton>
            ) : (
              <PromptInputSubmit status={status} disabled={disabled} />
            )}
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  );
}
