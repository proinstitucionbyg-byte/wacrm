import { describe, expect, it } from 'vitest';
import { parseAcademicModules } from './calendar';
const courses=['NUTRICION Y DIETETICA','AUXILIAR DE FARMACIA','RECURSOS HUMANOS','ASISTENTE ADMINISTRATIVO','AUXILIAR DE EDUCACION INICIAL'];
const input=()=>courses.flatMap(course=>[10,11].map(month=>({course,module:'MODULO',start_date:`2026-${month}-01`,class_dates:Array.from({length:8},(_,i)=>`2026-${month}-${String(i*2+1).padStart(2,'0')}`),hour:'20:00'})));
describe('academic calendar snapshot',()=>{
  it('accepts exactly two modules for each of the five courses',()=>expect(parseAcademicModules(input())).toHaveLength(10));
  it('rejects missing courses and duplicate classes',()=>{
    expect(parseAcademicModules(input().slice(1))).toBeNull();
    const rows=input(); rows[0].class_dates[1]=rows[0].class_dates[0]; expect(parseAcademicModules(rows)).toBeNull();
  });
  it('rejects overlapping modules and malformed dates',()=>{
    const rows=input(); rows[1].start_date=rows[0].start_date; expect(parseAcademicModules(rows)).toBeNull();
    const bad=input(); bad[0].start_date='2026-02-30'; expect(parseAcademicModules(bad)).toBeNull();
  });
});
