import { NextResponse } from "next/server"
import { toErrorResponse } from "@/lib/auth/account"
import { requirePermission } from "@/lib/auth/permissions"
import { supabaseAdmin } from "@/lib/automations/admin-client"

export async function POST(request: Request) {
  try {
    const ctx = await requirePermission("automations", "create")
    const body = await request.json().catch(() => null)

    const sourceId =
      typeof body?.id === "string"
        ? body.id
        : ""

    if (!sourceId) {
      return NextResponse.json(
        { error: "Folder id is required" },
        { status: 400 },
      )
    }

    const admin = supabaseAdmin()

    // 1. Buscar la carpeta original
    const { data: sourceFolder, error: sourceError } = await admin
      .from("automation_folders")
      .select("id, name, parent_id")
      .eq("id", sourceId)
      .eq("account_id", ctx.accountId)
      .maybeSingle()

    if (sourceError) {
      return NextResponse.json(
        { error: sourceError.message },
        { status: 500 },
      )
    }

    if (!sourceFolder) {
      return NextResponse.json(
        { error: "Folder not found" },
        { status: 404 },
      )
    }

    // 2. Crear la copia de la carpeta
    const { data: newFolder, error: createError } = await admin
      .from("automation_folders")
      .insert({
        account_id: ctx.accountId,
        name: `${sourceFolder.name} (Copia)`,
        parent_id: sourceFolder.parent_id,
      })
      .select("id, name, parent_id, created_at, updated_at")
      .single()

    if (createError || !newFolder) {
      return NextResponse.json(
        { error: createError?.message ?? "Could not duplicate folder" },
        { status: 500 },
      )
    }

    // 3. Obtener las automatizaciones de la carpeta original
    const { data: automations, error: automationsError } = await admin
      .from("automations")
      .select("*")
      .eq("account_id", ctx.accountId)
      .eq("folder_id", sourceFolder.id)

    if (automationsError) {
      // Si falla, eliminamos la carpeta recién creada
      await admin
        .from("automation_folders")
        .delete()
        .eq("id", newFolder.id)
        .eq("account_id", ctx.accountId)

      return NextResponse.json(
        { error: automationsError.message },
        { status: 500 },
      )
    }

    const createdIds: string[] = []
    const cleanupCopy = async () => {
      if (createdIds.length) await admin.from("automations").delete().in("id", createdIds).eq("account_id", ctx.accountId)
      await admin.from("automation_folders").delete().eq("id", newFolder.id).eq("account_id", ctx.accountId)
    }
    // 4. Duplicar las automatizaciones y sus pasos, sin activarlas.
    for (const automation of automations ?? []) {
      const {
        id,
        created_at,
        updated_at,
        ...automationData
      } = automation

      const { data: newAutomation, error: automationError } = await admin
        .from("automations")
        .insert({
          ...automationData,
          account_id: ctx.accountId,
          folder_id: newFolder.id,
          name: `${automation.name} (Copia)`,
          is_active: false,
        })
        .select("id")
        .single()

      if (automationError || !newAutomation) {
        await cleanupCopy()
        return NextResponse.json(
          {
            error:
              automationError?.message ??
              "Could not duplicate automation",
          },
          { status: 500 },
        )
      }
      createdIds.push(newAutomation.id)
      const { data: steps, error: stepsError } = await admin.from("automation_steps")
        .select("id, parent_step_id, branch, step_type, step_config, position")
        .eq("automation_id", automation.id)
      if (stepsError) {
        await cleanupCopy()
        return NextResponse.json({ error: stepsError.message }, { status: 500 })
      }
      if (steps?.length) {
        const ids = new Map(steps.map(step => [step.id, crypto.randomUUID()]))
        const rows = steps.map(step => ({ ...step, id: ids.get(step.id), automation_id: newAutomation.id,
          parent_step_id: step.parent_step_id ? ids.get(step.parent_step_id) : null }))
        const { error: copyStepsError } = await admin.from("automation_steps").insert(rows)
        if (copyStepsError) {
          await cleanupCopy()
          return NextResponse.json({ error: copyStepsError.message }, { status: 500 })
        }
      }
    }

    return NextResponse.json(
      {
        folder: newFolder,
        duplicatedAutomations: automations?.length ?? 0,
      },
      { status: 201 },
    )
  } catch (err) {
    return toErrorResponse(err)
  }
}
