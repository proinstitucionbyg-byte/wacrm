import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';
const source = readFileSync('output/sales-workbook-2026-10/VENTAS_BASE_CRM_SYNC.gs','utf8');
const context = () => { const c = createContext({console,Map,Date}); runInContext(source,c); return c; };
describe('commercial workbook synchronization', () => {
  it.each(['Recursos humanos','RECURSOS HUMANOS','recurso humano','Recursos   Humanos'])('classifies %s as Recursos Humanos', value => {
    expect(context().normalizeCourse_(value)).toBe('Recursos Humanos');
  });
  it('refuses an older API snapshot rather than erasing durable sales during deployment', () => {
    const c=context();let data=[{id:'lead'}];
    c.UrlFetchApp={fetch:()=>({getResponseCode:()=>200,getContentText:()=>JSON.stringify({data,meta:{}})})};
    expect(()=>c.fetchAllSalesLeads_('https://crm.example','key')).toThrow('Se conserva la base');
    data=[{id:'lead',commercial_sale_countable:false}] as typeof data;
    expect(c.fetchAllSalesLeads_('https://crm.example','key')).toHaveLength(1);
  });
  it('orders by CRM entry date and time while moving the complete row, including IDs and notes', () => {
    const c=context();let sortArgs:unknown;let rangeArgs:unknown;
    const sheet={getLastRow:()=>5001,getRange:(...args:number[])=>({getDisplayValues:()=>[['1'],['2'],['3']],sort:(sort:unknown)=>{sortArgs=sort;rangeArgs=args;}})};
    c.sortSalesChronologically_(sheet);
    expect(rangeArgs).toEqual([3,1,3,30]);
    expect(JSON.parse(JSON.stringify(sortArgs))).toEqual([{column:5,ascending:true},{column:6,ascending:true},{column:17,ascending:true}]);
  });
  it('refreshes 100 consecutive contacts in five writes without touching status, operations or notes', () => {
    const c=context();const writes:{row:number,col:number,n:number,w:number,values:unknown}[]=[];
    const sheet={getRange:(row:number,col:number,n:number,w:number)=>{
      const range={setValues:(values:unknown)=>{writes.push({row,col,n,w,values});return range;},setNumberFormat:()=>range};return range;
    }};
    c.refreshSalesRows_(sheet,Array.from({length:100},(_,i)=>({number:i+3,row:Array.from({length:23},(_,j)=>`${i}:${j}`),statusAt:''})));
    expect(writes).toHaveLength(5);
    expect(writes.map(w=>[w.col,w.w])).toEqual([[2,6],[9,5],[16,8],[26,1],[27,4]]);
    expect(writes.every(w=>![8,14,15].some(col=>col>=w.col&&col<w.col+w.w))).toBe(true);
  });
  function properties(seed: Record<string,string> = {}) {
    const values = new Map(Object.entries(seed));
    return {getProperty: (key:string) => values.get(key) ?? null, setProperty:(key:string,value:string) => values.set(key,value),deleteProperty:(key:string)=>values.delete(key)};
  }
  it('imports a CRM status change after the previous sheet status was synchronized', () => {
    const c=context(); const props=properties({'SALES_MAIN_STATUS:id':'INTERESADO'});
    expect(c.reconcileSalesMainStatus_('id','VENTA','INTERESADO',props,'https://crm.example',100)).toBe('VENTA');
    expect(props.getProperty('SALES_MAIN_STATUS:id')).toBe('VENTA');
  });
  it('does not rewrite remembered states for 300 unchanged contacts', () => {
    const c=context();
    const props=properties(Object.fromEntries(Array.from({length:300},(_,i)=>[`SALES_MAIN_STATUS:lead-${i}`,'INTERESADO'])));
    const write=vi.spyOn(props,'setProperty');
    c.UrlFetchApp={fetch:vi.fn(()=>{throw new Error('Unchanged states must not be sent to CRM');})};
    for(let i=0;i<300;i++) {
      expect(c.reconcileSalesMainStatus_(`lead-${i}`,'INTERESADO','INTERESADO',props,'https://crm.example',100)).toBe('INTERESADO');
    }
    expect(write).not.toHaveBeenCalled();
    expect(c.UrlFetchApp.fetch).not.toHaveBeenCalled();
  });
  it('remembers a changed or initially empty CRM state once, then skips identical writes', () => {
    const c=context();const props=properties({'SALES_MAIN_STATUS:changed':'INTERESADO'});
    const write=vi.spyOn(props,'setProperty');
    expect(c.reconcileSalesMainStatus_('changed','NO CONTESTA','INTERESADO',props,'https://crm.example',100)).toBe('NO CONTESTA');
    expect(c.reconcileSalesMainStatus_('empty',null,'',props,'https://crm.example',100)).toBe('');
    expect(write).toHaveBeenCalledTimes(2);
    expect(c.reconcileSalesMainStatus_('changed','NO CONTESTA','NO CONTESTA',props,'https://crm.example',100)).toBe('NO CONTESTA');
    expect(c.reconcileSalesMainStatus_('empty',null,'',props,'https://crm.example',100)).toBe('');
    expect(write).toHaveBeenCalledTimes(2);
  });
  it('keeps unsent local changes and retries rather than replacing them with old CRM data', () => {
    const c=context(); const props=properties({'CRM_WRITE_API_KEY':'test-key','SALES_MAIN_STATUS:id':'','SALES_PENDING_STATE:id':'INTERESADO'});
    c.UrlFetchApp={fetch:()=>({getResponseCode:()=>403})};
    expect(c.reconcileSalesMainStatus_('id','','INTERESADO',props,'https://crm.example',100)).toBe('INTERESADO');
    expect(props.getProperty('SALES_PENDING_STATE:id')).toBe('INTERESADO');
    c.UrlFetchApp={fetch:()=>({getResponseCode:()=>200})};
    expect(c.reconcileSalesMainStatus_('id','','INTERESADO',props,'https://crm.example',100)).toBe('INTERESADO');
    expect(props.getProperty('SALES_PENDING_STATE:id')).toBeNull();
  });
  it('does not overwrite a sheet edit made after the CRM snapshot started', () => {
    const c=context(); const props=properties({'SALES_MAIN_STATUS:id':'VENTA','SALES_MAIN_EDIT_AT:id':'101'});
    expect(c.reconcileSalesMainStatus_('id','INTERESADO','VENTA',props,'https://crm.example',100)).toBe('VENTA');
  });
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
  it('retains the closing adviser history after the chat assignment changes, including a removed sale', () => {
    const c=context();const adviser={user_id:'owner-a',active_for_sales:true};
    const lead={id:'closed',assigned_adviser_id:'fidelity-person',sale_owner_id:'owner-a',commercial_sale_countable:false};
    expect(JSON.parse(JSON.stringify(c.salesLeadsForAdviser_(adviser,[lead])))).toEqual([lead]);
    expect(JSON.parse(JSON.stringify(c.salesHistoryCells_({...lead,sale_owner_name:'ANA'})))).toEqual(['NO','ANA','','owner-a']);
  });
  it('does not create personal files or share data when no adviser is active', () => {
    const c=context(); const create=vi.fn(); c.SpreadsheetApp={create};
    const main={getLastRow:()=>2,getRange:()=>({getValues:()=>[[]]})};
    c.syncSalesPersonalBases_({getSheetByName:()=>main},{getRange:()=>({getDisplayValues:()=>[]})},[{user_id:'a',active_for_sales:false}],[],{getProperty:()=>null});
    expect(create).not.toHaveBeenCalled();
  });
  it('publishes only names, sales and goals to the personal ranking, never CEO-only metrics', () => {
    const c=context();const reads:unknown[][]=[];const writes:unknown[][]=[];let cleared=false;
    const source={getRange:(...args:unknown[])=>{
      reads.push(args);return {getValue:()=>1,getValues:()=>Array.from({length:103},()=>Array(6).fill('public'))};
    },copyTo:()=>{throw new Error('Copying the private CEO sheet is forbidden');}};
    const target:Record<string,unknown>={getMaxRows:()=>160,getDataRange:()=>({breakApart:()=>({clearContent:()=>{cleared=true;}})}),getCharts:()=>[]};
    target.getRange=(...args:unknown[])=>{const range:Record<string,unknown>={setValues:(rows:unknown)=>{writes.push([args,rows]);return range;}};
      range.getDisplayValue=()=>'';
      for(const method of ['merge','setValue','setNumberFormat','setBackground','setFontColor','setFontWeight','setWrap'])range[method]=()=>range;return range;};
    for(const method of ['setColumnWidth','setFrozenRows','setHiddenGridlines','insertChart'])target[method]=()=>target;
    target.newChart=()=>{const chart:Record<string,unknown>={build:()=>({})};for(const method of ['setChartType','addRange','setNumHeaders','setOption','setPosition'])chart[method]=()=>chart;return chart;};
    c.Charts={ChartType:{BAR:'BAR',PIE:'PIE'}};
    c.syncSalesSharedRanking_({getSheetByName:()=>source},{getSheetByName:()=>target});
    expect(cleared).toBe(true);
    expect(reads).toEqual([['B3'],['B4'],['E4'],[6,1,103,6]]);
    expect(writes).toHaveLength(2);
    expect(writes.every((w)=>((w[0] as number[])[1]+(w[0] as number[])[3]-1)<=6)).toBe(true);
  });
  it('creates and reuses 100 isolated personal bases without sharing permissions', () => {
    const c=context();
    const advisers=Array.from({length:100},(_,i)=>({user_id:`staff-${i}`,name:'ANA',active_for_sales:true}));
    const leads=advisers.map((a,i)=>({id:`contact-${i}`,assigned_adviser_id:a.user_id}));
    const master=leads.map((lead,i)=>Array.from({length:30},(_,col)=>col===16?lead.id:col===1?`PERSON ${i}`:''));
    const directoryRows=advisers.map(a=>[a.user_id,a.name,'','','','Activo','','']);
    const directory={getRange:(r:number,col:number)=>({getDisplayValues:()=>directoryRows,setValue:(v:string)=>{directoryRows[r-3][col-1]=v;}})};
    const main={getLastRow:()=>102,getRange:(r:number,col:number,n=1,w=1)=>({getDisplayValues:()=>master.map(row=>row.slice(0,17)),getValues:()=>r===2?[Array(30).fill('Header')]:master,getDataValidation:()=>({}),setValue:()=>{}})};
    const ss={getId:()=> 'general',getSheetByName:(name:string)=>name==='BASE GENERAL'?main:null};
    const books=new Map<string,unknown>();
    function createBook() {
      const cells=new Map<string,unknown>(); let last=0;
      const sheet:Record<string,unknown>={getLastRow:()=>last,getMaxColumns:()=>30,setName:()=>sheet};
      sheet.getRange=(r:number,col:number,n=1,w=1)=>{
        const range:Record<string,unknown>={
          getDisplayValue:()=>String(cells.get(`${r}:${col}`)||''),
          getValues:()=>Array.from({length:n},(_,i)=>Array.from({length:w},(_,j)=>cells.get(`${r+i}:${col+j}`)||'')),
          setValue:(value:unknown)=>{cells.set(`${r}:${col}`,value);last=Math.max(last,r);return range;},
          setValues:(rows:unknown[][])=>{rows.forEach((row,i)=>row.forEach((value,j)=>cells.set(`${r+i}:${col+j}`,value)));last=Math.max(last,r+rows.length-1);return range;},
        };
        for(const method of ['setFontWeight','setBackground','setFontColor','setDataValidation','setNumberFormat','clearContent'])range[method]=()=>range;
        return range;
      };
      for(const method of ['setFrozenRows','hideColumns','setHiddenGridlines','setColumnWidth'])sheet[method]=()=>sheet;
      const id=`private-${books.size}`;
      const book={getId:()=>id,getUrl:()=>`https://docs.google.com/spreadsheets/d/${id}/edit`,getSheets:()=>[sheet],getSheetByName:()=>sheet,cells};
      books.set(id,book);return book;
    }
    const create=vi.fn(createBook); c.SpreadsheetApp={create,openById:(id:string)=>books.get(id)};
    const props=properties();
    c.syncSalesPersonalBases_(ss,directory,advisers,leads,props);
    c.syncSalesPersonalBases_(ss,directory,advisers,leads,props);
    const partial=c.syncSalesPersonalBases_(ss,directory,advisers,leads,props,0);
    expect(partial.pending).toBe(99);
    expect(props.getProperty('SALES_PERSONAL_NEXT_USER')).toBe('staff-1');
    c.syncSalesPersonalBases_(ss,directory,advisers,leads,props,0);
    expect(props.getProperty('SALES_PERSONAL_NEXT_USER')).toBe('staff-2');
    expect(create).toHaveBeenCalledTimes(100);
    [...books.values()].forEach((book,i)=>{
      const cells=(book as {cells:Map<string,unknown>}).cells;
      expect(cells.get('3:17')).toBe(`contact-${i}`);
      expect(cells.get('1:17')).toBe(`ASESORA CRM:staff-${i}`);
    });
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
