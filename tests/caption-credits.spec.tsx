// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { installCaptionCredits } from '../src/client/CaptionCredits.ts'

/**
 * The Windows caption menubar credit readout.
 *
 * The label reaches into the desktop preload's shadow root, so the test builds
 * that structure by hand — the same `[data-windows-menu]` host with an OPEN
 * shadow root and a `[role=menubar]` holding the native buttons — and then
 * asserts the two things that matter: the figure is the sum of the regions DSH
 * can actually spend, and disposal leaves nothing behind.
 */

/** The host marker the desktop preload sets on its caption menubar element. */
const HOST_MARKER = '[data-windows-menu]'
/** Class of the injected readout. */
const LABEL = '.dsh-trae-caption-credits'

/** Build the preload's caption menubar: host + open shadow root + menubar. */
function mountCaptionBar(): { host: HTMLElement; shadow: ShadowRoot; bar: HTMLElement } {
  const host = document.createElement('div')
  host.dataset.windowsMenu = ''
  const shadow = host.attachShadow({ mode: 'open' })
  const bar = document.createElement('div')
  bar.setAttribute('role', 'menubar')
  for (const text of ['应用', '编辑']) {
    const button = document.createElement('button')
    button.textContent = text
    bar.append(button)
  }
  shadow.append(bar)
  document.body.append(host)
  return { host, shadow, bar }
}

/** One region's usage document, as the Host route answers it. */
function usage(
  region: 'cn' | 'ai',
  credits: { available: number; work: number; general: number } = { available: 1234.5, work: 234.5, general: 1000 },
  overrides: Record<string, unknown> = {},
): unknown {
  return {
    status: 'signed-in',
    accountId: 'a',
    accountName: 'me',
    tokenExpiresAtMs: 0,
    region,
    enabled: true,
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: {
      total: 2000,
      consumed: 2000 - credits.available,
      available: credits.available,
      workAvailable: credits.work,
      generalAvailable: credits.general,
      accounts: [],
    },
    ...overrides,
  }
}

/** Answer each region's route from a per-region table. */
function stubFetch(byRegion: Partial<Record<'cn' | 'ai', unknown>>): ReturnType<typeof vi.fn> {
  const stub = vi.fn(async (url: string) => {
    const region = url.includes('region=ai') ? 'ai' : 'cn'
    const body = byRegion[region]
    if (body === undefined) return { ok: false, status: 500, json: async () => ({}) }
    return { ok: true, status: 200, json: async () => body }
  })
  vi.stubGlobal('fetch', stub)
  return stub
}

/** Let the label's first read settle. */
const settle = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 20))

describe('caption credits', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    document.body.innerHTML = ''
  })

  it('sums the regions DSH can spend into one figure', async () => {
    const { shadow, bar } = mountCaptionBar()
    // Distinct figures, so a total that ignored one side would be visible.
    stubFetch({
      cn: usage('cn', { available: 1234.5, work: 234.5, general: 1000 }),
      ai: usage('ai', { available: 765, work: 0, general: 765 }),
    })

    const dispose = installCaptionCredits()
    await settle()

    const label = shadow.querySelector(LABEL)
    expect(label).not.toBeNull()
    // 1234.5 + 765 = 1999.5, which the card's formatter rounds to 2,000.
    expect(label?.textContent).toBe('积分 2,000')
    // A readout, not a menu item: a sibling of the menubar, never inside it.
    expect(bar.contains(label)).toBe(false)
    // The FOLLOWING bit proves it sits after the 应用/编辑 buttons.
    expect(bar.compareDocumentPosition(label as Node) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()

    dispose()
  })

  it('keeps the Work/general split in the tooltip, where DSH spendability is stated', async () => {
    const { shadow } = mountCaptionBar()
    stubFetch({ cn: usage('cn'), ai: usage('ai') })

    const dispose = installCaptionCredits()
    await settle()

    const title = shadow.querySelector(LABEL)?.getAttribute('title') ?? ''
    expect(title).toContain('Work 235（DSH 不可用）')
    expect(title).toContain('通用 1,000')
    expect(title).toContain('DSH 只能使用通用积分')

    dispose()
  })

  it('counts only the regions DSH can spend, and names the rest in the tooltip', async () => {
    const { shadow } = mountCaptionBar()
    // CN enabled; AI signed out. The total must be CN alone, not CN + 0 padded
    // into looking like both sides contributed.
    stubFetch({ cn: usage('cn'), ai: { status: 'signed-out', accounts: [] } })

    const dispose = installCaptionCredits()
    await settle()

    expect(shadow.querySelector(LABEL)?.textContent).toBe('积分 1,235')
    expect(shadow.querySelector(LABEL)?.getAttribute('title')).toContain('国际版：未登录')

    dispose()
  })

  it('excludes a region the user switched off', async () => {
    const { shadow } = mountCaptionBar()
    stubFetch({ cn: usage('cn'), ai: usage('ai', undefined, { enabled: false }) })

    const dispose = installCaptionCredits()
    await settle()

    // Only CN's 1,235 counts; the disabled region is reported, not summed.
    expect(shadow.querySelector(LABEL)?.textContent).toBe('积分 1,235')
    expect(shadow.querySelector(LABEL)?.getAttribute('title')).toContain('国际版：已关闭')

    dispose()
  })

  it('shows an em dash rather than a wrong number when no region answers', async () => {
    const { shadow } = mountCaptionBar()
    stubFetch({})

    const dispose = installCaptionCredits()
    await settle()

    expect(shadow.querySelector(LABEL)?.textContent).toBe('积分 —')

    dispose()
  })

  it('waits for the caption bar when the preload has not mounted it yet', async () => {
    // No bar at install time: the plugin loads before the preload mounts it.
    stubFetch({ cn: usage('cn', { available: 1234.5, work: 234.5, general: 1000 }) })
    const dispose = installCaptionCredits()
    await settle()

    const { shadow } = mountCaptionBar()
    // The observer fires on the mutation; give it a tick.
    await new Promise(resolve => setTimeout(resolve, 30))
    await settle()

    expect(shadow.querySelector(LABEL)?.textContent).toBe('积分 1,235')

    dispose()
  })

  it('removes the label and stops polling when the plugin is disposed', async () => {
    const { shadow } = mountCaptionBar()
    const fetchStub = stubFetch({ cn: usage('cn'), ai: usage('ai') })

    const dispose = installCaptionCredits()
    await settle()
    expect(shadow.querySelector(LABEL)).not.toBeNull()

    dispose()
    expect(shadow.querySelector(LABEL)).toBeNull()

    // No further reads after disposal.
    const callsAtDispose = fetchStub.mock.calls.length
    await settle()
    expect(fetchStub.mock.calls.length).toBe(callsAtDispose)
  })
})