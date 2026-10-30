import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';

import type { AgentSession, ToolDefinition } from '@earendil-works/pi-coding-agent';
import type { ModelConfig } from '@server/modules/ai-models/ai-models.service';

export const PI_MODEL_PROVIDER_ID = 'platform-runtime';
export const PI_MODEL_CONTEXT_WINDOW = 128_000;
export const PI_MODEL_MAX_OUTPUT_TOKENS = 8_192;

export function createPiModel(config: ModelConfig, signal?: AbortSignal) {
  const modelId = config.modelId.trim();
  const apiKey = config.apiKey.trim();
  if (!modelId || !apiKey) throw new Error('模型缺少 modelId 或 apiKey');
  const settings = config.provider === 'anthropic' ? { api: 'anthropic-messages' as const, baseUrl: config.apiBaseUrl?.trim() || 'https://api.anthropic.com' }
    : config.provider === 'openai' ? { api: 'openai-responses' as const, baseUrl: config.apiBaseUrl?.trim() || 'https://api.openai.com/v1' }
      : config.provider === 'openai-compatible' ? { api: 'openai-completions' as const, baseUrl: config.apiBaseUrl?.trim() ?? '' } : null;
  if (!settings) throw new Error(`不支持的模型 provider：${config.provider}`);
  if (!settings.baseUrl) throw new Error('openai-compatible 必须配置 apiBaseUrl');
  const deepseek = config.provider === 'openai-compatible' && /deepseek/i.test(modelId);
  return ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false, signal,
  }).then((modelRuntime) => {
    signal?.throwIfAborted();
    modelRuntime.registerProvider(PI_MODEL_PROVIDER_ID, { name: 'Platform Runtime', ...settings, apiKey,
      models: [{ id: modelId, name: modelId, api: settings.api, reasoning: deepseek,
        ...(deepseek ? { compat: { thinkingFormat: 'deepseek' as const, supportsDeveloperRole: false,
          supportsStore: false, maxTokensField: 'max_tokens' as const, requiresReasoningContentOnAssistantMessages: true } } : {}),
        input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: PI_MODEL_CONTEXT_WINDOW, maxTokens: PI_MODEL_MAX_OUTPUT_TOKENS }],
    });
    const model = modelRuntime.getModel(PI_MODEL_PROVIDER_ID, modelId);
    if (!model) throw new Error(`模型注册失败：${PI_MODEL_PROVIDER_ID}/${modelId}`);
    return { modelRuntime, model };
  });
}

