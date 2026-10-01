## v2.5.1（2026-10-02）

> **补上 2.5.0 没修完的缺口——国际版模型目录仍偏少。** 2.5.0 发布后，[#19](https://github.com/dingminhua/dsh-connect-trae/issues/19) 的报告人实测反馈：「pro 状态 PASS、单个模型调用 PASS，但模型数量还是没取全」。复测确认属实，并定位到插件**从未请求过的那个 function**。

### 修复

- **国际版模型目录 11 → 17 个**：Trae 按 function 分发模型名单，而插件此前只问过三个（`solo_work_remote` / `solo_work_lite` / `solo_agent_remote`），**从未请求 `chat_v3`**——它恰恰是最宽的名单之一（国际版 40 个 `config_name`），并列着一批别的 function 都没有的模型。
  - 最终目录 = **发现 ∩ 调用名单**：只被某个 function 列出、却拿不到调用 id 的模型会被剔除（这是防止「显示了但一点就报错」的保护）。2.5.0 只扩大了「发现」一侧，因此这批模型仍然进不来。
  - 现在 `chat_v3` 加入调用名单**并排在最后**，只补缺口、不改变任何既有模型的调用通道。
  - **新增可用的 6 个**：`Dola-Seed-2.0-Code`、`kimi-k2.7-code`、`deepseek-v4-flash-0731`、`deepseek-v3.2`、`gemini-3-flash-premium`、`gemini_2.5_flash_premium` —— 每一个都用插件自己的请求信封针对实时上游**逐个验证过可正常出字**。另外 `GPT-5.5` 也随之可见。

- **哪些仍然看不到，以及为什么**：`GPT-6-Astra`、`GPT-5.6-Sol/Terra/Luna`、`GLM-5.2` 在任何 function 的调用名单里都不存在，对聊天接口的**每个通道**都返回 `4011`/`4001`——它们属于 Trae IDE 自己的内置通道，不是本插件所走的 SOLO 通道。剔除它们是正确行为：宁可没有，也不放一个选了就报错的模型进来。

### 测试

- 全仓 392 → 395：`chat_v3` 必须排在调用名单最后、发现名单必须请求它、CN 名单**不得**被顺手扩大。
- 变异验证 3 次全部被抓（把 `chat_v3` 挪到最前 → 3 例失败；发现名单去掉它 → 2 例失败；顺手扩大 CN → 2 例失败）。

### 升级

```sh
dsh plugin add dsh-connect-trae        # 或在插件市场更新
```

装好后**重启 DSH**，再到插件卡片 → 国际版 tab 点一次「刷新模型」。

**完整比较**：[v2.5.0...v2.5.1](https://github.com/dingminhua/dsh-connect-trae/compare/v2.5.0...v2.5.1)
