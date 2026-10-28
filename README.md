# SnackOps

零食电商客服 Agent / Planner / Skill / Tool / Eval 运营平台。

当前阶段在既有注册中心与 JSON 存储之上，完成了可运行的 Agent 主链路：

- 统一的 LLM Provider：`coze`、`openai-compatible`、`classroom-fixture`；
- Planner 生成结构化计划，独立 Plan Validator 校验能力、强制依赖、价格/订单/物流/风险场景；
- Executor 按计划真实调用 Skill 与 Tool，逐步写入 Trace；
- 最终回复经过 `risk-check`，风险结果、失败状态、评分报告与完整 RunRecord 一起持久化；
- SSE Agent API、运行记录、步骤重试、人工接管、标注与解释；
- Demo/Agent 工作台转人工与 Run 人工接管自动生成客服工单，带入会话历史、优先级、原因、事实和缺失信息；
- `/` Agent 工作台、`/demo`「零食小助手」、`/runs` 列表与 `/runs/[runId]` Trace 详情页；
- 业务数据卡片化浏览与可配置数据的 CRUD；物流不再独立配置，改为订单内实时查询；
- Skill 名称/触发描述/Prompt/参数/依赖可编辑，支持 SKILL.md 查看、单项测试、手动创建和 AI 草案创建；
- Tool 名称/能力描述可配置，展示执行方式、实现位置、数据源和只读完整配置 JSON；
- `/planner` 提供 Planner 版本/配置、可编辑 System Prompt、模型参数、必经 Skill、基础/价格 Tool 与计划预览；
- `/models` 提供 Provider/模型管理、环境变量布尔状态、连接测试和 Provider 切换；
- `/evals` 评测中心使用真实 Agent 主链路执行 EvalCase，保存本次 final reply / Trace / runId，再用纯确定性评分器评分；支持选择 caseIds 的批量评测、轮询与两批版本对比；
- 「零食小助手」支持气泡聊天、常见问题、正在输入、90 秒/Agent 结束判断、1–5 分评分与 Bad Case 队列；
- `/ops` 运营中心把 Run 监控、评分、标注、导出、规则聚类、Prompt 草案、版本应用/回滚与 Prompt A/B 串成闭环。

课堂演示 Provider 不会被硬编码为直接返回答案；它和真实 Provider 共用 Planner → Validator → Executor → 风险审核 → 评分报告的完整链路。

## 技术栈

- Next.js 16 App Router + React 19 + TypeScript strict
- Tailwind CSS 4
- shadcn/ui 风格本地组件 + Radix UI
- Lucide React、Sonner、Recharts、Zod
- `coze-coding-dev-sdk`（Coze LLM）
- pnpm

## 启动

```bash
pnpm install
pnpm dev
```

开发和生产默认端口 **5000**，可用 `DEPLOY_RUN_PORT` 覆盖：

```bash
DEPLOY_RUN_PORT=5001 pnpm dev
DEPLOY_RUN_PORT=5001 pnpm start
```

> macOS 的 AirPlay 接收器通常占用 5000。本环境使用 `DEPLOY_RUN_PORT=5001` 完成运行验收，脚本默认端口仍为 5000。

## 脚本

| 命令 | 作用 |
| --- | --- |
| `pnpm dev` | 开发服务，默认 5000，使用 Webpack |
| `pnpm build` | 生产构建 |
| `pnpm start` | 启动已构建的生产服务 |
| `pnpm lint` | ESLint，零警告 |
| `pnpm typecheck` | Next 路由类型生成后执行 `tsc --noEmit` |
| `pnpm validate` | 依次执行 typecheck 与 lint |
| `pnpm test:store` | 验证 25 份数据、并发文件锁、原子 rename、失败回滚 |
| `pnpm test:registry` | 隔离数据与 Skill 目录，验收启停、真实 Tool、版本、diff、路径穿越 |
| `pnpm test:agent` | 隔离数据与 Skill 目录，验收完整 Agent 主链路、Provider 错误、禁用能力、Tool 错误、重试/接管/自动工单/标注/解释与重启持久化 |
| `pnpm test:admin` | 隔离数据与 Skill 目录，验收业务数据 CRUD、Skill 创建/AI 草案/单项测试、Tool 配置、Planner 预览与模型 Provider 切换 |
| `pnpm seed:registry` | 用当前 Skill 文件初始化版本快照；已有数据时需显式 `--force` |
| `pnpm classroom:reset` | 重置评测集、批次、标注、改进、Skill/Skill 版本到课堂基线；不触碰商品、订单等业务基础数据 |

## 目录

```text
src/app/                       工作台、零食小助手、运行列表、详情和全部 API
src/app/api/agent/run/         POST SSE Agent 主链路
src/app/api/runs/              运行列表/详情、handoff、annotate
src/app/api/tickets/           客服工单列表
src/app/api/run/retry/         重试并创建新 RunRecord
src/app/api/explain/           解释运行和风险判断
src/app/api/registry/          当前启用 Skill + Tool
src/app/api/skills/            Skill 列表/创建、详情、文件、单项测试、版本与 diff
src/app/api/skills/draft/      AI Create Skill 草案（不保存）
src/app/api/tools/             Tool 列表、启停、名称/描述配置、真实数据测试
src/app/api/catalog/           业务数据摘要与可编辑类型 CRUD
src/app/api/planner/           Planner 配置与 Prompt；/preview 计划预览
src/app/api/llm-config/        Provider 配置、切换与连接测试
src/components/agent/          工作台、零食小助手、Trace 视图、运行详情与列表
src/lib/tickets/               Run → 客服工单自动生成与上下文归集
src/components/registry/       Skill / Tool 运营界面、创建弹窗、单项测试面板
src/components/catalog/        业务数据卡片与 CRUD 表单
src/components/planner/        Planner 配置、能力选择和计划预览
src/components/models/         模型 Provider 与连接测试
src/lib/agent/                 Planner、Validator、Executor、风险、评分、RunRecord、Planner 预览
src/lib/llm/                   Provider 配置/管理、OpenAI、Coze、课堂 fixture
src/lib/registry/              Skill/Tool 注册、文件安全、版本与 diff
src/lib/store.ts               JSON 原子读写与进程级文件锁
skills/<skill-id>/SKILL.md     14 个技能提示词
tools/definitions.ts           6 个 Tool 的 Schema 与示例输入
tools/implementations.ts       6 个 Tool 的真实数据实现
data/                          25 份数据（含 planner-config、skill-tests、eval-config；物流内嵌订单）
assets/verification/           浏览器验收截图
```

## 业务数据目录

