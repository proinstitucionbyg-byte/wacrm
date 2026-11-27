import{beforeEach,describe,it,expect,vi}from'vitest';
import ExcelJS from'exceljs';
import{recipientsFromRows,readRecipientFile}from'./recipient-import';
const h=vi.hoisted(()=>({role:vi.fn()}));
vi.mock('@/lib/auth/account',()=>({requireRole:h.role,toErrorResponse:()=>Response.json({error:'No autorizado'},{status:403})}));
import{GET}from'@/app/api/multichannel/campaigns/template/route';
beforeEach(()=>{h.role.mockResolvedValue({accountId:'owner'});});
describe('campaign recipient template',()=>{
 it('downloads 1000 numbered blank slots, then imports only populated rows in their original order',async()=>{
  const response=await GET();expect(response.headers.get('content-disposition')).toContain('.xlsx');const buffer=await response.arrayBuffer(),book=new ExcelJS.Workbook();await book.xlsx.load(buffer);
  const sheet=book.worksheets[0];expect(sheet.rowCount).toBe(1001);expect(sheet.getCell('A1001').value).toBe(1000);
  expect(sheet.getRow(1).values).toEqual([undefined,'Orden','Telefono','Nombre']);
  sheet.getCell('B2').value='987020644';sheet.getCell('C2').value='Luis';sheet.getCell('B4').value='12025550123';sheet.getCell('C4').value='Prueba';
  const output=await book.xlsx.writeBuffer(),bytes=Uint8Array.from(output);const result=await readRecipientFile({name:'plantilla.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer,text:async()=>''});
  expect(result.errors).toEqual([]);expect(result.recipients.map(r=>[r.phone,r.name,r.variables])).toEqual([['+51987020644','Luis',undefined],['+12025550123','Prueba',undefined]]);
 });
 it('recognizes mixed countries from complete numbers without a prefix column and deduplicates Peru',()=>{
  const result=recipientsFromRows([['Orden','Telefono','Nombre'],['1','987020644','Luis'],['2','51 987 020 644','Luis'],['3','+57 300 123 4567','Rosa'],['4','12025550123','Pedro'],['5','0034 612 345 678','Ana']]);
  expect(result.errors).toEqual([]);expect(result.duplicates).toBe(1);expect(result.recipients.map(r=>[r.phone,r.country,r.name])).toEqual([['+51987020644','PE','Luis'],['+573001234567','CO','Rosa'],['+12025550123','US','Pedro'],['+34612345678','ES','Ana']]);
 });
 it('ignores reference numbering, accepts complete international numbers and retains custom dates',()=>{
  const result=recipientsFromRows([['Numero','Prefijo','Telefono','Nombre','fecha1'],['20','51','+12025550123','Rosa','30/11'],['1','51','987020644','Luis','01/12']]);
  expect(result.errors).toEqual([]);expect(result.recipients.map(r=>[r.phone,r.name,r.variables])).toEqual([['+12025550123','Rosa',{fecha1:'30/11'}],['+51987020644','Luis',{fecha1:'01/12'}]]);
 });
 it('requires owner access before generating the download',async()=>{h.role.mockRejectedValue(Error());expect((await GET()).status).toBe(403);});
});
