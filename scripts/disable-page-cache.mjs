import {readFile,writeFile,copyFile,readdir} from 'node:fs/promises';
const path='/app/.next/routes-manifest.json';
const data=JSON.parse(await readFile(path,'utf8'));
let changed=0;
for(const route of data.headers??[])for(const header of route.headers??[]){
 if(header.key.toLowerCase()==='cache-control'&&header.value==='public, max-age=0, s-maxage=300, stale-while-revalidate=86400'){
  header.value='private, no-store, max-age=0, must-revalidate';changed++;
 }
}
if(changed!==1&&!(data.headers??[]).some(r=>(r.headers??[]).some(h=>h.value==='private, no-store, max-age=0, must-revalidate')))throw Error('Unexpected page cache configuration');
await copyFile(path,path+'.before-no-store');
await writeFile(path,JSON.stringify(data));
const old='public, max-age=0, s-maxage=300, stale-while-revalidate=86400';
const replacement='private, no-store, max-age=0, must-revalidate';
const targets=['/app/server.js','/app/.next/required-server-files.json','/app/.next/prerender-manifest.json'];
async function metadata(dir){for(const item of await readdir(dir,{withFileTypes:true})){const file=dir+'/'+item.name;if(item.isDirectory())await metadata(file);else if(item.name.endsWith('.meta'))targets.push(file);}}
await metadata('/app/.next/server/app');
for(const file of targets){let text;try{text=await readFile(file,'utf8');}catch(e){if(e.code==='ENOENT')continue;throw e;}if(text.includes(old)){await copyFile(file,file+'.before-no-store');await writeFile(file,text.replaceAll(old,replacement));}}
console.log('Page cache disabled; hashed static assets retain their cache policy');
