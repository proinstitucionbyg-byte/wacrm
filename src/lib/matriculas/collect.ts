import type { SupabaseClient } from '@supabase/supabase-js';
import {
  collectEnrollmentData,
  collectPaymentData,
  type IntakeMessage,
} from './collect-data';

/** Account-scoped, collecting drafts only, version checked. Never queues a registration. */
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
  // Only this intake: don't reuse old DNI photos from an earlier conversation history.
  const { data: messages, error: messageError } = await db
    .from('messages')
    .select('id,content_text,image_analysis')
    .eq('conversation_id', conversationId)
    .eq('sender_type', 'customer')
    .gte('created_at', review.created_at)
    .order('created_at', { ascending: false })
    .limit(100);
  if (messageError) throw messageError;
  const next = collectEnrollmentData(
    collectPaymentData(draft.data, review.evidence?.fields),
    (messages ?? []) as IntakeMessage[]
  );
  if (JSON.stringify(next) === JSON.stringify(draft.data)) return;
  const { error: saveError } = await db
    .from('enrollment_drafts')
    .update({ data: next })
    .eq('id', draft.id)
    .eq('account_id', accountId)
    .eq('status', 'collecting')
    .eq('version', draft.version);
  if (saveError) throw saveError;
}
