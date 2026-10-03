# Fork notice / 分支说明

This repository is a **fork** of
[`dingminhua/dsh-connect-trae`](https://github.com/dingminhua/dsh-connect-trae),
created by [Gty2408](https://github.com/Gty2408).

本仓库是 [`dingminhua/dsh-connect-trae`](https://github.com/dingminhua/dsh-connect-trae)
的 **fork**，由 [Gty2408](https://github.com/Gty2408) 维护。

## Upstream authorship / 原作者

**All original work in this plugin is by `dingminhua`** (MIT licensed,
copyright "LaoDing"). The plugin — the Trae model provider, the usage/credit
card, the account handling, the check-in flow, and every test that came with
them — is theirs. This fork does not claim any of it.

**本插件的全部原始工作均属于 `dingminhua`**（MIT 许可，版权署名 "LaoDing"）。
模型供应商、用量/积分卡片、账号处理、签到流程，以及随附的全部测试，都是原作者
的成果。本 fork 不主张其中任何部分。

The `LICENSE` file is unchanged and the upstream copyright notice is kept
intact, as the MIT licence requires.

`LICENSE` 未作改动，原作者的版权声明完整保留，符合 MIT 许可的要求。

## What this fork changes / 本 fork 改了什么

One addition only — **a Trae credit total in the Windows caption menubar**,
next to the native 应用 / 编辑 buttons:

只增加了一项功能 —— **在 Windows 标题栏的「应用 / 编辑」右侧显示 Trae 积分总额**：

- `src/client/CaptionCredits.ts` — new file; the readout and its polling
- `src/client/index.tsx` — registers it through `ctx.effect`
- `tests/caption-credits.spec.tsx` — new file; seven tests over the readout

Everything else is upstream code, unmodified.

其余文件均为上游代码，未作修改。

## Why the caption, and why it reaches into a shadow root / 为什么是标题栏，为什么要伸进 shadow root

There is no slot for the caption strip. On Windows the desktop preload builds
that menubar itself — a `position: fixed` element marked `[data-windows-menu]`,
with the native buttons inside an **open** shadow root. `mode: 'open'` is the
only reason a plugin can append to it.

标题栏没有槽位。Windows 上那条菜单栏由 desktop preload 自己构建：一个标了
`[data-windows-menu]` 的 `position: fixed` 元素，原生按钮放在 **open** 的
shadow root 里。`mode: 'open'` 是插件能追加内容的唯一原因。

This is a deliberate trade-off: it reads a DOM structure the plugin does not
own. If a future DSH release restructures that bar, the label simply does not
appear — `installCaptionCredits()` fails soft and logs once, and the provider,
the card, and everything upstream are unaffected.

这是刻意的取舍：它读取的是插件并不拥有的 DOM 结构。若将来的 DSH 改动这条菜单栏
的结构，标签就只是不出现 —— `installCaptionCredits()` 会安静降级并只记录一次日志，
模型供应商、设置卡片以及上游的一切都不受影响。

## What the number means / 这个数字是什么

The caption shows the account's **total available** credits — the sum of
`credits.available` across the regions DSH can actually spend (signed in and not
switched off). A disabled or signed-out region is **not** counted as zero; it is
named in the tooltip instead, so the figure never silently misstates the balance.

标题栏显示账号的 **可用积分总额** —— 即 DSH 真正能用的那些区域（已登录且未被关闭）
的 `credits.available` 之和。被关闭或未登录的区域 **不会** 按 0 计入，而是写进
tooltip，所以这个数字不会悄悄失真。

The Work / general split lives in the tooltip, because the caption is too narrow
for it and the distinction matters: the upstream card labels Work credits
"DSH 不可用" — they are spendable only inside the Trae app.

Work / 通用 的拆分放在 tooltip 里，因为标题栏放不下，而这个区别很重要：上游卡片把
Work 积分标为「DSH 不可用」—— 它只能在 Trae 客户端内使用。

The figure refreshes once a minute while the page lives, and the label is removed
when the plugin is disposed.

页面存活期间每分钟刷新一次；插件被释放时标签会被移除。

## Installing this fork / 安装本 fork

```sh
dsh plugin --profile desktop add github:Gty2408/dsh-connect-trae
```

To go back to upstream:

```sh
dsh plugin --profile desktop add github:dingminhua/dsh-connect-trae
```

## Development / 开发

Unchanged from upstream:

与上游一致：

```sh
pnpm install
pnpm run typecheck   # tsc, both configs
pnpm run test        # vitest, 420 tests
pnpm run build       # tsdown -> lib/
```

`lib/` is build output and is gitignored upstream and here, so a fresh clone
needs `pnpm install && pnpm run build` before it can be installed.

`lib/` 是构建产物，上游和本 fork 都将其 gitignore，所以新克隆的仓库需要先
`pnpm install && pnpm run build` 才能安装。

## Upstream README / 上游文档

The original `README.md` and `README.en.md` are kept verbatim, so the full
description of the plugin's features, routes, and design notes still applies —
except that they do not mention the caption credit readout added here.

原始 `README.md` 与 `README.en.md` 原样保留，因此插件功能、路由与设计说明的完整
描述依然适用 —— 只是它们没有提到这里新增的标题栏积分显示。