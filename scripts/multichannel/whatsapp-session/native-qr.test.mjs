import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {observeNativeQr} from './native-qr.mjs';

test('native QR bridge emits only changed valid canvases from the login holder',async()=>{
  const sent=[];let tick,cleared=0,png='data:image/png;base64,aGVsbG8=';
  const window={__wacrmNativeQrTimer:123,receive:value=>sent.push(value)};
  const document={querySelector:selector=>{assert.equal(selector,'[data-ref]');return {getAttribute:()=> 'native-qr',querySelector:()=>({width:240,height:240,toDataURL:()=>png})};}};
  runInNewContext('('+observeNativeQr.toString()+')("receive")',{window,document,setInterval:fn=>{tick=fn;return 124;},clearInterval:id=>{assert.equal(id,123);cleared++;}});
  tick();assert.equal(sent.length,1);png='data:image/png;base64,bmV3';tick();assert.equal(sent.length,2);
  png='data:text/html;base64,aGVsbG8=';tick();assert.equal(sent.length,2);assert.equal(cleared,1);
});

test('native bridge waits quietly while no login canvas is present',()=>{
 let called=0;
 runInNewContext('('+observeNativeQr.toString()+')("receive")',{window:{receive:()=>called++},document:{querySelector:()=>null},setInterval:fn=>{fn();return 1;},clearInterval:()=>{}});
 assert.equal(called,0);
});
