import { NextResponse } from "next/server"
import { requireRole, toErrorResponse } from "@/lib/auth/account"
import { supabaseAdmin } from "@/lib/automations/admin-client"

export async function GET() {
  try {
    const ctx = await requireRole("agent")
    const admin = supabaseAdmin()

    const { data, error } = await admin
      .from("automation_folders")
      .select("id, name, parent_id, created_at, updated_at")
      .eq("account_id", ctx.accountId)
      .order("created_at", { ascending: true })

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ folders: data ?? [] })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function POST(request: Request) {
  try {
    const ctx = await requireRole("agent")
    const body = await request.json().catch(() => null)

    const name =
      typeof body?.name === "string"
        ? body.name.trim()
        : ""

    const parentId =
      typeof body?.parent_id === "string"
        ? body.parent_id
        : null

    if (!name) {
      return NextResponse.json(
        { error: "Folder name is required" },
        { status: 400 },
      )
    }

    if (name.length > 100) {
      return NextResponse.json(
        { error: "Folder name is too long" },
        { status: 400 },
      )
    }

    const admin = supabaseAdmin()

    // Si se está creando dentro de otra carpeta,
    // comprobamos que pertenezca a la misma cuenta.
    if (parentId) {
      const { data: parent, error: parentError } = await admin
        .from("automation_folders")
        .select("id")
        .eq("id", parentId)
        .eq("account_id", ctx.accountId)
        .maybeSingle()

      if (parentError) {
        return NextResponse.json(
          { error: parentError.message },
          { status: 500 },
        )
      }

      if (!parent) {
        return NextResponse.json(
          { error: "Parent folder not found" },
          { status: 404 },
        )
      }
    }

    const { data, error } = await admin
      .from("automation_folders")
      .insert({
        account_id: ctx.accountId,
        name,
        parent_id: parentId,
      })
      .select("id, name, parent_id, created_at, updated_at")
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json(
      { folder: data },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function PATCH(request: Request) {
  try {
    const ctx = await requireRole("agent")
    const body = await request.json().catch(() => null)

    const id =
      typeof body?.id === "string"
        ? body.id
        : ""

    if (!id) {
      return NextResponse.json(
        { error: "Folder id is required" },
        { status: 400 },
      )
    }

    const updates: {
      name?: string
      parent_id?: string | null
    } = {}

    if (typeof body?.name === "string") {
      const name = body.name.trim()

      if (!name) {
        return NextResponse.json(
          { error: "Folder name is required" },
          { status: 400 },
        )
      }

      if (name.length > 100) {
        return NextResponse.json(
          { error: "Folder name is too long" },
          { status: 400 },
        )
      }

      updates.name = name
    }

    if ("parent_id" in body) {
      updates.parent_id =
        typeof body.parent_id === "string"
          ? body.parent_id
          : null
    }

    const admin = supabaseAdmin()

    // Verificar que la carpeta exista en la cuenta.
    const { data: folder, error: folderError } = await admin
      .from("automation_folders")
      .select("id, parent_id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle()

    if (folderError) {
      return NextResponse.json(
        { error: folderError.message },
        { status: 500 },
      )
    }

    if (!folder) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 },
      )
    }

    // Evitar que una carpeta sea su propio padre.
    if (updates.parent_id === id) {
      return NextResponse.json(
        { error: "A folder cannot be its own parent" },
        { status: 400 },
      )
    }

    // Verificar que el nuevo padre pertenezca a la misma cuenta.
    if (updates.parent_id) {
      const { data: parent, error: parentError } = await admin
        .from("automation_folders")
        .select("id")
        .eq("id", updates.parent_id)
        .eq("account_id", ctx.accountId)
        .maybeSingle()

      if (parentError) {
        return NextResponse.json(
          { error: parentError.message },
          { status: 500 },
        )
      }

      if (!parent) {
        return NextResponse.json(
          { error: "Parent folder not found" },
          { status: 404 },
        )
      }
    }

    const { data, error } = await admin
      .from("automation_folders")
      .update(updates)
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .select("id, name, parent_id, created_at, updated_at")
      .single()

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ folder: data })
  } catch (err) {
    return toErrorResponse(err)
  }
}

export async function DELETE(request: Request) {
  try {
    const ctx = await requireRole("agent")
    const body = await request.json().catch(() => null)

    const id =
      typeof body?.id === "string"
        ? body.id
        : ""

    if (!id) {
      return NextResponse.json(
        { error: "Folder id is required" },
        { status: 400 },
      )
    }

    const admin = supabaseAdmin()

    const { data: folder, error: folderError } = await admin
      .from("automation_folders")
      .select("id")
      .eq("id", id)
      .eq("account_id", ctx.accountId)
      .maybeSingle()

    if (folderError) {
      return NextResponse.json(
        { error: folderError.message },
        { status: 500 },
      )
    }

    if (!folder) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 },
      )
    }

    // No permitimos borrar una carpeta que todavía tenga subcarpetas.
    const { count: childCount, error: childError } = await admin
      .from("automation_folders")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", id)
      .eq("account_id", ctx.accountId)

    if (childError) {
      return NextResponse.json(
        { error: childError.message },
        { status: 500 },
      )
    }

    if ((childCount ?? 0) > 0) {
      return NextResponse.json(
        {
          error:
            "Cannot delete a folder that contains subfolders. Move or delete the subfolders first.",
        },
        { status: 409 },
      )
    }

    // Las automatizaciones NO se eliminan.
    // Al borrar la carpeta quedan sin carpeta.
    const { error: moveError } = await admin
      .from("automations")
      .update({ folder_id: null })
      .eq("folder_id", id)
      .eq("account_id", ctx.accountId)

    if (moveError) {
      return NextResponse.json(
        { error: moveError.message },
        { status: 500 },
      )
    }

    const { error: deleteError } = await admin
      .from("automation_folders")
      .delete()
      .eq("id", id)
      .eq("account_id", ctx.accountId)

    if (deleteError) {
      return NextResponse.json(
        { error: deleteError.message },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true })
  } catch (err) {
    return toErrorResponse(err)
  }
}