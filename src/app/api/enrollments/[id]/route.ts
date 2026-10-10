import { NextResponse } from 'next/server';
import { toErrorResponse } from '@/lib/auth/account';
import { requirePermission } from '@/lib/auth/permissions';
import {
  parseEnrollmentData,
  enrollmentIssues,
} from '@/lib/matriculas/enrollment';
import { declarationEvidence } from '@/lib/matriculas/identity-evidence';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('enrollments', 'view');
    const { id } = await params;
    const { data: draft, error } = await ctx.supabase
      .from('enrollment_drafts')
      .select('*')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (error) throw error;
    if (!draft)
      return NextResponse.json(
        { error: 'Matrícula no encontrada' },
        { status: 404 }
      );
    const { data: images, error: imagesError } = await ctx.supabase
      .from('messages')
      .select('id,media_url,image_analysis,created_at')
      .eq('conversation_id', draft.conversation_id)
      .eq('sender_type', 'customer')
      .eq('content_type', 'image')
      .order('created_at', { ascending: false })
      .limit(30);
    if (imagesError) throw imagesError;
    const { data: documents, error: documentsError } = await ctx.supabase
      .from('enrollment_document_deliveries')
      .select('kind,status,sent_at,error')
      .eq('enrollment_id', id)
      .eq('account_id', ctx.accountId);
    if (documentsError) throw documentsError;
    return NextResponse.json({
      draft,
      images: images ?? [],
      documents: documents ?? [],
      issues: enrollmentIssues(draft.data),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = await requirePermission('enrollments', 'edit');
    const { id } = await params;
    const body = await request.json().catch(() => null);
    const data = parseEnrollmentData(body?.data);
    if (!data || !Number.isSafeInteger(body?.version) || body.version < 1)
      return NextResponse.json({ error: 'Datos inválidos' }, { status: 400 });
    const { data: existing, error: readError } = await ctx.supabase
      .from('enrollment_drafts')
      .select('conversation_id,status')
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .maybeSingle();
    if (readError) throw readError;
    if (!existing)
      return NextResponse.json({ error: 'No encontrada' }, { status: 404 });
    if (['processing', 'registered'].includes(existing.status))
      return NextResponse.json(
        { error: 'La matrícula está en proceso o ya fue registrada.' },
        { status: 409 }
      );
    if (data.identity_message_ids?.length) {
      const { data: images, error } = await ctx.supabase
        .from('messages')
        .select('id,image_analysis')
        .eq('conversation_id', existing.conversation_id)
        .eq('sender_type', 'customer')
        .eq('content_type', 'image')
        .in('id', data.identity_message_ids);
      if (error) throw error;
      if (images?.length !== data.identity_message_ids.length)
        return NextResponse.json(
          { error: 'Las fotos deben pertenecer a esta conversación.' },
          { status: 400 }
        );
      if (
        images.some(
          (image) => image.image_analysis?.category === 'payment_receipt'
        )
      )
        return NextResponse.json(
          {
            error:
              'El voucher no sustituye las fotos del documento de identidad.',
          },
          { status: 400 }
        );
    }
    if (data.declaration_message_ids?.length) {
      const {data: declarations,error: declarationError}=await ctx.supabase.from('messages').select('id,content_text').eq('conversation_id',existing.conversation_id).eq('sender_type','customer').eq('content_type','text').in('id',data.declaration_message_ids);
      if (declarationError) throw declarationError;
      if (declarations?.length !== data.declaration_message_ids.length || declarationEvidence(data,declarations).length !== declarations.length)
        return NextResponse.json({error:'El respaldo debe contener nombre, documento y correo escritos por el estudiante en este chat.'},{status:400});
    }
    if (data.guardian_message_ids?.length) {
      const {data: guardians,error: guardianError}=await ctx.supabase.from('messages').select('id,image_analysis').eq('conversation_id',existing.conversation_id).eq('sender_type','customer').eq('content_type','image').in('id',data.guardian_message_ids);
      if (guardianError) throw guardianError;
      if(guardians?.length!==data.guardian_message_ids.length || guardians.some(image=>image.image_analysis?.category==='payment_receipt'))
        return NextResponse.json({error:'Selecciona las fotos del documento del tutor o padres de este chat.'},{status:400});
    }
    const { data: saved, error } = await ctx.supabase
      .from('enrollment_drafts')
      .update({ data })
      .eq('id', id)
      .eq('account_id', ctx.accountId)
      .eq('version', body.version)
      .select('*')
      .maybeSingle();
    if (error) throw error;
    if (!saved)
      return NextResponse.json(
        { error: 'Otra persona cambió la ficha. Actualiza antes de guardar.' },
        { status: 409 }
      );
    return NextResponse.json({ draft: saved, issues: enrollmentIssues(data) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
