import { requireApiKey } from '@/lib/auth/api-context';
import { ok, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseAcademicModules } from '@/lib/matriculas/calendar';
import { collectConversationEnrollments } from '@/lib/matriculas/collect';
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const body = await request.json().catch(() => null);
    const modules = parseAcademicModules(body?.modules);
    if (!modules || typeof body.source_url !== 'string' || !/^https:\/\/docs\.google\.com\/spreadsheets\/d\/[\w-]+\/edit(?:[?#][\w=&-]*)?$/.test(body.source_url)) throw badRequest('Revisa los cinco cursos y las dos fechas de cada cuadro.');
    const { data: pending, error: pendingError } = await ctx.supabase.from('teacher_reschedule_requests').select('id,course,class_date').eq('account_id',ctx.accountId).eq('status','queued');
    if (pendingError) throw pendingError;
    const applied: unknown[] = Array.isArray(body.applied_cancellations) ? body.applied_cancellations : [];
    // Never let an older periodic snapshot overwrite a cancellation being processed.
    if ((pending ?? []).some(job => !applied.includes(job.id))) return ok({ synced: 0, deferred: true });
    if ((pending ?? []).some(job => modules.some(m => m.course === job.course && m.class_dates.includes(job.class_date)))) throw badRequest('La clase cancelada sigue incluida en el cuadro.');
    const { error } = await ctx.supabase.rpc('sync_academic_calendar', { p_account: ctx.accountId, p_modules: modules, p_source: body.source_url });
    if (error) throw error;
    if (pending?.length) {
      const done = await ctx.supabase.from('teacher_reschedule_requests').update({status:'applied',applied_at:new Date().toISOString()}).eq('account_id',ctx.accountId).in('id',pending.map(job=>job.id)).eq('status','queued');
      if (done.error) throw done.error;
    }
    const { data: drafts, error: draftError } = await ctx.supabase.from('enrollment_drafts').select('conversation_id').eq('account_id', ctx.accountId).eq('status', 'collecting').limit(50);
    if (draftError) throw draftError;
    for (const conversation of new Set((drafts ?? []).map((draft) => draft.conversation_id).filter((id): id is string => Boolean(id)))) await collectConversationEnrollments(ctx.supabase, ctx.accountId, conversation);
    return ok({ synced: modules.length });
  } catch (error) { return toApiErrorResponse(error); }
}
