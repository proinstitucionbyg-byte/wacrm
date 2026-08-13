import { NextResponse } from "next/server";
import { requireRole, toErrorResponse } from "@/lib/auth/account";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { userId } = await params;

    const { data, error } = await ctx.supabase.rpc(
      "get_member_permissions",
      {
        p_user_id: userId,
      },
    );

    if (error) {
      console.error("[member permissions] GET error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({
      permissions: data ?? [],
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  try {
    const ctx = await requireRole("admin");
    const { userId } = await params;

    const body = (await request.json().catch(() => null)) as
      | {
          module?: unknown;
          action?: unknown;
          allowed?: unknown;
        }
      | null;

    if (
      typeof body?.module !== "string" ||
      typeof body?.action !== "string" ||
      typeof body?.allowed !== "boolean"
    ) {
      return NextResponse.json(
        {
          error:
            "module, action y allowed son obligatorios",
        },
        { status: 400 },
      );
    }

    const { error } = await ctx.supabase.rpc(
      "set_member_permission",
      {
        p_user_id: userId,
        p_module: body.module,
        p_action: body.action,
        p_allowed: body.allowed,
      },
    );

    if (error) {
      console.error("[member permissions] PATCH error:", error);
      return NextResponse.json(
        { error: error.message },
        { status: 400 },
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}