# dsh-connect-trae 对 DSH 0.2.0-rc.1 的适配性核对

> 对照对象：同级目录 `../deepseek-harness`，tag `dsh-v0.2.0-rc.1`（2026-09-28 19:48）
> 本机运行时：**DSH Desktop 0.2.0-rc.1**（从 `app.asar` 内的 `dsh-app-boot/package.json` 读出）
> 本插件：`dsh-connect-trae@2.3.1`，开发树依赖 `0.1.7-rc.1`
> 核对时间：2026-09-29　方法：实包符号比对 + 运行宿主自带的门禁代码 + 本机实测
> 结论：**有 1 处必须改（已在运行中造成插件整体不加载），其余为卫生项，无需适配**

---

## 0. 一句话结论

插件**当前在这台机器上根本没有加载**——不是某个功能坏掉，是整个 bundle 被 DSH 0.2.0-rc.1 的
peer 兼容门禁拒绝挂载。根因是 8 条 peer 范围写成 `<0.2.0-0`，该上界把 `0.2.0-rc.1` 这类
**0.2.0 预发布版**也一并排除；契约本身没有任何破坏。

---

## 1. 失败现象（本机实测，非推断）

| 证据 | 结果 |
|---|---|
| 插件自有状态路由 `/plugins/dsh-connect-trae/usage?region=cn` | **HTTP 404** |
| 同级插件对照 `/plugins/dsh-connect-workbuddy/usage?region=cn` | HTTP 200（正常返回用量 JSON） |
| 运行中插件的 203 条挂载行 | **没有 `dsh-connect-trae`**；同级已加载的 bundle 均为 `active` |
| `~/.dsh/logs/desktop-next.log` 中 Trae 相关记录 | 最后一条 **2026-09-28T11:10:16Z**（19:10 CST），此后 **0 条** |
| `app.asar` 时间戳 | **2026-09-28 20:04 CST**（即升级到 0.2.0-rc.1 的时刻） |

时间线闭合：升级前插件一直在用，升级后即刻归零。

---

## 2. 根因（宿主源码级定位）

DSH 自 0.1.7-rc.1 起新增了 **peer 兼容门禁**（`2c67633990 feat(plugins): enforce DSH peer compatibility with exact exemptions`）。
对 bundle 而言，门禁在 `loadProfileDirectory()` 内，**拒绝即整个 bundle 跳过**：

```ts
// packages/boot/app-boot/src/profile.ts  (0.2.0-rc.1, L674-676)
// A bundle is not a plugin row, so row admission never reads its own peers.
const issue = evaluatePluginCompatibility(bundleManifest, exemptions)
if (issue !== undefined && !issue.exempted) throw new Error(pluginCompatibilityWarning(issue))
// ... catch: skippedBundles.push({ packageName, reason })
```

`evaluatePluginCompatibility()` 用 `semver.satisfies(runtime, range, {includePrerelease:true})` 逐条判定
（`src/plugin-compatibility.ts:61`）。本插件 8 条范围的失败点是上界：

```
>=0.1.7-rc.1 <0.2.0-0   →  0.2.0-rc.1 不满足 ❌
```

因为 semver 里 `0.2.0-rc.1 < 0.2.0-0`（预发布版小于它自己的 `-0` 基准）。换言之
`<0.2.0-0` 的本意是「排除 0.2.0 正式版」，实际却连 **整个 0.2.0 预发布线**一起排除了。

**这不是「0.2 破坏契约」**：同级插件 `dsh-connect-workbuddy`（`<0.2.0`）、`dsh-ldvh`、
`dsh-subagent-default-model` 都写 `<0.2.0`，因此全部照常加载。三行范围内只有本插件用了 `-0` 上界。

> 该判定由**宿主自己发行的代码**得出：从 `app.asar` 中按偏移提取
> `dsh-app-boot/lib/index.js`（offset 由 `integrity.hash` 校验确认），
> 原样运行其中的 `evaluatePluginCompatibility`，输入本插件 `package.json`。
> 返回 `DENIED`，8 条 peer 全部列出，`exempted: false`。

**同层验证**：把该门禁跑一遍本机 desktop profile 的全部 19 个 bundle，判定与运行中的挂载
状态**逐一吻合**——5 个 `DENIED` 的 bundle（本插件、`@changfenhuang/dsh-genui`、
`dsh-better-reasoning-effort`、`dsh-free-search`、`dsh-rewind-plugin`）**全部不在挂载行里**，
11 个 `OK` 加 3 个内建（`dsh-base` / `dsh-web-app` / `agent-team-profile`，不走该门禁）
**全部 active**。这排除了「我的判定模型与宿主不一致」的可能。

---

## 3. 契约层面：**无破坏**

门禁只是版本范围问题；真正的 API 面几乎没动。

### 3.1 机械差分（0.1.7-rc.2 → 0.2.0-rc.1）

| 指标 | 数值 |
|---|---|
| 提交数 | 261（非 merge 167） |
| 文件变更 | 1109 files, +20,374 / −77,957 |
| 显式破坏性提交（`!`） | **0** |
| `packages/` 下 package.json | 321 → 325（+4，见下） |

