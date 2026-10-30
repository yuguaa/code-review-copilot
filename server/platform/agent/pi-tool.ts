import { defineTool } from '@earendil-works/pi-coding-agent';
import { Value } from 'typebox/value';

import type { Static, TSchema } from 'typebox';

export function definePiServiceTool<T extends TSchema, R>(options: {
  name: string; label: string; description: string; parameters: T;
  execute(input: Static<T>, signal?: AbortSignal): Promise<R> | R;
}) {
  return defineTool({ ...options, execute: (_id, input, signal) => Promise.resolve().then(() => {
    signal?.throwIfAborted();
    Value.Assert(options.parameters, input);
    return options.execute(input, signal);
  }).then((details) => {
    signal?.throwIfAborted();
    return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
  }) });
}
