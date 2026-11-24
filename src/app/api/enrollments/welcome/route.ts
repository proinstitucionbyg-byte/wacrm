import {previewEnrollmentIntake} from '@/lib/matriculas/intake-preview';
import {loadAcademicCalendar} from '@/lib/matriculas/calendar';
import type {IntakeEvidence} from '@/lib/matriculas/auto-intake';
import { NextResponse } from 'next/server';
import { canInAccount, requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { UUID_PATTERN } from '@/lib/team-chat';
import { enrollmentIssues, type EnrollmentData } from '@/lib/matriculas/enrollment';
import { manualDocumentDelivery } from '@/lib/matriculas/manual-document-delivery';
export async function GET(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'view');
    const conversation = new URL(request.url).searchParams.get('conversation');
    if (!UUID_PATTERN.test(conversation ?? ''))
      return NextResponse.json({ error: 'Chat invalido' }, { status: 400 });
    const { data, error } = await ctx.supabase
      .from('enrollment_sequence_runs')
      .select(
        'id,stage,welcome_due_at,completed_at,completed_by,backup_sent_at,status'
      )
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', conversation)
      .in('stage', ['final', 'provisional'])
      .neq('status', 'closed')
      .order('started_at', { ascending: false })
      .limit(1);
    if (error) throw error;
    const { data: draft, error: draftError } = await ctx.supabase
      .from('enrollment_drafts')
      .select('id,version,data,status,review_id,conversation_id,error')
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', conversation)
      .in('status', ['collecting','error'])
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (draftError) throw draftError;
    const { data: enrollment, error: enrollmentError } = await ctx.supabase
      .from('enrollment_drafts')
      .select('id,version,status,registered_number,student_folder_url,manual_document_delivery,error')
      .eq('account_id', ctx.accountId)
      .eq('conversation_id', conversation)
      .in('status', ['ready', 'processing', 'registered', 'error'])
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (enrollmentError) throw enrollmentError;
    let documentDeliveries: Array<{ kind: string; status: string }> = [];
    if (enrollment?.status === 'registered') {
      const { data: deliveries, error: deliveriesError } = await ctx.supabase
        .from('enrollment_document_deliveries')
        .select('kind,status')
        .eq('account_id', ctx.accountId)
        .eq('enrollment_id', enrollment.id);
      if (deliveriesError) throw deliveriesError;
      documentDeliveries = deliveries ?? [];
    }
    let intake = null;
    let identityCandidates: Array<{
      id: string;
      created_at: string;
      category: string | null;
      fields: Record<string, unknown>;
    }> = [];
    let declarationCandidates: Array<{ id: string; created_at: string; content_text: string }> = [];
    if (draft) {
      const { data: review, error: reviewError } = await ctx.supabase
        .from('payment_reviews')
        .select('status,payment_purpose,evidence,created_at')
        .eq('id', draft.review_id)
        .eq('account_id', ctx.accountId)
        .maybeSingle();
      if (reviewError) throw reviewError;
      if (review?.status === 'validated' && review.payment_purpose === 'enrollment'
          && await canInAccount(ctx, 'enrollments', 'edit')) {
        if (draft.conversation_id) {
          const {data: latestMessages,error: latestError}=await ctx.supabase.from('messages')
            .select('id,content_text,media_url,image_analysis,sender_type,ai_generated,created_at')
            .eq('conversation_id',draft.conversation_id).order('created_at',{ascending:false}).limit(250);
          if(latestError)throw latestError;
          const calendar=(draft.data as EnrollmentData).start_date?[]:await loadAcademicCalendar(ctx.supabase,ctx.accountId);
          draft.data=previewEnrollmentIntake(draft.data as EnrollmentData,review.evidence?.fields??{},(latestMessages??[]) as IntakeEvidence[],calendar,review.created_at);

          const images=(latestMessages??[]).filter(message=>message.sender_type==='customer');
          identityCandidates = (images ?? [])
            .filter((image) => image.image_analysis?.category === 'identity_document')
            .slice(0, 4)
            .map((image) => ({
              id: image.id,
              created_at: image.created_at,
              category: image.image_analysis?.category ?? null,
              fields: image.image_analysis?.fields ?? {},
            }));
          const written=(latestMessages??[]).filter(message=>message.sender_type==='customer');
          declarationCandidates = (written ?? [])
            .filter((message) => typeof message.content_text === 'string' && message.content_text.trim())
            .slice(0, 40)
            .map((message) => ({ id: message.id, created_at: message.created_at, content_text: message.content_text! }));
        }
        intake = {
          id: draft.id,
          version: draft.version,
          status: draft.status,
          error: draft.error,
          data: draft.data as EnrollmentData,
          issues: enrollmentIssues(draft.data as EnrollmentData),
          can_edit: await canInAccount(ctx, 'enrollments', 'edit'),
          identity_candidates: identityCandidates,
          declaration_candidates: declarationCandidates,
        };
      }
    }
    return NextResponse.json({
      tasks: data ?? [],
      intake,
      enrollment: enrollment
        ? {
            id: enrollment.id,
            version: enrollment.version,
            can_edit_delivery: await canInAccount(ctx, 'enrollments', 'edit'),
            manual_delivery: manualDocumentDelivery(enrollment.manual_document_delivery, enrollment.student_folder_url),
            status: enrollment.status,
            error: enrollment.error,
            registered_number: enrollment.registered_number,
            student_folder_url:
              enrollment.student_folder_url?.startsWith(
                'https://drive.google.com/drive/folders/'
              )
                ? enrollment.student_folder_url
                : null,
            documents: documentDeliveries,
          }
        : null,
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function POST(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'send');
    const body = await request.json().catch(() => null);
    if (!UUID_PATTERN.test(body?.id ?? ''))
      return NextResponse.json(
        { error: 'Bienvenida invalida' },
        { status: 400 }
      );
    const { data, error } = await ctx.supabase.rpc(
      'complete_enrollment_welcome',
      { p_id: body.id }
    );
    if (error)
      return NextResponse.json(
        {
          error:
            'No puedes marcar esta bienvenida o ya vencieron las dos horas.',
        },
        { status: 403 }
      );
    return NextResponse.json(data);
  } catch (error) {
    return toErrorResponse(error);
  }
}
