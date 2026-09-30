# 国际版接口探索：付费账号是否能看到/用到不同的模型与接口

> 探索时间：2026-09-30　账号：本机国际版（TRAE SOLO，`solo-sg`），**免费账号**
> 方法：用插件**自身的**认证链路取到实时 token，再用插件自己的 header 构造器发请求（只读）
> 结论：**没有「付费专属接口」——模型目录与聊天走的是同一组端点。付费改变的是同一份响应里的
> 授权标志，以及聊天时的错误码。**

---

## 0. 一句话结论

国际版的模型目录（`/api/remote/v1/models`）与聊天（`/api/agent/v3/llm_utils_chat`）**不区分付费与否**，
免费账号能拿到**完全一样的 10 个模型**。付费的作用点在**调用时**：同一模型对免费账号返回
`code:1005 / extra:{"plan":4}`，对已订阅账号才会真正出字。

所以「付费才有新接口」这个假设**不成立**；准确说法是「**同一个接口，按账号档位授权**」。

---

## 1. 插件当前用到的国际版端点

| 用途 | 端点 | 备注 |
|---|---|---|
| 模型目录（骨架） | `GET /api/remote/v1/models?functions=…` | 网关 `coresg-normal.trae.ai` |
| 模型 wire 映射 | `POST /api/ide/v1/get_detail_param` | 提供 `config_name` |
| 聊天 | `POST /api/agent/v3/llm_utils_chat` | 同一端点，靠 `function` 区分模式 |
| 订阅状态 | `POST /trae/api/v1/pay/ide_user_pay_status` | 网关 `growsg-normal.trae.ai` |

## 2. 实测：免费账号看到什么

`pay_status` 原始响应里的身份字段（本机）：

```
user_pay_identity      : 0
user_pay_identity_str  : "Free"            ← 档位名称
has_package            : false
pay_identity_priority_list : [0,5,4,1,2,3] ← 档位阶梯
enable_solo_lite       : true
enable_solo_web        : true
enable_solo_builder    : false             ← 付费档能力
enable_solo_coder      : false             ← 付费档能力
last_pro_entitlement_expire_time : 1781720691
detail.permission      : 1
```

**模型目录不受档位影响**：刷新国际版目录返回 **10 个**模型，与付费与否无关：

```
gemini-3.1-pro  gemini-3-flash-solo  minimax-m3  minimax-m2.7  kimi-k3
kimi-k2.5       gpt-6-sol            gpt-6-luna  gpt-5.4       gpt-5.2
```

## 3. 关键机制：同一个模型，按档位给不同错误码

对上面 10 个逐个发起真实请求（`function` 按各自所属模式给对）：

| 模型 | 免费账号结果 | 判读 |
|---|---|---|
| `gpt-5.4`、`gpt-5.2`、`kimi-k3` | ✅ 正常出字 | 免费可用 |
| `gpt-6-sol`、`gpt-6-luna` | ⛔ `code:1005`、`extra:{"plan":4}` | **订阅门禁** |
| 其余 | ✅（用对 `function` 后可用） | 免费可用 |

**`1005` + `plan:4` 是本探索最重要的发现**：这是上游对「模型存在、但你的档位不够」的**专门错误码**，
与 `4001 param is invalid`（请求构造/function 不对）在语义上完全不同。插件目前**不知道这两个码**：

```
grep -rn "4011\|1005" src/ tests/   →  零命中
```

## 4. 附带发现：还有一个未记录的错误码 `4011`

模型只能通过**它所属的那个 `function`** 调用，用错 function 的报错也分两种：

| function | 结果 |
|---|---|
| `solo_work_remote` | 对部分模型 `4001`（param is invalid） |
| `solo_agent` | `4011` |
| `solo_agent_remote` / `chat_v3` | ✅ 成功 |
| `solo_coder` | `4011` |

`4011` 此前从未在源码或测试中出现。它与 `4001` 的区别（是否代表「function 不存在」vs「参数非法」）
**未证实**，需要更多样本。

## 5. 对本插件的三条实际含义

1. **不存在「付费专属接口」，不需要为付费账号加新端点。** 目录与聊天端点共用，付费差异只体现在
   调用返回的 `code`。
2. **免费账号目前的 7 个模型是「静态兜底目录」，不是上游限制。** 本机 `regions.ai.lastCatalog`
   为空（国际版从未刷新过），于是回落到 `FALLBACK_TRAE_MODELS_AI` 的 7 个。**实测刷新后立刻变成
   10 个**（多出 `kimi-k3`、`gpt-6-sol`、`gpt-6-luna`）。也就是说这 7 个是本地状态问题，与账号档位无关。
3. **`1005` 是「可用的失败」而非「坏掉的模型」。** 免费账号在卡片上会看到 `gpt-6-*`，选中后对话
   却只得到空回复（错误码被吞）。若要改进，应在合成 SSE 时把 `1005` 翻译成可读的
   「该模型需要订阅」——**这是可选增强，不是缺陷修复**。

## 6. 未证实 / 边界

- **付费账号的真实响应未采样。** 本机只有免费账号，`1005/plan:4` 的**确切含义是从错误码 +
  `user_pay_identity_str:"Free"` 推断的**，不是拿付费账号实测出来的。「付费后同一模型可用」属
  **高置信推断，非实测结论**——若要坐实，需要一台已订阅账号实测一次。
- **`plan` 数值与档位的对应**未证实（只见过 `plan:4`）。`pay_identity_priority_list` 里的
  `[0,5,4,1,2,3]` 疑似档位优先级，但未验证。
- **`change_pay_identity` / 升级入口**未探测：本次只做只读查询，未尝试任何会改变账号状态的端点。
- **CN 侧是否有同样机制**未探测（本次范围是国际版）。

## 7. 复现方式

```bash
# 1) 用插件自身的认证链路取实时 token（不打印明文）
node /tmp/probe-intl.mjs          # 产出 /tmp/.intl-token.json（mode 600）

# 2) 列出各 function 的模型分组
node /tmp/roster.mjs

# 3) 逐个模型验证可调用性与错误码
node /tmp/ai10.mjs
```

> 探索脚本用的是 `lib/`（构建产物）导出的 `TraeCredentialStore`、`buildTraeCnHeaders`、
> `prepareSoloBody`，因此请求与插件真实流量同形。所有调用均为只读（`get_detail_param`、
> `models`、`pay/status` 与一次 `max_tokens:1` 的最小对话），**未触碰任何会改变账号状态的端点**。
