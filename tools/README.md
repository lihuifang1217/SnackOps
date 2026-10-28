# Tools

Tool 的契约与执行实现分开维护：

```text
tools/definitions.ts       输入/输出 Zod Schema、示例输入、执行元数据与数据源
tools/implementations.ts   真实 JSON 数据读取和业务错误处理
src/lib/registry/tools.ts  注册、启停、名称/描述配置、Schema 序列化与执行入口
```

## 约定

- 输入输出必须使用 Zod 校验，API 通过 `z.toJSONSchema()` 返回可审阅的 Schema。
- 工具默认只读，不创建订单、不扣库存、不修改业务数据。
- 执行前重新读取 `data/tools.json` 与 `data/tools-config.json`；停用工具返回 409。
- 名称与能力描述可在 `/tools` 右侧面板配置，Planner 与 Executor 下次读取注册表时立即生效。
- 执行方式、实现位置、数据源和完整配置 JSON 只读展示，不允许在页面修改实现。
- `/api/tools/:id/test` 与 `/tools` 页面提供真实数据单项测试。

## 当前 Tool

`query_products`、`query_activities`、`query_coupons`、`calculate_price`、`query_orders`、`query_logistics`。

物流不再是独立业务数据：`data/logistics.json` 已移除，承运商、运单号、状态和轨迹内嵌在 `data/orders.json`；`query_logistics` 从订单实时聚合，并支持未发货订单返回实时“未发货”状态。
