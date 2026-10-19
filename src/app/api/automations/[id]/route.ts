import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { toErrorResponse } from '@/lib/auth/account'
import { requirePermission } from '@/lib/auth/permissions'
import { supabaseAdmin } from '@/lib/automations/admin-client'
import {
  loadStepsTree,
  type BuilderStepInput,
} from '@/lib/automations/steps-tree'
import {automationSnapshot,buildSaveImpact,snapshotHash} from '@/lib/automations/save-impact'
import {
  validateStepsForActivation,
  validateTriggerForActivation,
} from '@/lib/automations/validate'

async function requireUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try { await requirePermission('automations', 'view') } catch (err) { return toErrorResponse(err) }
  const { id } = await params
  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = supabaseAdmin()
  const { data: automation, error } = await admin
    .from('automations')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!automation) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const steps = await loadStepsTree(id)
  const {data: flat,error: flatError}=await admin.from('automation_steps').select('*').eq('automation_id',id).order('id')
  if(flatError)return NextResponse.json({error:flatError.message},{status:500})
  return NextResponse.json({ automation, steps, steps_revision:snapshotHash(flat??[]) })
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Editing an automation is a write — the RLS automations_update policy
  // requires `agent`, but this route mutates via the service-role client
  // which bypasses RLS, so enforce the role here.
  try {
    await requirePermission('automations', 'edit')
  } catch (err) {
    return toErrorResponse(err)
  }

  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })

  const admin = supabaseAdmin()

  // Ownership check before we touch anything. Load the fields we need
  // to compute the post-patch "effective" state for validation.
  const { data: existing } = await admin
    .from('automations')
    .select('id, user_id, account_id, is_active, trigger_type, trigger_config')
    .eq('id', id)
    .maybeSingle()
  if (!existing || existing.user_id !== user.id) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const update: Record<string, unknown> = {}
  for (const k of [
  'name',
  'description',
  'trigger_type',
  'trigger_config',
  'is_active',
  'folder_id',
] as const) {
  if (k in body) update[k] = body[k]
}

  // If this PATCH leaves the automation active (either explicitly
  // activating it OR editing an already-active one), validate the
  // merged configuration first. Activation is the natural gate — drafts
  // are still allowed to be incomplete.
  const willBeActive =
    typeof update.is_active === 'boolean' ? update.is_active : existing.is_active
  if (willBeActive) {
    const mergedTriggerType = (update.trigger_type ?? existing.trigger_type) as string
    const mergedTriggerConfig = update.trigger_config ?? existing.trigger_config
    const mergedSteps = Array.isArray(body.steps)
      ? (body.steps as { step_type: string; step_config: Record<string, unknown> }[])
      : await loadStepsTree(id)
    const issues = [
      ...validateTriggerForActivation(mergedTriggerType, mergedTriggerConfig),
      ...validateStepsForActivation(mergedSteps),
    ]
    if (issues.length > 0) {
      return NextResponse.json(
        {
          error: 'Cannot keep automation active with invalid configuration',
          issues,
        },
        { status: 400 },
      )
    }
  }

  if (Array.isArray(body.steps)) {
    try {
      const snapshot=await automationSnapshot(existing.account_id,id)
      const plan=buildSaveImpact(snapshot,body.steps as BuilderStepInput[],update)
      if(body.steps_revision!==plan.revision)return NextResponse.json({error:'Los bloques cambiaron o este editor es antiguo. Recarga antes de guardar.'},{status:409})
      if(body.preview)return NextResponse.json({token:plan.token,impacts:plan.impacts,problems:plan.problems,summary:plan.summary})
      if(plan.problems.length)return NextResponse.json({error:plan.problems[0],problems:plan.problems},{status:409})
      if(plan.impacts.length && body.impact_token!==plan.token)return NextResponse.json({error:'Revisa y acepta la actualización de los enlaces antes de guardar.'},{status:409})
      if(body.impact_token && body.impact_token!==plan.token)return NextResponse.json({error:'Los datos cambiaron desde la revisión. Vuelve a guardar para ver la lista actualizada.'},{status:409})
      const {error:saveError}=await admin.rpc('save_automation_with_references',{
        p_account:existing.account_id,p_id:id,p_expected:snapshot.expected,p_update:update,
        p_steps:plan.rows,p_links:plan.patches,p_pending:plan.pendingPatches,p_structural:plan.structural,
      })
      if(saveError)return NextResponse.json({error:saveError.message},{status:409})
      const {data:flat,error:flatError}=await admin.from('automation_steps').select('*').eq('automation_id',id).order('id')
      if(flatError)return NextResponse.json({error:flatError.message},{status:500})
      return NextResponse.json({ok:true,steps:await loadStepsTree(id),steps_revision:snapshotHash(flat??[])})
    }catch(error){return NextResponse.json({error:error instanceof Error?error.message:'No se pudo revisar el cambio.'},{status:400})}
  }

  if (Object.keys(update).length > 0) {
    const { error: updErr } = await admin
      .from('automations')
      .update(update)
      .eq('id', id)
    if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params

  // Deleting an automation is a write — enforce `agent` (the service-role
  // client below bypasses the agent-gated automations_delete RLS).
  try {
    await requirePermission('automations', 'delete')
  } catch (err) {
    return toErrorResponse(err)
  }

  const user = await requireUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { error } = await supabaseAdmin()
    .from('automations')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
