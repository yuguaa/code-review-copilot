import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('session review command route', () => {
  it('delegates slash review commands to the session service', () => {
    const routeSource = readFileSync(new URL('./sessions.routes.ts', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('./sessions.service.ts', import.meta.url), 'utf8');
    const lifecycleSource = readFileSync(new URL('./session-lifecycle.service.ts', import.meta.url), 'utf8');

    expect(routeSource).toContain("sessionRoutes.post('/:id/review-command'");
    expect(routeSource).toContain("sessionRoutes.post('/:id/message-feedback'");
    expect(routeSource).toContain('submitMessageFeedback(sessionId, body.messageId, body.feedback, body.findingText)');
    expect(routeSource).toContain('runReviewCommand(sessionId)');
    expect(routeSource).toContain("result.kind === 'invalid-kind'");
    expect(routeSource).toContain("result.kind === 'running'");
    expect(routeSource).toContain("result.kind === 'missing-seed'");
    expect(routeSource).not.toContain('prisma.message.create');

    expect(serviceSource).toContain("session.kind !== 'review'");
    expect(serviceSource).toContain("session.status === 'running'");
    expect(serviceSource).toContain('parentId: seed.id');
    expect(serviceSource).toContain('代码审查指令');
    expect(serviceSource).toContain('markReviewSessionRunning(sessionId, command.id)');
    expect(serviceSource).toContain('void runReviewSession(sessionId)');

    expect(lifecycleSource).toContain("status: 'running'");
    expect(lifecycleSource).toContain("publishSessionStatus(sessionId, 'running')");
    expect(lifecycleSource).toContain('markReviewSessionCompleted');
    expect(lifecycleSource).toContain('markReviewSessionFailed');
  });
});
