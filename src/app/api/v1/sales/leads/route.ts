import { requireApiKey } from '@/lib/auth/api-context';
import { buildPage, keysetFilter, parseListParams } from '@/lib/api/v1/pagination';
import { okList, toApiErrorResponse } from '@/lib/api/v1/respond';
import { SALES_COMMERCIAL_STATUSES } from '@/lib/sales/commercial-status';
import { courseInterestFromMessages } from '@/lib/sales/course-interest';

const SALES_TAGS = new Set<string>([
  'AREA VENTAS',
  'ASESOR INSTITUTO',
  'SEGUIMIENTO DE VENTAS',
  'VENTA',
  ...SALES_COMMERCIAL_STATUSES,
]);

type RawMessage = {
  id: string;
  sender_type: string;
  content_text: string | null;
  created_at: string;
  status: string | null;
  source_referral: Record<string, unknown> | null;
  interactive_reply_id: string | null;
  content_type: string;
};

type RawConversation = {
  id: string;
  status: string;
  assigned_agent_id: string | null;
  created_at: string;
  last_message_at: string | null;
  last_message_text: string | null;
  unread_count: number | null;
  automation_enabled: boolean;
  ai_enabled: boolean;
  conversation_sales_routes: {
    agent_id: string | null;
    state: string;
    created_at: string;
    lease_expires_at: string | null;
  } | Array<{
    agent_id: string | null;
    state: string;
    created_at: string;
    lease_expires_at: string | null;
  }> | null;
  messages: RawMessage[];
};

type RawContact = {
  id: string;
  phone: string | null;
  phone_normalized: string | null;
  name: string | null;
  external_id: string | null;
  channel: string | null;
  created_at: string;
  contact_tags: Array<{ created_at?: string; tag: { name: string } | null }>;
  conversations: RawConversation[];
};

function newestRoute(routes: RawConversation['conversation_sales_routes']) {
  if (!routes) return null;
  if (!Array.isArray(routes)) return routes;
  return [...routes].sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
}

type EnrollmentSnapshot = { status: string; data: { prices?: unknown } | null; student_folder_url: string | null };

// review_id is unique: PostgREST returns an object for this relation in production.
// Accept arrays too, so exports remain compatible with older schema metadata.
function enrollmentSnapshots(value: unknown): EnrollmentSnapshot[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value]) as EnrollmentSnapshot[];
}

