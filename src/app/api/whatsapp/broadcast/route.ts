import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { sendTemplateMessage } from '@/lib/whatsapp/meta-api'
import { decrypt } from '@/lib/whatsapp/encryption'
import type { SendTimeParams } from '@/lib/whatsapp/template-send-builder'
import { isMessageTemplate } from '@/lib/whatsapp/template-row-guard'
import { findOrCreateContact } from '@/lib/api/v1/contacts'
import {
  sanitizePhoneForMeta,
  isValidE164,
  phoneVariants,
  isRecipientNotAllowedError,
} from '@/lib/whatsapp/phone-utils'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'

interface BroadcastResult {
  phone: string
  status: 'sent' | 'failed'
  whatsapp_message_id?: string
  error?: string
}

/**
 * Two input shapes are accepted:
 *
 *   NEW (preferred — supports per-recipient variable substitution):
 *     {
 *       recipients: Array<{ phone: string; params: string[] }>,
 *       template_name, template_language
 *     }
 *
 *   LEGACY (all phones receive the same params — kept so existing
 *   callers don't break):
 *     {
 *       phone_numbers: string[],
 *       template_params: string[],
 *       template_name, template_language
 *     }
 *
 * Previous implementation only supported the legacy shape, and the
 * sending hook was forced to ship every batch with `templateParams[0]`
 * — meaning every recipient got contact-0's personalization. The new
 * shape is what actually fixes that.
 */