export function createPiRuntime(options: PiRuntimeOptions): Promise<PiRuntime> {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(options.signal?.reason ?? new Error('Agent 已取消'));
  const timeoutMs = options.timeoutMs;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Agent timeoutMs 必须大于 0');
  if (options.maxSteps !== undefined && (!Number.isInteger(options.maxSteps) || options.maxSteps < 1)) throw new Error('Agent maxSteps 必须为正整数');
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  const timer = setTimeout(() => controller.abort(new Error('Agent 执行超时')), timeoutMs);
  timer.unref();
  const cwd = options.cwd ?? process.cwd();
  const settingsManager = SettingsManager.inMemory({ compaction: { enabled: false }, retry: { enabled: false }, cacheWarming: 'off' });
  const skills = options.skills ?? [];
  const resourceLoader = new DefaultResourceLoader({ cwd, agentDir: cwd, settingsManager,
    noExtensions: true, noContextFiles: true, noPromptTemplates: true, noThemes: true, noSkills: true,
    additionalSkillPaths: skills.map((skill) => skill.path),
    skillsOverride: (current) => ({ skills: current.skills.filter((skill) => skills.some((allowed) => allowed.name === skill.name)), diagnostics: current.diagnostics }),
    systemPrompt: options.systemPrompt, appendSystemPromptOverride: () => [],
  });
  let session: AgentSession | undefined;
  let abortFailure: unknown;
  let disposed = false;
  const stopSession = () => { void session?.abort().catch((error: unknown) => { abortFailure = error; }); };
  const dispose = () => {
    if (disposed) return Promise.resolve();
    disposed = true;
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', forwardAbort);
    controller.signal.removeEventListener('abort', stopSession);
    return Promise.resolve(session?.abort()).then(() => { if (abortFailure) throw abortFailure; }).finally(() => session?.dispose());
  };
  return Promise.resolve().then(() => { controller.signal.throwIfAborted(); return createPiModel(options.modelConfig, controller.signal); })
    .then(({ modelRuntime, model }) => resourceLoader.reload().then(() => {
      controller.signal.throwIfAborted();
      const missing = skills.filter((allowed) => !resourceLoader.getSkills().skills.some((skill) => skill.name === allowed.name));
      if (missing.length) throw new Error(`Agent Skill 未加载：${missing.map((skill) => skill.name).join(', ')}`);
      const sessionManager = SessionManager.inMemory(cwd);
      /* 历史仅恢复文本上下文，零用量不计入本轮统计；会话分支由数据库管理。 */
      for (const message of options.history ?? []) {
        if (message.role === 'user') sessionManager.appendMessage({ role: 'user', content: message.text, timestamp: Date.now() });
        else sessionManager.appendMessage({ role: 'assistant', content: [{ type: 'text', text: message.text }],
          api: model.api, provider: model.provider, model: model.id, timestamp: Date.now(), stopReason: 'stop',
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } });
      }
      return createAgentSession({ cwd, agentDir: cwd, modelRuntime, model, thinkingLevel: 'off',
        noTools: 'all', tools: options.tools.map((tool) => tool.name), customTools: options.tools,
        resourceLoader, sessionManager, settingsManager,
      });
    }))
    .then(({ session: active }) => {
      session = active;
      controller.signal.addEventListener('abort', stopSession, { once: true });
      if (controller.signal.aborted) stopSession();
      controller.signal.throwIfAborted();
      const stream = active.agent.streamFunction;
      active.agent.streamFunction = (model, context, streamOptions) => stream(model, context, { ...streamOptions, maxRetries: 0 });
      const finishTurn = active.agent.finishTurn;
      let steps = 0;
      let limitReached = false;
      active.agent.finishTurn = async (turn, signal): Promise<{ action: 'continue' } | { action: 'end' } | undefined> => {
        const decision = await finishTurn?.(turn, signal);
        steps += 1;
        if (options.maxSteps && steps >= options.maxSteps) {
          limitReached = turn.message.role === 'assistant'
            && (turn.message.content.some((part) => part.type === 'toolCall') || decision?.action === 'continue');
          return { action: 'end' as const };
        }
        return decision || undefined;
      };
      return { session: active, resourceLoader, signal: controller.signal,
        abort: (reason: unknown) => controller.abort(reason), dispose,
        prompt: (text: string) => {
          controller.signal.throwIfAborted();
          steps = 0;
          limitReached = false;
          return active.prompt(text, { expandPromptTemplates: false }).then(() => {
            controller.signal.throwIfAborted();
            const reply = [...active.messages].reverse().find((message) => message.role === 'assistant');
            if (reply?.role === 'assistant' && (reply.stopReason === 'error' || reply.stopReason === 'aborted')) {
              throw new Error(reply.errorMessage || 'Pi Agent 模型请求失败');
            }
            if (limitReached) throw new Error(`Agent 已达到本轮 ${options.maxSteps} 步上限，请继续提问或调整模型步骤配置`);
          });
        },
      };
    }).catch((error: unknown) => dispose().then(() => { throw error; }));
}

export type PiRuntimeOptions = {
  modelConfig: ModelConfig; systemPrompt: string; tools: ToolDefinition[]; timeoutMs: number;
  cwd?: string; signal?: AbortSignal; maxSteps?: number;
  skills?: Array<{ name: string; path: string }>;
  history?: Array<{ role: 'user' | 'assistant'; text: string }>;
};
export type PiRuntime = { session: AgentSession; resourceLoader: DefaultResourceLoader; signal: AbortSignal;
  prompt(text: string): Promise<void>; abort(reason: unknown): void; dispose(): Promise<void> };
