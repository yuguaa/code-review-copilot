import { useEffect, useMemo, useRef, useState } from 'react';
import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { ArrowUpIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CornerDownRightIcon, SquareIcon } from 'lucide-react';
import { toast } from 'sonner';

import { ActionError, ResourceState } from '@web/components/common/resource-state';
import { Conversation, ConversationContent, ConversationScrollButton } from '@web/components/ai-elements/conversation';
import { Message, MessageAction, MessageActions, MessageContent, MessageResponse } from '@web/components/ai-elements/message';
import { PromptInput, PromptInputBody, PromptInputFooter, PromptInputSubmit, PromptInputTextarea, PromptInputTools } from '@web/components/ai-elements/prompt-input';
import { Reasoning, ReasoningContent, ReasoningTrigger } from '@web/components/ai-elements/reasoning';
import { Tool, ToolContent, ToolHeader, ToolInput, ToolOutput } from '@web/components/ai-elements/tool';
import { Button } from '@web/components/ui/button';
import { Select } from '@web/components/ui/forms';
import { useAction, useResource } from '@web/hooks/use-resource';
import { api } from '@web/lib/api';

import type { AIModelSummary, SessionDetail } from '@web/lib/types';
import type { UIMessage } from 'ai';

type ToolPartView = { type: string; state?: string; toolName?: string; input?: unknown; output?: unknown; errorText?: string };

function renderPart(part: UIMessage['parts'][number], key: number, streaming: boolean) {
  if (part.type === 'text') return <MessageResponse key={key} streaming={streaming}>{part.text}</MessageResponse>;
  if (part.type === 'reasoning') return <Reasoning key={key} isStreaming={streaming && part.state !== 'done'} defaultOpen={streaming}>
    <ReasoningTrigger /><ReasoningContent>{part.text}</ReasoningContent>
  </Reasoning>;
  if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
    const tool = part as ToolPartView;
    const title = tool.toolName ?? tool.type.replace(/^tool-/, '');
    const state = tool.state ?? 'input-streaming';
    return <Tool key={key} defaultOpen={state === 'output-error'}><ToolHeader title={title} state={state} />
      <ToolContent><ToolInput input={tool.input} /><ToolOutput output={tool.output} errorText={tool.errorText} /></ToolContent>
    </Tool>;
  }
  return null;
}

function hasRenderablePart(message: UIMessage): boolean {
  return message.parts.some((part) => part.type === 'text' || part.type === 'reasoning'
    || part.type === 'dynamic-tool' || part.type.startsWith('tool-'));
}

