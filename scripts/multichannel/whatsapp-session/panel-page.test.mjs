import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runInNewContext} from 'node:vm';
import {webcrypto} from 'node:crypto';
import {TextEncoder} from 'node:util';
import {sessionPage} from './panel-page.mjs';

// A DOM-free controller test: no browser, network, profile or actual phone.
class Element {
  constructor(){this.children=[];this.dataset={};this.attributes={};this.hidden=false;this.value='';this.textContent='';this.classList={add(){},remove(){}};}
  replaceChildren(...rows){this.children=rows;}
  append(...rows){this.children.push(...rows);}
  appendChild(row){this.children.push(row);}
  setAttribute(key,value){this.attributes[key]=value;}
  removeAttribute(key){delete this.attributes[key];}
  querySelectorAll(){return this.children.flatMap(li=>li.children);}
  focus(){}
}
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
function fixture({holdA=false,group=false}={}){
  const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
  let releaseA,holdNextMessage=false,releaseMessage;
  const calls=[],sent=[],timers=[],intervals=[],storage=new Map();
  const lines=[{lineKey:'WA-a',label:'Ventas',active:true,status:'ready'},{lineKey:'WA-b',label:'Soporte',active:true,status:'ready'}];
  const reply=data=>({ok:true,json:async()=>data});
  const fetch=async(path,init={})=>{
    calls.push(path);const url=new URL(path,'http://127.0.0.1');
    if(url.pathname==='/api/lines')return reply({defaultLine:'WA-a',canManage:true,lines});
    if(url.pathname==='/api/status')return reply({status:'ready'});
    const line=url.searchParams.get('line');
    if(url.pathname==='/api/chats'){
      const id=group?'123456789@g.us':line==='WA-a'?'911111111@c.us':'922222222@c.us';
      const data={offset:0,limit:20,total:1,chats:[{id,name:group?'Grupo de prueba':line==='WA-a'?'ALFA':'BETA',phone:group?null:line==='WA-a'?'911111111':'922222222',group}]};
      if(line==='WA-a'&&holdA)return new Promise(resolve=>{releaseA=()=>resolve(reply(data));});
      return reply(data);
    }
    if(url.pathname.startsWith('/api/chats/')){
      const data={name:group?'Grupo de prueba':line==='WA-a'?'ALFA':'BETA',phone:group?null:line==='WA-a'?'911111111':'922222222',group,messages:[{text:'Mensaje de '+line,type:'chat',timestamp:1}]};
      if(holdNextMessage){holdNextMessage=false;return new Promise(resolve=>{releaseMessage=()=>resolve(reply(data));});}
      return reply(data);
    }
    if(url.pathname==='/api/send'){sent.push(JSON.parse(init.body));return reply({state:'accepted'});}
    throw Error('Ruta inesperada');
  };
  const html=sessionPage('test'),script=html.match(/<script nonce="test">([\s\S]*?)<\/script>/)[1];
  runInNewContext(script,{document:{getElementById:get,createElement:()=>new Element()},URL,location:{hash:'#private-token'},
    sessionStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)??null,removeItem:k=>storage.delete(k)},
    history:{replaceState(){}},setInterval:(fn,ms)=>{intervals.push({fn,ms});return intervals.length;},setTimeout:fn=>{timers.push(fn);return timers.length;},clearTimeout(){},fetch,crypto:webcrypto,TextEncoder});
  return {get,calls,sent,releaseA:()=>releaseA(),holdMessage:()=>{holdNextMessage=true;},releaseMessage:()=>releaseMessage(),timers,intervals};
}
test('a late list response from another number cannot replace the selected line chats',async()=>{
  const x=fixture({holdA:true});await settle();await x.get('lines').children[1].onclick();await settle();
  x.releaseA();await settle();assert.equal(x.get('chats').children[0].children[0].dataset.chat,'922222222@c.us');
});
test('switching number hides the previous thread even if an old message read finishes later',async()=>{
  const x=fixture();await settle();x.holdMessage();const pending=x.get('chats').children[0].children[0].onclick();await settle();
  await x.get('lines').children[1].onclick();await settle();x.releaseMessage();await pending;await settle();
  assert.equal(x.get('thread').children.length,0);assert.equal(x.get('thread').hidden,true);
});
test('search uses the selected line and is applied to the server list',async()=>{
  const x=fixture();await settle();await x.get('lines').children[1].onclick();await settle();
  x.get('search').value='Farmacia';x.get('search').oninput();x.timers.at(-1)();await settle();
  assert.ok(x.calls.some(path=>path.includes('search=Farmacia')&&path.includes('line=WA-b')));
});
test('shows the phone for individual contacts and refreshes the open chat automatically',async()=>{
  const x=fixture();await settle();const button=x.get('chats').children[0].children[0];
  assert.equal(button.children[1].children[1].textContent,'+911111111');
  await button.onclick();await settle();assert.match(x.get('thread-subtitle').textContent,/\+911111111/);
  const listBefore=x.calls.filter(path=>path.startsWith('/api/chats?')).length;
  const threadBefore=x.calls.filter(path=>path.startsWith('/api/chats/')&&path.includes('line=')).length;
  const poll=x.intervals.find(row=>row.ms===5000);assert.ok(poll);poll.fn();await settle();
  assert.ok(x.calls.filter(path=>path.startsWith('/api/chats?')).length>listBefore);
  assert.ok(x.calls.filter(path=>path.startsWith('/api/chats/')&&path.includes('line=')).length>threadBefore);
});
test('the group composer accepts editable text and sends it only to the selected existing group',async()=>{
  const x=fixture({group:true});await settle();
  await x.get('chats').children[0].children[0].onclick();await settle();
  assert.equal(x.get('composer-wrap').hidden,false);
  assert.equal(x.get('message-text').placeholder,'Escribe al grupo (envío manual)');
  x.get('message-text').value='Aviso manual al grupo';
  await x.get('send-form').onsubmit({preventDefault(){}});await settle();
  assert.deepEqual(x.sent.map(({chat_id,text})=>({chat_id,text})),[
    {chat_id:'123456789@g.us',text:'Aviso manual al grupo'},
  ]);
});
