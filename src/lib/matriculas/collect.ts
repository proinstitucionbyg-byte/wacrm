import type { SupabaseClient } from '@supabase/supabase-js';
import {
  collectEnrollmentData,
  collectPaymentData,
  type IntakeMessage,
} from './collect-data';
import { prepareAutomaticIntake, type IntakeEvidence } from './auto-intake';
import { loadAcademicCalendar } from './calendar';
import { enrollmentIssues } from './enrollment';

/** Only queues a complete, consistent intake after human payment validation. */
export async function collectConversationEnrollments(
  db: SupabaseClient,
  accountId: string,
  conversationId: string
) {
  const { data: drafts, error } = await db
    .from('enrollment_drafts')
    .select('id,review_id,data,version')
    .eq('account_id', accountId)
    .eq('conversation_id', conversationId)
    .eq('status', 'collecting');
  if (error) throw error;
  // Several simultaneous enrollments need an explicit association, not a guess.
  if (drafts?.length !== 1) return;
  const draft = drafts[0];
  const { data: review, error: reviewError } = await db
    .from('payment_reviews')
    .select('status,created_at,evidence')
    .eq('id', draft.review_id)
    .eq('account_id', accountId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (review?.status !== 'validated') return;
  // Include data sent before the voucher. Contradictory written/photo values stay pending.
  const { data: messages, error: messageError } = await db
    .from('messages')
    .select('id,content_text,image_analysis,sender_type,ai_generated,created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (messageError) throw messageError;
  const evidence = (messages ?? []) as IntakeEvidence[];
  let next = collectEnrollmentData(
    collectPaymentData(draft.data, review.evidence?.fields),
    evidence.filter((message) => message.sender_type === 'customer' || !message.sender_type) as IntakeMessage[]
  );
  if (next.course) next = prepareAutomaticIntake(next, evidence, await loadAcademicCalendar(db, accountId), review.created_at);
  const ready = enrollmentIssues(next).length === 0;
  if (!ready && JSON.stringify(next) === JSON.stringify(draft.data)) return;
  const { error: saveError } = await db
    .from('enrollment_drafts')
    .update({ data: next, ...(ready ? { status: 'ready', error: null } : {}) })
    .eq('id', draft.id)
    .eq('account_id', accountId)
    .eq('status', 'collecting')
    .eq('version', draft.version);
  if (saveError) throw saveError;
}
