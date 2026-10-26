import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { buildConversationContext } from '@/lib/ai/context';
import { conversationCourse } from '@/lib/ai/automation-match';
import { academicContext } from '@/lib/matriculas/calendar';

const path='output/centralizacion-2026-10/private/course-context-replay.json';
// The source contains private customer data and is deliberately absent from CI/Git.
describe.skipIf(!existsSync(path))('read-only replay of the observed cross-course timetable error',()=>{
  it('keeps Inicial and supplies its official 18:00 offer without another program or provider call',async()=>{
    const source=JSON.parse(readFileSync(path,'utf8'));
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(source.cut_at));
      const history={select:()=>history,eq:()=>history,in:()=>history,order:()=>history,
        limit:async(n:number)=>({data:n===20?source.recent:source.history,error:null})};
      const messages=await buildConversationContext({from:()=>history} as unknown as SupabaseClient,'captured-conversation',20);
      const selected=conversationCourse(messages);
      expect(selected).toBe('AUXILIAR DE EDUCACION INICIAL');
      const calendar={select:()=>calendar,eq:()=>calendar,maybeSingle:async()=>({data:source.calendar,error:null})};
      const facts=(await academicContext({from:()=>calendar} as unknown as SupabaseClient,'captured-account',selected)).join('\n');
      expect(facts).toContain('DESARROLLO SOCIOEMOCIONAL Y MANEJO CONDUCTUAL');
      expect(facts).toContain('SU CLASE ES EL 2026-11-16 A LAS 18:00');
      expect(facts).not.toContain('RECLUTAMIENTO');
      expect(facts).not.toContain('RECURSOS HUMANOS');
      expect(facts).not.toContain('A LAS 20:00');
    } finally {vi.useRealTimers();}
  });
});
