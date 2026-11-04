import{test}from'node:test';import assert from'node:assert/strict';
import{retainingLocalAuth}from'./retaining-local-auth.mjs';
test('provider logout never recursively deletes a busy profile or rejects its frame listener',async()=>{
 let deleted=0;class Base{constructor(options){this.options=options;}async logout(){deleted++;throw Error('EBUSY');}}
 const Auth=retainingLocalAuth(Base),auth=new Auth({dataPath:'owned-profile'});await assert.doesNotReject(auth.logout());assert.equal(deleted,0);assert.equal(auth.options.dataPath,'owned-profile');
});
