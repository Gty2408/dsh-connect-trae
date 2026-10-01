import { describe, expect, it, vi } from 'vitest'
import { TraeSoloRemoteCatalogClient } from '../src/solo-remote.ts'
import type { TraeCredential } from '../src/auth.ts'

const credential: TraeCredential = { accessToken: 'token', userId: 'uid', host: 'https://host', expiresAtMs: Date.now() + 1000, edition: 'solo', source: 'desktop' }

describe('TraeSoloRemoteCatalogClient', () => {
  it('parses model capabilities and unions every advertised group', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent_remote', models: [{
        name: 'qwen3.8-max', display_name: 'Qwen3.8-Max', multimodal: true, max_mode: true,
        context_window_tokens: { dev: 200000, max: 1000000 },
        reasoning_effort_config: { support_thinking: true, options: ['light', 'high', 'extra_high'], default_level: 'high' },
        features: JSON.stringify({ consumption_rate: { enable: true, data: { rate: 1.5 } }, reasoning: { enable: true } }),
      }] },
      { function: 'solo_agent', models: [{ name: 'gpt-5.6-sol', display_name: 'GPT-5.6-Sol' }] },
      { function: 'solo_work_remote', models: [{ name: 'ignored' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    const models = await client.fetchModels()
    expect(models[0]).toEqual({
      id: 'qwen3.8-max', name: 'Qwen3.8-Max', multimodal: true,
      contextWindow: 200000, maxContextWindow: 1000000, creditMultiplier: 1.5,
      reasoningSupported: true,
      reasoning: { supported: ['low', 'high', 'xhigh'], defaultEffort: 'high' },
    })
    // Every group is read, not just the preferred one (issue #19): `solo_agent`
    // is where gpt-5.6-* / gpt-6-astra / glm-5.2 live. Rows are passed through
    // as-is — callability is decided by the wire join in mergeTraeModelSources,
    // never here.
    expect(models.map(model => model.id)).toEqual(['qwen3.8-max', 'gpt-5.6-sol', 'ignored'])
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://solo.trae.cn/api/remote/v1/models?functions=solo_agent_remote,solo_work_remote')
  })

  it('emits a model listed by two groups only once', async () => {
    const shared = { name: 'gpt-5.4', display_name: 'GPT-5.4' }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent_remote', models: [shared] },
      { function: 'solo_agent', models: [shared, { name: 'gpt-6-astra', display_name: 'GPT-6-Astra' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([
      { id: 'gpt-5.4', name: 'GPT-5.4' },
      { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
    ])
  })

  it('fails clearly when the catalog response contains no usable models', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).rejects.toThrow(/contained no models/)
  })

  it('does not expose a chat or session API', () => {
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => credential })
    expect('chat' in client).toBe(false)
  })
})

describe('region-scoped directory gateway', () => {
  it('routes an international credential to coresg with its portal headers', async () => {
    const intlCredential: TraeCredential = {
      accessToken: 'token', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
      expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
    }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_agent_remote', models: [{ name: 'gpt-5.4', display_name: 'GPT-5.4', multimodal: true }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => intlCredential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toHaveLength(1)
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://coresg-normal.trae.ai/api/remote/v1/models?functions=solo_agent,solo_agent_remote,solo_work_remote,chat_v3')
    const headers = (fetchImpl.mock.calls[0]?.[1] as RequestInit).headers as Record<string, string>
    expect(headers['Referer']).toBe('https://coresg-normal.trae.ai/')
    expect(headers['x-preferenced-language']).toBe('en')
    expect(headers['x-trae-user-timezone']).toBe('Asia/Singapore')
  })

  it('asks the ai directory for chat_v3, its only source of three callable models', async () => {
    // Measured 2026-10-01 (issue #19 follow-up): deepseek-v3.2,
    // gemini-3-flash-premium and gemini_2.5_flash_premium appear in NO other
    // group, and all three answer normally through llm_utils_chat under
    // chat_v3. Discovery alone does not expose them — the wire join does — but
    // without the group they could never be discovered at all.
    const intlCredential: TraeCredential = {
      accessToken: 'token', userId: 'uid', host: 'https://growsg-normal.trae.ai', userRegion: 'SG',
      expiresAtMs: Date.now() + 1000, edition: 'solo-sg', source: 'desktop',
    }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'chat_v3', models: [{ name: 'deepseek-v3.2', display_name: 'DeepSeek-V3.2' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => intlCredential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await expect(client.fetchModels()).resolves.toMatchObject([{ id: 'deepseek-v3.2' }])
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('chat_v3')
  })

  it('leaves the CN discovery list alone', async () => {
    // CN's solo_coder group would add models, but it mixes three that answer
    // 4001 under every chat function measured with callable ones, and the merge
    // cannot separate them. Widening CN without that resolution would advertise
    // models that cannot be called — the failure the wire join exists to avoid.
    const cnCredential: TraeCredential = {
      accessToken: 'token', userId: 'uid', host: 'https://trae-api-cn.mchost.guru', userRegion: 'CN',
      expiresAtMs: Date.now() + 1000, edition: 'cn', source: 'desktop',
    }
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ code: 0, data: { list: [
      { function: 'solo_work_remote', models: [{ name: 'glm-5.3', display_name: 'GLM-5.3' }] },
    ] } }), { status: 200 }))
    const client = new TraeSoloRemoteCatalogClient({ credential: async () => cnCredential, fetchImpl: fetchImpl as unknown as typeof fetch })
    await client.fetchModels()
    const url = String(fetchImpl.mock.calls[0]?.[0])
    expect(url).toBe('https://solo.trae.cn/api/remote/v1/models?functions=solo_agent_remote,solo_work_remote')
    expect(url).not.toContain('chat_v3')
    expect(url).not.toContain('solo_coder')
  })
})
