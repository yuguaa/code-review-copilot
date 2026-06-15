import { Card } from '@/components/ui/card'
import { Code2, GitFork, Settings, HelpCircle, Webhook, Shield, Zap } from 'lucide-react'

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
          title: '2. 配置模型凭据',
          description: '添加供 Pi Profile 引用的模型凭据',
          details: [
            '选择提供商：OpenAI 或 Anthropic Claude',
            '输入模型 ID（如 gpt-4o、claude-3-5-sonnet-20241022）',
            '提供 API 密钥',
            '添加模型后，点击"启用"使其可被 Pi Profile 使用'
          ]
        },
        {
          icon: <Code2 className="h-5 w-5 text-sidebar-primary" />,
          title: '3. 添加仓库',
          description: '选择要审查的 GitLab 仓库并配置 Pi Profile',
          details: [
            '点击"添加仓库"按钮',
            '从列表中选择或搜索要添加的仓库',
            '创建 Pi Profile 并选择模型凭据',
            '（可选）配置 Profile Prompt 和 Prompt 模式（扩展/替换）',
            '（可选）启用自动审查功能'
          ]
        },
        {
          icon: <Webhook className="h-5 w-5 text-sidebar-primary" />,
          title: '4. 配置 Webhook',
          description: '在 GitLab 中配置 Webhook 以触发自动审查',
          details: [
            '进入 GitLab 仓库的 Settings → Webhooks',
            'URL 填写：https://your-domain.com/api/webhook/gitlab',
            '勾选 Merge request events 和 Push events',
            '（可选）如果在配置中设置了密钥，需在 Secret token 中填写密钥',
            '点击"Add webhook"完成配置'
          ]
        }
      ]
    },
    {
      id: 'model-credentials',
      title: '模型凭据配置',
      icon: <Settings className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: 'Pi Runtime 支持哪些模型？',
          answer: '当前主链路支持 OpenAI 和 Anthropic Claude。自定义 endpoint 尚未接入，配置后会快速失败。'
        },
        {
          question: '模型凭据和 Pi Profile 是什么关系？',
          answer: '模型凭据只保存 provider、modelId 和 API Key。仓库通过 Pi Profile 引用模型凭据，并配置 Prompt、排序和输出条数限制。'
        },
        {
          question: '如何为不同仓库使用不同模型？',
          answer: '进入仓库详情，为每个仓库创建或编辑 Pi Profile。不同仓库可以引用不同模型凭据；同一仓库当前只运行排序第一的启用 Profile。'
        },
        {
          question: 'Temperature 参数有什么作用？',
          answer: 'Temperature 控制模型输出随机性。Pi 审查建议使用较低值，让输出更稳定、更便于解析和追溯。'
        },
        {
          question: '能否使用自定义 endpoint？',
          answer: '当前 Pi Runtime 主链路尚未接入自定义 endpoint。配置自定义 provider 或 endpoint 会快速失败，避免审查链路悄悄偏移。'
        }
      ]
    },
    {
      id: 'repository-config',
      title: '仓库配置',
      icon: <Code2 className="h-5 w-5 text-sidebar-primary" />,
      content: [
        {
          question: '什么是 Pi Profile Prompt？',
          answer: 'Pi Profile Prompt 用来为仓库定制 Pi 审查重点。例如指定编码规范、安全要求或特定技术栈风险。'
        },
        {
          question: '提示词模式：扩展 vs 替换？',
          answer: '• 扩展模式（默认）：在内置提示词基础上追加你的自定义要求，保留基本审查功能\n• 替换模式：完全使用你的自定义提示词，适合需要完全自定义审查行为的场景\n\n注意：替换模式仍会保留输出格式要求以确保系统能正确解析结果'
        },
        {
          question: '如何使用监听分支？',
          answer: '监听分支允许你指定哪些分支需要自动审查：\n• 留空：监听所有分支\n• 单个分支：main\n• 多个分支：main,develop（逗号分隔）\n• 通配符：feature/*,hotfix/*'
        },
        {
          question: '如何为仓库配置独立模型？',
          answer: '在仓库详情中创建 Pi Profile，并选择该 Profile 使用的模型凭据。仓库不再保存独立 API Key，模型归属统一由 Pi Profile 管理。'
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
          answer: 'Webhook URL 格式为：https://your-domain.com/api/webhook/gitlab\n如果设置了密钥，需要在 GitLab Webhook 配置的 Secret token 字段中填写密钥'
        },
        {
          question: '配置 Webhook 后没有反应？',
          answer: '请检查：\n1. Webhook URL 是否正确\n2. GitLab 中是否勾选了 "Merge request events" 和 "Push events"\n3. 仓库是否启用了"自动审查"\n4. 如果设置了密钥，确认 Secret token 填写正确\n5. 查看系统日志确认 Webhook 是否被触发'
        },
        {
          question: '支持哪些触发事件？',
          answer: '目前支持两种触发事件：\n• Merge Request events：创建或更新 MR 时触发审查\n• Push events：直接推送到分支时触发审查\n\n建议同时启用两种事件以覆盖所有场景'
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
          question: 'Pi 如何决定审查哪些文件？',
          answer: '系统先获取本次 MR 或 Push 的可审查 diff，再把变更清单和 patch 写入 sandbox。Pi 必须基于这些材料输出可定位 finding。'
        },
        {
          question: '审查结果会自动发布到 GitLab 吗？',
          answer: '这取决于你的配置。默认情况下，审查完成后，评论会自动发布到 GitLab Merge Request。你也可以在审查日志中查看结果，手动选择是否发布。'
        },
        {
          question: '如何查看历史审查记录？',
          answer: '在审查历史页面，你可以查看所有历史审查，包括：\n• 审查状态（进行中/完成/失败/已停止）\n• 审查的仓库和分支\n• 发现的问题统计\n• 详细的审查评论\n• Pi 原始输出、Prompt 和 Bubblewrap 会话\n\n支持分页浏览，每页显示 20 条记录'
        },
        {
          question: 'GitLab 上会留下什么样的评论？',
          answer: '当前只发布一条总评评论，包含结论、问题索引、全部问题清单、文件风险排行、技术走查和 Pi Profile 结果。'
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
          question: 'Pi 审查失败或报错？',
          answer: '常见原因：\n1. API 密钥无效或已过期\n2. API 配额用完\n3. 网络问题导致 API 超时\n4. 模型配置错误\n\n建议：先在设置页面测试连接，确认配置正确。'
        },
        {
          question: '审查结果不如预期？',
          answer: '可以尝试：\n1. 检查 bubblewrap 是否可用\n2. 检查 /opt/pi 是否已挂载进 sandbox\n3. 检查 Bubblewrap workspace 是否可读写\n4. 更换 Pi Profile 引用的模型凭据\n5. 优化 Profile Prompt，明确审查重点'
        },
        {
          question: '如何删除不需要的配置？',
          answer: '• 删除仓库：在仓库列表中点击操作菜单的删除图标\n• 删除模型凭据：在设置页面的模型凭据列表中删除\n• 删除 GitLab 账号：在设置页面删除账号（会同时删除关联的所有仓库）'
        },
        {
          question: '系统性能和限制？',
          answer: '• 审查历史支持分页，每页 20 条记录\n• 不同仓库使用不同 Bubblewrap workspace 绑定\n• 同仓库并发 review 复用仓库缓存，但使用独立 worktree 和 Pi 进程\n• API 调用受限于 Pi Profile 引用模型的速率限制'
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
          了解如何使用 Code Review Copilot 进行 Pi Runtime 代码审查
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
    </div>
  )
}
