import {readFile,writeFile,copyFile} from 'node:fs/promises';
const path='/app/.next/routes-manifest.json';
const data=JSON.parse(await readFile(path,'utf8'));
let changed=0;
for(const route of data.headers??[])for(const header of route.headers??[]){
 if(header.key.toLowerCase()==='cache-control'&&header.value==='public, max-age=0, s-maxage=300, stale-while-revalidate=86400'){
  header.value='private, no-store, max-age=0, must-revalidate';changed++;
 }
}
if(changed!==1)throw Error('Unexpected page cache configuration');
await copyFile(path,path+'.before-no-store');
await writeFile(path,JSON.stringify(data));
console.log('Page cache disabled; hashed static assets retain their cache policy');
