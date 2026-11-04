import{afterEach,it,expect,vi}from'vitest';
import{withSessionInbound,currentSessionInbound}from'./session-inbound-context';
import{getSessionOriginLineForConversation,enqueueSessionTextIfRequired}from'./session-transport-guard';
afterEach(()=>vi.unstubAllEnvs());
it('keeps concurrent queries from different WhatsApps pinned to their own input',async()=>{
 vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED','true');
 const db={from:()=>{throw Error('Must not switch to latest global message');}};
 const values=await Promise.all(['WA-one','WA-two'].map(lineKey=>withSessionInbound({accountId:'a',conversationId:'same-person',lineKey,messageRowId:lineKey,providerMessageId:lineKey},async()=>{
  await Promise.resolve();expect(currentSessionInbound('other-person')).toBeNull();return getSessionOriginLineForConversation(db as never,'same-person');
 })));
 expect(values).toEqual(['WA-one','WA-two']);expect(currentSessionInbound('same-person')).toBeNull();
});
it('queues only the original line, row and provider receipt and rejects an account mismatch',async()=>{
 vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED','true');vi.stubEnv('MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED','true');
 const query={select:vi.fn().mockReturnThis(),eq:vi.fn().mockReturnThis(),order:vi.fn().mockReturnThis(),limit:vi.fn().mockReturnThis(),maybeSingle:vi.fn().mockResolvedValue({data:{id:'row-one',whatsapp_session_line_key:'WA-one'},error:null})};
 const receipt={...query,maybeSingle:vi.fn().mockResolvedValue({data:{provider_message_id:'input-one'},error:null})};
 const rpc=vi.fn().mockResolvedValue({data:{message_id:'waweb-job:one'},error:null}),db={from:(table:string)=>table==='messages'?query:receipt,rpc};
 await withSessionInbound({accountId:'a',conversationId:'c',lineKey:'WA-one',messageRowId:'row-one',providerMessageId:'input-one'},async()=>{
  await enqueueSessionTextIfRequired(db as never,{accountId:'a',conversationId:'c',text:'Respuesta'});
  expect(query.eq).toHaveBeenCalledWith('id','row-one');expect(rpc).toHaveBeenCalledWith('enqueue_whatsapp_session_text',expect.objectContaining({p_line_key:'WA-one',p_inbound_provider_message_id:'input-one'}));
  await expect(enqueueSessionTextIfRequired(db as never,{accountId:'other',conversationId:'c',text:'No'})).rejects.toThrow('otra cuenta');
 });
});
