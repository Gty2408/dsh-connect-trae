import type { TraeCredential } from './auth.ts'
import { parseTraeRemoteModel, type TraeDiscoveredModel } from './model-metadata.ts'
import { REGION_GATEWAYS, regionOfCredential, type TraeRegion } from './region.ts'

export const TRAE_SOLO_REMOTE_BASE = 'https://solo.trae.cn/api/remote/v1'

/**
 * Remote-directory functions to ask for, per region.
 *
 * The remote `/models` answer is **grouped by function** and the groups are not
 * interchangeable (measured 2026-10-01, issue #19):
 *
 * ```
 * solo_agent        : 19 models   ← superset; also the ONLY source of
 *                                   gpt-6-astra / gpt-5.6-sol|terra|luna /
 *                                   glm-5.2 / gpt-5.5 / Seed-2.1-Turbo
 * solo_agent_remote : 10 models   ← what this client used to read, and all it
 *                                   read: the preferred group only
 * ```
 *
 * `solo_agent` ⊇ `solo_agent_remote`, so reading just the latter hid nine
 * models that the Trae IDE does show — exactly what the reporter saw. Both
 * groups are therefore requested, and every returned group is unioned.
 *
 * Asking for a function the gateway does not serve is harmless: unknown names
 * are ignored rather than rejected (`solo_work_remote` returns no group on
 * `ai`, and the request still answers HTTP 200).
 *
 * `chat_v3` was added on 2026-10-01 (issue #19 follow-up) because it carries
 * three ai-region models that appear in NO other group — `deepseek-v3.2`,
 * `gemini-3-flash-premium`, `gemini_2.5_flash_premium` — and those three are
 * callable: with `chat_v3` also in the wire list (see TRAE_DIRECTORY_FUNCTIONS
 * in solo.ts) the ai directory goes from 11 visible models to 17, each verified
 * end-to-end. Discovery alone changes nothing; the wire join decides visibility,
 * and a discovered model with no wire match is dropped (see
 * mergeTraeModelSources).
 *
 * The CN list is left as it was on purpose. Its `solo_coder` group does carry
 * models the current CN list misses, but it mixes callable ones (`glm-5`,
 * `glm-5.1`, `qwen-3.5`) with three that answer `4001` under every chat
 * function measured, and nothing in the merge can separate them by group.
 * Widening CN discovery therefore waits for a per-model function resolution
 * rather than advertising models that cannot be called.
 */
export const TRAE_REMOTE_DIRECTORY_FUNCTIONS: Readonly<Record<TraeRegion, readonly string[]>> = {
  cn: ['solo_agent_remote', 'solo_work_remote'],
  ai: ['solo_agent', 'solo_agent_remote', 'solo_work_remote', 'chat_v3'],
}

export interface TraeSoloRemoteCatalogOptions {
  credential(): Promise<TraeCredential>
  fetchImpl?: typeof fetch
  baseUrl?: string
}

/**
 * Region-scoped request dressing. The CN portal is `solo.trae.cn` with the
 * CN locale headers; the international directory lives on the shared
 * `coresg-normal.trae.ai` gateway and was verified (2026-09-15) with the
 * English/Singapore headers — both forms are accepted, each region keeps the
 * shape its own portal sends.
 */
function remoteDressing(region: TraeRegion): { referer: string; timezone: string; language: string } {
  return region === 'ai'
    ? { referer: 'https://coresg-normal.trae.ai/', timezone: 'Asia/Singapore', language: 'en' }
    : { referer: 'https://solo.trae.cn/', timezone: 'Asia/Shanghai', language: 'zh-cn' }
}

/**
 * Read-only model catalog client for the SOLO Web API.
 *
 * This deliberately has no chat/session method: the Remote session protocol
 * only exposes a final answer and cannot preserve DSH's structured tool loop.
 */
export class TraeSoloRemoteCatalogClient {
  private readonly fetchImpl: typeof fetch
  private readonly baseUrl: string | undefined

  constructor(private readonly options: TraeSoloRemoteCatalogOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.baseUrl = options.baseUrl
  }

  private async headers(region: TraeRegion): Promise<Record<string, string>> {
    const credential = await this.options.credential()
    const dressing = remoteDressing(region)
    return {
      'Authorization': `Cloud-IDE-JWT ${credential.accessToken}`,
      'Content-Type': 'application/json',
      'x-trae-client-type': 'web',
      'x-trae-user-timezone': dressing.timezone,
      'x-preferenced-language': dressing.language,
      'Referer': dressing.referer,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    }
  }

  async fetchModels(signal?: AbortSignal): Promise<TraeDiscoveredModel[]> {
    // The directory gateway follows the credential's own region; an explicit
    // baseUrl (tests, diagnostics) still pins the endpoint.
    const credential = await this.options.credential()
    const region = regionOfCredential(credential)
    const base = this.baseUrl ?? REGION_GATEWAYS[region].remote
    const headers = await this.headers(region)
    const functions = TRAE_REMOTE_DIRECTORY_FUNCTIONS[region].join(',')
    const response = await this.fetchImpl(`${base}/models?functions=${functions}`, { headers, signal: signal ?? AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`SOLO remote models returned HTTP ${response.status}`)
    const json = await response.json() as { code?: number; data?: { list?: { function?: string; models?: unknown[] }[] } }
    const groups = json.data?.list ?? []
    // Union EVERY group, not just the preferred one. Each group is a roster the
    // gateway is willing to serve; a model listed by any of them is a model the
    // IDE can offer, and the wire join downstream (see mergeTraeModelSources)
    // is what decides whether it is actually callable. Restricting this to
    // `solo_agent_remote` dropped the nine models issue #19 was opened about.
    //
    // First listing wins so a model present in several groups is emitted once,
    // keeping the gateway's own group order (solo_agent_remote first in the ai
    // answer) stable for rows that appear in both.
    const seen = new Set<string>()
    const models: TraeDiscoveredModel[] = []
    for (const group of groups) {
      for (const raw of group.models ?? []) {
        const model = parseTraeRemoteModel(raw)
        if (model === undefined || seen.has(model.id)) continue
        seen.add(model.id)
        models.push(model)
      }
    }
    if (models.length === 0) throw new Error('SOLO remote models response contained no models')
    return models
  }
}
