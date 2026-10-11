import { requireApiKey } from '@/lib/auth/api-context';
import { ok, badRequest, toApiErrorResponse } from '@/lib/api/v1/respond';
import { parseTeachers } from '@/lib/matriculas/teachers';

/** Existing private Apps Script bridge only; no public teacher directory. */
export async function POST(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'enrollments:sync');
    const body = await request.json().catch(() => null), teachers = parseTeachers(body?.teachers);
    if (!teachers) throw badRequest('Revisa el directorio de docentes y sus números internacionales.');
    const { error } = await ctx.supabase.from('academic_teacher_directories').upsert({ account_id: ctx.accountId, teachers, updated_at: new Date().toISOString() });
    if (error) throw error;
    const { data: jobs, error: jobsError } = await ctx.supabase.from('teacher_reschedule_requests').select('id,course,class_date').eq('account_id',ctx.accountId).eq('status','queued').order('created_at').limit(25);
    if (jobsError) throw jobsError;
    return ok({ teachers: teachers.length, jobs: jobs ?? [] });
  } catch (error) { return toApiErrorResponse(error); }
}
