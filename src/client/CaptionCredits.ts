/**
 * Trae credit total in the Windows caption menubar.
 *
 * ## What this is
 *
 * On Windows the desktop preload mounts its own application menu bar as a
 * `position: fixed` element at the top of the window (`[data-windows-menu]`),
 * holding the native "应用 / 编辑" buttons inside an **open** shadow root. This
 * module appends one more item to that bar, to the right of "编辑", showing the
 * account's total available Trae credits.
 *
 * ## Why it reaches into the preload's shadow root
 *
 * There is no slot for the caption strip. Every other seat this plugin occupies
 * is a registered slot (`plugins.bundle.config`, `plugins.row.config`), but the
 * caption menubar is built by the desktop preload before the client plugin tree
 * exists, and it publishes no extension point. The shadow root is created with
 * `mode: 'open'`, which makes it reachable; that is the only reason this works.
 *
 * The trade-off is explicit: this reads a DOM structure the plugin does not own.
 * If a DSH release renames the host marker or restructures the bar, the label
 * simply does not appear — the function below fails soft, logging once, and the
 * rest of the plugin (models, usage card) is unaffected. Nothing here is
 * load-bearing for the provider itself.
 *
 * ## Why the number is what it is
 *
 * The card shows Work and general credits separately, because the plugin labels
 * Work credits "DSH 不可用" — they are spendable only inside the Trae app. A
 * single caption figure cannot carry that distinction, so the label shows the
 * account's total *available* credits (`credits.available`, the same field the
 * card's own "可用" summary uses) and puts the Work/general split in the
 * tooltip, where there is room to say which part DSH can spend.
 *
 * ## Freshness
 *
 * The card polls its usage route every minute while it is open; the caption has
 * no "open", so it polls on the same interval for as long as the page lives, and
 * stops when the plugin is disposed. A disabled region is skipped rather than
 * counted: its credits are not offered to DSH.
 */

import { TRAE_REGIONS, TRAE_USAGE_PATH, withTraeRegion } from '../status-paths.ts'
import type { TraeWebUsage } from '../status-paths.ts'
import type { TraeRegion } from '../region.ts'

/** The preload's caption menubar host (`host.dataset.windowsMenu = ''`). */
const CAPTION_HOST_SELECTOR = '[data-windows-menu]'

/** Class of the injected label; also how a re-run finds an existing one. */
const LABEL_CLASS = 'dsh-trae-caption-credits'

/** Style-tag identity, so the sheet is injected exactly once per shadow root. */
const CSS_TAG = 'dsh-connect-trae/caption-credits.css'

/**
 * How often the caption re-reads usage.
 *
 * Mirrors the card's own `POLL_INTERVAL_MS`. Kept as a separate constant rather
 * than imported because the card's is module-private and the two poll for
 * different reasons — the card only while it is open.
 */
const REFRESH_INTERVAL_MS = 60_000

/** One region's contribution to the caption figure. */
interface RegionCredits {
  region: TraeRegion
  /** `credits.available`; absent when the region has no credit answer. */
  available?: number
  workAvailable?: number
  generalAvailable?: number
  /** Why this region contributed nothing, for the tooltip. */
  note?: string
}

/** The label's rendered state. */
interface CaptionState {
  /** Undefined while the first read is still in flight. */
  total?: number
  regions: readonly RegionCredits[]
  /** Set when no region produced a number. */
  emptyReason?: string
}

/** Format a credit figure the way the card does: grouped, no decimals. */
function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value)
}

/**
 * Read one region's usage document.
 *
 * @param region - the region to address.
 * @param signal - aborts the request when the plugin is disposed.
 * @returns the document, or undefined when the route could not be read.
 */
async function readRegion(region: TraeRegion, signal: AbortSignal): Promise<TraeWebUsage | undefined> {
  try {
    const response = await fetch(withTraeRegion(TRAE_USAGE_PATH, region), {
      headers: { accept: 'application/json' },
      credentials: 'same-origin',
      signal,
    })
    if (!response.ok) return undefined
    return (await response.json()) as TraeWebUsage
  } catch {
    return undefined
  }
}

/**
 * Turn the per-region documents into the caption's total.
 *
 * A region contributes only when it is signed in, enabled for DSH, and actually
 * carries a credit answer — a signed-out or disabled region is reported in the
 * tooltip instead of being counted as zero, so the figure never silently
 * understates or overstates what the account holds.
 *
 * @param documents - one document per region, in `TRAE_REGIONS` order.
 * @returns the state to render.
 */
function summarize(documents: readonly (TraeWebUsage | undefined)[]): CaptionState {
  const regions: RegionCredits[] = []
  let total: number | undefined

  documents.forEach((document, index) => {
    const region = TRAE_REGIONS[index]
    if (region === undefined) return
    if (document === undefined) {
      regions.push({ region, note: '用量查询失败' })
      return
    }
    if (document.status === 'error') {
      regions.push({ region, note: document.message })
      return
    }
    if (document.status === 'signed-out') {
      regions.push({ region, note: '未登录' })
      return
    }
    if (document.enabled === false) {
      regions.push({ region, note: '已关闭' })
      return
    }
    if (document.credits === undefined) {
      regions.push({ region, note: document.creditsError ?? '无积分数据' })
      return
    }
    const { available, workAvailable, generalAvailable } = document.credits
    regions.push({ region, available, workAvailable, generalAvailable })
    total = (total ?? 0) + available
  })

  if (total === undefined) {
    return {
      regions,
      emptyReason: regions.find(entry => entry.note !== undefined)?.note ?? '暂无积分',
    }
  }
  return { total, regions }
}

