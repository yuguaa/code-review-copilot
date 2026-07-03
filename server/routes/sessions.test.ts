import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('session review command route', () => {
  it('delegates slash review commands to the session service', () => {
    const routeSource = readFileSync(new URL('./sessions.ts', import.meta.url), 'utf8');
    const serviceSource = readFileSync(new URL('../modules/sessions/sessions.service.ts', import.meta.url), 'utf8');

    expect(routeSource).toContain("sessionRoutes.post('/:id/review-command'");
    expect(routeSource).toContain('runReviewCommand(sessionId)');
    expect(routeSource).toContain("result.kind === 'invalid-kind'");
    expect(routeSource).toContain("result.kind === 'running'");
    expect(routeSource).toContain("result.kind === 'missing-seed'");
    expect(routeSource).not.toContain('prisma.message.create');

    expect(serviceSource).toContain("session.kind !== 'review'");
    expect(serviceSource).toContain("session.status === 'running'");
    expect(serviceSource).toContain('parentId: seed.id');
    expect(serviceSource).toContain('代码审查指令');
    expect(serviceSource).toContain("status: 'running'");
    expect(serviceSource).toContain("publishSessionStatus(sessionId, 'running')");
    expect(serviceSource).toContain('void runReviewSession(sessionId)');
  });
});
