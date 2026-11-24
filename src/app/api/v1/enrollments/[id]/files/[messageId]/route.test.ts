import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({key:vi.fn(),download:vi.fn(),rows:{} as Record<string,unknown>,storage:vi.fn()}));
vi.mock('@/lib/auth/api-context',()=>({requireApiKey:h.key}));
import { GET } from './route';
const id='3492eea7-325f-4c04-a5da-d6e7a020931c';
beforeEach(()=>{
 vi.resetAllMocks();
 h.rows={enrollment_drafts:{review_id:'review',conversation_id:'conversation',status:'processing',data:{},lease_token:'lease'},payment_reviews:{message_id:id,status:'validated'},enrollment_uploads:null,messages:{content_type:'image',media_url:`/api/whatsapp/session-media/${id}`}};
 h.download.mockResolvedValue({data:new Blob(['original'],{type:'image/jpeg'}),error:null});
 h.storage.mockReturnValue({download:h.download});
 h.key.mockResolvedValue({accountId:'account',supabase:{storage:{from:h.storage},from:(table:string)=>{const c={select:()=>c,eq:()=>c,maybeSingle:async()=>({data:h.rows[table],error:null})};return c;}}});
});
const request=(lease='lease')=>GET(new Request('https://crm.example/files',{headers:{'X-Enrollment-Lease':lease}}),{params:Promise.resolve({id:'draft',messageId:id})});
describe('enrollment linked WhatsApp original',()=>{
 it('downloads the private original from this account for a validated receipt',async()=>{const r=await request();expect(r.status).toBe(200);expect(r.headers.get('Content-Type')).toBe('image/jpeg');expect(await r.text()).toBe('original');expect(h.storage).toHaveBeenCalledWith('whatsapp-session-media');expect(h.download).toHaveBeenCalledWith(`account/${id}`);});
 it('does not download with a different lease',async()=>{expect((await request('other')).status).toBe(404);expect(h.download).not.toHaveBeenCalled();});
 it('reports a missing original rather than falling back to another channel',async()=>{h.download.mockResolvedValue({data:null,error:{message:'missing'}});expect((await request()).status).toBe(404);});
 it('rejects unsupported stored media',async()=>{h.download.mockResolvedValue({data:new Blob(['bad'],{type:'text/html'}),error:null});expect((await request()).status).toBe(400);});
});
