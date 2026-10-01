## v2.6.0（2026-10-02）

> **包含仍未发布的 2.5.1**（补问 `chat_v3`，国际版目录 11 → 17）——它只打了 tag、未推 npm，因此没有用户拿到过。
>
> 本版的核心是一个**行为反转**：目录里有、但拿不到调用 id 的模型**不再被隐藏，而是照常显示**，调用失败时给出可读的上游错误。

### 新增

- **模型列表「全部呈现」**（[#19](https://github.com/dingminhua/dsh-connect-trae/issues/19)）：此前这类行会被直接剔除，理由是「放出来只会报错」。但**可调用名单是按账号档位下发的**——用免费账号测不到，不能推出付费账号用不了。隐藏用户自己 Trae IDE 里有的模型，比让他看到一条明确的错误更糟。
  - 现在选中这类模型会看到如实的拒绝原因，例如：
    ```
    Trae does not serve this model under the SOLO function the request used
    (config_name rejected) · Trae code 4001 · upstream: We're sorry, the param is invalid…
    ```
  - **上游一旦把它开放到 SOLO 通道，插件会自动可用**（判据就是能不能 join 到调用 id），无需再升级插件。
  - 国际版实测：目录 **17 → 22**（新增 `GPT-6-Astra`、`GPT-5.6-Sol/Terra/Luna`、`GLM-5.2`）。

### 修复

- **国内版目录补齐**：发现侧此前只读两个货架，漏掉 `solo_coder`(12) / `chat_v3`(18) / `solo_agent`(18) / `solo_work_lite`(15) 等组——与国际版此前的缺口形状相同。两个区域现在使用同一份组名单，调用名单同步补齐。
  - 实测：国内版目录 **19 → 30 个模型**（新增 `Doubao-Seed-Code`、`Doubao-Seed-2.0-Code`、`GLM-5.1`、`GLM-5`、`GLM-5v-Turbo`、`DeepSeek-V4-Pro`、`DeepSeek-V4-Flash`、`Kimi-K2.5`、`Qwen-3.5`、`MiniMax-M2.7`、`Qwen-3.6-Plus` 等）。
- **纠正一处测量错误**：2.5.1 里「CN 的 `solo_coder` 组 3 个模型任何 function 都 4001」的判断有误——那是探测脚本用**展示名**而非该 function 返回的 `config_name` 去调用导致的。用正确的 id 重测，它们**全部正常出字**。

### 测试

- 全仓 395 例全绿；**变异验证 3 次全部被抓**（改回「丢弃无线行」→ 2 例失败；国内版调用名单改回两项 → 1 例失败；国内版发现名单改回两项 → 2 例失败）。

### 升级

```sh
dsh plugin add dsh-connect-trae        # 或在插件市场更新
```

装好后**重启 DSH**，再到插件卡片刷新一次模型目录。

**完整比较**：[v2.5.0...v2.6.0](https://github.com/dingminhua/dsh-connect-trae/compare/v2.5.0...v2.6.0)
