import { afterEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createGitLabServiceMock, validateDingtalkTargetMock } = vi.hoisted(() => ({
  prismaMock: {
    gitLabAccount: { findUnique: vi.fn() },
    $transaction: vi.fn(),
  },
  createGitLabServiceMock: vi.fn(),
  validateDingtalkTargetMock: vi.fn(() => Promise.resolve()),
}));

vi.mock("@server/infrastructure/prisma/prisma.service", () => ({ prisma: prismaMock }));
vi.mock("@server/shared/gitlab/gitlab.service", () => ({ createGitLabService: createGitLabServiceMock }));
vi.mock("@server/modules/notifications/notifications.service", () => ({ validateDingtalkTarget: validateDingtalkTargetMock }));

describe("动态仓库 Webhook 配置", () => {
  afterEach(() => {
    delete process.env.GITLAB_AUTO_CONFIGURE_WEBHOOKS;
    delete process.env.APP_PUBLIC_URL;
    vi.clearAllMocks();
  });

  it("生产配置创建仓库前自动同步项目 Hook", async () => {
    process.env.GITLAB_AUTO_CONFIGURE_WEBHOOKS = "1";
    process.env.APP_PUBLIC_URL = "https://review.example/";
    const account = {
      id: "account-1", url: "https://gitlab.example", accessToken: "access-token", webhookSecret: "webhook-secret", isActive: true,
    };
    const repository = { id: "repository-1", customApiKey: null, defaultAIModel: null };
    const transaction = { repository: { create: vi.fn().mockResolvedValue(repository) } };
    const ensureProjectWebhook = vi.fn().mockResolvedValue({ id: 9, url: "https://review.example/api/webhook/gitlab" });
    prismaMock.gitLabAccount.findUnique.mockResolvedValue(account);
    prismaMock.$transaction.mockImplementation((callback: (client: typeof transaction) => Promise<unknown>) => callback(transaction));
    createGitLabServiceMock.mockReturnValue({ ensureProjectWebhook });

    const { createRepository } = await import("./repositories.service");
    await createRepository({ gitLabAccountId: account.id, gitLabProjectId: 13084, name: "TeachMind", path: "team/teachmind" });

    expect(createGitLabServiceMock).toHaveBeenCalledWith(account.url, account.accessToken);
    expect(ensureProjectWebhook).toHaveBeenCalledWith(13084, "https://review.example/api/webhook/gitlab", account.webhookSecret);
    expect(transaction.repository.create).toHaveBeenCalledTimes(1);
  });
});
