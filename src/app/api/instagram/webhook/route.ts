import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "@/lib/automations/admin-client";

const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;
const APP_SECRET = process.env.META_APP_SECRET;

/**
 * GET
 * Verificación del webhook por Meta.
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === VERIFY_TOKEN && challenge) {
    console.log("[Instagram Webhook] Verificación correcta");

    return new NextResponse(challenge, {
      status: 200,
    });
  }

  console.error("[Instagram Webhook] Verificación rechazada");

  return NextResponse.json(
    { error: "Verification failed" },
    { status: 403 }
  );
}

/**
 * POST
 * Recibe mensajes entrantes de Instagram
 * y los guarda en el CRM.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // ----------------------------------------------------------
    // 1. Validar firma de Meta
    // ----------------------------------------------------------

    const signature = request.headers.get("x-hub-signature-256");

    if (APP_SECRET && signature) {
      const expectedSignature =
        "sha256=" +
        crypto
          .createHmac("sha256", APP_SECRET)
          .update(rawBody)
          .digest("hex");

      const signatureBuffer = Buffer.from(signature);
      const expectedBuffer = Buffer.from(expectedSignature);

      if (
        signatureBuffer.length !== expectedBuffer.length ||
        !crypto.timingSafeEqual(
          signatureBuffer,
          expectedBuffer
        )
      ) {
        console.error(
          "[Instagram Webhook] Firma inválida"
        );

        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 403 }
        );
      }
    }

    // ----------------------------------------------------------
    // 2. Parsear evento
    // ----------------------------------------------------------

    const body = JSON.parse(rawBody);

    console.log(
      "[Instagram Webhook] Evento recibido:",
      JSON.stringify(body, null, 2)
    );

    // Meta puede enviar varios entry/messaging en un mismo POST.
    const entries = Array.isArray(body?.entry)
      ? body.entry
      : [];

    if (entries.length === 0) {
      return NextResponse.json(
        { ok: true },
        { status: 200 }
      );
    }

    const db = supabaseAdmin();

    // ----------------------------------------------------------
    // 3. Resolver cuenta
    // ----------------------------------------------------------

    const { data: account, error: accountError } = await db
      .from("accounts")
      .select("id, owner_user_id")
      .limit(1)
      .single();

    if (accountError || !account) {
      console.error(
        "[Instagram Webhook] Account resolution error:",
        accountError
      );

      return NextResponse.json(
        { ok: false },
        { status: 500 }
      );
    }

    const accountId = account.id;
    const ownerUserId = account.owner_user_id;

    // ----------------------------------------------------------
    // 4. Procesar todos los eventos
    // ----------------------------------------------------------

    for (const entry of entries) {
      const messagingEvents = Array.isArray(entry?.messaging)
        ? entry.messaging
        : [];

      for (const event of messagingEvents) {
        const senderId = event?.sender?.id;
        const message = event?.message;

        // Ignorar eventos que no sean mensajes.
        if (!senderId || !message) {
          continue;
        }

        const text =
          typeof message?.text === "string"
            ? message.text
            : "";

        const messageId =
          typeof message?.mid === "string"
            ? message.mid
            : null;

        // Ignorar mensajes sin ID.
        if (!messageId) {
          continue;
        }

        // ------------------------------------------------------
        // 5. Buscar contacto de Instagram
        // ------------------------------------------------------

        let { data: contact, error: contactLookupError } =
          await db
            .from("contacts")
            .select("id, name")
            .eq("account_id", accountId)
            .eq("channel", "instagram")
            .eq("external_id", senderId)
            .maybeSingle();

        if (contactLookupError) {
          console.error(
            "[Instagram Webhook] Contact lookup error:",
            contactLookupError
          );

          continue;
        }

        // ------------------------------------------------------
        // 6. Crear contacto si no existe
        // ------------------------------------------------------

        if (!contact) {
          const profileName =
            event?.sender?.name ||
            `Instagram ${senderId}`;

          const {
            data: createdContact,
            error: contactCreateError,
          } = await db
            .from("contacts")
            .insert({
              account_id: accountId,
              user_id: ownerUserId,
              phone: senderId,
              name: profileName,
              external_id: senderId,
              channel: "instagram",
            })
            .select("id, name")
            .single();

          if (contactCreateError || !createdContact) {
            console.error(
              "[Instagram Webhook] Contact creation error:",
              contactCreateError
            );

            continue;
          }

          contact = createdContact;
        }

        // ------------------------------------------------------
        // 7. Buscar conversación existente
        // ------------------------------------------------------

        let { data: conversation, error: conversationLookupError } =
          await db
            .from("conversations")
            .select("id")
            .eq("account_id", accountId)
            .eq("contact_id", contact.id)
            .order("created_at", { ascending: true })
            .limit(1)
            .maybeSingle();

        if (conversationLookupError) {
          console.error(
            "[Instagram Webhook] Conversation lookup error:",
            conversationLookupError
          );

          continue;
        }

        // ------------------------------------------------------
        // 8. Crear conversación si no existe
        // ------------------------------------------------------

        if (!conversation) {
          const {
            data: createdConversation,
            error: conversationCreateError,
          } = await db
            .from("conversations")
            .insert({
              account_id: accountId,
              user_id: ownerUserId,
              contact_id: contact.id,
            })
            .select("id")
            .single();

          if (
            conversationCreateError ||
            !createdConversation
          ) {
            console.error(
              "[Instagram Webhook] Conversation creation error:",
              conversationCreateError
            );

            continue;
          }

          conversation = createdConversation;
        }

        // ------------------------------------------------------
        // 9. Evitar duplicados
        // ------------------------------------------------------

        const { data: existingMessage } = await db
          .from("messages")
          .select("id")
          .eq("conversation_id", conversation.id)
          .eq("message_id", messageId)
          .maybeSingle();

        if (existingMessage) {
          console.log(
            "[Instagram Webhook] Mensaje duplicado ignorado:",
            messageId
          );

          continue;
        }

        // ------------------------------------------------------
        // 10. Guardar mensaje entrante
        // ------------------------------------------------------

        const { error: messageError } = await db
          .from("messages")
          .insert({
            conversation_id: conversation.id,
            sender_type: "customer",
            content_type: "text",
            content_text: text,
            message_id: messageId,
            status: "delivered",
          });

        if (messageError) {
          console.error(
            "[Instagram Webhook] Message insert error:",
            messageError
          );

          continue;
        }

        // ------------------------------------------------------
        // 11. Actualizar conversación
        // ------------------------------------------------------

        const now = new Date().toISOString();

        await db
          .from("conversations")
          .update({
            last_message_text: text,
            last_message_at: now,
            updated_at: now,
          })
          .eq("id", conversation.id);

        console.log(
          "[Instagram Webhook] Message saved:",
          {
            accountId,
            contactId: contact.id,
            conversationId: conversation.id,
            senderId,
            messageId,
            text,
          }
        );
      }
    }

    // ----------------------------------------------------------
    // 12. Responder OK a Meta
    // ----------------------------------------------------------

    return NextResponse.json(
      { ok: true },
      { status: 200 }
    );
  } catch (error) {
    console.error(
      "[Instagram Webhook] Error:",
      error
    );

    return NextResponse.json(
      { ok: false },
      { status: 500 }
    );
  }
}