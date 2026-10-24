export type OpeningKeywordConfig = {
  keywords?: unknown
  match_type?: unknown
  case_sensitive?: unknown
  internal_only?: unknown
}

/** Use the match rules saved on the active automation or flow. */
export function configuredKeywordMatches(
  text: string,
  config: OpeningKeywordConfig | null | undefined,
): boolean {
  if (!text || !Array.isArray(config?.keywords) || config.keywords.length === 0) return false
  if (config.internal_only === true) return false
  const caseSensitive = config.case_sensitive === true
  const haystack = caseSensitive ? text : text.toLowerCase()
  const matchType = config.match_type === 'exact' ? 'exact' : 'contains'
  return config.keywords.some((raw) => {
    if (typeof raw !== 'string' || !raw.trim()) return false
    const keyword = caseSensitive ? raw : raw.toLowerCase()
    return matchType === 'exact' ? haystack === keyword : haystack.includes(keyword)
  })
}

export function hasConfiguredOpeningKeyword(
  text: string,
  automationConfigs: Array<OpeningKeywordConfig | null | undefined>,
  flowConfigs: Array<OpeningKeywordConfig | null | undefined>,
): boolean {
  return automationConfigs.some((config) => configuredKeywordMatches(text, config))
    || flowConfigs.some((config) => configuredKeywordMatches(text, config))
}

export type FirstInboundKeywordDecision = 'continue' | 'wait_for_meta' | 'human'

export function decideFirstInboundKeywordRouting(input: {
  firstInbound: boolean
  keywordMatch: boolean
  lookupSucceeded: boolean
  adOriginConfirmed: boolean
}): FirstInboundKeywordDecision {
  if (!input.firstInbound) return 'continue'
  if (!input.lookupSucceeded || !input.keywordMatch) return 'human'
  return input.adOriginConfirmed ? 'continue' : 'wait_for_meta'
}
