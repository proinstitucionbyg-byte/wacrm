import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { isInboxCommand } from '@/lib/inbox/commands'
import {
  checkRateLimit,
  rateLimitResponse,
  RATE_LIMITS,
} from '@/lib/rate-limit'
import {
  sendMessageToConversation,
  validateSendMessageParams,
  SendMessageError,
} from '@/lib/whatsapp/send-message'

import { isSocialChannel } from '@/lib/social/meta-api'
import { sendSocialMessage } from '@/lib/social/send'

type Channel = 'whatsapp' | 'messenger' | 'instagram'

export async function POST(request: Request) {
  try {
    const supabase = await createClient()

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser()

    if (authError || !user) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      )
    }

    const limit = checkRateLimit(`send:${user.id}`, RATE_LIMITS.send)

    if (!limit.success) {
      return rateLimitResponse(limit)
    }

    const { data: profile } = await supabase
      .from('profiles')
      .select('account_id')
      .eq('user_id', user.id)
      .maybeSingle()

    const accountId = profile?.account_id as string | undefined

    if (!accountId) {
      return NextResponse.json(
        { error: 'Your profile is not linked to an account.' },
        { status: 403 }
      )
    }

    const body = await request.json()

    const {
      conversation_id: conversationIdInput,
      contact_id,
      message_type,
      content_text,
      media_url,
      filename,
      template_name,
      template_language,
      template_params,
      template_message_params,
      interactive_payload,
      reply_to_message_id,
    } = body

    if (typeof content_text === 'string' && isInboxCommand(content_text)) {
      return NextResponse.json({ error: 'Envía los comandos desde BLOQUES PREPARADOS; no se enviarán como texto al estudiante.' }, { status: 400 })
    }

    if ((!conversationIdInput && !contact_id) || !message_type) {
      return NextResponse.json(
        {
          error:
            'Either conversation_id or contact_id, plus message_type, are required',
        },
        { status: 400 }
      )
    }

    try {
      validateSendMessageParams({
        messageType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        templateName: template_name,
        interactivePayload: interactive_payload,
      })
    } catch (err) {
      if (err instanceof SendMessageError) {
        return NextResponse.json(
          { error: err.message },
          { status: err.status }
        )
      }

      throw err
    }

    // ------------------------------------------------------------
    // 1. Resolve conversation
    // ------------------------------------------------------------

    let conversationId: string | null = null

    if (conversationIdInput) {
      const { data, error } = await supabase
        .from('conversations')
        .select('id')
        .eq('id', conversationIdInput)
        .eq('account_id', accountId)
        .single()

      if (error || !data) {
        return NextResponse.json(
          { error: 'Conversation not found' },
          { status: 404 }
        )
      }

      conversationId = data.id
    } else {
      const { data: contactRow, error: contactErr } = await supabase
        .from('contacts')
        .select('id')
        .eq('id', contact_id)
        .eq('account_id', accountId)
        .maybeSingle()

      if (contactErr || !contactRow) {
        return NextResponse.json(
          { error: 'Contact not found' },
          { status: 404 }
        )
      }

      const { data: existing } = await supabase
        .from('conversations')
        .select('id')
        .eq('account_id', accountId)
        .eq('contact_id', contact_id)
        .maybeSingle()

      if (existing) {
        conversationId = existing.id
      } else {
        const { data: created, error: createError } =
          await supabase
            .from('conversations')
            .insert({
              account_id: accountId,
              user_id: user.id,
              contact_id,
            })
            .select('id')
            .single()

        if (createError || !created) {
          return NextResponse.json(
            { error: 'Failed to create conversation' },
            { status: 500 }
          )
        }

        conversationId = created.id
      }
    }

    if (!conversationId) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    // ------------------------------------------------------------
    // 2. Resolve contact + channel
    // ------------------------------------------------------------

    const { data: conversation, error: conversationError } =
      await supabase
        .from('conversations')
        .select(`
          id,
          contact_id,
          contacts (
            id,
            channel,
            external_id,
            name
          )
        `)
        .eq('id', conversationId)
        .eq('account_id', accountId)
        .single()

    if (conversationError || !conversation) {
      return NextResponse.json(
        { error: 'Conversation not found' },
        { status: 404 }
      )
    }

    const contact = Array.isArray(conversation.contacts)
      ? conversation.contacts[0]
      : conversation.contacts

    const channel = contact?.channel as Channel | undefined
    const externalId = contact?.external_id as string | undefined
    
    if (!channel) {
      return NextResponse.json(
        { error: 'Conversation has no channel' },
        { status: 400 }
      )
    }

    // ------------------------------------------------------------
    // 3. WHATSAPP
    // ------------------------------------------------------------

    if (channel === 'whatsapp') {
      try {
        const result = await sendMessageToConversation(
          supabase,
          accountId,
          {
            conversationId,
            senderId: user.id,
            messageType: message_type,
            contentText: content_text,
            mediaUrl: media_url,
            filename,
            templateName: template_name,
            templateLanguage: template_language,
            templateParams: template_params,
            templateMessageParams: template_message_params,
            interactivePayload: interactive_payload,
            replyToMessageId: reply_to_message_id,
          }
        )

        return NextResponse.json({
          success: true,
          channel: 'whatsapp',
          message_id: result.messageId,
          whatsapp_message_id: result.whatsappMessageId,
        })
      } catch (err) {
        if (err instanceof SendMessageError) {
          return NextResponse.json(
            { error: err.message },
            { status: err.status }
          )
        }

        throw err
      }
    }

    // ------------------------------------------------------------
    // Messenger and Instagram share the channel-aware sender used by bots.
    if (isSocialChannel(channel)) {
      const { data: canSend, error: permissionError } = await supabase.rpc('has_member_permission', {
        p_user_id: user.id, p_module: 'inbox', p_action: 'send',
      })
      if (permissionError || canSend !== true) return NextResponse.json({ error: 'No tienes permiso para enviar mensajes.' }, { status: 403 })
      const result = await sendSocialMessage(supabase, {
        accountId, conversationId, contactId: conversation.contact_id,
        channel, externalId: externalId ?? null, senderId: user.id,
        messageType: message_type, text: content_text, mediaUrl: media_url,
        filename, interactivePayload: interactive_payload,
      })
      return NextResponse.json({ success: true, channel, message_id: result.message_id, whatsapp_message_id: result.whatsapp_message_id })
    }
    return NextResponse.json({ error: `Unsupported channel: ${channel}` }, { status: 400 })
  } catch (error) {
    console.error('Error in unified Meta send:', error)

    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Failed to send message' },
      { status: 500 }
    )
  }
}
