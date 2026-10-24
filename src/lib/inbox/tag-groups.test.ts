import { describe, expect, it } from 'vitest';
import type { Tag } from '@/types';
import { groupTags, tagGroup } from './tag-groups';
import { SALES_COMMERCIAL_STATUSES } from '@/lib/sales/commercial-status';
const tag=(name:string, extra:Partial<Tag>={}):Tag=>({id:name,name,color:'#fff',...extra} as Tag);

describe('authorized tag grouping',()=>{
  it('puts every existing commercial status in Sales without changing names or adding catalog entries',()=>{
    const input=SALES_COMMERCIAL_STATUSES.map(name=>tag(name));
    const output=groupTags(input);
    expect(output).toHaveLength(1);expect(output[0].name).toBe('VENTAS');
    expect(output[0].tags.map(t=>t.name).sort()).toEqual([...SALES_COMMERCIAL_STATUSES].sort());
  });
  it('separates operational fidelity, payment and personal responsibility labels',()=>{
    expect(tagGroup(tag('AREA FIDELIZACION'))).toBe('FIDELIZACIÓN');
    expect(tagGroup(tag('URGENTE · EXPEDIENTE DE MATRÍCULA'))).toBe('FIDELIZACIÓN');
    expect(tagGroup(tag('PAGO VALIDADO'))).toBe('PAGOS Y MATRÍCULAS');
    expect(tagGroup(tag('ASESOR ANTONELLA',{kind:'system'}))).toBe('RESPONSABLES');
  });
  it('never imports tags outside the authorized input or mutates their audience',()=>{
    const input=[tag('Solo para Finanzas',{audience:{users:['specific-user'],areas:['FINANZAS'],roles:[]}})];
    const before=JSON.stringify(input);const output=groupTags(input);
    expect(output[0].name).toBe('FINANZAS');expect(output[0].tags).toEqual(input);expect(JSON.stringify(input)).toBe(before);
  });
});
