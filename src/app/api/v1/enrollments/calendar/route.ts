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
    const { error } = await ctx.supabase.rpc('sync_academic_calendar', { p_account: ctx.accountId, p_modules: modules, p_source: body.source_url });
    if (error) throw error;
    const { data: drafts, error: draftError } = await ctx.supabase.from('enrollment_drafts').select('conversation_id').eq('account_id', ctx.accountId).eq('status', 'collecting').limit(50);
    if (draftError) throw draftError;
    for (const conversation of new Set((drafts ?? []).map((draft) => draft.conversation_id).filter((id): id is string => Boolean(id)))) await collectConversationEnrollments(ctx.supabase, ctx.accountId, conversation);
    return ok({ synced: modules.length });
  } catch (error) { return toApiErrorResponse(error); }
}
