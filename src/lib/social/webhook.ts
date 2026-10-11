import { after, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import { verifyMetaWebhookSignature } from '@/lib/whatsapp/webhook-signature'
import { socialConfiguration, type SocialChannel } from './meta-api'
import { parseSocialInbound } from './inbound'
import { storeSocialInbound, dispatchSocialInbound } from './process-inbound'

export function verifySocialSubscription(request: Request) {
  const params = new URL(request.url).searchParams
  const token = process.env.MESSENGER_VERIFY_TOKEN
  if (token && params.get('hub.mode') === 'subscribe' && params.get('hub.verify_token') === token && params.get('hub.challenge')) {
    return new Response(params.get('hub.challenge'), { status: 200 })
  }
  return new Response('Forbidden', { status: 403 })
}

export async function receiveSocialWebhook(request: Request, channel: SocialChannel) {
  const raw = await request.text()
  if (!verifyMetaWebhookSignature(raw, request.headers.get('x-hub-signature-256'))) return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  let body: unknown
  try { body = JSON.parse(raw) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
  try {
    const accountId = process.env.META_CHANNEL_ACCOUNT_ID ?? ''
    const { assetId } = socialConfiguration(channel, accountId)
    const messages = parseSocialInbound(channel, body, assetId)
    if (!messages.length) return NextResponse.json({ ok: true })
    const db = supabaseAdmin()
    const { data: account, error } = await db.from('accounts').select('id,owner_user_id').eq('id', accountId).maybeSingle()
    if (error || !account) throw new Error('La cuenta social no está vinculada al CRM.')
    // Keep Meta's acknowledgement quick; Next's after retains the work.
    after(async () => {
      for (const message of messages) {
        try {
          const context = await storeSocialInbound(db, channel, account, message)
          if (context) await dispatchSocialInbound(db, context)
        } catch (error) { console.error(`[${channel}] inbound processing failed`, error) }
      }
    })
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error(`[${channel}] webhook configuration failed`, error)
    return NextResponse.json({ error: 'Channel configuration unavailable' }, { status: 503 })
  }
}