export async function GET(request: Request) {
  try {
    const ctx = await requireApiKey(request, 'sales:read');
    const { limit, cursor } = parseListParams(request);
    let query = ctx.supabase
      .from('contacts')
      .select(`
        id, phone, phone_normalized, name, external_id, channel, created_at,
        contact_tags(created_at,tag:tags(name)),
        conversations(
          id, status, assigned_agent_id, created_at, last_message_at, last_message_text,
          unread_count, automation_enabled, ai_enabled,
          conversation_sales_routes(agent_id,state,created_at,lease_expires_at),
          messages(id,sender_type,content_text,created_at,status,source_referral,interactive_reply_id,content_type)
        )
      `)
      .eq('account_id', ctx.accountId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .order('created_at', { referencedTable: 'conversations', ascending: false })
      .limit(1, { referencedTable: 'conversations' })
      .eq('conversations.messages.sender_type', 'customer')
      .order('created_at', { referencedTable: 'conversations.messages', ascending: false })
      .limit(limit + 1);

    const cursorFilter = keysetFilter(cursor);
    if (cursorFilter) query = query.or(cursorFilter);

    const { data, error } = await query;
    if (error) throw error;

    const page = buildPage((data ?? []) as unknown as RawContact[], limit);
    // A completed enrollment leaves Sales for Fidelización. Keep that sale in
    // the commercial ledger using the human-validated payment, not its area tag.
    const { data: paidReviews, error: paidError } = page.items.length
      ? await ctx.supabase.from('payment_reviews')
          .select('contact_id,status,payment_purpose,reviewed_at,operation_reference,sales_adviser,enrollments:enrollment_drafts(status,data,student_folder_url)')
          .eq('account_id', ctx.accountId)
          .eq('status', 'validated')
          .in('contact_id', page.items.map((contact) => contact.id))
          .order('reviewed_at', { ascending: true })
      : { data: [], error: null };
    if (paidError) throw paidError;
    const saleByContact = new Map((paidReviews ?? [])
      .map((review) => ({ ...review, enrollments: enrollmentSnapshots(review.enrollments) }))
      .filter((review) => review.payment_purpose === 'enrollment' ||
        (review.payment_purpose === 'unclassified' && review.enrollments?.some((draft) => draft.status === 'registered')))
      .map((review) => [review.contact_id, review]));
    const possibleAgentIds = [...new Set(page.items.flatMap((contact) => {
      const conversation = contact.conversations[0];
      const route = conversation ? newestRoute(conversation.conversation_sales_routes) : null;
      return [conversation?.assigned_agent_id, route?.agent_id].filter((id): id is string => !!id);
    }))];
    const { data: profiles, error: profileError } = possibleAgentIds.length
      ? await ctx.supabase
          .from('profiles')
          .select('user_id,full_name,nickname,area')
          .eq('account_id', ctx.accountId)
          .in('user_id', possibleAgentIds)
      : { data: [], error: null };
    if (profileError) throw profileError;
    const profileById = new Map((profiles ?? []).map((profile) => [profile.user_id, profile]));

    const salesContacts = page.items.flatMap((contact) => {
      if ((contact.phone_normalized || contact.phone || '').replace(/\D/g, '').replace(/^51(?=\d{9}$)/, '') === '987020644') return [];
      const tags = contact.contact_tags
        .map((item) => item.tag?.name ?? '')
        .filter(Boolean);

      const conversation = contact.conversations[0] ?? null;
      const messages = conversation?.messages ?? [];
      const route = conversation ? newestRoute(conversation.conversation_sales_routes) : null;
      const assignedAgentId = conversation?.assigned_agent_id ?? route?.agent_id ?? null;
      const assignedProfile = assignedAgentId ? profileById.get(assignedAgentId) : null;
      const isSalesProfile = assignedProfile?.area?.toLowerCase() === 'ventas';
      const sale = saleByContact.get(contact.id);
      const salePrices = (sale?.enrollments?.[0]?.data as { prices?: unknown } | null)?.prices;
      if (!sale && !tags.some((tag) => SALES_TAGS.has(tag)) && !isSalesProfile) return [];
      const firstReferral = [...messages]
        .filter((message) => message.sender_type === 'customer' && message.source_referral)
        .sort((a, b) => a.created_at.localeCompare(b.created_at))[0]?.source_referral ?? null;
      const latestCustomerMessage = [...messages]
        .filter((message) => message.sender_type === 'customer')
        .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null;
      const courseInterest = courseInterestFromMessages(messages);

      return [{
        id: contact.id,
        name: contact.name?.trim() || 'Sin nombre',
        phone_or_user_id: contact.phone_normalized || contact.external_id || contact.phone || '',
        channel: contact.channel || 'whatsapp',
        course_interest: courseInterest.course,
        course_details: courseInterest.details,
        course_basis: 'coincidencia en los mensajes entrantes de la conversación más reciente; confirmar si está vacío',
        created_at: contact.created_at,
        institute: 'INSTICRECE',
        crm_tags: tags,
        commercial_status: tags.find((tag) => SALES_COMMERCIAL_STATUSES.includes(tag as typeof SALES_COMMERCIAL_STATUSES[number])) ?? '',
        commercial_status_at: contact.contact_tags.find((item) => SALES_COMMERCIAL_STATUSES.includes(item.tag?.name as typeof SALES_COMMERCIAL_STATUSES[number]))?.created_at ?? null,
        sale_validated: !!sale,
        sale_validated_at: sale?.reviewed_at ?? null,
        sale_monthly_price: Array.isArray(salePrices) && typeof salePrices[1] === 'number' ? salePrices[1] : null,
        sales_adviser: sale?.sales_adviser ?? null,
        operation_reference: sale?.operation_reference ?? null,
        student_folder_url: sale?.enrollments?.find((draft) => draft.student_folder_url)?.student_folder_url ?? null,
        assigned_adviser_id: assignedAgentId,
        assigned_adviser: assignedProfile?.nickname?.trim() || assignedProfile?.full_name?.trim() || '',
        assigned_at: route?.created_at ?? null,
        last_interaction_at: conversation?.last_message_at ?? null,
        last_customer_message_at: latestCustomerMessage?.created_at ?? null,
        conversation_status: conversation?.status ?? null,
        automation_enabled: conversation?.automation_enabled ?? null,
        ai_enabled: conversation?.ai_enabled ?? null,
        unread_count: conversation?.unread_count ?? 0,
        source_referral: firstReferral,
        campaign_or_ad: firstReferral ? JSON.stringify(firstReferral) : '',
        last_customer_text: latestCustomerMessage?.content_text ?? null,
      }];
    });

    return okList(salesContacts, page.nextCursor);
  } catch (error) {
    return toApiErrorResponse(error);
  }
}
