import{test}from'node:test';import assert from'node:assert/strict';
import{normalizeSessionMedia,sessionPayloadHash,createSessionMediaLoader}from'./session-media.mjs';
const origin='https://storage.example.test',audio={kind:'audio',url:origin+'/storage/v1/object/public/media/lesson.ogg'};
test('media authorization binds the exact file and caption, preserving old text hashes',()=>{
 assert.equal(sessionPayloadHash('hello'),sessionPayloadHash('hello',null));assert.notEqual(sessionPayloadHash('hello'),sessionPayloadHash('hello',audio));
 assert.notEqual(sessionPayloadHash('hello',audio),sessionPayloadHash('hello',{...audio,url:audio.url+'2'}));assert.notEqual(sessionPayloadHash('hello',audio),sessionPayloadHash('hello',{...audio,caption:'changed'}));
 assert.deepEqual(normalizeSessionMedia({...audio,filename:'',caption:''}),audio);
});
test('rejects credentials, tokens, unsupported schemes and file paths before download',async()=>{
 let fetched=0;const load=createSessionMediaLoader({allowedOrigins:[origin],makeMedia:()=>{},fetchImpl:async()=>{fetched++;}});
 for(const url of ['http://127.0.0.1/a','https://user:pass@storage.example.test/a',audio.url+'?token=private','https://other.example.test/storage/v1/object/public/file',origin+'/internal'])await assert.rejects(load({...audio,url}));
 assert.throws(()=>normalizeSessionMedia({...audio,filename:'../private'}));assert.equal(fetched,0);
});
test('downloads a bounded authorized audio as a voice message without sending its internal text as a caption',async()=>{
 const load=createSessionMediaLoader({allowedOrigins:[origin],makeMedia:(mime,data,filename)=>({mime,data,filename}),fetchImpl:async(_url,options)=>{assert.equal(options.redirect,'error');return new Response('AUDIO',{headers:{'content-type':'application/ogg'}});}});
 const result=await load({...audio,caption:'Internal text'});assert.equal(result.content.mime,'audio/ogg');assert.equal(Buffer.from(result.content.data,'base64').toString(),'AUDIO');assert.equal(result.options.sendAudioAsVoice,true);assert.equal(result.options.caption,undefined);
});
test('rejects misleading MIME, oversized declared and streamed files, and empty files',async()=>{
 for(const response of [new Response('html',{headers:{'content-type':'text/html'}}),new Response('large',{headers:{'content-type':'audio/ogg','content-length':'100'}}),new Response('large',{headers:{'content-type':'audio/ogg'}}),new Response('',{headers:{'content-type':'audio/ogg'}})]){
  const load=createSessionMediaLoader({allowedOrigins:[origin],makeMedia:()=>{},fetchImpl:async()=>response,maxBytes:3});await assert.rejects(load(audio));
 }
});
