import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  sendMessageToConversation,
  SendMessageError,
} from "@/lib/whatsapp/send-message";

export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json(
        { error: "Unauthorized" },
        { status: 401 },
      );
    }

    const { data: profile } = await supabase
      .from("profiles")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();

    const accountId = profile?.account_id;

    if (!accountId) {
      return NextResponse.json(
        { error: "Account not found" },
        { status: 403 },
      );
    }

    const { messageId, conversationId } = await req.json();

    const { data: message, error } = await supabase
      .from("messages")
      .select("*")
      .eq("id", messageId)
      .single();

    if (error || !message) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 },
      );
    }
    console.log("FORWARD MESSAGE");
console.log(message);
let mediaUrl = message.media_url;

if (
  mediaUrl &&
  mediaUrl.startsWith("/api/")
) {
  const origin = new URL(req.url).origin;
  mediaUrl = `${origin}${mediaUrl}`;
}

    const result = await sendMessageToConversation(
  supabase,
  accountId,
  {
    conversationId,
    messageType: message.content_type,
    contentText: message.content_text,
    mediaUrl: message.media_url,
    templateName: message.template_name,
    interactivePayload: message.interactive_payload,
    replyToMessageId: message.reply_to_message_id,
  },
);

    return NextResponse.json({
      success: true,
      message_id: result.messageId,
      whatsapp_message_id: result.whatsappMessageId,
    });
  } catch (err) {
    if (err instanceof SendMessageError) {
      return NextResponse.json(
        { error: err.message },
        { status: err.status },
      );
    }

    console.error(err);

    return NextResponse.json(
      {
        error: "Failed to forward message",
      },
      {
        status: 500,
      },
    );
  }
}