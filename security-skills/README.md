# Security Skills

本目录提供安全测试 Agent 可加载的入口 Skill。

## hack

`hack/SKILL.md` 是授权 Web/API 测试入口，包含授权检查、范围控制、证据要求、影响优先流程和危险操作边界。

启动要求：

- 目标、授权依据和截止时间明确。
- 只测试授权 Web/API 表面。
- 先执行页面快照，再根据观察信号选择测试路径。
- 截图、请求记录和 Markdown 报告需要相互对应。

## 来源

- 上游来源：[yaklang/hack-skills 的 hack/SKILL.md](https://github.com/yaklang/hack-skills/blob/main/skills/hack/SKILL.md)
- 采用原则：授权检查、范围控制、证据完整性、影响优先。
- 上游固定 commit：`6fbf0bc8d5c71830d62543a308d8744606c43d7c`
