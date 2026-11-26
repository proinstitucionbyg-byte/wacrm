import {readFile,writeFile,copyFile} from 'node:fs/promises';
const path='/runtime/contabo-worker-entrypoint.mjs';
const before='plan=validatePlan(proposed,owner,registry,scope);';
const after="plan=validatePlan({...proposed,lines:proposed.lines.filter(line=>{const row=registry.lines.find(r=>r.lineKey===line.lineKey);return row&&!row.archived&&!row.released&&!row.label?.startsWith('Historial ');})},owner,registry,scope);";
const source=await readFile(path,'utf8');
if(source.includes(after)){console.log('Startup plan already corrected');process.exit(0);}
if(source.split(before).length!==2)throw Error('Unexpected entrypoint; refusing patch');
await copyFile(path,path+'.before-archived-plan-fix');
await writeFile(path,source.replace(before,after));
console.log('Archived and released profiles excluded from startup plan');