interface NewRecipient {
  phone: string
  /** Body variable values, one per {{N}}. Legacy field. */
  params?: string[]
  /**
   * Structured per-send values (header text variable, media URL
   * override, URL/COPY_CODE button values). When set, takes
   * precedence over `params` for the body too — see
   * sendTemplateMessage for the merge rules.
   */
  messageParams?: SendTimeParams
}

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Per-user broadcast budget. Note: this limits how often a user
    // can *start* a campaign, not how many messages go out inside
    // one — the fan-out loop below runs without additional gating.
    const limit = checkRateLimit(`broadcast:${user.id}`, RATE_LIMITS.broadcast)
    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    // Resolve the caller's account_id. whatsapp_config + templates
    // + broadcasts are all account-scoped post-multi-user, so the
    // old `.eq('user_id', user.id)` filters miss every row created
    // by a teammate.
    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()
    const accountId = profile?.account_id as string | undefined
    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 },
      )
    }

    const body = await request.json()
    const {
      recipients: newRecipients,
      phone_numbers,
      template_name,
      template_language,
      template_params,
      name,
    } = body

    // Normalize to a list of {phone, params} regardless of shape.
    let recipients: NewRecipient[]
    if (Array.isArray(newRecipients) && newRecipients.length > 0) {
      recipients = newRecipients
    } else if (Array.isArray(phone_numbers) && phone_numbers.length > 0) {
      const shared: string[] = Array.isArray(template_params)
        ? template_params
        : []
      recipients = phone_numbers.map((phone: string) => ({
        phone,
        params: shared,
      }))
    } else {
      return NextResponse.json(
        {
          error:
            'Provide either `recipients` (preferred) or `phone_numbers` — must be a non-empty array',
        },
        { status: 400 }
      )
    }

    if (!template_name) {
      return NextResponse.json(
        { error: 'template_name is required' },
        { status: 400 }
      )
    }

    const { data: config, error: configError } = await supabase
      .from('whatsapp_config')
      .select('*')
      .eq('account_id', accountId)
      .single()

    if (configError || !config) {
      return NextResponse.json(
        {
          error:
            'WhatsApp not configured. Please set up your WhatsApp integration first.',
        },
        { status: 400 }
      )
    }

    const accessToken = decrypt(config.access_token)

    // Load the template row once so sendTemplateMessage can build
    // header + button components on each iteration. Loading inside
    // the loop would N+1 against Supabase for every recipient.
    // Guard against a malformed local row crashing every send in
    // the loop with the same opaque TypeError — fail loudly once.
    const { data: rawTemplateRow } = await supabase
      .from('message_templates')
      .select('*')
      .eq('account_id', accountId)
      .eq('name', template_name)
      .eq('language', template_language || 'en_US')
      .maybeSingle()
    if (rawTemplateRow && !isMessageTemplate(rawTemplateRow)) {
      return NextResponse.json(
        {
          error:
            'Template row is malformed locally — run "Sync from Meta" in Settings to repair it before broadcasting.',
        },
        { status: 500 },
      )
    }
    const templateRow = rawTemplateRow ?? null

    // This legacy endpoint previously sent templates without creating the
    // broadcast ledger rows used by delivery webhooks. Create the ledger
    // first and fail closed if any valid recipient cannot be recorded.
    const validRecipients = recipients
      .map((recipient, index) => ({ recipient, index, phone: sanitizePhoneForMeta(recipient.phone) }))
      .filter((entry) => isValidE164(entry.phone))
    const { data: broadcast, error: broadcastError } = await supabase
      .from('broadcasts')
      .insert({
        account_id: accountId,
        user_id: user.id,
        name: typeof name === 'string' && name.trim() ? name.trim().slice(0, 160) : `Difusión: ${template_name}`,
        template_name,
        template_language: template_language || 'en_US',
        status: 'sending',
        total_recipients: validRecipients.length,
      })
      .select('id')
      .single()
    if (broadcastError || !broadcast) {
      console.error('[whatsapp-broadcast] could not create billing ledger:', broadcastError)
      return NextResponse.json({ error: 'No se inició la difusión porque no se pudo preparar su registro de entrega y costos.' }, { status: 500 })
    }

    const recipientRowByIndex = new Map<number, string>()
    for (const entry of validRecipients) {
      try {
        const { id: contactId } = await findOrCreateContact(supabase, accountId, user.id, { phone: entry.phone })
        const { data: row, error: recipientError } = await supabase
          .from('broadcast_recipients')
          .insert({
            broadcast_id: broadcast.id,
            contact_id: contactId,
            status: 'pending',
          })
          .select('id')
          .single()
        if (recipientError || !row) throw recipientError ?? new Error('No se devolvió la fila del destinatario')
        recipientRowByIndex.set(entry.index, row.id)
      } catch (error) {
        console.error('[whatsapp-broadcast] recipient ledger preparation failed:', error)
        await supabase.from('broadcasts').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', broadcast.id)
        return NextResponse.json({ error: 'No se inició la difusión: no se pudo registrar cada destinatario para verificar su entrega y costo.' }, { status: 500 })
      }
    }

    const results: BroadcastResult[] = []
    let sentCount = 0
    let failedCount = 0

    for (let recipientIndex = 0; recipientIndex < recipients.length; recipientIndex++) {
      const recipient = recipients[recipientIndex]
      const sanitized = sanitizePhoneForMeta(recipient.phone)

      if (!isValidE164(sanitized)) {
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: 'Invalid phone number format',
        })
        failedCount++
        continue
      }

      // Retry with phone variants on "not in allowed list" so numbers
      // that differ only in a trunk-prefix 0 still reach recipients.
      const variants = phoneVariants(sanitized)
      let sentMessageId: string | null = null
      let lastError: string | null = null

      for (const variant of variants) {
        try {
          const result = await sendTemplateMessage({
            phoneNumberId: config.phone_number_id,
            accessToken,
            to: variant,
            templateName: template_name,
            language: template_language || 'en_US',
            template: templateRow ?? undefined,
            messageParams: recipient.messageParams,
            params: recipient.params ?? [],
          })
          sentMessageId = result.messageId
          lastError = null
          break
        } catch (error) {
          const errorMessage =
            error instanceof Error ? error.message : 'Unknown error'
          if (!isRecipientNotAllowedError(errorMessage)) {
            lastError = errorMessage
            break
          }
          lastError = errorMessage
          // retry with next variant
        }
      }

      if (sentMessageId) {
        results.push({
          phone: recipient.phone,
          status: 'sent',
          whatsapp_message_id: sentMessageId,
        })
        sentCount++
        const recipientRowId = recipientRowByIndex.get(recipientIndex)
        if (recipientRowId) {
          const { error: ledgerError } = await supabase.from('broadcast_recipients').update({
            status: 'sent',
            sent_at: new Date().toISOString(),
            whatsapp_message_id: sentMessageId,
            error_message: null,
          }).eq('id', recipientRowId)
          if (ledgerError) console.error('[whatsapp-broadcast] could not link delivered message to billing ledger:', ledgerError)
        }
      } else {
        console.error(
          `Failed to send broadcast to ${recipient.phone}:`,
          lastError
        )
        results.push({
          phone: recipient.phone,
          status: 'failed',
          error: lastError || 'Unknown error',
        })
        failedCount++
        const recipientRowId = recipientRowByIndex.get(recipientIndex)
        if (recipientRowId) {
          const { error: ledgerError } = await supabase.from('broadcast_recipients').update({
            status: 'failed',
            error_message: (lastError || 'Unknown error').slice(0, 1000),
          }).eq('id', recipientRowId)
          if (ledgerError) console.error('[whatsapp-broadcast] could not store failed send:', ledgerError)
        }
      }
    }

    const { error: finalizeError } = await supabase.from('broadcasts').update({
      status: sentCount > 0 ? 'sent' : 'failed',
      updated_at: new Date().toISOString(),
    }).eq('id', broadcast.id)
    if (finalizeError) console.error('[whatsapp-broadcast] could not finalize broadcast ledger:', finalizeError)

    return NextResponse.json({
      success: true,
      total: recipients.length,
      sent: sentCount,
      failed: failedCount,
      results,
    })
  } catch (error) {
    console.error('Error in WhatsApp broadcast POST:', error)
    return NextResponse.json(
      { error: 'Failed to process broadcast' },
      { status: 500 }
    )
  }
}
