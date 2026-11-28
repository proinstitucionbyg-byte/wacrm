import { NextResponse } from 'next/server';
import { requirePermission } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { CONVERSATION_SELECT, normalizeConversations } from '@/lib/inbox/conversations';

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission('inbox', 'view');
    const params = new URL(request.url).searchParams;
    const query = (params.get('q') ?? '').trim(), unread = params.get('unread') === '1';
    const browse = params.get('browse') === '1';
    const offset = Number(params.get('offset') ?? 0);
    if (query.length > 120 || (!unread && query.length < 2 && !(browse && query === '')) || !Number.isSafeInteger(offset) || offset < 0) {
      return NextResponse.json({ error: 'Escribe entre 2 y 120 caracteres.' }, { status: 400 });
    }
    let exactIds:string[]|null=null;
    if(/^[+0-9 ().-]+$/.test(query)){
      let digits=query.replace(/\D/g,'');if(digits.startsWith('00'))digits=digits.slice(2);
      if(digits.length>=9){
        const values=new Set([digits,'+'+digits]);if(/^9\d{8}$/.test(digits)){values.add('51'+digits);values.add('+51'+digits);}
        const contacts=await ctx.supabase.from('contacts').select('id').eq('account_id',ctx.accountId).in('phone',[...values]);if(contacts.error)throw contacts.error;
        if(contacts.data?.length){
          let request=ctx.supabase.from('conversations').select('id').eq('account_id',ctx.accountId).in('contact_id',contacts.data.map(c=>c.id)).order('last_message_at',{ascending:false}).range(offset,offset+100);
          if(unread)request=request.gt('unread_count',0);
          const direct=await request;if(direct.error)throw direct.error;if(direct.data?.length)exactIds=direct.data.map(c=>c.id);
        }
      }
    }
    const { data: matches, error } = exactIds?{data:exactIds.map(conversation_id=>({conversation_id})),error:null}:await ctx.supabase.rpc('search_inbox_conversations', {
      p_query: query, p_unread: unread, p_offset: offset,
    });
    if (error) throw error;
    const ids: string[] = (matches ?? []).slice(0,100).map((row: { conversation_id: string }) => row.conversation_id);
    const conversations = [];
    // Keep URLs below proxy limits, and always hydrate through the caller's RLS.
    for (let start = 0; start < ids.length; start += 40) {
      const result = await ctx.supabase.from('conversations').select(CONVERSATION_SELECT)
        .eq('account_id', ctx.accountId).in('id', ids.slice(start,start+40));
      if (result.error) throw result.error;
      conversations.push(...normalizeConversations(result.data ?? []));
    }
    return NextResponse.json({ conversations, hasMore: (matches ?? []).length > 100, nextOffset: offset + 100 },
      { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return toErrorResponse(error); }
}
