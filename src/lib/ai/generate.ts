import {
  AiError,
  type AiConfig,
  type AiUsage,
  type ChatMessage,
  type GenerateResult,
} from './types'
import {
  AUTOMATION_MARKER_REGEX,
  HANDOFF_AREAS,
  aiRequestTimeoutMs,
} from './defaults'
import { generateOpenAi } from './providers/openai'
import { generateAnthropic } from './providers/anthropic'

export interface GenerateArgs {
  config: AiConfig
  /** Fully-built system prompt (see `buildSystemPrompt`). */
  systemPrompt: string
  /** Recent conversation turns, oldest first. */
  messages: ChatMessage[]
}

/**
 * Generate the next reply from the account's configured provider.
 * Dispatches to the right adapter, then parses the handoff and
 * automation markers out of the raw text. Throws `AiError` on any
 * provider/network failure.
 */
export async function generateReply(args: GenerateArgs): Promise<GenerateResult> {
  const { config, systemPrompt, messages } = args
  const timeoutMs = aiRequestTimeoutMs()
  const providerArgs = {
    apiKey: config.apiKey,
    model: config.model,
    systemPrompt,
    messages,
    timeoutMs,
  }

  let result: { text: string; usage: AiUsage | null }
  switch (config.provider) {
    case 'openai':
      result = await generateOpenAi(providerArgs)
      break
    case 'anthropic':
      result = await generateAnthropic(providerArgs)
      break
    default:
      throw new AiError(`Unsupported AI provider: ${config.provider}`, {
        code: 'unsupported_provider',
        status: 400,
      })
  }

  return parseGeneration(result.text, result.usage)
}

const AUTOMATION_MARKER_GLOBAL = new RegExp(AUTOMATION_MARKER_REGEX.source, 'gi')

// Tolerant on purpose. Accepts `[[HANDOFF]]`, `[[HANDOFF:ventas]]`,
// `[[HANDOFF:fidelizacion:delicado]]` and `[[HANDOFF:delicado]]`, so a
// slightly off marker still counts as a handoff instead of leaking to
// the customer.
const HANDOFF_RE =
  /\[\[HANDOFF(?::\s*([^\]\s:]+))?(?::\s*([^\]\s:]+))?\s*\]\]/i
const HANDOFF_RE_GLOBAL = new RegExp(HANDOFF_RE.source, 'gi')

function clean(raw: string): string {
  return raw
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
}

function normalizeArea(raw: string | undefined): string | null {
  if (!raw) return null
  const c = clean(raw)
  return (HANDOFF_AREAS as readonly string[]).includes(c) ? c : null
}

function isDelicate(raw: string | undefined): boolean {
  return raw ? clean(raw).startsWith('delic') : false
}

/**
 * Split the raw model output into
 * `{ text, handoff, handoffArea, handoffDelicate, automationId, usage }`.
 * A handoff marker (alone or trailing a partial reply) makes the turn a
 * handoff; its area is validated against HANDOFF_AREAS (null if missing
 * or unknown) and the optional `delicado` flag marks painful situations.
 * The automation marker is stripped from the text and its id returned
 * (lowercased); a handoff always wins over an automation. `usage` is
 * passed straight through (null when the provider didn't report it).
 */
export function parseGeneration(
  raw: string,
  usage: AiUsage | null = null,
): GenerateResult {
  const handoffMatch = raw.match(HANDOFF_RE)
  const handoff = handoffMatch !== null
  const handoffArea = handoff ? normalizeArea(handoffMatch?.[1]) : null
  const handoffDelicate = handoff
    ? isDelicate(handoffMatch?.[1]) || isDelicate(handoffMatch?.[2])
    : false
  const automationMatch = raw.match(AUTOMATION_MARKER_REGEX)
  const automationId =
    !handoff && automationMatch ? automationMatch[1].toLowerCase() : null
  const text = raw
    .replace(HANDOFF_RE_GLOBAL, '')
    .replace(AUTOMATION_MARKER_GLOBAL, '')
    .trim()
  return { text, handoff, handoffArea, handoffDelicate, automationId, usage }
}