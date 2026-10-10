import { describe, expect, it, vi } from 'vitest';
import { academicContext, academicOffer, parseAcademicModules } from './calendar';
const courses=['NUTRICION Y DIETETICA','AUXILIAR DE FARMACIA','RECURSOS HUMANOS','ASISTENTE ADMINISTRATIVO','AUXILIAR DE EDUCACION INICIAL'];
const input=()=>courses.flatMap(course=>[10,11].map(month=>({course,module:'MODULO',start_date:`2026-${month}-01`,class_dates:Array.from({length:8},(_,i)=>`2026-${month}-${String(i*2+1).padStart(2,'0')}`),hour:'20:00'})));
describe('academic calendar snapshot',()=>{
  it('offers only the incorporation date to the AI while retaining the official start internally',async()=>{
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-10-09T12:00:00-05:00'));
      const modules=courses.flatMap(course=>[
        {course,module:'CLINICA',start_date:'2026-10-06',class_dates:['2026-10-06','2026-10-13','2026-10-15','2026-10-20','2026-10-22','2026-10-27','2026-10-29','2026-11-03'],hour:'20:00'},
        {course,module:'SEGURIDAD',start_date:'2026-11-05',class_dates:['2026-11-05','2026-11-10','2026-11-12','2026-11-17','2026-11-19','2026-11-24','2026-11-26','2026-12-01'],hour:'20:00'},
      ]);
      const chain={select:()=>chain,eq:()=>chain,maybeSingle:async()=>({data:{modules,updated_at:new Date().toISOString()},error:null})};
      const db={from:()=>chain} as unknown as Parameters<typeof academicContext>[0];
      const context=(await academicContext(db,'account')).join('\n');
      expect(context).toContain('fecha disponible para incorporarse 2026-10-13');
      expect(context).not.toContain('2026-10-06');
      expect(context).toContain('Usa las automatizaciones configuradas');
      expect(academicOffer(modules,courses[0])?.start_date).toBe('2026-10-06');
      expect(modules[0].start_date).toBe('2026-10-06');
    } finally {vi.useRealTimers();}
  });
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
