import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('output/sales-workbook-2026-10/VENTAS_BASE_CRM_SYNC.gs','utf8');
const context = () => { const c = createContext({console,Map,Date}); runInContext(source,c); return c; };
describe('commercial workbook synchronization', () => {
  it('ignores commission formulas below the last real contact and preserves manual rows', () => {
    const c = context();
    const rows = Array.from({length: 4999}, () => Array(17).fill(''));
    rows[0][16] = 'crm-id';
    rows[2][1] = 'Manual contact';
    expect(c.salesLastDataRow_({getLastRow: () => 5001, getRange: () => ({getDisplayValues: () => rows})})).toBe(5);
    expect(c.salesLastDataRow_({getLastRow: () => 2})).toBe(2);
  });
  it('stores the Lima calendar day without the message time fraction', () => {
    const c = context();
    c.Utilities = {formatDate: () => '2026-10-23'};
    expect(c.salesDay_(new Date('2026-10-24T04:59:00Z'),'America/Lima').toISOString()).toBe('2026-10-23T05:00:00.000Z');
    expect(c.salesDay_('', 'America/Lima')).toBe('');
  });
  it('preserves personal links and rotation order by CRM user ID, not roster position', () => {
    const c = context(); let result: unknown;
    const sheet = {getRange: () => ({getDisplayValues: () => [['b','B','','','','',2,'link-b'],['a','A','','','','',1,'link-a']],setValues: (rows: unknown) => {result=rows;}})};
    c.syncSalesAdviserDirectory_(sheet,[{user_id:'a',name:'A',active_for_sales:true},{user_id:'b',name:'B',active_for_sales:false}]);
    const rows=JSON.parse(JSON.stringify(result));
    expect(rows).toHaveLength(100);
    expect(rows[0].slice(6)).toEqual([1,'link-a']);
    expect(rows[1].slice(6)).toEqual([2,'link-b']);
    expect(rows[1][5]).toBe('Inactivo');
  });
  it('isolates 100 advisers even with identical display names and stops disabled advisers', () => {
    const c=context();
    const advisers=Array.from({length:100},(_,i)=>({user_id:`user-${i}`,name:'ANA',active_for_sales:true}));
    const leads=advisers.map((a,i)=>({id:`lead-${i}`,assigned_adviser_id:a.user_id}));
    advisers.forEach((a,i)=>expect(JSON.parse(JSON.stringify(c.salesLeadsForAdviser_(a,leads)))).toEqual([leads[i]]));
    expect(c.salesLeadsForAdviser_({...advisers[0],active_for_sales:false},leads)).toHaveLength(0);
  });
  it('does not create personal files or share data when no adviser is active', () => {
    const c=context(); const create=vi.fn(); c.SpreadsheetApp={create};
    const main={getLastRow:()=>2,getRange:()=>({getValues:()=>[[]]})};
    c.syncSalesPersonalBases_({getSheetByName:()=>main},{getRange:()=>({getDisplayValues:()=>[]})},[{user_id:'a',active_for_sales:false}],[],{getProperty:()=>null});
    expect(create).not.toHaveBeenCalled();
  });
  it('refuses to overwrite a personal edit after a failed status upload', () => {
    const c=context(); c.UrlFetchApp={fetch:()=>({getResponseCode:()=>403})};
    expect(()=>c.sendSalesPersonalStatus_('https://crm.example','key','id','INTERESADO')).toThrow('Se conserva la edición');
  });
  it('keeps system attribution separate from active human staff', () => {
    const c=context();
    expect(c.institutionalName_('INSTITUCION')).toBe('ASESOR INSTITUTO');
    expect(c.normalizeAdviser_({ai_enabled:true},new Map())).toBe('ASESOR INSTITUTO');
    expect(c.normalizeAdviser_({ai_enabled:false,automation_enabled:false},new Map())).toBe('');
  });
});