`/catalog` 使用卡片展示 9 类业务数据：商品、活动、优惠券、订单、用户、售后政策、FAQ、工单、转人工规则。

- 可编辑：商品、活动、优惠券、售后政策、FAQ、转人工规则，支持新增、编辑、删除；
- 系统只读：订单、用户；工单由 Agent 转人工自动生成，页面只读，不提供手工增删改；
- 物流不再是独立业务数据。`data/logistics.json` 已移除，物流状态、承运商、运单号和轨迹内嵌在 `orders.json`；`query_logistics` 从订单实时聚合，不再读取独立集合；
- 卡片保留类型摘要并携带原始记录，编辑弹窗根据类型生成字段表单，服务端用 Zod 契约和唯一 ID 校验；
- API：`POST /api/catalog/:type`、`PUT /api/catalog/:type/:id`、`DELETE /api/catalog/:type/:id`，只读类型返回 403。

## Skill 创建与测试

### 编辑与版本

Skill 右侧面板可编辑名称、触发描述、System prompt、温度、最大输出 Tokens 与依赖工具；Planner / Executor 的每次调用都会重新读取注册表，因此保存后立即生效。

- `查看 SKILL.md` 读取当前生效文件并弹窗展示原文；
- `保存版本快照` 弹窗列出名称、目标版本、触发描述、模型参数、依赖、文件路径与完整 Prompt，确认后保存；
- 保存自动保留修改前快照，版本 tab 可查看全文和与其他版本的逐行 diff；
- 名称、描述、参数、依赖变化都会生成新版本；同名和同 ID 会被拒绝。

### 手动创建与 AI Create Skill

- `POST /api/skills` 手动创建：校验唯一 ID/名称、描述、参数范围、依赖工具存在，创建 `skills/<id>/SKILL.md` 和 1.0.0 初始快照；
- `POST /api/skills/draft` 只生成草案，不写入任何文件：输入能力描述，AI 生成含触发场景、指令、输出要求、安全边界、依赖建议和审阅备注的标准草案；
- 草案在前端展示格式/依赖校验问题和人工确认项，可继续编辑 ID、名称、Prompt、参数和依赖，确认后才调用创建 API；
- 课堂 fixture 与真实 Provider 共用同一草案接口；真实 Provider 失败时返回结构化错误，不静默降级；
- 路径穿越 ID（如 `../../evil`）会被拒绝。

### 单项 Skill 测试

`GET /api/skills/:id/test` 返回配置检查和最近测试；`POST /api/skills/:id/test` 独立执行单个 Skill：

- 使用当前生效的 Skill 版本、SKILL.md、模型、Temperature、Max Tokens；
- 先执行依赖 Tool，并把真实输入/输出作为上下文；
- 记录输入、输出、耗时、状态、错误、依赖检查、Tool 执行明细和 Provider/模型；
- 工具不存在或停用时不调用模型，明确记录 ERROR；不会把整条 Agent 运行冒充成单项测试；
- 测试记录持久化到 `data/skill-tests.json`，页面可查看历史。

## Tool 配置

`/tools` 右侧面板展示并可配置：

- 工具名称、能力描述（保存后 Planner / Executor 下一次读取立即生效）；
- 执行方式、实现位置、数据源（只读运行事实）；
- 完整配置 JSON（只读，包含注册表、启停/重试配置、执行元数据、Schema 与示例输入）；
- 输入/输出 Schema 与输出示例 tab；
- 单项测试结果展示服务端校验后的真实输入、真实输出、耗时和结构化错误，客户端不能伪造成功状态。

工具仍可搜索、启停，并可用真实 `data/` JSON 运行单项测试；Tool ID 与实现位置不可在页面修改。

## Planner 管理

`/planner` 真实读写 `data/planner-config.json`：

- 展示 Planner 版本（`planner.v2.1`）、配置版本、模型、Temperature、Max Tokens；
- 在保存按钮上方直接展示并编辑 Planner System Prompt；
- 配置必经 Skill、基础 Tool、价格相关 Tool；risk-check 固定强制，不可被配置移除；
- System Prompt 支持 `{{availableSkills}}`、`{{availableTools}}`、`{{mandatoryCapabilities}}`、`{{riskSignals}}`、`{{userInput}}`、`{{conversationHistory}}` 占位符，由服务端注入当前能力与风险上下文；
- 保存配置后，后续 Planner 调用立即使用新的 Prompt、模型参数和规则；
- 列出全部 Skill / Tool，停用项不可选；Tool 白名单为基础 Tool + 价格相关 Tool 的并集；
- 可设置临时 mandatoryCapabilities（从启用能力添加或输入 `skill:` / `tool:`）；
- 输入问题后调用 `POST /api/planner/preview`，以编号步骤条展示决策过程、计划能力、`selectedSkills`、`selectedTools`、`reasoning`、风险和独立校验错误/警告；
- 预览不创建 RunRecord、不执行 Tool；非法计划显示 `PLAN_PARSE_FAILED`、`MISSING_*`、`CAPABILITY_UNAVAILABLE` 等原因；
- 禁用 Skill/Tool 后刷新能力，预览会根据新的启用清单重新规划或明确校验失败；
- 实际 Agent 只使用 available_skills / available_tools；价格、活动、优惠券必须通过代码 Tool 获取；每条执行步骤进入 execution_trace；最终回复始终经过 risk-check。

## 模型管理

`/models` 管理持久化 Provider：

- 当前 Provider、模型、配置来源与运行模式 Banner；
- Provider 描述、默认模型和模型列表；
- 环境变量只显示名称与“已配置/未配置”，不读取或回显密钥值；
- 测试连接会实际调用当前 Provider；失败返回结构化错误码；
- 切换 Provider 写入 `data/llm-config.json`（`managed=true`），后续未显式指定 Provider 的 Agent Run 使用该配置；
- `classroom-fixture` 始终标记为课堂演示稳定模式；
- 真实 Provider 缺配置时禁止切换、测试返回明确错误，绝不静默降级到演示。

Provider 分辨率：请求显式 Provider → 管理后台已固定的 Provider → `LLM_PROVIDER` / 环境变量自动探测 → `classroom-fixture`。

## LLM Provider

### 选择规则

请求中的 `provider` → 管理后台固定的 `llm-config.managed` Provider → `LLM_PROVIDER` / 环境变量自动探测 → `classroom-fixture`。

