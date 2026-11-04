import{it,expect}from'vitest';import{readQueueJson}from'./bounded-json';
it('bounds actual UTF-8 bytes even when Content-Length is missing or misleading',async()=>{
 const r=new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json','Content-Length':'1'},body:JSON.stringify({text:'💬'.repeat(20)})});expect(await readQueueJson(r,30)).toEqual({ok:false,status:413});
});
it('rejects malformed data and unapproved content types',async()=>{
 expect(await readQueueJson(new Request('https://example.test',{method:'POST',body:'{}'}),100)).toEqual({ok:false,status:400});
 expect(await readQueueJson(new Request('https://example.test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{' }),100)).toEqual({ok:false,status:400});
});
