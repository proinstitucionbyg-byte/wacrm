import { describe, expect, it, vi } from 'vitest';
vi.mock('@/lib/flows/meta-send',()=>({engineSendText:vi.fn()}));
vi.mock('@/lib/ai/handoff-routing',()=>({routeConversationToArea:vi.fn()}));
import { handleTeacherInbound, parseTeachers, teacherPhone, teacherCancellationIntent, urgentTeacherClass } from './teachers';
import { engineSendText } from '@/lib/flows/meta-send';
import { routeConversationToArea } from '@/lib/ai/handoff-routing';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { AcademicModule } from './calendar';
const course='NUTRICION Y DIETETICA';
const modules:AcademicModule[]=[{course,module:'CLINICA',start_date:'2026-10-06',class_dates:['2026-10-06','2026-10-13','2026-10-15','2026-10-20','2026-10-22','2026-10-27','2026-10-29','2026-11-03'],hour:'20:00'}];
describe('docentes autorizados y urgencias',()=>{
  it('preserva códigos de Perú y Ecuador, sin tratar IDs opacos como teléfonos',()=>{
    expect(teacherPhone('+51 934 646 285')).toBe('51934646285');
    expect(teacherPhone('+593 98 675 8487')).toBe('593986758487');
    expect(teacherPhone('PE.234874')).toBeNull();
  });
  it('valida directorio y rechaza números compartidos ambiguos',()=>{
    const teacher={course,name:'RICARDO',phones:['+593 98 675 8487']};
    expect(parseTeachers([teacher])?.[0].phones).toEqual(['593986758487']);
    expect(parseTeachers([teacher,{...teacher,name:'OTRO'}])).toBeNull();
    expect(parseTeachers([{...teacher,phones:[]}])).toBeNull();
    expect(parseTeachers([{...teacher,course:'DESCONOCIDO'}])).toBeNull();
  });
  it('no interfiere con consultas de ventas',()=>expect(teacherCancellationIntent('Hola, información de nutrición')).toBe(false));
  it('acepta cancelación inequívoca desde treinta minutos antes hasta durante la clase',()=>{
    for(const time of ['19:30:00','20:00:00','21:59:59']) expect(urgentTeacherClass('No voy a poder dar la clase hoy',course,modules,new Date(`2026-10-13T${time}-05:00`))).toBe('2026-10-13');
  });
  it('aviso anticipado, clase terminada y días sin clase no cambian fechas',()=>{
    for(const date of ['2026-10-13T19:29:59','2026-10-13T22:00:00','2026-10-14T20:00:00'])expect(urgentTeacherClass('No puedo dar la clase hoy',course,modules,new Date(date+'-05:00'))).toBeNull();
  });
  it('preguntas, negaciones, otras fechas y otros cursos requieren revisión',()=>{
    const now=new Date('2026-10-13T20:00:00-05:00');
    for(const text of ['¿Podría reprogramar?','No se reprograma la clase','No puedo dar la clase mañana','Cancelo la clase del 15/10/2026','Cancelo la clase de farmacia'])expect(urgentTeacherClass(text,course,modules,now)).toBeNull();
    expect(urgentTeacherClass('Cancelo la clase del 13/10/2026',course,modules,now)).toBe('2026-10-13');
  });
});

describe('entrada del docente sin interferir con ventas',()=>{
  const input={accountId:'account',conversationId:'chat',contactId:'contact',userId:'owner',messageId:'message',text:'Soy docente, no puedo dictar la clase hoy',humanRecentlyActive:false};
  function database(channel='whatsapp',phone='593986758487',created=true) {
    const rpc=vi.fn().mockResolvedValue({data:{created},error:null});
    const from=vi.fn((table:string)=>{
      const query={select:()=>query,eq:()=>query,maybeSingle:async()=>({error:null,data:table==='academic_teacher_directories'?{teachers:[{name:'RICARDO',course,phones:['593986758487']}],updated_at:new Date().toISOString()}:table==='contacts'?{channel,phone}:null})};
      return query;
    });
    return {db:{from,rpc} as unknown as SupabaseClient,from,rpc};
  }
  it('un hola no consulta directorio ni intercepta automatizaciones',async()=>{
    const {db,from}=database();expect(await handleTeacherInbound(db,{...input,text:'hola'})).toBe(false);expect(from).not.toHaveBeenCalled();
  });
  it('un alumno que pregunta por una cancelación sigue en atención normal',async()=>{
    const {db,rpc}=database('whatsapp','51999999999');expect(await handleTeacherInbound(db,{...input,text:'Se canceló la clase?'})).toBe(false);expect(rpc).not.toHaveBeenCalled();
  });
  it('un número nuevo requiere identidad; no cambia fechas',async()=>{
    const {db,rpc}=database('whatsapp','51999999999');await handleTeacherInbound(db,input);
    expect(rpc).toHaveBeenCalledWith('record_teacher_reschedule',expect.objectContaining({p_day:null,p_teacher:null}));
    expect(engineSendText).toHaveBeenLastCalledWith(expect.objectContaining({text:expect.stringContaining('número no autorizado')}));
    expect(routeConversationToArea).toHaveBeenCalledWith(db,'account','chat','fidelizacion');
  });
  it('un perfil social nunca se confirma como docente solo por teléfono',async()=>{
    const {db,rpc}=database('instagram');await handleTeacherInbound(db,input);expect(rpc).toHaveBeenCalledWith('record_teacher_reschedule',expect.objectContaining({p_day:null,p_teacher:null}));
  });
  it('un reintento no duplica respuesta ni derivación',async()=>{
    vi.mocked(engineSendText).mockClear();vi.mocked(routeConversationToArea).mockClear();
    const {db}=database('whatsapp','593986758487',false);expect(await handleTeacherInbound(db,input)).toBe(true);expect(engineSendText).not.toHaveBeenCalled();expect(routeConversationToArea).not.toHaveBeenCalled();
  });
});
