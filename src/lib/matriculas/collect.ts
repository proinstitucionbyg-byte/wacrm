import type { SupabaseClient } from '@supabase/supabase-js';
import {
  collectEnrollmentData,
  collectPaymentData,
  type IntakeMessage,
} from './collect-data';
import { prepareAutomaticIntake, type IntakeEvidence } from './auto-intake';
import { loadAcademicCalendar } from './calendar';
import { enrollmentIssues } from './enrollment';
import { manualEvidenceMatches } from './manual-evidence';
import { syncPaidEnrollmentHandoff } from './paid-intake-handoff';

/** Only queues a complete, consistent intake after human payment validation. */
export async function collectConversationEnrollments(
  db: SupabaseClient,
  accountId: string,
  conversationId: string,
  selectedDraftId?: string
) {
  const { data: drafts, error } = await db
    .from('enrollment_drafts')
    .select('id,review_id,data,version')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'collecting');
  if (error) throw error;
  // Several simultaneous enrollments need an explicit association, not a guess.
  if (!selectedDraftId && drafts?.length !== 1) return;
  const draft = selectedDraftId
    ? drafts?.find((item) => item.id === selectedDraftId)
    : drafts?.[0];
  // An explicit draft id is already an unambiguous association. Newly
  // validated payments start with payment fields only, so requiring a course
  // here prevented us from reading the student's earlier chat and left the
  // enrollment permanently in `collecting`.
  if (!draft) return;
  const { data: review, error: reviewError } = await db
    .from('payment_reviews')
    .select('status,created_at,evidence,payment_purpose')
    .eq('id', draft.review_id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (review?.status !== 'validated'||['tuition','other'].includes(review.payment_purpose)) return;
  // Include data sent before the voucher. Contradictory written/photo values stay pending.
  const { data: messages, error: messageError } = await db
    .from('messages')
    .select(
      'id,content_text,media_url,image_analysis,sender_type,ai_generated,created_at'
    )
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    // Keep the original course-selection message available even after a long
    // automation. A paid lead can easily exceed 100 text/media blocks before
    // the voucher is validated.
    .limit(250);
  if (messageError) throw messageError;
  const evidence = (messages ?? []) as IntakeEvidence[];
  let next = collectEnrollmentData(
    collectPaymentData(draft.data, review.evidence?.fields),
    evidence.filter(
      (message) => message.sender_type === 'customer' || !message.sender_type
    ) as IntakeMessage[]
  );
  if (next.course)
    next = prepareAutomaticIntake(
      next,
      evidence,
      await loadAcademicCalendar(db, accountId),
      review.created_at
    );
  // Staff confirmation is a private, attributed record, not a fabricated chat message.
  // Re-reading later chat must not erase it or revive old contradictory OCR.
  if (draft.data.declaration_message_ids?.length) {
    const {data: uploads,error: uploadError} = await db.from('enrollment_uploads').select('id,image_analysis').eq('account_id',accountId).eq('review_id',draft.review_id).in('id',draft.data.declaration_message_ids).eq('kind','declaration');
    if(uploadError)throw uploadError;
    const confirmed = uploads?.find(file => manualEvidenceMatches(draft.data,file.image_analysis));
    if(confirmed) {
      for(const [field,value] of Object.entries(draft.data)) if(typeof value==='string'&&value.trim()) Object.assign(next,{[field]:value});
      next.declaration_message_ids=[confirmed.id];next.identity_message_ids=[];next.identity_confirmed=false;
    }
  }
  const ready = enrollmentIssues(next).length === 0;
  if (ready || JSON.stringify(next) !== JSON.stringify(draft.data)) {
    const { error: saveError } = await db
      .from('enrollment_drafts')
      .update({ data: next, ...(ready ? { status: 'ready', error: null } : {}) })
      .eq('id', draft.id)
      .eq('account_id', accountId)
      .eq('status', 'collecting')
      .eq('version', draft.version);
    if (saveError) throw saveError;
  }
  await syncPaidEnrollmentHandoff(db, accountId, conversationId, draft.id, next);
}
