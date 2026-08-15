import { NextResponse } from "next/server";

const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (
    mode === "subscribe" &&
    token &&
    VERIFY_TOKEN &&
    token === VERIFY_TOKEN
  ) {
    return new Response(challenge ?? "", { status: 200 });
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[Messenger Webhook] Error:", error);

    return NextResponse.json(
      { ok: false },
      { status: 400 }
    );
  }
}