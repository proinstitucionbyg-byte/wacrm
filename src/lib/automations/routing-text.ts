/** Keep the inbox's audio marker while routing by the spoken words alone. */
export function inboundRoutingText(displayText: string | null, audioTranscript?: string | null): string {
  return audioTranscript?.trim() || displayText || ''
}
