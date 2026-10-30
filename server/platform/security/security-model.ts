/* 保留既有模块导出路径，模型注册只由通用 Pi 运行时实现。 */
export { createPiModel as createSecurityModel, PI_MODEL_PROVIDER_ID as SECURITY_MODEL_PROVIDER_ID,
  PI_MODEL_CONTEXT_WINDOW as SECURITY_MODEL_CONTEXT_WINDOW,
  PI_MODEL_MAX_OUTPUT_TOKENS as SECURITY_MODEL_MAX_OUTPUT_TOKENS } from '@server/platform/agent';
export type SecurityPiModel = Awaited<ReturnType<typeof import('@server/platform/agent').createPiModel>>['model'];