/** The label text: a compact total, or an em dash while unknown. */
function labelText(state: CaptionState): string {
  return state.total === undefined ? '积分 —' : `积分 ${formatNumber(state.total)}`
}

/**
 * The tooltip: which regions contributed, and how the total splits.
 *
 * This is where the Work/general distinction lives. The caption is too narrow
 * for it, but it is exactly what a reader needs before trusting the number.
 *
 * @param state - the rendered state.
 * @returns one line per region, plus the split.
 */
function labelTitle(state: CaptionState): string {
  const lines = state.regions.map(entry => {
    if (entry.available === undefined) return `${entry.region === 'cn' ? '国内版' : '国际版'}：${entry.note ?? '无数据'}`
    const work = entry.workAvailable === undefined ? '' : `，Work ${formatNumber(entry.workAvailable)}（DSH 不可用）`
    const general = entry.generalAvailable === undefined ? '' : `，通用 ${formatNumber(entry.generalAvailable)}`
    return `${entry.region === 'cn' ? '国内版' : '国际版'}：可用 ${formatNumber(entry.available)}${work}${general}`
  })
  lines.push('')
  lines.push('DSH 只能使用通用积分；Work 积分仅在 Trae 客户端内可用')
  return lines.join('\n')
}

/**
 * Inject the caption stylesheet into one shadow root, once.
 *
 * @param shadow - the caption bar's shadow root.
 */
function ensureStyles(shadow: ShadowRoot): void {
  if (shadow.querySelector(`style[data-plugin-css="${CSS_TAG}"]`) !== null) return
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-connect-trae'
  style.dataset.pluginCss = CSS_TAG
  style.textContent = `
    .${LABEL_CLASS} {
      margin-left: 6px;
      padding: 0 9px;
      height: 22px;
      display: inline-flex;
      align-items: center;
      border: 0;
      border-radius: 6px;
      background: var(--dsw-alias-interactive-bg-hover, rgba(127, 127, 127, 0.14));
      color: var(--dsw-alias-label-secondary, #6b6f76);
      font: inherit;
      font-size: 12px;
      line-height: 1;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
      cursor: default;
      /* The strip behind the bar is a drag region; the label must stay clickable. */
      -webkit-app-region: no-drag;
    }
    .${LABEL_CLASS}:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
    }
  `
  shadow.append(style)
}

/**
 * Install the credit label into the Windows caption menubar.
 *
 * Returns a disposer. On a platform or build with no caption menubar the
 * function observes the document and installs the label if the bar appears
 * later; the observer is torn down with the plugin.
 *
 * @returns a disposer that removes the label, its observer, and its timer.
 */
export function installCaptionCredits(): () => void {
  if (typeof document === 'undefined') return () => {}

  const controller = new AbortController()
  let label: HTMLSpanElement | undefined
  let observer: MutationObserver | undefined
  let timer: number | undefined
  let disposed = false
  let reportedFailure = false

  /** Render the current state into the label, creating it if needed. */
  const render = (state: CaptionState): void => {
    if (disposed) return
    const host = document.querySelector(CAPTION_HOST_SELECTOR)
    if (host === null) return
    const shadow = host.shadowRoot
    if (shadow === null) return

    if (label === undefined || !label.isConnected) {
      ensureStyles(shadow)
      // A plain span, not a button: this is a readout, and there is no supported
      // way to navigate to the plugin's card from here, so it does not pretend
      // to be clickable.
      label = document.createElement('span')
      label.className = LABEL_CLASS
      shadow.append(label)
    }
    label.textContent = labelText(state)
    label.title = labelTitle(state)
  }

  /** One refresh: read every region and render the total. */
  const refresh = async (): Promise<void> => {
    const documents = await Promise.all(TRAE_REGIONS.map(region => readRegion(region, controller.signal)))
    if (disposed || controller.signal.aborted) return
    render(summarize(documents))
  }

  /** Begin polling, and stop the moment the plugin is disposed. */
  const start = (): void => {
    if (timer !== undefined) return
    void refresh()
    timer = window.setInterval(() => { void refresh() }, REFRESH_INTERVAL_MS)
  }

  try {
    if (document.querySelector(CAPTION_HOST_SELECTOR) !== null) {
      start()
    } else {
      // The preload mounts its bar after the shell overlay exists, so on a cold
      // load it is simply not there yet. Watch for it instead of giving up.
      observer = new MutationObserver(() => {
        if (disposed) return
        if (document.querySelector(CAPTION_HOST_SELECTOR) === null) return
        observer?.disconnect()
        observer = undefined
        start()
      })
      observer.observe(document.body, { childList: true, subtree: true })
    }
  } catch (error) {
    if (!reportedFailure) {
      reportedFailure = true
      console.error('[dsh-connect-trae] caption credit label unavailable (models and card unaffected):', error)
    }
  }

  return () => {
    disposed = true
    controller.abort()
    observer?.disconnect()
    if (timer !== undefined) window.clearInterval(timer)
    label?.remove()
  }
}