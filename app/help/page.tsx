import { Card, CardContent } from '@/components/ui/card'
import { Code2, GitFork, Settings, HelpCircle, Clock, Webhook, FileKey, Shield, Zap } from 'lucide-react'

export default function HelpPage() {
  const sections = [
    {
      id: 'getting-started',
      title: '快速开始',
      icon: <Zap className="h-5 w-5 text-sidebar-primary" />,
      steps: [
        {
          icon: <GitFork className="h-5 w-5 text-sidebar-primary" />,
          title: '1. 配置 GitLab 账号',
          description: '在设置页面添加你的 GitLab 账号，需要提供访问令牌',
          details: [
            '登录 GitLab，进入 Settings → Access Tokens',
            '创建个人访问令牌，需要 api 和 read_repository 权限',
            '复制令牌并粘贴到配置页面',
            '（可选）设置 Webhook 密钥以验证请求'
          ]
        },
        {
          icon: <Settings className="h-5 w-5 text-sidebar-primary" />,
          title: '2. 配置 AI 模型',
          description: '添加并配置用于代码审查的 AI 模型',
          details: [
            '选择提供商：OpenAI、Anthropic Claude 或自定义',
            '输入模型 ID（如 gpt-4o、claude-3-5-sonnet-20241022）',
            '提供 API 密钥',
            '（可选）配置最大 Tokens 和 Temperature 参数',
            '添加模型后，点击"启用"使其激活'
          ]
        },
        {
          icon: <Code2 className="h-5 w-5 text-sidebar-primary" />,
          title: '3. 添加仓库',
          description: '选择要审查的 GitLab 仓库',
          details: [
            '点击"添加仓库"按钮',
            '从列表中选择或搜索要添加的仓库',
            '为仓库选择默认 AI 模型（或使用全局默认）',
            '（可选）启用自动审查功能'
          ]
        },
        {
          icon: <FileKey className="h-5 w-5 text-sidebar-primary" />,
          title: '4. 配置分支规则',
          description: '为不同分支配置审查规则',
          details: [
            '进入仓库详情页',
            '添加分支配置，支持通配符（如 feature/*）',
            '为每个配置设置专用的 AI 模型',
            '自定义系统 Prompt 以指导审查重点',
            '启用或禁用特定配置'
          ]
        },
        {
          icon: <Webhook className="h-5 w-5 text-sidebar-primary" />,
          title: '5. 配置 Webhook',
          description: '在 GitLab 中配置 Webhook 以触发自动审查',
          details: [
            '进入 GitLab 仓库的 Settings → Webhooks',
            'URL 填写：https://your-domain.com/api/webhook/gitlab',
            '勾选 Merge request events',
            '（可选）如果在配置中设置了密钥，需在 URL 中添加 ?secret=YOUR_SECRET',
            '点击"Add webhook"完成配置'
          ]
        }
      ]
    },
    {
      id: 'ai-models',
      title: 'AI 模型配置',
      icon: <Settings className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: '支持哪些 AI 模型？',
          answer: '目前支持：\n• OpenAI：GPT-4o、GPT-4 Turbo、GPT-3.5 Turbo\n• Anthropic Claude：Claude 3.5 Sonnet、Claude 3 Haiku、Claude 3 Opus\n• 自定义：任何兼容 OpenAI API 格式的模型（如本地部署的 Llama）'
        },
        {
          question: '什么是全局默认模型？',
          answer: '全局默认模型是在设置页面配置的 AI 模型，当仓库没有单独配置模型时，将自动使用全局默认模型。这样可以避免为每个仓库重复配置。'
        },
        {
          question: '如何为不同仓库使用不同模型？',
          answer: '在仓库列表中，点击仓库的"AI 模型"列，选择该仓库专用的模型。如果不选择，则使用全局默认模型。这样可以根据项目需求使用不同的审查策略。'
        },
        {
          question: 'Temperature 参数有什么作用？',
          answer: 'Temperature 控制 AI 回复的随机性：\n• 较低值（0.1-0.3）：更确定、保守的审查\n• 中等值（0.4-0.7）：平衡的审查\n• 较高值（0.8-1.0）：更多样化的建议\n代码审查建议使用 0.2-0.4 之间'
        },
        {
          question: '如何使用本地部署的模型？',
          answer: '选择"自定义"提供商，然后：\n1. 输入模型 ID（如 llama-3-70b）\n2. 填写 API 请求地址（如 http://localhost:11434/v1）\n3. 确保你的服务兼容 OpenAI API 格式'
        }
      ]
    },
    {
      id: 'branch-config',
      title: '分支配置',
      icon: <Code2 className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: '什么是分支配置？',
          answer: '分支配置允许你为不同的分支设置不同的审查规则。例如：\n• main 分支：使用严格审查，高 Temperature\n• feature/* 分支：使用常规审查\n• hotfix/* 分支：快速审查，只关注关键问题'
        },
        {
          question: '如何使用通配符匹配分支？',
          answer: '支持以下通配符模式：\n• feature/*：匹配所有 feature 开头的分支\n• */dev：匹配所有以 dev 结尾的分支\n• release-*：匹配所有 release- 开头的分支\n• *：匹配所有分支（慎用）'
        },
        {
          question: '如何自定义系统 Prompt？',
          answer: '在分支配置中，可以编写自定义系统 Prompt 来指导 AI 审查重点。例如：\n\n"请重点关注以下方面：\n1. 安全漏洞和潜在风险\n2. 性能问题\n3. 代码可维护性\n4. 测试覆盖率"'
        },
        {
          question: '一个仓库可以有多个分支配置吗？',
          answer: '可以。一个仓库可以添加多个分支配置，系统会按照配置顺序匹配第一个符合条件的规则。建议将具体分支放在前面，通配符规则放在后面。'
        }
      ]
    },
    {
      id: 'webhook',
      title: 'Webhook 配置',
      icon: <Webhook className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: '为什么需要配置 Webhook？',
          answer: 'Webhook 用于在 GitLab 发生特定事件（如创建 Merge Request）时，自动通知 Code Review Copilot 进行代码审查。配置后，审查会自动触发，无需手动操作。'
        },
        {
          question: '如何设置 Webhook 密钥？',
          answer: '在设置页面的 GitLab 账号配置中，可以设置 Webhook 密钥。设置后，在 GitLab Webhook URL 中添加 ?secret=YOUR_SECRET。系统会验证密钥以确保请求来自合法来源。'
        },
        {
          question: 'Webhook URL 是什么？',
          answer: 'Webhook URL 格式为：https://your-domain.com/api/webhook/gitlab\n如果设置了密钥，URL 应为：https://your-domain.com/api/webhook/gitlab?secret=YOUR_SECRET'
        },
        {
          question: '配置 Webhook 后没有反应？',
          answer: '请检查：\n1. Webhook URL 是否正确\n2. GitLab 中是否勾选了 "Merge request events"\n3. 仓库是否启用了"自动审查"\n4. 查看系统日志确认 Webhook 是否被触发'
        }
      ]
    },
    {
      id: 'review',
      title: '审查说明',
      icon: <Shield className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: '审查结果如何分级？',
          answer: '问题分为三个级别：\n\n🔴 严重：\n• 安全漏洞（SQL 注入、XSS 等）\n• 重大 Bug（空指针、资源泄漏等）\n• 数据丢失风险\n\n🟡 一般：\n• 代码质量问题（重复代码、过长函数等）\n• 性能问题（N+1 查询、低效算法等）\n• 错误处理不当\n\n🔵 建议：\n• 最佳实践（命名规范、设计模式等）\n• 可读性改进\n• 文档完善'
        },
        {
          question: 'AI 如何决定审查哪些文件？',
          answer: 'AI 会审查 Merge Request 中所有变更的文件。对于大型 PR，系统可能会分批处理以确保质量。你可以通过自定义 Prompt 指定需要重点关注或忽略的文件类型。'
        },
        {
          question: '审查结果会自动发布到 GitLab 吗？',
          answer: '这取决于你的配置。默认情况下，审查完成后，评论会自动发布到 GitLab Merge Request。你也可以在审查日志中查看结果，手动选择是否发布。'
        },
        {
          question: '如何查看历史审查记录？',
          answer: '在审查记录页面，你可以查看所有历史审查，包括：\n• 审查状态（进行中/完成/失败）\n• 审查的仓库和分支\n• 发现的问题统计\n• 详细的审查评论'
        }
      ]
    },
    {
      id: 'troubleshooting',
      title: '故障排除',
      icon: <HelpCircle className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: '添加仓库时提示"加载项目失败"？',
          answer: '请检查：\n1. GitLab 访问令牌是否有效\n2. 令牌是否有足够的权限（api、read_repository）\n3. GitLab URL 是否正确\n4. 网络连接是否正常'
        },
        {
          question: 'AI 审查失败或报错？',
          answer: '常见原因：\n1. API 密钥无效或已过期\n2. API 配额用完\n3. 网络问题导致 API 超时\n4. 模型配置错误\n\n建议：先在设置页面测试连接，确认配置正确。'
        },
        {
          question: '审查结果不如预期？',
          answer: '可以尝试：\n1. 调整 Temperature 参数\n2. 更换不同的 AI 模型\n3. 优化系统 Prompt，明确审查重点\n4. 为不同分支配置不同的审查策略'
        },
        {
          question: '如何删除不需要的配置？',
          answer: '• 删除仓库：在仓库列表中点击删除按钮\n• 删除分支配置：在仓库详情中删除特定配置\n• 删除 AI 模型：在设置页面删除模型\n• 删除 GitLab 账号：删除账号会同时删除关联的所有仓库'
        }
      ]
    }
  ]

  return (
    <div className="p-8">
      {/* 页面标题 */}
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-foreground mb-1">
          帮助中心
        </h1>
        <p className="text-sm text-muted-foreground">
          了解如何使用 Code Review Copilot 进行智能代码审查
        </p>
      </div>

      {/* 内容区块 */}
      {sections.map((section) => (
        <Card key={section.id} className="border-border/40 mb-6">
          <div className="p-6">
            <div className="flex items-center gap-3 mb-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-sidebar shrink-0">
                {section.icon}
              </div>
              <h2 className="text-lg font-semibold text-foreground">{section.title}</h2>
            </div>

            <div className="space-y-6">
              {section.steps ? (
                // 快速开始步骤
                <div className="space-y-6">
                  {section.steps.map((step, index) => (
                    <div key={index} className="border-l-2 border-border/40 pl-6 pb-6 last:pb-0 last:border-0">
                      <div className="flex items-start gap-4 mb-3">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted shrink-0">
                          {step.icon}
                        </div>
                        <div className="flex-1">
                          <h3 className="text-sm font-semibold text-foreground mb-1">{step.title}</h3>
                          <p className="text-xs text-muted-foreground mb-3">{step.description}</p>
                          {step.details && (
                            <ul className="space-y-1">
                              {step.details.map((detail, idx) => (
                                <li key={idx} className="text-xs text-muted-foreground flex items-start gap-2">
                                  <span className="text-sidebar-primary mt-0.5">•</span>
                                  <span>{detail}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : section.content ? (
                // FAQ 内容
                <div className="space-y-4">
                  {section.content.map((item, index) => (
                    <div key={index} className="border-b border-border/40 pb-4 last:border-0 last:pb-0">
                      <h3 className="text-sm font-semibold text-foreground mb-2">{item.question}</h3>
                      <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-line">
                        {item.answer}
                      </p>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Card>
      ))}

      {/* 联系支持 */}
      <Card className="border-border/40">
        <div className="p-6">
          <h2 className="text-lg font-semibold text-foreground mb-4">需要更多帮助？</h2>
          <p className="text-sm text-muted-foreground mb-4">
            如果你在使用过程中遇到问题，可以通过以下方式联系我们
          </p>
          <div className="flex gap-4">
            <a
              href="https://github.com/your-repo/issues"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sidebar-primary hover:underline"
            >
              GitHub Issues
            </a>
            <span className="text-muted-foreground">•</span>
            <a
              href="mailto:support@example.com"
              className="text-sm text-sidebar-primary hover:underline"
            >
              Email 支持
            </a>
            <span className="text-muted-foreground">•</span>
            <a
              href="https://github.com/your-repo/wiki"
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-sidebar-primary hover:underline"
            >
              文档中心
            </a>
          </div>
        </div>
      </Card>
    </div>
  )
}