新增 4 个包，**全部与本插件无关**：`product-analytics`、`ui-settings-session-log`、
`schedule-bundle`、`otel`。

### 3.2 本插件触及的包，源码逐字节比对

插件声明 8 个 `@deepseek-ai/dsh-*` peer，另有 6 个 client 包写在 `dsh.client.inject`。
**源码目录整体比对**（解包两 tag 后 `diff -rq`）：

| 包 | 源码变化 |
|---|---|
| `dsh-llm` / `dsh-llm-pi-ai` | 无（rc.2→0.2.0 无 diff；`PiAiAdapterOptions`、`ResolvedPiAiProviderProfile` 从 rc.1 起逐字一致） |
| `dsh-attachment` / `dsh-settings` / `dsh-host-webserver` | **IDENTICAL** |
| `dsh-atomic-write` / `dsh-home-paths` | **IDENTICAL**（rc.2 的锁接管改动已在上一轮吸收，本轮无新变化） |
| `dsh-client-ui-slots` | **renderer.ts / store.ts / index.ts 全部 IDENTICAL**；exports 映射一致 |
| `dsh-client-locale` / `ui-renderer` / `ui-settings` / `ui-settings-plugins` | 无源码改动，**exports 映射逐字一致**（含 `./client` 子路径） |
| `dsh-client-ui-primitives` | 仅增量：新增 `pointerModality`；**无导出被移除** |

### 3.3 符号级核对（rc.2 文档 §F11 提醒的方法论）

**类型级**：本机运行时 `app.asar` 内 `.d.ts` 数量为 **0**（与 rc.2 文档记载一致），
故权威类型来源取 npm 实包。逐符号比对 `0.1.7-rc.1`（开发树）vs `0.2.0-rc.1`（npm 实包）：

```
dsh-llm                 AdapterRegistrationHandle / DirectoryRegistrationHandle / resolveRetryPolicy   identical
dsh-llm-pi-ai           PiAiAdapter / ResolvedPiAiProviderProfile                                      identical
dsh-attachment          AttachmentStore                                                                identical
dsh-home-paths          resolveDshHome                                                                 identical
dsh-atomic-write        withFileLock / writeFileAtomic                                                  identical
            移除的导出符号：0
```

**运行时值级**：从 `app.asar` 提取全部 `@deepseek-ai` 包（290 个）后直接 import，
插件消费的每个符号均存在；对 12 个可加载的包做导出名集合比对，**移除 0 个**，
仅 `dsh-llm` 新增 `ACCOUNT_QUOTA_EXCEEDED_CODE`、`projectToolUpdates`
（第 13 个 `ui-primitives` 因浏览器端 `react` 依赖在此环境不可加载，改用源码级静态比对，见下条）。

**全量类型面**：13 个包的 `.d.ts` 导出符号全量比对 → 仅 `dsh-client-ui-primitives` 少 3 个
（`OnboardingSurface`、`CODE_HIGHLIGHT_EXTENSIONS`、`languageForPath`）。经 grep 确认
**本插件对这三个符号零引用**，且该包在插件里只作 `dsh.client.inject` 声明、**源码从不 import**
（`lib/client.js` 内 `require` 只有 `react` / `react/jsx-runtime`；源码级静态比对亦确认
仅新增 `pointerModality`、无移除）。

### 3.4 端到端类型验证（最强的一条）

把 `src/` + `tests/` 复制到隔离目录，将 14 个 `@deepseek-ai` 依赖（13 个从 npm 取 0.2.0-rc.1
实包 + `cordis` 4.0.4 / `schemastery` 3.18.4，后两者版本线与 DSH 独立且与运行时一致）
整体替换，用插件自己的 `tsconfig` 跑真实 tsc。
`--listFiles` 确认 host 半侧实际解析到 7 个 0.2.0-rc.1 包、client 半侧 5 个，
且 `@earendil-works/pi-ai` 0.85.1 与运行时逐字一致：

```
tsc -p tsconfig.json        (host half)   EXIT 0
tsc -p tsconfig.client.json (client half) EXIT 0
```

**对 0.2.0-rc.1 类型整体零错误。** 插件自身的 `check` 流水线在 0.1.7-rc.1 上同样通过
（typecheck 两半 OK、测试 345/345、build 成功）。重跑 build 后 `lib/` 三个产物字节数与
改动前完全一致（`87514` / `84015` / `172771`），即构建可复现、本次核对未改变任何产物
（`lib/` 在 `.gitignore` 内，`git status` 干净）。

---

## 4. 修复方案

### 方案 A（推荐）：放宽上界

`package.json` 中 8 条范围（L79–L86）由 `>=0.1.7-rc.1 <0.2.0-0` 改为 `>=0.1.7-rc.1 <0.3.0-0`。
devDependencies 一并升到 0.2.0-rc.1，让开发树与用户运行时一致。

用**同一个 shipped 门禁**复核该改法：

| 运行时 | 改前 | 改后 |
|---|---|---|
| 0.1.7-rc.1 / 0.1.7-rc.2 | admitted | admitted（**不回归**） |
| 0.2.0-rc.1 / 0.2.0 / 0.2.5 | **DENIED** | admitted |
| 0.3.0-rc.1 / 0.3.0 | DENIED | DENIED（**下一线仍被挡**，符合原意） |

