import{test}from'node:test';import assert from'node:assert/strict';import{runInNewContext}from'node:vm';
import{installMediaModelCompatibility}from'./media-model-compat.mjs';
test('prepared media cannot overwrite an outgoing identity and retains the uploaded file evidence',async()=>{
 const original={__x_id:'internal-media-identity',toJSON(){return{filehash:'real-file-hash',mediaKey:'private-key',type:'ptt',__x_id:undefined};}};
 const window={WWebJS:{processMediaData:async()=>original}};
 runInNewContext('('+installMediaModelCompatibility.toString()+')()',{window});
 const result=await window.WWebJS.processMediaData({data:'test'}),id={_serialized:'new-real-message-id'},outgoing={id,...result};
 assert.equal(Object.hasOwn(outgoing,'__x_id'),false);assert.equal(outgoing.id,id);assert.equal(outgoing.type,'ptt');assert.equal(outgoing.filehash,'real-file-hash');assert.equal(outgoing.mediaKey,'private-key');assert.equal(original.__x_id,'internal-media-identity');
 const installed=window.WWebJS.processMediaData;runInNewContext('('+installMediaModelCompatibility.toString()+')()',{window});assert.equal(window.WWebJS.processMediaData,installed);
});
