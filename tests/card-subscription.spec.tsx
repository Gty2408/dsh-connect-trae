// @vitest-environment jsdom
/**
 * The card's international subscription row.
 *
 * WHY THIS FILE EXISTS — read before deleting or weakening it:
 * issue #19 reported a Pro member seeing "No active package". The row judged
 * the account on `has_package` ALONE, which answers "does a package
 * entitlement row exist", not "is this account on a paid plan". Trae publishes
 * the plan separately as `user_pay_identity_str`, and the card now reads it.
 *
 * These specs render the SHIPPED `TraeUsageCard` and assert on what it draws,
 * so a future edit that quietly drops the plan identity again fails here.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutline14: () => null,
}))

import { TraeUsageCard } from '../src/client/TraeUsageCard.tsx'
import { TRAE_USAGE_PATH, traePlanIsPaid } from '../src/status-paths.ts'
import type { TraeSettingsKey } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const t = ((key: TraeSettingsKey, params?: Record<string, unknown>) =>
  params === undefined ? key : `${key}:${JSON.stringify(params)}`) as never

function makeScope(initial: Record<string, unknown> = {}, writable = true) {
  let value: Record<string, unknown> = structuredClone(initial)
  const listeners = new Set<() => void>()
  return {
    scope: {
      getSnapshot: () => ({ status: 'ready', value, writable }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
      set: async (field: string, next: unknown) => {
        value = { ...value, [field]: structuredClone(next) }
        for (const listener of listeners) listener()
      },
    },
  }
}

/** One signed-in ai document carrying a pay status. */
function payDocument(payStatus: Record<string, unknown>) {
  return {
    status: 'signed-in',
    accountId: 'account-1',
    accountName: 'LaoDing',
    tokenExpiresAtMs: Date.now() + 3_600_000,
    region: 'ai',
    enabled: true,
    accounts: [],
    models: [],
    enabledModelIds: [],
    credits: undefined,
    payStatus: {
      isDollarUsageBilling: true, hasPackage: false, isPayFreshman: false,
      inTrial: false, trialEndTimeMs: 0,
      enableSoloLite: false, enableSoloBuilder: false, enableSoloCoder: false, enableSoloWeb: false,
      ...payStatus,
    },
  }
}

function stubFetch(document: Record<string, unknown>): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request) => {
    const url = String(input)
    if (url.startsWith(TRAE_USAGE_PATH)) return new Response(JSON.stringify(document), { status: 200 })
    throw new Error(`unexpected fetch: ${url}`)
  })
}

/** Render the card expanded and wait for the subscription row. */
async function renderSubscriptionRow(): Promise<void> {
  const { scope } = makeScope()
  render(<TraeUsageCard t={t} settingsScope={scope as never} />)
  fireEvent.click(screen.getByRole('button', { name: /row\.title/ }))
  await waitFor(() => { expect(screen.getByText(/row\.subscriptionLabel/)).toBeTruthy() })
}

describe('traePlanIsPaid', () => {
  it('treats only the exact Free identity as unpaid', () => {
    expect(traePlanIsPaid('Free')).toBe(false)
    expect(traePlanIsPaid('free')).toBe(false)
    expect(traePlanIsPaid('  Free  ')).toBe(false)
    expect(traePlanIsPaid(undefined)).toBe(false)
    expect(traePlanIsPaid('')).toBe(false)
    expect(traePlanIsPaid('Pro')).toBe(true)
    // An unrecognised tier is NOT "Free": understating a paid plan is the more
    // damaging error, and it is the one issue #19 hit.
    expect(traePlanIsPaid('Pro+')).toBe(true)
    expect(traePlanIsPaid('Trial')).toBe(true)
  })
})

describe('TraeUsageCard subscription row', () => {
  it('shows a member as subscribed from the plan identity alone', async () => {
    // has_package stays false, exactly as the reporter's account behaved.
    stubFetch(payDocument({ hasPackage: false, payIdentity: 5, payIdentityStr: 'Pro' }))
    await renderSubscriptionRow()

    expect(screen.getByText('row.subscribed')).toBeTruthy()
    expect(screen.queryByText('row.noPackage')).toBeNull()
    // The plan is named, so the row says which plan and not just a boolean.
    expect(screen.getByText('row.subscribed · Pro')).toBeTruthy()
  })

  it('still reports a package entitlement without a plan identity', async () => {
    stubFetch(payDocument({ hasPackage: true }))
    await renderSubscriptionRow()

    // Without a tier string both the badge and the value render the bare label,
    // so one exact `getByText` match cannot work here; what matters is that the
    // row is on (and does not claim "no package").
    expect(screen.getAllByText('row.subscribed').length).toBeGreaterThan(0)
    expect(screen.queryByText('row.noPackage')).toBeNull()
  })

  it('names the free tier instead of only saying there is no package', async () => {
    stubFetch(payDocument({ hasPackage: false, payIdentity: 0, payIdentityStr: 'Free' }))
    await renderSubscriptionRow()

    expect(screen.getByText('row.noPackage')).toBeTruthy()
    expect(screen.getByText('row.noPackage · Free')).toBeTruthy()
  })

  it('prefers the trial window over the tier label', async () => {
    stubFetch(payDocument({ inTrial: true, trialEndTimeMs: 1_789_000_000_000, payIdentityStr: 'Pro' }))
    await renderSubscriptionRow()

    expect(screen.getByText(/^row\.trialUntil:/)).toBeTruthy()
  })
})