注：`0.1.7-alpha.1/alpha.2` 在改前改后**都是 DENIED**（`>=0.1.7-rc.1` 下界所限），
属既有行为，不是本次引入的回归。

### 方案 B（应急，不改包）：授予精确版本豁免

profile 的 `compatibility.json` 写入 `{"dsh-connect-trae@2.3.1": ["0.2.0-rc.1"]}` 即可挂载。
已用 shipped 代码验证 `exempted: true` 时 `loadProfileDirectory` 不再抛错。
代价：豁免是**精确到版本**的，插件或 DSH 任一升级都不继承，每次升级都要重授；
且这只清门禁、不解决范围本身写错。**建议作为临时手段，最终仍应走方案 A。**

本机现状：`~/.dsh/profiles/desktop/compatibility.json` **不存在**（即当前无任何豁免）。

### 方案 A 的回归缺口（建议一并补）

插件已有 `tests/dsh-017-compat.spec.ts` 钉住 0.1.7 的三处**静默**契约变化，但全仓
**没有任何测试覆盖 `peerDependencies` 范围本身**（grep `peerDependencies` / `semver` 零命中）。
这正是本次失败的形状：范围写错不会让任何断言变红，只会在真实宿主上表现为「插件整体消失」，
CI 全绿。

建议新增一条测试：读 `package.json` 的 peer 范围，用 semver（需显式加为 devDependency，
当前仅作为传递依赖存在于 `.pnpm/semver@7.8.5`）断言**当前开发树版本**与**下一线预发布版本**
都落在范围内。这能在「上界写窄到连预发布都挡掉」时立刻失败，而不必等到用户升级宿主。

---

## 5. 其余观察（均无需改动）

1. **client 侧 roster 一致**：插件 `dsh.client.inject` 的 6 个包在两条线的 web roster 中
   存在性完全一致（`ui-slots` / `ui-primitives` 两条线都不在 roster，属既有等价状态）。
2. **client bundle 装载契约未变**：`__ModuleLoader__.load({id, factory})` 横幅在 0.2.0-rc.1
   逐字保留（`packages/client/modules/src/client/manifest.ts` rc.2→0.2.0 **零 diff**）。
3. **槽位 API 未变**：`plugins.bundle.config` / `plugins.row.config` 两个槽位在 0.2.0-rc.1
   的插件管理页仍然声明；`SlotEntryDef` 的 `name`/`key`/`priority`/`inject` 选项形状逐字一致。
4. **`dsh.client` 清单 schema 未变**：`packages/util/package-manifest/src/types.ts` 两 tag **IDENTICAL**。
5. **`configForms` 仍在**、`settingsScope` 确认已不存在（0.1.7 起移除）——插件 2.3.0 的
   `ctx.get()` 软探测写法依然正确。
6. **`dsh-llm` 的新增能力是纯加法**：`toolUpdate` 字段与新 `projectToolUpdates` 投影；
   `toolUpdate === undefined` 时行为等价于旧的「每次请求都声明完整工具表」，而
   `dsh-llm-pi-ai` 的 adapter **不设置该字段**，故对本插件无行为影响。
7. **0.2.0 自身的装配变化**与本插件无关：web bundle 里 time-context / schedule 行被移出，
   改由 `dsh-experimental-schedule-bundle` 承载；插件管理页的卡片版式调整属展示层。
8. **`ui-primitives` 的 3 个符号移除**只影响直接消费它们的插件；本插件不用
   （该包在插件里仅作声明，源码零 import）。
9. **`inject` 里声明一个非图行包是安全的**：`arriveGraphRow` 对
   `graphRows.get(packageName) === undefined` 直接跳过，不会导致加载失败——
   所以插件 inject 中的 `ui-slots` / `ui-primitives` 两条无害。
10. **部署约束（沿用 rc.2 结论）**：`atomic-write` 的锁接管在跨 PID namespace 共享
    `$DSH_HOME`（WSL2 经 `/mnt/c`）场景下有已知边界，本机 macOS 单命名空间不触发。

---

## 6. 方法学备注

- **运行时版本从 `app.asar` 内读**，不从 `package.json` 猜：`Info.plist` 亦为 `0.2.0-rc.1`。
- **asar 偏移有坑**：本机实测 payload 基准为 `8 + headerSize`，不是常见的 `16 + headerSize`。
  用条目的 `integrity.hash` 对候选基准做 SHA256 校验后才定位正确，避免读出错位数据。
- **原生模块的 Node 差异**：Electron 捆绑的 node（24.21.0）与 `rolldown` 原生绑定的
  代码签名 Team ID 不同，`dlopen` 失败；改用系统 node（v25.9.0）后 vitest 正常，
  这是本机工具链现象，与 DSH 版本无关。
- **未做的事**：未修改任何源码、`package.json`、版本号或 `lib/` 产物（`git status` 干净）；
  未替用户授予版本豁免（`compatibility.json` 未创建）。
