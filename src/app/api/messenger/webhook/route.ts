import { NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/automations/admin-client";

const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token === VERIFY_TOKEN &&
    challenge
  ) {
    return new Response(challenge, { status: 200 });
  }

  return new Response("Forbidden", { status: 403 });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    console.log(
      "[Messenger Webhook]",
      JSON.stringify(body, null, 2)
    );

    const entry = body?.entry?.[0];
    const messaging = entry?.messaging?.[0];

    if (!entry || !messaging) {
      return NextResponse.json({ ok: true });
    }

    const senderId = messaging?.sender?.id;
    const message = messaging?.message;

    if (!senderId || !message) {
      return NextResponse.json({ ok: true });
    }

    const text = message?.text ?? "";
    const messageId = message?.mid ?? null;

    const db = supabaseAdmin();

    // ------------------------------------------------------------
    // 1. Resolve account
    // ------------------------------------------------------------
    const { data: account, error: accountError } = await db
      .from("accounts")
      .select("id, owner_user_id")
      .limit(1)
      .single();

    if (accountError || !account) {
      console.error(
        "[Messenger Webhook] Account resolution error:",
        accountError
      );

      return NextResponse.json(
        { ok: false },
        { status: 500 }
      );
    }

    const accountId = account.id;
    const ownerUserId = account.owner_user_id;

    // ------------------------------------------------------------
    // 2. Find or create Messenger contact
    // ------------------------------------------------------------
    let { data: contact } = await db
      .from("contacts")
      .select("id, name")
      .eq("account_id", accountId)
      .eq("channel", "messenger")
      .eq("external_id", senderId)
      .maybeSingle();

    if (!contact) {
      const profileName =
        messaging?.sender?.name ??
        `Messenger ${senderId}`;

      const { data: createdContact, error: contactError } =
        await db
          .from("contacts")
          .insert({
            account_id: accountId,
            user_id: ownerUserId,
            phone: senderId,
            name: profileName,
            external_id: senderId,
            channel: "messenger",
          })
          .select("id, name")
          .single();

      if (contactError || !createdContact) {
        console.error(
          "[Messenger Webhook] Contact creation error:",
          contactError
        );

        return NextResponse.json(
          { ok: false },
          { status: 500 }
        );
      }

      contact = createdContact;
    }

    // ------------------------------------------------------------
    // 3. Find or create conversation
    // ------------------------------------------------------------
    let { data: conversation } = await db
      .from("conversations")
      .select("id")
      .eq("account_id", accountId)
      .eq("contact_id", contact.id)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!conversation) {
      const { data: createdConversation, error: conversationError } =
        await db
          .from("conversations")
          .insert({
            account_id: accountId,
            user_id: ownerUserId,
            contact_id: contact.id,
          })
          .select("id")
          .single();

      if (conversationError || !createdConversation) {
        console.error(
          "[Messenger Webhook] Conversation creation error:",
          conversationError
        );

        return NextResponse.json(
          { ok: false },
          { status: 500 }
        );
      }

      conversation = createdConversation;
    }

    // ------------------------------------------------------------
    // 4. Save inbound message
    // ------------------------------------------------------------
    if (messageId) {
      const { error: messageError } = await db
        .from("messages")
        .insert({
          conversation_id: conversation.id,
          sender_type: "contact",
          content_type: "text",
          content_text: text,
          message_id: messageId,
          status: "received",
        });

      if (messageError) {
        console.error(
          "[Messenger Webhook] Message insert error:",
          messageError
        );

        return NextResponse.json(
          { ok: false },
          { status: 500 }
        );
      }
    }

    // ------------------------------------------------------------
    // 5. Update conversation preview
    // ------------------------------------------------------------
    await db
      .from("conversations")
      .update({
        last_message_text: text,
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", conversation.id);

    console.log(
      "[Messenger Webhook] Message saved:",
      {
        accountId,
        contactId: contact.id,
        conversationId: conversation.id,
        senderId,
        messageId,
      }
    );

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error(
      "[Messenger Webhook] Error:",
      error
    );

    return NextResponse.json(
      { ok: false },
      { status: 400 }
    );
  }
}