import { NextResponse } from 'next/server';
import { getCurrentAccount, toErrorResponse } from '@/lib/auth/account';
import { normalizePhone } from '@/lib/whatsapp/phone-utils';

type ReminderInput = { body?: unknown; due_at?: unknown; repeat_days?: unknown; conversation_id?: unknown;
  action_kind?: unknown; destination_phone?: unknown; message_text?: unknown; recipient_ids?: unknown };

export async function GET(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const teamView = new URL(request.url).searchParams.get('scope') === 'team';
    if (teamView && ctx.role !== 'owner') {
      return NextResponse.json({ error: 'Solo el CEO puede ver los recordatorios del equipo.' }, { status: 403 });
    }
    let query = ctx.supabase.from('adviser_reminders').select('id,user_id,body,due_at,repeat_days,conversation_id,status,action_kind,destination_phone,message_text')
      .eq('account_id', ctx.accountId).eq('status', 'active');
    if (!teamView) query = query.eq('user_id', ctx.userId);
    const { data, error } = await query.order('due_at', { ascending: true }).limit(100);
    if (error) throw error;
    let names = new Map<string, string>();
    if (teamView && data?.length) {
      const { data: profiles, error: profileError } = await ctx.supabase.from('profiles')
        .select('user_id,full_name,email').eq('account_id', ctx.accountId)
        .in('user_id', [...new Set(data.map(item => item.user_id))]);
      if (profileError) throw profileError;
      names = new Map((profiles ?? []).map(profile => [profile.user_id, profile.full_name || profile.email || 'Asesora']));
    }
    const {data:recipients,error:recipientError}=await ctx.supabase.from('profiles').select('user_id,full_name,nickname,area').eq('account_id',ctx.accountId).order('full_name');
    if(recipientError)throw recipientError;
    return NextResponse.json({ recipients:recipients??[],reminders: (data ?? []).map(item => ({ ...item, owner_name: names.get(item.user_id) ?? null })),
      canViewTeam: ctx.role === 'owner', currentUserId: ctx.userId });
  } catch (error) { return toErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const ctx = await getCurrentAccount();
    const input = await request.json().catch(() => null) as (ReminderInput & { reminders?: ReminderInput[] }) | null;
    const entries: ReminderInput[] | null = input ? (Array.isArray(input.reminders) ? input.reminders : [input]) : null;
    if (!entries || !Array.isArray(entries) || entries.length < 1 || entries.length > 10) {
      return NextResponse.json({ error: 'Incluye entre 1 y 10 recordatorios.' }, { status: 400 });
    }
    const rows = [];
    for (const entry of entries) {
      const recipients=entry.recipient_ids===undefined?[ctx.userId]:entry.recipient_ids;
      if(!Array.isArray(recipients)||!recipients.length||recipients.length>50||recipients.some(id=>typeof id!=='string'||!/^[0-9a-f-]{36}$/i.test(id)))return NextResponse.json({error:'Selecciona entre 1 y 50 destinatarios del equipo.'},{status:400});
      const uniqueRecipients=[...new Set(recipients as string[])];
      const {data:members,error:membersError}=await ctx.supabase.from('profiles').select('user_id').eq('account_id',ctx.accountId).in('user_id',uniqueRecipients);
      if(membersError)throw membersError;
      if(members?.length!==uniqueRecipients.length)return NextResponse.json({error:'Los destinatarios deben pertenecer a tu equipo.'},{status:403});
      const body = typeof entry.body === 'string' ? entry.body.trim() : '';
      const dueAt = typeof entry.due_at === 'string' ? new Date(entry.due_at) : new Date(NaN);
      const repeatDays = entry.repeat_days == null ? null : Number(entry.repeat_days);
      const kind = entry.action_kind === 'message' ? 'message' : 'notification';
      const phone = typeof entry.destination_phone === 'string' ? normalizePhone(entry.destination_phone) : '';
      const destinationPhone = phone.startsWith('51') && phone.length === 11 ? phone.slice(2) : phone;
      const messageText = typeof entry.message_text === 'string' ? entry.message_text.trim() : '';
      let conversationId = typeof entry.conversation_id === 'string' ? entry.conversation_id : null;
      if (!body || body.length > 1000 || !Number.isFinite(dueAt.getTime()) || dueAt.getTime() < Date.now() + 10_000
        || dueAt.getTime() > Date.now() + 5 * 365 * 86400_000
        || (repeatDays !== null && (!Number.isInteger(repeatDays) || repeatDays < 1 || repeatDays > 365))) {
        return NextResponse.json({ error: 'Escribe cada recordatorio con una fecha futura válida.' }, { status: 400 });
      }
      if (kind === 'message') {
        if(uniqueRecipients.length!==1||uniqueRecipients[0]!==ctx.userId)return NextResponse.json({error:'El envio programado de mensajes solo puede quedar a tu nombre. Para el equipo usa un recordatorio interno.'},{status:400});
        if (!/^9\d{8}$/.test(destinationPhone) || !messageText || messageText.length > 1000 || repeatDays !== null) {
          return NextResponse.json({ error: 'Para enviar un mensaje, indica un celular peruano y el texto exacto; el envío no puede repetirse.' }, { status: 400 });
        }
        if (conversationId) {
          const { data: selected, error: selectedError } = await ctx.supabase.from('conversations')
            .select('id,contact:contacts(phone,channel,external_id)').eq('id', conversationId)
            .eq('account_id', ctx.accountId).maybeSingle();
          if (selectedError) throw selectedError;
          const contact = Array.isArray(selected?.contact) ? selected.contact[0] : selected?.contact;
          const selectedPhone = normalizePhone(contact?.phone || '');
          if (!(contact?.channel === 'whatsapp' || contact?.channel == null && !contact?.external_id)
            || ![destinationPhone, `51${destinationPhone}`].includes(selectedPhone)) {
            conversationId = null;
          }
        }
        if (!conversationId) {
        // Resolve an existing WhatsApp chat; never create a new contact from dictation.
        const matches: { id: string; phone: string }[] = [];
        let exhausted = false;
        for (let page = 0; page < 10; page++) {
          const { data: contacts, error: contactError } = await ctx.supabase.from('contacts')
            .select('id,phone,channel,external_id').eq('account_id', ctx.accountId)
            .or('channel.eq.whatsapp,channel.is.null')
            .order('id').range(page * 1000, page * 1000 + 999);
          if (contactError) throw contactError;
          matches.push(...(contacts ?? []).filter(contact => {
            const normalized = normalizePhone(contact.phone || '');
            return (contact.channel === 'whatsapp' || contact.channel == null && !contact.external_id)
              && (normalized === destinationPhone || normalized === `51${destinationPhone}`);
          }));
          if ((contacts ?? []).length < 1000) { exhausted = true; break; }
        }
        if (!exhausted) return NextResponse.json({ error: 'Hay demasiados contactos para resolver el número con seguridad. Selecciona el chat manualmente.' }, { status: 400 });
        if (matches.length !== 1) return NextResponse.json({ error: `El número ${destinationPhone} no identifica un único contacto de WhatsApp del CRM. Selecciona el chat correcto.` }, { status: 400 });
        const { data: chats, error: chatError } = await ctx.supabase.from('conversations').select('id')
          .eq('account_id', ctx.accountId).eq('contact_id', matches[0].id).limit(2);
        if (chatError) throw chatError;
        if (chats?.length !== 1) return NextResponse.json({ error: `No se encontró un chat único para ${destinationPhone}.` }, { status: 400 });
        conversationId = chats[0].id;
        }
      } else if (conversationId) {
        const { data: visible, error: visibilityError } = await ctx.supabase.from('conversations').select('id')
          .eq('id', conversationId).eq('account_id', ctx.accountId).maybeSingle();
        if (visibilityError) throw visibilityError;
        if (!visible) return NextResponse.json({ error: 'No tienes acceso a ese chat.' }, { status: 403 });
      }
      for(const recipient of uniqueRecipients)rows.push({ account_id: ctx.accountId, user_id: recipient, created_by:ctx.userId,conversation_id: recipient===ctx.userId?conversationId:null,
        body, due_at: dueAt.toISOString(), repeat_days: repeatDays, action_kind: kind,
        destination_phone: kind === 'message' ? destinationPhone : null,
        message_text: kind === 'message' ? messageText : null });
    }
    const { data, error } = await ctx.supabase.from('adviser_reminders').insert(rows)
      .select('id,body,due_at,repeat_days,conversation_id,status,action_kind');
    if (error) throw error;
    return NextResponse.json({ reminders: data }, { status: 201 });
  } catch (error) { return toErrorResponse(error); }
}
