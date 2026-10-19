## 执行方式

在主流程完成模块整合后，从项目目录运行：

```bash
node --import tsx scripts/verify-platform.ts
```

查看说明不会启动数据库：

```bash
node --import tsx scripts/verify-platform.ts --help
```

每次执行使用 `.verification/platform-*` 中的全新目录和 PostgreSQL 数据库，端口固定为 `55433`。端口已被占用时直接终止验证。数据库仅监听 `127.0.0.1`，关闭 Unix socket，结束时等待连接与数据库进程退出，并检查端口已经释放。

验证在独立子进程中显式设置新数据库地址和生成的登录凭证。Prisma CLI 对验证目录中的 schema 执行 `migrate deploy`，真实应用使用当前项目生成的 Prisma Client 和该独立数据库。配置、请求与迁移均执行实际操作。

## 验证范围

- 完整迁移与 `20261019120000_dingtalk_robots` 记录，重复部署幂等；验证机器人凭证保留、仓库及 RSS 绑定。
- 真实 `createApp` 请求、API 认证、错误密码、同源限制、登录摘要、重新登录撤销旧凭证、注销撤销复制的凭证、会话过期。
- 仓库、模型、GitLab、RSS 和机器人配置的创建、读取、更新、敏感字段隐藏、凭证留空保留和可选凭证明确清除。
- 本地 Git 仓库真实创建两次提交，OCR 原生 `version`、`review --help` 和 `review --preview`。
- Push Webhook 处理、Run 排队、重复请求、并发重新排队、排队取消、运行记录与消息关联读取。
- 未认证或失效会话访问遥测代理时被拒绝。

应用使用内存 Request 直接访问真实 Hono 路由及 PostgreSQL，不启动测试 HTTP 服务器。配置中的 `.invalid` 地址仅作为配置保存输入；脚本不访问这些地址。Run 执行器和 RSS 调度器不会启动。Webhook 输入使用上述本地 Git 提交，不表示已验证 GitLab 真实投递。

单项验证最长 60 秒，子命令最长 55 秒，输出记录与日志保存在本次验证目录。失败返回非零退出码。数据库目录保留以便检查，每次重跑均重新初始化新数据库。

## 需要外部资源的项目

- 真实模型审查、完整报告保存事务与模型追问。
- 正在执行的 OCR 进程取消、进程退出后的重新执行与服务重启恢复。
- GitLab 真实 Webhook 投递、远端 diff 版本核对、总评与行级评论发布。
- 钉钉发送、RSS 真实抓取及发送去重。
- Grafana 认证代理完整联通，以及平台与 OCR 的同一 trace 查询。

这些项目列入每次 `report.json` 的 `limitations`。本地 OCR preview 仅作为预览验证，不登记完整审查成功结果；排队与取消记录保持真实状态，没有写入编造的模型报告。
