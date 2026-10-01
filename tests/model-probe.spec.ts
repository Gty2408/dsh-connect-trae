/**
 * The one-click availability test.
 *
 * The classification rules matter more than the plumbing: this feature's failure
 * mode is telling a user a working model is dead. Trae throttles, proxies drop
 * requests, and a 200 body can still carry a refusal — so the tests below pin
 * every branch where an INCONCLUSIVE answer must stay `unknown` rather than
 * becoming a negative verdict.
 */
import { describe, expect, it, vi } from 'vitest'
import { classifyProbeResult, probeBody, probeModelsSequentially, probeOneModel, TRAE_PROBE_TIMEOUT_MS } from '../src/model-probe.ts'
import type { TraeChatResult } from '../src/upstream.ts'

/**
 * What `TraeSoloBridge` hands back: an OpenAI-shaped chunk stream, NOT Trae's
 * own events. The probe reads this side of the bridge, so the fixtures must
 * speak the same shape the production path does.
 */
function bridgedResponse(content = 'pong'): Response {
  return new Response(`data: {"choices":[{"index":0,"delta":{"content":"${content}"},"finish_reason":null}]}\n\ndata: [DONE]\n\n`, {
    headers: { 'content-type': 'text/event-stream' },
  })
}

describe('classifyProbeResult', () => {
  it('reports an answer with output as available', () => {
    expect(classifyProbeResult({ ok: true, response: new Response('') }, true))
      .toEqual({ verdict: 'available', detail: 'upstream answered' })
  })

  it('treats a stream that carried no output as inconclusive, not unavailable', () => {
    const classified = classifyProbeResult({ ok: true, response: new Response('') }, false)
    expect(classified.verdict).toBe('unknown')
    expect(classified.detail).toContain('without any output')
  })

  it('reads the subscription gate back out of the translated message', () => {
    // What the bridge produces for an in-stream 1005: a 402 hard_credit whose
    // message names the code.
    const classified = classifyProbeResult({
      ok: false, status: 402, kind: 'hard_credit',
      message: "Trae requires a paid plan for this model; the current account's plan does not cover it · plan 4 · Trae code 1005",
    }, false)
    expect(classified.verdict).toBe('gated')
    expect(classified.detail).toContain('plan 4')
  })

  it('reads 4001 and 4011 as "this channel does not serve it"', () => {
    for (const code of [4001, 4011]) {
      const classified = classifyProbeResult({
        ok: false, status: 400, kind: 'client',
        message: `Trae refused this model · Trae code ${String(code)}`,
      }, false)
      expect(classified.verdict).toBe('unsupported')
    }
  })

  it('treats an unauthenticated answer as an auth stop, not a dead model', () => {
    const classified = classifyProbeResult({ ok: false, status: 401, kind: 'authentication', message: 'token rejected' }, false)
    expect(classified.verdict).toBe('auth')
  })

  it('separates throttling from a refusal', () => {
    expect(classifyProbeResult({ ok: false, status: 429, kind: 'soft_rate', message: 'slow down' }, false).verdict).toBe('rate_limited')
  })

  it('never turns a transport failure or a server fault into a negative verdict', () => {
    // status 0 is the transport/timeout signal the client reports.
    expect(classifyProbeResult({ ok: false, status: 0, kind: 'server', message: 'transport error: socket hang up' }, false).verdict).toBe('unknown')
    expect(classifyProbeResult({ ok: false, status: 500, kind: 'server', message: 'HTTP 500' }, false).verdict).toBe('unknown')
  })

  it('treats an unnamed 4xx client refusal as unsupported', () => {
    // The bridge classifies a 4001/4011 refusal as `client`; one that arrives
    // without a code label is still a request refusal, not an unknown.
    expect(classifyProbeResult({ ok: false, status: 400, kind: 'client', message: 'bad request' }, false).verdict).toBe('unsupported')
  })
})

describe('probeOneModel', () => {
  it('sends a minimal one-word prompt and no tools', () => {
    const body = JSON.parse(probeBody('glm-5.2')) as Record<string, unknown>
    expect(body['model']).toBe('glm-5.2')
    expect(body['messages']).toEqual([{ role: 'user', content: 'ping' }])
    expect(body).not.toHaveProperty('tools')
    expect(JSON.stringify(body).length).toBeLessThan(200)
  })

  it('records the model id alongside the verdict', async () => {
    const chat = vi.fn(async () => ({ ok: true, response: bridgedResponse() }) as TraeChatResult)
    await expect(probeOneModel(chat, 'glm-5.2')).resolves.toEqual({
      id: 'glm-5.2', verdict: 'available', detail: 'upstream answered',
    })
  })

  it('classifies a refusal carried inside a 200 body', async () => {
    const chat = async (): Promise<TraeChatResult> => ({
      ok: false, status: 402, kind: 'hard_credit', message: "needs a paid plan · Trae code 1005",
    })
    await expect(probeOneModel(chat, 'gpt-6-astra')).resolves.toMatchObject({ id: 'gpt-6-astra', verdict: 'gated' })
  })

  it('classifies a mid-stream refusal thrown by the bridge, without calling it unknown', async () => {
    // The bridge errors the stream (rather than returning a result) when the
    // refusal arrives after output started; its message still names the code.
    const chat = async (): Promise<TraeChatResult> => ({ ok: true, response: new Response('') })
    const poisoned = new Response(new ReadableStream({
      start(controller) { controller.error(new Error('Trae refused this model · Trae code 4011')) },
    }))
    const streamChat = async (): Promise<TraeChatResult> => ({ ok: true, response: poisoned })
    expect((await probeOneModel(streamChat, 'gpt-5.6-sol')).verdict).toBe('unsupported')
    expect(chat).toBeDefined()
  })

  it('reports a timeout as unknown, never as unavailable', async () => {
    const chat = (_body: string, signal?: AbortSignal): Promise<TraeChatResult> => new Promise((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(new Error('aborted')) })
    })
    const result = await probeOneModel(chat, 'glm-5.2', 20)
    expect(result.verdict).toBe('unknown')
    expect(result.detail).toContain('no answer within')
  })

  it('defaults its timeout to the exported budget', () => {
    expect(TRAE_PROBE_TIMEOUT_MS).toBeGreaterThan(5_000)
  })
})

describe('probeModelsSequentially', () => {
  it('runs one model at a time, in order, reporting each as it lands', async () => {
    const order: string[] = []
    const chat = async (body: string): Promise<TraeChatResult> => {
      const model = (JSON.parse(body) as { model: string }).model
      order.push(model)
      return { ok: true, response: bridgedResponse() }
    }
    const seen: string[] = []
    const results = await probeModelsSequentially(chat, ['a', 'b', 'c'], result => { seen.push(result.id) })
    expect(order).toEqual(['a', 'b', 'c'])
    expect(seen).toEqual(['a', 'b', 'c'])
    expect(results).toHaveLength(3)
  })

  it('stops at the first authentication failure instead of spending every call', async () => {
    const chat = vi.fn(async (): Promise<TraeChatResult> => ({ ok: true, response: bridgedResponse('x') }))
    let calls = 0
    const authThenFail = async (): Promise<TraeChatResult> => {
      calls += 1
      return calls === 2
        ? { ok: false, status: 401, kind: 'authentication', message: 'token rejected' }
        : { ok: true, response: bridgedResponse('x') }
    }
    const results = await probeModelsSequentially(authThenFail, ['a', 'b', 'c', 'd'])
    expect(results.map(r => r.verdict)).toEqual(['available', 'auth'])
    expect(chat).toBeDefined()
  })
})
