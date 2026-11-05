import{test}from'node:test';import assert from'node:assert/strict';import{runInNewContext}from'node:vm';
import{snapshotMediaReceipts}from'./media-receipt.mjs';
test('media receipt proof excludes another file, recipient and incoming media',async()=>{
 const chatId='51900000001@c.us',address=value=>({toString:()=>value}),message=(id,own=true,to=chatId,filehash='exact')=>({id:{fromMe:own,toString:()=>id},filehash,to:address(to)});
 const window={WWebJS:{getChat:async()=>({id:address(chatId),msgs:{getModelsArray:()=>[message('true_correct'),message('true_foreign',true,'51900000002@c.us'),message('false_incoming',false),message('true_other_file',true,chatId,'other')]}})}};
 const result=await runInNewContext('('+snapshotMediaReceipts.toString()+')({chatId:"'+chatId+'",filehash:"exact"})',{window});
 assert.equal(result.chatId,chatId);assert.deepEqual(Array.from(result.ids),['true_correct']);
});
