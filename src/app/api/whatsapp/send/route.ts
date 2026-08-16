import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
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

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0'

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
    // 4. MESSENGER
    // ------------------------------------------------------------

    if (channel === 'messenger') {
      if (!externalId) {
        return NextResponse.json(
          { error: 'Messenger contact has no external_id' },
          { status: 400 }
        )
      }

      const token = process.env.MESSENGER_PAGE_ACCESS_TOKEN

      if (!token) {
        return NextResponse.json(
          { error: 'MESSENGER_PAGE_ACCESS_TOKEN is not configured' },
          { status: 500 }
        )
      }

      const result = await sendMessengerMessage({
        recipientId: externalId,
        accessToken: token,
        messageType: message_type,
        text: content_text,
        mediaUrl: media_url,
      })

      await saveOutboundMessage({
        supabase,
        conversationId,
        contentType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        messageId: result.messageId,
      })

      return NextResponse.json({
        success: true,
        channel: 'messenger',
        message_id: result.messageId,
      })
    }

    // ------------------------------------------------------------
    // 5. INSTAGRAM
    // ------------------------------------------------------------

    if (channel === 'instagram') {
      if (!externalId) {
        return NextResponse.json(
          { error: 'Instagram contact has no external_id' },
          { status: 400 }
        )
      }

      const token = process.env.INSTAGRAM_ACCESS_TOKEN
      const instagramAccountId =
        process.env.INSTAGRAM_BUSINESS_ACCOUNT_ID

      if (!token || !instagramAccountId) {
        return NextResponse.json(
          {
            error:
              'Instagram credentials are not configured',
          },
          { status: 500 }
        )
      }

      const result = await sendInstagramMessage({
        instagramAccountId,
        recipientId: externalId,
        accessToken: token,
        messageType: message_type,
        text: content_text,
        mediaUrl: media_url,
      })

      await saveOutboundMessage({
        supabase,
        conversationId,
        contentType: message_type,
        contentText: content_text,
        mediaUrl: media_url,
        messageId: result.messageId,
      })

      return NextResponse.json({
        success: true,
        channel: 'instagram',
        message_id: result.messageId,
      })
    }

    return NextResponse.json(
      { error: `Unsupported channel: ${channel}` },
      { status: 400 }
    )
  } catch (error) {
    console.error('Error in unified Meta send:', error)

    return NextResponse.json(
      { error: 'Failed to send message' },
      { status: 500 }
    )
  }
}

// ============================================================
// Messenger
// ============================================================

async function sendMessengerMessage({
  recipientId,
  accessToken,
  messageType,
  text,
  mediaUrl,
}: {
  recipientId: string
  accessToken: string
  messageType: string
  text?: string
  mediaUrl?: string
}) {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/me/messages` +
    `?access_token=${encodeURIComponent(accessToken)}`

  let message: Record<string, unknown>

  if (messageType === 'text') {
    message = {
      text: text || '',
    }
  } else if (
    mediaUrl &&
    ['image', 'video', 'audio', 'file'].includes(messageType)
  ) {
    const attachmentType =
      messageType === 'file' ? 'file' : messageType

    message = {
      attachment: {
        type: attachmentType,
        payload: {
          url: mediaUrl,
          is_reusable: false,
        },
      },
    }
  } else {
    throw new Error(
      `Messenger does not support message type "${messageType}" yet`
    )
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: {
        id: recipientId,
      },
      message,
    }),
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    console.error('[Messenger Send Error]', data)

    throw new Error(
      data?.error?.message ||
        'Messenger rejected the message'
    )
  }

  return {
    messageId: data.message_id as string,
  }
}

// ============================================================
// Instagram
// ============================================================

async function sendInstagramMessage({
  instagramAccountId,
  recipientId,
  accessToken,
  messageType,
  text,
  mediaUrl,
}: {
  instagramAccountId: string
  recipientId: string
  accessToken: string
  messageType: string
  text?: string
  mediaUrl?: string
}) {
  const url =
    `https://graph.facebook.com/${GRAPH_VERSION}/${instagramAccountId}/messages` +
    `?access_token=${encodeURIComponent(accessToken)}`

  let message: Record<string, unknown>

  if (messageType === 'text') {
    message = {
      text: text || '',
    }
  } else if (
    mediaUrl &&
    ['image', 'video', 'audio'].includes(messageType)
  ) {
    message = {
      attachment: {
        type: messageType,
        payload: {
          url: mediaUrl,
        },
      },
    }
  } else {
    throw new Error(
      `Instagram does not support message type "${messageType}" yet`
    )
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      recipient: {
        id: recipientId,
      },
      message,
    }),
  })

  const data = await response.json()

  if (!response.ok || data.error) {
    console.error('[Instagram Send Error]', data)

    throw new Error(
      data?.error?.message ||
        'Instagram rejected the message'
    )
  }

  return {
    messageId: data.message_id as string,
  }
}

// ============================================================
// Save outbound Meta message
// ============================================================

async function saveOutboundMessage({
  supabase,
  conversationId,
  contentType,
  contentText,
  mediaUrl,
  messageId,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>
  conversationId: string
  contentType: string
  contentText?: string
  mediaUrl?: string
  messageId: string
}) {
  const { error } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_type: 'agent',
      content_type: contentType,
      content_text: contentText || null,
      media_url: mediaUrl || null,
      message_id: messageId,
      status: 'sent',
    })

  if (error) {
    console.error(
      '[Meta Send] Error saving outbound message:',
      error
    )
  }

  await supabase
    .from('conversations')
    .update({
      last_message_text: contentText || '',
      last_message_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', conversationId)
}