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
  sheet.getCell('C2').value='987020644';sheet.getCell('D2').value='Luis';sheet.getCell('B4').value='1';sheet.getCell('C4').value='2025550123';sheet.getCell('D4').value='Prueba';
  const output=await book.xlsx.writeBuffer(),bytes=Uint8Array.from(output);const result=await readRecipientFile({name:'plantilla.xlsx',size:bytes.byteLength,arrayBuffer:async()=>bytes.buffer,text:async()=>''});
  expect(result.errors).toEqual([]);expect(result.recipients.map(r=>[r.phone,r.name,r.variables])).toEqual([['+51987020644','Luis',undefined],['+12025550123','Prueba',undefined]]);
 });
 it('ignores reference numbering, accepts complete international numbers and retains custom dates',()=>{
  const result=recipientsFromRows([['Numero','Prefijo','Telefono','Nombre','fecha1'],['20','51','+12025550123','Rosa','30/11'],['1','51','987020644','Luis','01/12']]);
  expect(result.errors).toEqual([]);expect(result.recipients.map(r=>[r.phone,r.name,r.variables])).toEqual([['+12025550123','Rosa',{fecha1:'30/11'}],['+51987020644','Luis',{fecha1:'01/12'}]]);
 });
 it('requires owner access before generating the download',async()=>{h.role.mockRejectedValue(Error());expect((await GET()).status).toBe(403);});
});
