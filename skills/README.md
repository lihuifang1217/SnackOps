# Skills

每个客服能力使用独立目录：

```text
skills/<skill-id>/SKILL.md
```

- `SKILL.md` 是当前提示词正文，由服务端 Skill 注册中心读取和原子写入。
- 注册元数据位于 `data/skills.json`，当前版本快照位于 `data/skill-versions.json`。
- Skill ID 只允许中英文字母、数字、`_` 和 `-`；拒绝 `.`、`/`、`\` 和 `..`。
- API 不接受客户端文件路径，只接受 Skill ID；服务端必须把路径限定在 `SNACKOPS_SKILLS_DIR` 内。
- 编辑保存时自动递增补丁版本并生成快照，修改前版本标记为“历史”。

当前初始化 14 个 Skill。`risk-check` 的 R01–R08 规则是安全回复放行、危险回复阻断的审计边界。