export function ReviewChat({ detail, runId, blocked, refresh }: {
  detail: SessionDetail; runId?: string; blocked: boolean; refresh: () => Promise<SessionDetail | undefined | void>;
}) {
  const [input, setInput] = useState('');
  const [parentMessageId, setParentMessageId] = useState<string | null>(null);
  const [modelId, setModelId] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const submittedText = useRef('');
  const busyRef = useRef(false);
  const models = useResource<{ models: AIModelSummary[] }>('/api/settings/models');
  const branchAction = useAction();
  const transport = useMemo(() => new DefaultChatTransport({
    api: "/api/chat", body: { sessionId: detail.session.id },
    prepareSendMessagesRequest: ({ id, trigger, messageId, messages, body }) => ({
      body: { ...body, id, trigger, messageId, messages: messages.slice(-1) },
    }),
  }), [detail.session.id]);
  const chat = useChat({
    id: `${detail.session.id}:${runId ?? 'chat'}`, messages: detail.messages, transport,
    onError: (error) => { toast.error(error.message); setInput(submittedText.current); },
    onFinish: () => {
      setParentMessageId(null);
      return refresh().then((next) => { if (next) chat.setMessages(next.messages); });
    },
  });
  const busy = chat.status === 'submitted' || chat.status === 'streaming';
  busyRef.current = busy;
  const disabled = busy || blocked || Boolean(branchAction.pending);
  const { setMessages, stop } = chat;

  useEffect(() => {
    /* 服务端回显只在本地生成结束后同步。 */
    if (!busyRef.current) setMessages(detail.messages);
  }, [detail.messages, setMessages]);
  useEffect(() => () => { void stop(); }, [stop]);

  const send = () => {
    const text = input.trim();
    if (!text || disabled) return;
    submittedText.current = text;
    setInput('');
    void chat.sendMessage({ text }, {
      body: { runId, parentMessageId, ...(modelId ? { aiModelId: modelId } : {}) },
    }).catch((error: unknown) => {
      setInput(text);
      if (error instanceof Error && error.name !== 'AbortError') toast.error(error.message);
    });
  };
  const changeBranch = (messageId: string) => branchAction.execute('branch', () => api(`/api/sessions/${detail.session.id}/active-message`, {
    method: 'POST', body: JSON.stringify({ messageId }),
  }).then(() => { setParentMessageId(null); return refresh(); }));

  return <div className="flex min-h-0 flex-1 flex-col">
    <Conversation className="flex-1">
      <ConversationContent aria-busy={busy}>
            {chat.messages.length === 0 && <ResourceState empty title="围绕代码继续提问" description="描述你想了解的实现、提交或审查结论。" />}
            {chat.messages.map((message) => {
              const streaming = busy && message.id === chat.messages.at(-1)?.id && message.role === 'assistant';
              if (!hasRenderablePart(message) && !streaming) return null;
              const isUser = message.role === 'user';
              const node = detail.messageTree.find((item) => item.id === message.id);
              return <Message key={message.id} from={message.role}>
                  <span className="text-xs font-medium text-muted-foreground">{isUser ? '你' : '助手'}</span>
                  <MessageContent>
                    {message.parts.map((part, index) => renderPart(part, index, streaming))}
                    {streaming && !hasRenderablePart(message) && <MessageResponse streaming>{''}</MessageResponse>}
                  </MessageContent>
                    <MessageActions>
                      <MessageAction tooltip="从这里追问" disabled={disabled} onClick={() => { setParentMessageId(message.id); inputRef.current?.focus(); }}>
                        {parentMessageId === message.id ? <CheckIcon /> : <CornerDownRightIcon />}<span>从这里追问</span>
                      </MessageAction>
                      {node && node.siblingCount > 1 && <div className="ml-auto flex items-center gap-2">
                        <MessageAction tooltip="上一个消息分支" size="icon-xs" disabled={disabled || node.siblingIndex <= 0} onClick={() => changeBranch(node.siblingIds[node.siblingIndex - 1])}><ChevronLeftIcon /></MessageAction>
                        <span className="text-[11px] text-muted-foreground">{node.siblingIndex + 1}/{node.siblingCount}</span>
                        <MessageAction tooltip="下一个消息分支" size="icon-xs" disabled={disabled || node.siblingIndex >= node.siblingCount - 1} onClick={() => changeBranch(node.siblingIds[node.siblingIndex + 1])}><ChevronRightIcon /></MessageAction>
                      </div>}
                    </MessageActions>
                </Message>
              ;
            })}
      </ConversationContent>
      <ConversationScrollButton />
    </Conversation>
    <p role="status" aria-live="polite" className="sr-only">{busy ? '正在生成回复' : '回复已更新'}</p>
    <div className="border-t p-4 sm:px-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <ActionError error={branchAction.error} />
        {models.error && <ActionError error={models.error} />}
        {parentMessageId && <div className="flex items-center justify-between text-xs text-muted-foreground"><span>从选中的消息建立分支</span><Button variant="ghost" size="xs" onClick={() => setParentMessageId(null)}>取消选择</Button></div>}
        <PromptInput onSubmit={(event) => { event.preventDefault(); send(); }}>
          <PromptInputBody><PromptInputTextarea ref={inputRef} aria-label="追问内容" placeholder={blocked ? '审查结束后可以继续追问' : '询问实现、风险或审查结论…'} value={input} disabled={disabled} onChange={(event) => setInput(event.target.value)} onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); }
          }} /></PromptInputBody>
          <PromptInputFooter><PromptInputTools>
            <Select aria-label="追问模型" className="max-w-64" value={modelId} onChange={(event) => setModelId(event.target.value)} disabled={disabled || models.loading}>
              <option value="">仓库默认模型</option>
              {models.data?.models.filter((model) => model.isActive).map((model) => <option value={model.id} key={model.id}>{model.provider}/{model.modelId}{model.isDefault ? '（默认）' : ''} · {model.id.slice(-6)}</option>)}
            </Select>
          </PromptInputTools>
          {busy ? <Button type="button" variant="outline" size="sm" disabled={branchAction.pending === 'stop'} onClick={() => branchAction.execute('stop', () => api(`/api/chat/${detail.session.id}/stop`, { method: 'POST' }).then(() => stop()).then(refresh))}><SquareIcon />{branchAction.pending === 'stop' ? '正在停止…' : '停止生成'}</Button>
            : <PromptInputSubmit disabled={disabled || !input.trim()} aria-label="发送追问"><ArrowUpIcon />发送</PromptInputSubmit>}
          </PromptInputFooter>
        </PromptInput>
      </div>
    </div>
  </div>;
}
