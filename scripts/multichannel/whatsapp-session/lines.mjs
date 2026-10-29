// Owner-local operations only. No send/resume/logout endpoint exists here.
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {parseArgs} from 'node:util';
import {sessionScope} from './store.mjs';
const {positionals,values}=parseArgs({allowPositionals:true,options:{name:{type:'string'},line:{type:'string'}}});
try{
  const command=positionals[0];
  if(!['list','register','connect','stop'].includes(command))throw Error();
  if(command==='register'&&(!values.name?.trim()||values.name.length>60))throw Error();
  const root=fileURLToPath(new URL('../../../output/multichannel-private/whatsapp-session/',import.meta.url));
  const config=JSON.parse(await readFile(join(root,'worker-config.json'),'utf8'));
  const access=JSON.parse(await readFile(join(root,sessionScope(config.accountId,config.lineKey),'panel-access.json'),'utf8'));
  const origin=new URL(access.origin);
  if(origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||origin.pathname!=='/'||origin.username||origin.password)throw Error();
  async function request(path,body){
    const response=await fetch(new URL(path,origin),{method:body?'POST':'GET',headers:{Authorization:'Bearer '+access.token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),redirect:'error',signal:AbortSignal.timeout(15_000)});
    if(!response.ok)throw Error();return response.json();
  }
  if(command==='list'){
    const result=await request('/api/lines');console.log(JSON.stringify({lines:result.lines}));
  }else if(command==='register'){
    const previous=await request('/api/lines');
    const existing=previous.lines.find(row=>row.label.toLocaleLowerCase()===values.name.trim().toLocaleLowerCase());
    const row=existing??await request('/api/lines',{label:values.name});
    console.log(JSON.stringify({lineKey:row.lineKey,label:row.label,alreadyRegistered:!!existing}));
  }else{
    sessionScope(config.accountId,values.line);
    const result=await request('/api/lines/'+encodeURIComponent(values.line)+'/'+command,{});
    console.log(JSON.stringify(result));
  }
}catch{console.error('No se pudo gestionar la línea. Revisa comando, nombre, panel activo, perfil y límite local.');process.exitCode=1;}
