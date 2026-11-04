import{test}from'node:test';import assert from'node:assert/strict';import{runInNewContext}from'node:vm';
import{installMessageModelCompatibility}from'./message-model-compat.mjs';
test('preserves raw provider key through browser JSON serialization without replacing vendor fields',()=>{
 const api={getMessageModel:()=>({id:{fromMe:true},body:'Example',extra:42})};
 runInNewContext('('+installMessageModelCompatibility.toString()+')()',{window:{WWebJS:api}});
 const wrapper=api.getMessageModel;
 runInNewContext('('+installMessageModelCompatibility.toString()+')()',{window:{WWebJS:api}});
 assert.equal(api.getMessageModel,wrapper);
 const result=JSON.parse(JSON.stringify(api.getMessageModel({id:{toString:()=> 'true_51900000001@c.us_PROVIDER'},to:{toString:()=> '51900000001@c.us'}})));
 assert.equal(result.id._serialized,'true_51900000001@c.us_PROVIDER');assert.equal(result.to,'51900000001@c.us');assert.equal(result.extra,42);
});
test('does not fabricate a provider identifier when the raw key cannot serialize',()=>{
 const api={getMessageModel:()=>({id:{fromMe:true}})};
 runInNewContext('('+installMessageModelCompatibility.toString()+')()',{window:{WWebJS:api}});
 assert.equal(api.getMessageModel({id:{}}).id._serialized,undefined);
});