- `classroom-fixture`：确定性生成器；页面、RunRecord 和 Provider 徽标明确标识“课堂演示”。不调用外部模型，但仍执行真实 Tool、versioned Skill、风险检查和评分报告。
- `openai-compatible`：读取 `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`LLM_MODEL`，请求 `<base>/chat/completions`。
- `coze`：通过 `coze-coding-dev-sdk` 的 `Config` / `LLMClient` 调用；读取 `COZE_API_TOKEN` 或 `COZE_WORKLOAD_IDENTITY_API_KEY`，可选 `COZE_INTEGRATION_BASE_URL` / `COZE_INTEGRATION_MODEL_BASE_URL`。

显式选择真实 Provider 但缺少配置时返回 `503 LLM_CONFIG_MISSING`，中文错误中说明缺少的环境变量，并提示可切换到 `classroom-fixture`。真实 Provider 调用失败、超时或返回空内容时不会自动降级为演示模式。

## Agent 主链路

### Planner

输入包含：

- `userInput`、`conversationHistory`；
- 当前启用 `availableSkills`、`availableTools`；
- 自动推导和用户传入的 `mandatoryCapabilities`。

输出结构化 JSON Plan：

```json
{
  "goal": "本次目标",
  "selectedSkills": ["need-extraction"],
  "selectedTools": ["query_products"],
  "reasoning": "选择依据",
  "mandatoryCapabilities": ["skill:risk-check", "tool:query_orders"],
  "risk": {
    "level": "low",
    "flags": [],
    "requiresHumanHandoff": false,
    "notes": []
  },
  "fallback": null
}
```

Planner 只能从当前启用的能力中选择。价格场景强制要求 `calculate_price`；订单和物流分别要求 `query_orders` / `query_logistics`；风险输入始终要求 `risk-check`；高风险场景还要求 `human-handoff-decision`。Planner 输出非法 JSON 或结构不合格时生成安全 fallback，记录解析错误，并由 Validator 阻断自动执行。

### Plan Validator

Validator 与服务层解耦，独立检查：

- 不存在或未启用的 Skill / Tool；
- mandatoryCapabilities 遗漏；
- 价格场景缺少 `calculate_price`；
- 订单/物流场景缺少对应 Tool；
- 风险场景缺少 `risk-check` 或人工接管能力；
- Plan 风险等级低于确定性输入风险；
- 重复能力以及 Planner fallback。

校验错误写入 RunRecord 的 `validation.errors`，页面以红色错误块展示。校验失败时不会执行任何 Skill / Tool，状态降级为“转人工”。

### Executor

执行顺序：

1. `need-extraction`（如计划包含）；
2. Tool（按 query_products → activities → coupons → orders → logistics → calculate_price 的安全依赖顺序）；
3. 其余中间 Skill；
4. `response-generator` 生成候选最终回复；
5. `risk-check` 审核候选回复；
6. 计算执行评分并持久化。

每个 Skill / Tool Step 至少记录：

```json
{
  "id": "step-1",
  "type": "tool",
  "capabilityId": "query_orders",
  "input": {},
  "output": {},
  "durationMs": 12,
  "status": "SUCCESS",
  "error": null,
  "startedAt": "2026-10-18T08:00:00.000Z",
  "finishedAt": "2026-10-18T08:00:00.012Z"
}
```

- Tool 失败记录 `ERROR`，RunRecord 状态为“失败”，不会伪装成功。
- Skill 调用设置超时；超时记录 `SKILL_TIMEOUT` 并写入步骤错误。
- 执行中重新读取 Skill / Tool 注册状态，停用能力不会继续执行。
- 风险审核在最终回复生成之后执行；block 时使用安全替代回复。
- 最终回复、完整 steps、风险结果和评分报告一起持久化。

### 风险审核

`risk-check.rules.v1` 对候选回复执行可审计规则：

- R01 价格与 Tool 证据一致；
- R02 禁止极限词和夸大功效；
- R03 不做超出售后政策的承诺；
- R04 新客优惠判断；
- R05 儿童、孕妇、过敏和特殊人群提示；
- R06 投诉和售后不得推诿；
- R07 疑似中奖诈骗：提醒不转账、不提供敏感信息、通过官方渠道核验；
- R08 安全回复可发送，危险回复才阻断。

`risk-check` 仍作为 versioned Skill 步骤运行，步骤记录 Skill 版本和 hash；规则引擎检查发生在最终回复之后。

### RunRecord

```json
{
  "id": "run-...",
  "question": "...",
  "source": "workbench",
  "conversationId": "conv-...",
  "createdAt": "2026-10-18T08:00:00.000Z",
  "status": "成功",
  "finalReply": "...",
  "plan": {},
  "validation": {},
  "steps": [],
  "riskResult": {},
  "durationMs": 320,
  "error": null,
  "errorCode": null,
  "provider": "classroom-fixture",
  "model": "classroom-fixture-v1",
  "isDemo": true,
  "skillVersions": [],
  "toolVersions": [],
  "evaluation": {},
  "handoff": null,
  "retryOf": null,
  "conversationEnded": false
}
```

`evaluation` 由实际 Trace 计算，包含 plan/validation、强制能力、Tool 证据、风险审核、最终回复和运行状态检查，不使用硬编码 PASS/FAIL。课堂 fixture 与真实 Provider 都进入同一评分和报告流程。

## 工作台与零食小助手

### Agent 工作台

- 输入问题、读取启用 Skill / Tool、生成 Plan JSON、逐步执行；
- 展示用户输入、Planner 计划、Planner 思考 / 决策过程、按步骤条展示的规划过程与计划能力、每个 Skill / Tool 的 Input / Output JSON、最终回复、风险报告、评分报告与完整 Trace；
- 多轮会话通过 `conversationHistory` 和 `conversationId` 延续；
- 失败的 Tool 步骤可调用 `POST /api/runs/:id/steps/:stepId/retry` 独立重试，重试结果作为新 Step 追加到同一 Trace；Skill 步骤提示重试整条运行；
- 支持人工接管（持久化原因与操作者）；
- 支持“解释本次运行”，点击后平滑跳转到解释卡片，展示 Planning 理由、风险判断、证据和改进建议。

### 零食小助手

- 标题「零食小助手」、绿色在线点、3 个常见问题、左右气泡布局、圆形发送按钮；
- 回车发送、发送后清空、自动滚动；
- 回复前约 1 秒显示“正在输入…”，实际调用同一个 `POST /api/agent/run`；
- Agent 判断收尾或 90 秒无新发言后，在聊天框内展示 1–5 分评分，不提供建议框、不提供结束按钮；
- 评分通过 `POST /api/ratings` 保存到 `ratings.json`；
- 1–2 分自动写入 `improvements.json`，并进入 `/ops` 的 Bad Case / 改进建议规则聚类。

## 运营中心 `/ops`

运营中心不是只读数字面板，所有动作都写回服务端 JSON：

- **运行监控**：运行总数、成功率、平均耗时、失败步骤、风险等级分布、人工接管率、最近 Run 和失败步骤样本；每个 Run 可打开详情。
- **服务评分**：接收 Demo / Agent 用户评分，展示评分总数、平均分、1 分 Bad Case 数；保存原始问答对和完整会话过程；按日期、评分、问题类型筛选，不提供运营端补录评分表单。
- **人工评估**：失败 Run Bad Case、Run 标注人工跟进、低评分服务进入待评估列表；填写期望回复、意图、质量标签、必经 Skill、期望 Tool 事实、禁用表述、备注和六维备注；保存为标注后进入数据标注。页面注明“复核 Bad Case 与低分服务，写出期望回复并沉淀为标注数据”。
- **数据标注**：流程为运行 → Bad Case → 人工标注 → 审核 → Eval 回归；保存用户问题、模型回复、期望回复、意图、风险、质量标签、必经 Skill、期望 Tool 事实、禁用表述、失败原因和六维分别备注；接受后才允许进入改进建议或评测集；支持审核/全部 JSONL、CSV、导入 Bad Case 和新增标注。
- **改进建议**：聚合低评分、低分标注、失败 Run 和 Eval 评测失败（当前为批次级预留口子，下阶段接入用例级）；页面明确标注“规则聚类，不是 LLM 分析”；每个类别展示六维均分和用户评分均分；给出四类方向、样本 Run 和规则建议。
- **Prompt 应用**：生成草案不会修改生产 Prompt；应用时先保存当前 Skill 版本快照，再创建新版本。
- **独立 Tab**：运营中心 Tab 顺序为运行监控、服务评分、人工评估、数据标注、改进建议、版本回滚、Prompt A/B。
- **Prompt A/B**：一次实验只选择一个 Skill，编辑该 Skill 的 A 版 / B 版 Prompt；设置 A/B 流量、分别开启/关闭 A/B，支持新增实验和保存编辑。

评分、标注、改进、A/B 和 Ops 聚合均通过独立 API 读取；页面使用 section-level error state，单个接口失败不会让整页崩溃。

## 评测中心 `/evals`

`/evals` 分为三个 Tab：

```text
评测集 | 评测运行过程 | 批次对比
```

所有运行都走真实 Agent 主链路；单条测试与过程查看在当前评测集内展开，不创建批次；批次只支持手动新建。评分器不读取旧批次结果伪造新批次。

### 评测集

- 用例总数、启用/停用、已运行、通过率、平均分、分类、能力资产；
- LLM-as-Judge 启用开关与全局 Judge 系统 Prompt 查看/修改；
- 六维评分维度、权重、公式可视化；
- 回复评分方法可视化；
- 新增、编辑、复制、删除、启停、筛选、从 Run 导入；
- 用例新增 `maxLatencyMs`；
- 「运行全部」打开手动批次确认弹窗，不自动创建批次；
- 单条运行和查看过程都在当前评测集页面内展开，不跳转、不新建批次；
- 评测集列表展示六维分、总分/通过、场景、问题、期望回复、评分方法、风控、最大耗时、禁词、关键词、期望能力、Tool 事实和人工六维标注。

`EvalCase` 额外字段：

- `maxLatencyMs`：性能维度上限，默认 3000ms；
- `expectedToolFacts`：Tool 事实命中依据；
- `humanScores`：人工六维质量标注（可作为人工评估 10% 权重的来源）。

### 六维评分

基础权重：

```text
Planner 20% · Skill 15% · Tool 25% · 回复 25% · 风控 10% · 性能 5%
```

启用人工评估时：

```text
Planner 18% · Skill 14% · Tool 23% · 回复 23% · 风控 9% · 性能 3% + 人工评估 10%
```

规则：

- Planner：100 − 缺少期望能力×30 − 误用禁止能力×35 − risk-check 非最后一步×50；
- Skill：100 − 执行失败 Skill×50；
- Tool：期望 Tool 事实命中率 − 缺失价格 Tool×25 − 价格计算早于推荐决策×30；
- 回复：无 Judge 时精准匹配 100%；有有效 Judge 时 55% 精准 + 45% Judge；禁用表述每个 −35；
- 风控：必须通过时通过 100 / 不通过 0；非强制时 risk-check 最后一步 100 / 否则 0；
- 性能：100 − 超出 `maxLatencyMs` 的比例×100；
- 人工评估：100 − Σ 低于 3 分且问题仍存在的维度 (3 − 原分)×12，追加 10%；
- 总分六维加权求和 + 人工加权，四舍五入 0–100，通过线 80。

回复评分方法：

- 精准匹配：关键点、Tool 事实、禁用表述、能力调用；
- 余弦相似度：expectedReply 与实际回复的词袋/字符相似度，仅辅助诊断，不进总分；
- LLM-as-Judge：按统一 Prompt 和用例标准评估，有效分进入回复层 45%；
- 人工评估：六维标注追加 10%，不自动替代机器分。

Judge Prompt 配置存放在 `eval-config.json`；API 为 `GET/PATCH /api/eval/config`。默认 Provider 为 `classroom-fixture` 时不会伪造 Judge 分数，会明确显示 Judge 不可用；切换到真实 Provider 后调用真实模型。

### 评测运行过程

- 展示当前批次全部数据，可切换全部 / Bad Case（非 PASS）；
- 「运行全部」打开手动批次确认弹窗；
- 每条用例默认折叠，展示总分、通过状态、场景、来源、名称、运行时间、耗时、步数、六维分和完整总分计算过程；
- 支持查看过程、重跑、Trace；重跑只更新当前展开内容，不跳转、不新建批次、不改写批次统计；
- 展开后展示评测输入、最终回复、精准匹配、余弦相似度、LLM-as-Judge、人工评估明细、发现的问题、Planner 摘要；
- 按顺序展示执行步骤，每一步输入/输出可展开。

### 批次与版本对比

批次只能通过手动新建（自定义批次 / 运行全部确认弹窗）产生。

`POST /api/eval/batch/run`：

- 不传 `caseIds`：全部 enabled 用例；
- 合法 `caseIds`：只运行指定用例；
- `caseIds: []`：400 `EMPTY_CASE_IDS`；
- 无效 ID：400 `INVALID_CASE_IDS` + `details.invalidIds`；
- 保存实际 `caseIds`、`caseSnapshot`、`caseSetHash`、Skill/Evaluator 版本与 hash、Provider/模型/params、时间、计数和 `caseResults`。

状态：

```text
queued | running | done | error | cancelled
```

单条状态：

```text
PASS | FAIL | REVIEW | ERROR
```

单条 ERROR 不阻断批次；只有整批无法继续才进入 `error`。统计满足：

```text
total = passed + failed + review + errors
```

`passRate` 分母为 `passed + failed + review`，ERROR 不进入质量通过率。

`GET /api/eval/batch/:id` 支持轮询；终态停止；404 为结构化错误。

`DELETE /api/eval/batch/:id` 删除终态批次；运行中批次返回 409 `EVAL_BATCH_RUNNING`。删除只移除批次记录，关联 RunRecord 仍保留；评测运行过程与批次对比均提供删除入口。

### 版本对比

- 通过率与 PASS/FAIL/REVIEW/ERROR 数量；
- 已修复、新增失败、状态不变但回复改变；
- 平均耗时；
- Provider、模型、params、Evaluator 版本/hash 一致性。

只有 caseIds、caseSetHash、Evaluator hash、Provider/模型/params 一致且批次完整完成时才可比较；否则显示“不可直接比较”，不输出版本变好/变差结论。

### 数据

`eval-config.json` 为 Judge 配置；`eval_cases.json` 为用例；`eval_batches.json` 为批次。
## API

| 方法与路径 | 用途 |
| --- | --- |
| `POST /api/agent/run` | SSE 运行 Agent；事件为 `run`、`plan`、`step`、`final`、`error`、`done` |
| `GET /api/runs?page=1&limit=20` | 分页运行记录 |
| `GET /api/runs/:id` | 完整 RunRecord 与 annotations |
| `POST /api/run/retry` | 用同一问题重试，创建新 RunRecord 并记录 retryOf |
| `POST /api/runs/:id/handoff` | 记录人工接管原因与操作者 |
| `POST /api/runs/:id/annotate` | 保存标注到 `annotations.json` |
| `POST /api/runs/:id/steps/:stepId/retry` | 独立重试失败的 Tool Step，并把结果追加到 Trace |
| `GET /api/ratings` / `POST /api/ratings` | 读取评分（支持时间/评分/问题类型过滤）与总数/均分/1 分统计 / 保存 Demo、Agent 或运营评分、问答对和完整会话 |
| `GET/POST /api/annotations` | 标注列表与新建（六维分、状态、对象） |
| `GET/PATCH /api/annotations/:id` | 读取 / 更新标注状态与维度 |
| `POST /api/annotations/:id/promote` | 标注转改进建议或评测集 |
| `GET /api/annotations/export` | 导出 CSV，或 `format=jsonl&scope=review|all` 导出审核/全部 JSONL |
| `POST /api/annotations/import` | 导入 Bad Case JSON/JSONL 数据 |
| `GET /api/improvements` | 规则聚类 + 改进建议 |
| `POST /api/improvements/generate-prompt` | 生成规则 Prompt 草案与 diff，不写 Skill |
| `POST /api/improvements/apply-prompt` | 人工确认后应用 Prompt，保存 Skill 版本快照 |
| `GET/POST /api/ab-tests` | Prompt A/B 记录与草稿创建 |
| `PATCH /api/ab-tests/:id` | 保存 Skill、流量、A/B 开关、状态 |
| `GET /api/ops` | 运行监控聚合数据 |
| `POST /api/explain` | 从已保存的计划、Trace、风险和评分解释运行 |
| `GET /api/registry` | 当前启用的 Skill / Tool |
| `GET /api/skills` / `POST /api/skills` | Skill 列表 / 手动创建（含初始版本） |
| `GET /api/skills/:id` / `PUT /api/skills/:id` / `PATCH /api/skills/:id` | 详情 / 保存版本 / 启停 |
| `GET /api/skills/:id/file` | 当前 SKILL.md 原文 |
| `POST /api/skills/draft` | AI Create Skill 标准草案，不保存 |
| `GET /api/skills/:id/test` / `POST /api/skills/:id/test` | 配置检查与历史 / 运行单项测试 |
| `GET /api/skills/:id/versions` | 版本列表 |
| `POST /api/skills/:id/rollback` | 回滚到历史正文并创建新当前版本 |
| `GET /api/skills/:id/versions/:versionId` | 版本全文 |
| `GET /api/skills/:id/diff` | 版本 diff |
| `GET /api/tools` / `PATCH /api/tools/:id` | Tool 列表 / 启停与名称、描述配置 |
| `POST /api/tools/:id/test` | 运行真实数据单项测试 |
| `GET /api/catalog` / `GET /api/catalog/:type` | 业务数据摘要与原始卡片记录 |
| `POST /api/catalog/:type` | 新增可配置业务数据 |
| `GET /api/overview` | 服务端聚合运营总览指标、待处理工单、运行趋势与健康状态 |
| `GET /api/tickets` | 读取自动生成的客服工单（含完整转人工上下文） |
| `PUT /api/catalog/:type/:id` / `DELETE /api/catalog/:type/:id` | 编辑 / 删除可配置业务数据 |
| `GET /api/planner` / `PUT /api/planner` | Planner 配置、Prompt 与能力清单 / 保存 Planner 运行参数 |
| `POST /api/planner/preview` | 生成 Plan 并执行独立校验，不创建 RunRecord |
| `GET /api/llm-config` / `PUT /api/llm-config` | 当前 Provider、模型、环境变量状态 / 保存配置 |
| `POST /api/llm-config/switch` | 切换并固定后续 Run 的 Provider |
| `POST /api/llm-config/test` | 实际测试 Provider 连接，失败返回结构化错误 |
| `GET /api/eval` | 返回 EvalCases、batches、skills、tools |
| `POST /api/eval/cases` | 新增评测用例 |
| `PATCH /api/eval/cases/:id` / `DELETE /api/eval/cases/:id` | 编辑 / 删除 / 启停评测用例 |
| `POST /api/eval/cases/:id/copy` | 复制用例 |
| `POST /api/eval/from-run` | 从 Run 加入评测集 |
| `POST /api/eval/score` | 用 caseId + runId 调用基础评分器 |
| `POST /api/eval/score/detailed` | 单条真实 Run 的六维评分，不创建批次 |
| `GET/PATCH /api/eval/config` | 读取/更新 LLM-as-Judge 开关、全局 Prompt 与 temperature |
| `POST /api/eval/batch/run` | 用实际 Agent 逐条执行批次并返回 batchId |
| `GET /api/eval/batch/:id` | 轮询批次状态、进度、统计与 caseResults |
| `DELETE /api/eval/batch/:id` | 删除终态批次；运行中拒绝，保留关联 RunRecord |
| `GET /api/health` | JSON 存储健康检查 |

## 页面

- `/`：完整 Agent 工作台。Provider 选择、问题输入、Planner/Validator 计划、思考过程、逐步输入输出、最终回复、风险、评分、步骤重试、人工接管和运行解释。
- `/demo`：零食小助手。常见问题、气泡聊天、正在输入、自动评分；底层调用同一个 `POST /api/agent/run`，不绕过 Planner、Skill、Tool 或风险审核。
- `/runs`：分页运行记录，展示状态、Provider、风险、步骤数和耗时。
- `/runs/[runId]`：完整 Trace、最终回复、Plan、风险、评分、版本引用、重试、人工接管、标注和解释。
- `/tickets`：客服工单。展示 Demo / Agent 工作台自动转人工和 Run 人工接管生成的工单，含用户消息、会话历史、优先级、原因码、原因、已知事实、缺失信息、建议队列与关联 Run。
- `/overview`：运营总览实时读取 `products / tickets / skills / tools / runs / eval_cases`，展示待处理工单、启用能力、评测用例、7 日运行趋势和最近运行；支持刷新真实数据和 `GET /api/overview`。
- `/ops`：运营中心。运行监控、Demo/Agent 服务评分、人工评估、数据标注、改进建议、版本回滚、Prompt A/B。
- `/evals`：评测中心。评测集 / 评测运行过程 / 批次对比三 Tab；EvalCase CRUD、LLM-as-Judge 配置、六维评分、单条内联测试、手动批次、过程 Trace 与版本对比。
- `/skills`：搜索、状态筛选、启停、编辑、SKILL.md 查看、单项测试、手动创建、AI Create Skill、版本快照与 diff、保存快照详情确认。
- `/tools`：搜索、启停、名称/能力描述配置、执行方式/实现位置/数据源、完整只读 JSON、真实数据测试。
- `/catalog`：9 类业务数据卡片；6 类可配置数据支持新增、编辑、删除，订单/用户只读，工单由转人工自动生成。
- `/planner`：Planner 版本/配置、可编辑 System Prompt、模型参数、必经 Skill、基础/价格 Tool、mandatoryCapabilities、计划预览与校验原因。
- `/models`：当前 Provider、Provider 描述、默认模型/模型列表、环境变量状态、连接测试与 Provider 切换。

## 客服工单自动生成

触发来源：

- `/demo` 最终状态为 `转人工`；
- `/` Agent 工作台最终状态为 `转人工`；
- 任意 Run 调用 `POST /api/runs/:id/handoff` 标记人工接管。

`src/lib/tickets/service.ts` 会创建或复用同一 `runId` 的工单，并回写 Run 的 `ticketId`。工单字段：

- `priority`：高风险/诈骗/过敏/投诉为紧急，否则普通；
- `reasonCode`：如 `fraud_suspected`、`allergy_safety`、`complaint`、`logistics`、`after_sales`、`manual_handoff`；
- `reason`：人工接管原因、风险 notes 或 Planner fallback；
- `knownFacts`：订单号/运单号、风险标记、风险 notes、Planner 目标、risk-check 结论；
- `missingInfo`：订单号/运单号缺失、高风险身份核验、Planner 缺失信息；
- `suggestedQueue`：安全核验、过敏与特殊人群、投诉处理、订单物流、售后处理、人工客服；
- `userMessage`：本次用户消息；
- `conversationHistory`：请求携带的历史 + 当前用户消息 + 最终回复；
- `runId`、`conversationId`、`source`、`channel`、`customer`、`skill`。

RunRecord 会持久化 `conversationHistory` 与 `ticketId`。工作台/运行详情会显示已关联工单链接；`/tickets` 页面展示完整字段。

## 课堂重置

```bash
pnpm classroom:reset
pnpm classroom:reset --dry-run
```

- 只重置：`eval_cases`、`eval_batches`、`eval-config`、`annotations`、`improvements`、`skills`、`skill-versions`、`skill-tests` 以及 14 个 `skills/*/SKILL.md`；
- 不触碰：商品、订单、用户、活动、优惠券、Run、评分、工单等业务/运行数据；
- 使用同目录临时文件 + `fsync` + 原子 `rename` 写入；
- 预设文件位于 `scripts/classroom-preset/`，重复执行结果一致；
- 不提供 HTTP 重置接口，避免生产环境无保护重置；
- 可用 `SNACKOPS_DATA_DIR`、`SNACKOPS_SKILLS_DIR` 对隔离目录执行。

## 存储层

`src/lib/store.ts` 维持服务端 JSON 原子读写：

- 只允许服务端导入，文件名限定在数据目录；
- 数据目录由 `SNACKOPS_DATA_DIR` 或项目根目录推导；
- 按绝对文件路径维护进程级 Promise 锁，覆盖完整 read → modify → write；
- 同目录临时文件 + `fsync` + 原子 `rename`；
- 校验或写入失败时保留旧数据；
- RunRecord、annotations、skills、skill-versions、skill-tests、planner-config、ratings、improvements 全部通过 Zod。

Skill 提示词继续由 `SNACKOPS_SKILLS_DIR` 管理；Skill 版本引用、hash 和工具版本写入 RunRecord，便于追溯。

## 本阶段实际验收

验收日期：2026-10-27（Asia/Shanghai）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `pnpm install` | 0 | 依赖安装/校验通过 |
| `pnpm typecheck` | 0 | TypeScript + Next 路由类型通过 |
| `pnpm lint` | 0 | 零错误、零警告 |
| `pnpm test:store` | 0 | 25 份数据、锁、原子替换、失败回滚通过 |
| `pnpm test:registry` | 0 | 注册中心验收通过 |
| `pnpm test:eval` | 0 | 纯评分器关键词 AND/OR、禁词、价格、能力、风险语义、REVIEW/ERROR 单测通过 |
| `pnpm test:reset` | 0 | 两次重置一致，业务数据未变 |
| `pnpm test:agent` | 0 | Agent 主链路 + Ops + Eval CRUD/评分/ERROR/删除 + 批量评测轮询/校验验收通过 |
| `pnpm test:admin` | 0 | 业务数据 CRUD、Skill 创建/AI 草案/单项测试、Tool 配置、Planner 预览与 Provider 切换通过 |
| `pnpm build` | 0 | Next.js 16.4.2 生产构建通过 |
| `DEPLOY_RUN_PORT=5001 pnpm start` | 运行中 | 生产服务正常 |
| `GET /`、`/demo`、`/runs`、`/skills`、`/tools`、`/catalog`、`/planner`、`/models`、`/ops` | HTTP 200 | 页面可访问；生产控制台错误为 0 |

`pnpm test:agent` 实际结果：

```json
{
  "result": "PASS",
  "recommendationStatus": "成功",
  "recommendationSteps": 8,
  "priceToolStatus": "SUCCESS",
  "priceTotal": 79.7,
  "logisticsTools": ["query_orders", "query_logistics"],
  "fraudRiskFlags": ["fraud_suspected"],
  "fraudHandoffRequired": true,
  "disabledSkillStatus": "转人工",
  "disabledSkillErrors": ["CAPABILITY_UNAVAILABLE", "MANDATORY_SKILL_MISSING", "MISSING_RISK_CHECK"],
  "toolErrorStatus": "失败",
  "toolErrorSteps": ["query_orders", "query_logistics"],
  "stepRetryStatus": "ERROR",
  "stepRetryTraceAdded": true,
  "conversationEnded": true,
  "ratingSaved": true,
  "badCaseQueued": true,
  "providerConfigError": "LLM_CONFIG_MISSING",
  "plannerFallback": true,
  "validatorPriceCode": true,
  "retryOf": "run-...",
  "annotationSaved": true,
  "handoffSaved": "已接管",
  "explainEvidenceCount": 11,
  "lowRatingImprovement": true,
  "annotationExportBytes": 19520,
  "autoAnnotationQueue": true,
  "annotationFieldsSaved": true,
  "evaluationSavedAsAnnotation": true,
  "jsonlExportLines": 6,
  "importedBadCases": 1,
  "promoteRequiresAccepted": true,
  "badCaseEvaluationQueued": true,
  "annotationPromoted": "eval-...",
  "ruleClusters": 12,
  "promptDraftRuleBased": true,
  "promptUnchangedUntilApply": true,
  "versionSnapshotCreated": true,
  "rollbackRestoredPrompt": true,
  "abTestStatus": "运行中",
  "abSkillBound": true,
  "abTrafficUpdated": true,
  "evalScorePass": "PASS",
  "evalScoreChangesAfterKeywords": true,
  "evalErrorStatus": "ERROR",
  "evalFromRunSource": true,
  "evalDeleted": true,
  "autoTicketCreated": true,
  "autoTicketReason": "fraud_suspected",
  "autoTicketConversation": 2,
  "manualTicketCreated": true,
  "batchStatus": "done",
  "batchTotal": 3,
  "batchCaseCount": 3,
  "batchCountSum": 3,
  "persistedAfterRestart": true
}
```

`pnpm test:admin` 实际结果：

```json
{
  "result": "PASS",
  "catalogTypes": 9,
  "editableCatalogTypes": 6,
  "catalogCrud": true,
  "logisticsRemoved": true,
  "aiDraftValid": true,
  "aiDraftTools": ["query_orders"],
  "createdDraftSkill": "ai-draft-...",
  "initialVersion": "1.0.0",
  "updatedVersion": "1.0.1",
  "versionCount": 2,
  "diffAdded": 3,
  "skillFileRead": true,
  "skillTestStatus": "SUCCESS",
  "dependencyTestStatus": "ERROR",
  "toolMetadataUpdated": true,
  "toolTestItems": 2,
  "pathTraversalRejected": 400,
  "enabledListExcludesDisabled": true,
  "plannerVersion": "planner.v2.1",
  "plannerPromptConfigurable": true,
  "plannerRequiredSkillApplied": true,
  "plannerModelConfig": "provider-default",
  "plannerPreviewValid": true,
  "plannerDisabledValidation": false,
  "plannerNoRunCreated": true,
  "plannerToolScopeAffectsPreview": true,
  "modelProviders": 3,
  "modelFixtureTest": true,
  "modelRealFailureCode": "LLM_UPSTREAM_ERROR",
  "modelMissingCode": "LLM_CONFIG_MISSING",
  "providerSwitchAffectsRun": "openai-compatible",
  "providerSwitchBack": "classroom-fixture"
}
```

浏览器验收使用 Chrome DevTools Protocol：

- 价格问题从工作台运行，最终回复显示 `119.70 - 20.00 - 20.00 = 79.70`，Trace 包含 `calculate_price`；
- 物流问题在工作台与零食小助手均返回真实订单与物流状态；
- 中奖诈骗问题被标记 `fraud_suspected`，安全回复包含“不要转账 / 验证码 / 官方渠道”，状态为转人工；
- 运行列表展示成功、失败、转人工记录，详情页可解释、人工接管、保存标注，刷新后数据仍在；
- 业务目录显示 9 类卡片、6 类可编辑；订单卡片展示内嵌物流且无独立物流类型；新增/编辑/删除商品通过 UI 与 API 验证，验收商品已删除；
- Skill 管理可查看 SKILL.md 原文、编辑名称/触发描述/Prompt/参数/依赖、打开含完整内容的保存快照弹窗；AI Create Skill 生成含触发场景与依赖校验的草案；单项测试记录显示输入、输出、耗时、状态和依赖；
- Tool 右侧面板可修改名称与能力描述并立即反映到 `/api/registry`；完整只读配置 JSON 可查看；输出示例和真实输入/输出/耗时/错误正常展示；
- Planner 页面在保存按钮上方直接展示可编辑 System Prompt，并持久化模型参数、必经 Skill、基础/价格 Tool；预览显示 selectedSkills、selectedTools、reasoning、场景风险与校验错误/警告；必选 Skill 与价格 Tool 白名单配置均通过隔离测试验证；
- 模型管理显示当前 Provider、描述、默认模型/模型列表和环境变量布尔状态；fixture 连接测试成功，OpenAI 缺配置测试返回 `LLM_CONFIG_MISSING`，页面无密钥原文；
- Provider 切换通过隔离环境验证会影响后续 RunRecord（openai 失败记录 → 切回 fixture 成功记录）；
- Agent 工作台失败 Tool 步骤显示“重试步骤”，重试结果追加到 Trace；人工接管和运行解释可用；
- 运营中心接收 Demo/Agent 评分，展示总数/均分/1 分 Bad Case；评分保留完整会话；评分支持时间/分数/问题类型筛选；服务评分不提供补录表单；
- 失败 Run、Run 标注人工跟进和低评分服务自动进入人工评估；写出期望回复并保存为标注后进入数据标注；标注保存问题/回复/期望、意图/风险/质量标签/必经 Skill/期望 Tool 事实/禁用表述/失败原因及六维备注；CSV/JSONL 导出字段完整；Bad Case 可导入，支持新增标注；
- 数据标注四按钮状态正确：未接受时进入改进/评测集禁用，接受后才可操作；后端同样拒绝未接受标注的转存；
- 规则聚类明确标识“规则聚类”；低评分样本出现在聚类中；生成 Prompt 草案前后 Skill hash 不变；应用后创建版本快照，回滚恢复原正文；
- 运营中心模拟 `/api/ops` 失败时，监控区域显示 section error，评分等其他 Tab 仍可独立使用，页面不崩溃；
- 运营中心顶部 Tab 顺序为运行监控、服务评分、人工评估、数据标注、改进建议、版本回滚、Prompt A/B，不再有“其他运营”。
- 改进建议展示六维均分、用户评分均分和 Eval 失败预留聚类；Prompt A/B 支持单 Skill 的 A/B Prompt、流量和开关保存。
- Eval 新增/刷新保留、maxLatencyMs、修改 expectedKeywords 引起评分变化、停用用例从默认启用集消失、删除用例、从 Run 加入评测集、真实 Agent 单条/批量运行、六维总分与计算过程、Judge 配置、过程展开与 runId 证据均已验证；ERROR 独立于 FAIL；
- Ops 页面在 1440×900、1024×768、390×844 下无横向溢出（`scrollWidth === innerWidth`），生产控制台错误为 0。
- 零食小助手完成左右气泡、常见问题、约 1 秒正在输入、Agent 结束判断、评分卡片和评分持久化；1 分改进队列通过隔离测试验证；
- 工作台 1440×900、Planner 1024×768/390×844、模型管理 1024×768/390×844 无横向溢出；
- 1440×900、1024×768 和 390×844 下按钮无遮挡、无横向溢出；生产控制台错误为 0。

截图：

- [业务数据卡片 1440×900](assets/verification/catalog-cards-1440x900.png)
- [业务数据新增弹窗](assets/verification/catalog-create-1440x900.png)
- [Skill 管理 1440×900](assets/verification/skills-manager-1440x900.png)
- [AI Create Skill 草案](assets/verification/skills-create-ai-1440x900.png)
- [Skill 单项测试](assets/verification/skills-test-panel-1440x900.png)
- [保存版本快照详情](assets/verification/skills-save-snapshot-1440x900.png)
- [Tool 配置 1440×900](assets/verification/tools-manager-1440x900.png)
- [Tool 完整配置 JSON](assets/verification/tools-config-1440x900.png)
- [Tool 输出示例](assets/verification/tools-output-example-1440x900.png)
- [Tool 真实测试结果](assets/verification/tools-test-result-1440x900.png)
- [业务数据移动端](assets/verification/catalog-cards-390x844.png)
- [Skill 管理移动端](assets/verification/skills-manager-390x844.png)
- [Tool 管理移动端](assets/verification/tools-manager-390x844.png)
- [评测集 Tab](assets/verification/eval-tabs-cases-1440x900.png)
- [单条内联测试与过程（不新建批次）](assets/verification/eval-single-inline-1440x900.png)
- [评测运行过程](assets/verification/eval-process-1440x900.png)
- [运行过程详情](assets/verification/eval-process-detail-1440x900.png)
- [批次对比 Tab](assets/verification/eval-tabs-compare-1440x900.png)
- [客服工单自动生成](assets/verification/tickets-auto-handoff-1440x900.png)
- [运营总览真实数据](assets/verification/overview-real-data-1440x900.png)
- [运营中心运行监控](assets/verification/ops-monitor-1440x900.png)
- [运营中心运行监控 1024×768](assets/verification/ops-monitor-1024x768.png)
- [运营中心移动端](assets/verification/ops-390x844.png)
- [运营中心服务评分](assets/verification/ops-ratings-1440x900.png)
- [运营中心数据标注](assets/verification/ops-annotations-1440x900.png)
- [待标注字段与六维备注](assets/verification/ops-annotation-edit-1440x900.png)
- [人工评估 Tab](assets/verification/ops-manual-eval-1440x900.png)
- [版本回滚 Tab](assets/verification/ops-rollback-1440x900.png)
- [Prompt A/B Tab](assets/verification/ops-ab-tests-1440x900.png)
- [运营中心改进建议](assets/verification/ops-improvements-1440x900.png)
- [运营中心 Prompt 草案](assets/verification/ops-prompt-draft-1440x900.png)
- [Agent 工作台失败控制](assets/verification/workbench-failure-controls-1440x900.png)
- [Agent 工作台计划步骤条](assets/verification/workbench-plan-timeline-1440x900.png)
- [零食小助手 1440×900](assets/verification/demo-assistant-1440x900.png)
- [零食小助手评分](assets/verification/demo-rating-1440x900.png)
- [零食小助手移动端](assets/verification/demo-assistant-390x844.png)
- [Planner 管理 1440×900](assets/verification/planner-1440x900.png)
- [Planner 步骤条预览](assets/verification/planner-step-timeline-1440x900.png)
- [Planner 1024×768](assets/verification/planner-1024x768.png)
- [Planner 移动端](assets/verification/planner-390x844.png)
- [模型管理 1440×900](assets/verification/models-1440x900.png)
- [模型测试失败](assets/verification/models-test-error-1440x900.png)
- [模型管理 1024×768](assets/verification/models-1024x768.png)
- [模型管理移动端](assets/verification/models-390x844.png)

历史 Agent 截图：[Agent 工作台](assets/verification/agent-workbench-1440x900.png) · [运行记录](assets/verification/runs-list-1440x900.png) · [运行详情](assets/verification/run-detail-1440x900.png)

## 当前边界

- 运营中心的聚类和 Prompt 草案采用确定性规则模板，明确标识为规则聚类，不使用 LLM 生成结论。
- Prompt A/B 当前保存单 Skill 的 A/B Prompt、流量与开关配置；未实现自动流量分配、批量跑分和显著性检验。
- Eval 的 LLM Judge 支持配置，但默认 classroom-fixture 不提供真实模型 Judge；会明确显示不可用，不伪造分数。批量评测当前为服务端进程内执行，未实现定时调度/取消运行中的批次。
- 客服工单页面当前只读展示，不提供工单分配、回复、状态流转和删除；这些操作不在本阶段范围。

- Eval 已支持批量执行、轮询和版本对比；A/B 实验调度仍未实现；每次 `evaluation` 仍针对单条 RunRecord 生成。
- 本地单进程锁不支持多实例共享事务；生产多实例需要迁移到数据库或分布式锁。
- 尚未实现登录、权限与多租户隔离。
- 真实 Provider 需要配置对应环境变量；显式真实模式失败不会回退到课堂演示。
