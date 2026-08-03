import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { decrypt } from "@/lib/whatsapp/encryption";
import { getCatalogs } from "@/lib/whatsapp/meta-api";

async function resolveAccountId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string | null> {
  const { data } = await supabase
    .from("profiles")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();

  return data?.account_id ?? null;
}

export async function GET() {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json(
        { success: false, message: "Unauthorized" },
        { status: 401 },
      );
    }

    const accountId = await resolveAccountId(supabase, user.id);

    if (!accountId) {
      return NextResponse.json(
        { success: false, message: "Account not found" },
        { status: 404 },
      );
    }

    const { data: config, error } = await supabase
      .from("whatsapp_config")
      .select("waba_id, access_token")
      .eq("account_id", accountId)
      .maybeSingle();

    if (error || !config) {
      return NextResponse.json(
        { success: false, message: "WhatsApp configuration not found" },
        { status: 404 },
      );
    }

    const accessToken = decrypt(config.access_token);

    const catalogs = await getCatalogs({
      businessId: config.waba_id,
      accessToken,
    });

    return NextResponse.json({
      success: true,
      data: catalogs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 },
    );
  }
}