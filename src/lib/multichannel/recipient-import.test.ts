import {describe,it,expect} from 'vitest';
import ExcelJS from 'exceljs';
import {campaignPhone} from './campaign-phone';
import {parseRecipientPaste,readRecipientFile} from './recipient-import';
describe('phone list review',()=>{
 it('normalizes all supplied Peru formats and removes duplicates',()=>{
  const result=parseRecipientPaste('937467119\n51 937 467 119\n+51 937 467 119\n937 467 119');
  expect(result.errors).toEqual([]);expect(result.duplicates).toBe(3);expect(result.recipients).toEqual([{phone:'+51937467119',name:'',country:'PE'}]);
 });
 it('keeps CSV quoted names and identifies actual international prefixes',()=>{
  const result=parseRecipientPaste('Teléfono,Nombre\n+1 415 555 2671,"Ejemplo, Ana"\n937 467 119,Luis');
  expect(result.errors).toEqual([]);expect(result.recipients[0]).toMatchObject({country:'US',name:'Ejemplo, Ana'});expect(result.recipients[1].country).toBe('PE');
 });
 it('does not guess unknown countries or strip arbitrary text into a phone',()=>{
  for(const value of ['123456789','+999123456789','abc937467119','937467119 ext 1','999+937467119'])expect(campaignPhone(value)).toBeNull();
  expect(parseRecipientPaste('Telefono\n+999123456789').errors).toHaveLength(1);
  expect(()=>parseRecipientPaste('Telefono,Nombre\n937467119,"sin cerrar')).toThrow('comillas');
 });
 it('accepts an actual Excel workbook, including numeric phone cells',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Contactos');sheet.addRows([['Celular','Nombre'],[937467119,'Demo'],['+51 937 467 119','Duplicado']]);
  const raw=await book.xlsx.writeBuffer(),data=new Uint8Array(raw).slice().buffer;
  const result=await readRecipientFile({name:'demo.xlsx',size:data.byteLength,arrayBuffer:async()=>data,text:async()=>''});
  expect(result.recipients).toEqual([{phone:'+51937467119',name:'Demo',country:'PE'}]);expect(result.duplicates).toBe(1);
 });
 it('rejects formulas, corrupt files and oversized input before contact creation',async()=>{
  const book=new ExcelJS.Workbook(),sheet=book.addWorksheet('Contactos');sheet.addRows([['Telefono'],[{formula:'1+1',result:2}]]);
  const raw=await book.xlsx.writeBuffer(),data=new Uint8Array(raw).slice().buffer;
  await expect(readRecipientFile({name:'formula.xlsx',size:data.byteLength,arrayBuffer:async()=>data,text:async()=>''})).rejects.toThrow('sin fórmulas');
  await expect(readRecipientFile({name:'bad.xlsx',size:1,arrayBuffer:async()=>new ArrayBuffer(1),text:async()=>''})).rejects.toThrow('dañado');
  await expect(readRecipientFile({name:'big.xlsx',size:3_000_000,arrayBuffer:async()=>data,text:async()=>''})).rejects.toThrow('2 MB');
 });
});
