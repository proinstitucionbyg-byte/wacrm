import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";

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
    return new NextResponse(challenge, { status: 200 });
  }

  console.error("[Instagram Webhook] Verificación rechazada");

  return NextResponse.json(
    { error: "Verification failed" },
    { status: 403 }
  );
}

/**
 * POST
 * Recibe eventos enviados por Instagram.
 */
export async function POST(request: NextRequest) {
  try {
    const rawBody = await request.text();

    // ----------------------------------------------------------
    // Validar firma de Meta
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
        !crypto.timingSafeEqual(signatureBuffer, expectedBuffer)
      ) {
        console.error("[Instagram Webhook] Firma inválida");

        return NextResponse.json(
          { error: "Invalid signature" },
          { status: 403 }
        );
      }
    }

    // ----------------------------------------------------------
    // Parsear evento
    // ----------------------------------------------------------

    const body = JSON.parse(rawBody);

    console.log(
      "[Instagram Webhook] Evento recibido:",
      JSON.stringify(body, null, 2)
    );

    // Por ahora solamente confirmamos recepción.
    // Luego conectaremos esto con el CRM.

    return NextResponse.json({ received: true }, { status: 200 });
  } catch (error) {
    console.error("[Instagram Webhook] Error:", error);

    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}