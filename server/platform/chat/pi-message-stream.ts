import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import type { UIMessageStreamWriterWithOutcome } from 'ai';
import type { PiRuntime } from '@server/platform/agent';

/** Pi 拥有 Agent 循环；这里仅转换前端传输事件，不执行或调度工具。 */
export function streamPiMessages(runtime: PiRuntime, prompt: string, writer: UIMessageStreamWriterWithOutcome,
  options: { signal: AbortSignal; redact: (text: string) => string }): Promise<void> {
  let step = 0;
  let stepOpen = false;
  let eventError: unknown;
  let finishReason: 'stop' | 'length' = 'stop';
  const parts = new Map<number, { id: string; type: 'text' | 'reasoning'; text: string; closed: boolean }>();
  const tools = new Map<string, { id: string; done: boolean }>();
  const openStep = () => {
    if (stepOpen) return;
    step += 1;
    stepOpen = true;
    parts.clear();
    tools.clear();
    writer.write({ type: 'start-step' });
  };
  const partText = (index: number, type: 'text' | 'reasoning', text: string, delta: boolean) => {
    openStep();
    let part = parts.get(index);
    if (!part) {
      part = { id: `pi-${step}-${index}`, type, text: '', closed: false };
      parts.set(index, part);
      writer.write({ type: `${type}-start`, id: part.id });
    }
    if (part.closed) return;
    const next = delta ? text : text.slice(part.text.length);
    if (!delta && !text.startsWith(part.text)) throw new Error('Pi 返回的消息内容与实时增量不一致');
    if (next) { writer.write({ type: `${type}-delta`, id: part.id, delta: next }); part.text += next; }
  };
  const closePart = (index: number) => {
    const part = parts.get(index);
    if (part && !part.closed) {
      writer.write({ type: `${part.type}-end`, id: part.id });
      part.closed = true;
    }
  };
  const closeStep = () => {
    if (!stepOpen) return;
    for (const index of parts.keys()) closePart(index);
    writer.write({ type: 'finish-step' });
    stepOpen = false;
  };
  const toolInput = (toolCallId: string, toolName: string, input: unknown) => {
    openStep();
    if (tools.has(toolCallId)) return;
    const id = `pi-tool-${step}-${toolCallId}`;
    tools.set(toolCallId, { id, done: false });
    writer.write({ type: 'tool-input-available', toolCallId: id, toolName, input, dynamic: true });
  };
  const toolOutput = (toolCallId: string, result: { details?: unknown; content?: Array<{ type: string; text?: string }> }, isError: boolean, preliminary = false) => {
    const tool = tools.get(toolCallId);
    if (!tool) throw new Error('Pi 工具结果缺少对应的调用事件');
    const text = result.content?.filter((part) => part.type === 'text').map((part) => part.text ?? '').join('\n') ?? '';
    if (isError) writer.write({ type: 'tool-output-error', toolCallId: tool.id, dynamic: true, errorText: options.redact(text || '工具执行失败') });
    else writer.write({ type: 'tool-output-available', toolCallId: tool.id, output: result.details ?? text, dynamic: true, ...(preliminary ? { preliminary: true } : {}) });
    if (!preliminary) tool.done = true;
  };
  const onEvent = (event: AgentSessionEvent) => {
    if (event.type === 'turn_start') openStep();
    else if (event.type === 'message_update') {
      const update = event.assistantMessageEvent;
      if (update.type === 'text_delta') partText(update.contentIndex, 'text', update.delta, true);
      else if (update.type === 'thinking_delta') partText(update.contentIndex, 'reasoning', update.delta, true);
      else if (update.type === 'text_end' || update.type === 'thinking_end') {
        partText(update.contentIndex, update.type === 'text_end' ? 'text' : 'reasoning', update.content, false);
        closePart(update.contentIndex);
      }
    } else if (event.type === 'message_end' && event.message.role === 'assistant') {
      event.message.content.forEach((part, index) => {
        if (part.type === 'text' || part.type === 'thinking') {
          partText(index, part.type === 'text' ? 'text' : 'reasoning', part.type === 'text' ? part.text : part.thinking, false);
          closePart(index);
        } else if (part.type === 'toolCall') toolInput(part.id, part.name, part.arguments);
      });
      finishReason = event.message.stopReason === 'length' ? 'length' : 'stop';
    } else if (event.type === 'message_end' && event.message.role === 'toolResult') {
      if (!tools.get(event.message.toolCallId)?.done) toolOutput(event.message.toolCallId, event.message, event.message.isError);
    } else if (event.type === 'tool_execution_start') toolInput(event.toolCallId, event.toolName, event.args);
    else if (event.type === 'tool_execution_update') toolOutput(event.toolCallId, event.partialResult, false, true);
    else if (event.type === 'tool_execution_end') toolOutput(event.toolCallId, event.result, event.isError);
    else if (event.type === 'turn_end') closeStep();
  };
  writer.write({ type: 'start' });
  const unsubscribe = runtime.session.subscribe((event) => {
    if (eventError) return;
    try { onEvent(event); } catch (error) { eventError = error; runtime.abort(error); }
  });
  return Promise.resolve().then(() => runtime.prompt(prompt)).then(() => {
    if (eventError) throw eventError;
    closeStep();
    writer.setOutcome({ status: 'completed' });
    writer.write({ type: 'finish', finishReason });
  }).catch((error: unknown) => {
    for (const tool of tools.values()) if (!tool.done) writer.write({ type: 'tool-output-error', toolCallId: tool.id,
      dynamic: true, errorText: '执行已中断，未取得工具结果' });
    closeStep();
    if (!eventError && options.signal.aborted) {
      writer.setOutcome({ status: 'aborted' });
      writer.write({ type: 'abort', reason: '回答已停止' });
    } else {
      const failure = eventError ?? error;
      writer.setOutcome({ status: 'failed', error: failure });
      writer.write({ type: 'error', errorText: options.redact(failure instanceof Error ? failure.message : String(failure)) });
    }
  }).finally(() => { unsubscribe(); return runtime.dispose(); });
}
