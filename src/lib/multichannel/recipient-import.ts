import ExcelJS from 'exceljs';
import {campaignPhone} from './campaign-phone';
export type ImportedRecipient={phone:string;name:string;country:string|null};
const label=(v:string)=>v.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toUpperCase();
const phoneHeaders=['TELEFONO','CELULAR','WHATSAPP','NUMERO','PHONE','DESTINO','MOVIL'];
export function recipientsFromRows(rows:string[][]){
 const nonempty=rows.filter(row=>row.some(cell=>cell.trim()));
 if(!nonempty.length)throw Error('La lista está vacía.');
 const header=nonempty[0].map(label),column=header.findIndex(cell=>phoneHeaders.includes(cell));
 const nameColumn=header.findIndex(cell=>['NOMBRE','NOMBRE COMPLETO','NAME'].includes(cell));
 let data=column>=0?nonempty.slice(1):nonempty;
 // A plain list can contain several phone numbers per row without a header.
 if(column<0&&data.every(row=>row.every(cell=>!cell.trim()||campaignPhone(cell))))data=data.flatMap(row=>row.filter(cell=>cell.trim()).map(cell=>[cell]));
 if(data.length<1||data.length>1000)throw Error('Carga entre 1 y 1000 teléfonos por lista.');
 const seen=new Set<string>(),recipients:ImportedRecipient[]=[],errors:string[]=[];let duplicates=0;
 data.forEach((row,index)=>{
  const raw=row[column>=0?column:0]??'',parsed=campaignPhone(raw);
  if(!parsed){errors.push('Fila '+(index+(column>=0?2:1))+': teléfono inválido o sin prefijo internacional.');return;}
  if(seen.has(parsed.phone)){duplicates++;return;}seen.add(parsed.phone);
  const name=(row[column>=0?nameColumn:1]??'').trim();
  if(name.length>200){errors.push('Fila '+(index+1)+': nombre demasiado largo.');return;}
  recipients.push({phone:parsed.phone,country:parsed.country,name});
 });
 return {recipients,duplicates,errors};
}
export function parseRecipientPaste(text:string){
 if(text.length>200000)throw Error('La lista es demasiado grande.');
 const first=text.replace(/^\uFEFF/,'').split(/\r?\n/)[0]??'';
 const delimiter=first.includes('\t')?'\t':first.includes(';')?';':',';
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false;
 const clean=text.replace(/^\uFEFF/,'');
 for(let i=0;i<clean.length;i++){
  const char=clean[i];
  if(char==='"'){if(quoted&&clean[i+1]==='"'){cell+='"';i++;}else quoted=!quoted;}
  else if(!quoted&&(char===delimiter||char==='\n')){row.push(cell.replace(/\r$/,''));cell='';if(char==='\n'){rows.push(row);row=[];}}
  else cell+=char;
 }
 if(quoted)throw Error('Hay comillas sin cerrar en la lista.');
 row.push(cell.replace(/\r$/,''));rows.push(row);return recipientsFromRows(rows);
}
function boundedWorkbook(buffer:ArrayBuffer){
 const bytes=new Uint8Array(buffer),view=new DataView(buffer);let end=-1;
 for(let offset=bytes.length-22;offset>=Math.max(0,bytes.length-65557);offset--){if(view.getUint32(offset,true)===0x06054b50){end=offset;break;}}
 if(end<0)throw Error('El archivo Excel está dañado.');
 const count=view.getUint16(end+10,true),length=view.getUint32(end+12,true);let cursor=view.getUint32(end+16,true),total=0;
 if(count>1000||cursor+length>end)throw Error('El Excel contiene demasiados datos.');
 for(let entry=0;entry<count;entry++){
  if(cursor+46>end||view.getUint32(cursor,true)!==0x02014b50)throw Error('El archivo Excel está dañado.');
  const size=view.getUint32(cursor+24,true);total+=size;
  if(size>10_000_000||total>20_000_000||(view.getUint16(cursor+8,true)&1))throw Error('Usa un Excel sencillo, sin cifrado y con hasta 1000 contactos.');
  cursor+=46+view.getUint16(cursor+28,true)+view.getUint16(cursor+30,true)+view.getUint16(cursor+32,true);
 }
 if(cursor>end)throw Error('El archivo Excel está dañado.');
}
export async function readRecipientFile(file:Pick<File,'name'|'size'|'arrayBuffer'|'text'>){
 if(file.size>2_000_000)throw Error('El archivo no debe superar 2 MB.');
 if(/\.(csv|txt|tsv)$/i.test(file.name))return parseRecipientPaste(await file.text());
 if(!/\.xlsx$/i.test(file.name))throw Error('Usa Excel .xlsx, CSV o una lista de texto.');
 const buffer=await file.arrayBuffer();boundedWorkbook(buffer);
 const workbook=new ExcelJS.Workbook();
 await workbook.xlsx.load(buffer);
 const sheet=workbook.worksheets[0];if(!sheet||sheet.rowCount>1001||sheet.columnCount>30)throw Error('Usa la primera hoja con hasta 1000 teléfonos y 30 columnas.');
 const rows:string[][]=[];
 for(let r=1;r<=sheet.rowCount;r++){
  const row:string[]=[];
  for(let c=1;c<=sheet.columnCount;c++){
   const value=sheet.getCell(r,c).value;
   if(value===null||value===undefined)row.push('');
   else if(typeof value==='string')row.push(value);
   else if(typeof value==='number'&&Number.isSafeInteger(value))row.push(String(value));
   else throw Error('Fila '+r+': usa texto o números enteros, sin fórmulas ni enlaces.');
  }rows.push(row);
 }
 return recipientsFromRows(rows);
}
