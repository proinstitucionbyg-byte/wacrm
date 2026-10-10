import { describe, expect, it } from 'vitest';
import { contarClasesPeriodo, ofertaDeInicio, planificarModulo, secuenciaModulos, tareasPorReprogramacion } from './calendario-modulos';

const horario = { inicio: '2026-10-06', dias: [2, 4], hora: '20:00', excluidas: ['2026-10-08'] };
describe('modulos ciclicos e ingresos', () => {
  it('cuenta del 6 al 20 y separa el feriado de las clases previstas', () => {
    const result = contarClasesPeriodo(horario,'2026-10-06','2026-10-20');
    expect(result.programadas).toHaveLength(5);
    expect(result.canceladas).toEqual(['2026-10-08']);
    expect(result.previstas).toHaveLength(4);
  });
  it('cuenta cancelacion del docente en ambos horarios del miercoles', () => {
    for (const dias of [[1,3],[3,5]]) {
      const inicio = dias[0] === 1 ? '2026-10-05' : '2026-09-25';
      const result=contarClasesPeriodo({...horario,inicio,dias,excluidas:['2026-10-07']},'2026-10-06','2026-10-20');
      expect(result.programadas).toHaveLength(4);
      expect(result.previstas).toHaveLength(3);
      expect(result.canceladas).toEqual(['2026-10-07']);
    }
  });
  it('segundo corte incluye el dia 5 del mes siguiente', () => {
    const result=contarClasesPeriodo(horario,'2026-10-21','2026-11-05');
    expect(result.previstas).toHaveLength(5);
    expect(result.previstas.at(-1)).toBe('2026-11-05');
  });
  it.each([
    ['2026-09-25',[3,5],[], '2026-10-23'],
    ['2026-09-16',[1,3],[], '2026-10-14'],
    ['2026-09-25',[3,5],['2026-10-07'], '2026-10-28'],
    ['2026-10-05',[1,3],['2026-10-07'], '2026-11-04'],
    ['2026-11-11',[1,3],['2026-12-08','2026-12-09'], '2026-12-14'],
    ['2026-11-25',[3,5],['2026-12-08','2026-12-09','2026-12-25'], '2026-12-30'],
  ])('inicio %s y cancelaciones calculan proximo modulo %s', (inicio,dias,excluidas,siguiente) => {
    expect(planificarModulo({inicio,dias,hora:'20:00',excluidas}).siguienteInicio).toBe(siguiente);
  });
  it('conserva ocho clases y salta el feriado de Angamos', () => {
    const plan = planificarModulo(horario);
    expect(plan.clases).toEqual(['2026-10-06','2026-10-13','2026-10-15','2026-10-20','2026-10-22','2026-10-27','2026-10-29','2026-11-03']);
    expect(plan.siguienteInicio).toBe('2026-11-05');
  });
  it('sin cancelacion el siguiente modulo comienza el 3 de noviembre', () => {
    expect(planificarModulo({ ...horario, excluidas: [] }).siguienteInicio).toBe('2026-11-03');
  });
  it('una cancelacion docente corre las clases restantes sin perder clases', () => {
    const plan = planificarModulo({ ...horario, excluidas: [...horario.excluidas, '2026-10-13'] });
    expect(plan.clases).toHaveLength(8);
    expect(plan.clases[1]).toBe('2026-10-15');
    expect(plan.siguienteInicio).toBe('2026-11-10');
  });
  it('para el ingreso del 9 ofrece el 13 pero registra el inicio oficial del 6', () => {
    expect(ofertaDeInicio(planificarModulo(horario), new Date('2026-10-09T10:00:00-05:00'))).toEqual({moduloActual:true,fechaOfrecida:'2026-10-13',fechaOficial:'2026-10-06'});
  });
  it('cierra ingreso ordinario exactamente al comenzar la tercera clase en Lima', () => {
    const plan = planificarModulo(horario);
    expect(ofertaDeInicio(plan, new Date('2026-10-15T19:59:59-05:00')).moduloActual).toBe(true);
    expect(ofertaDeInicio(plan, new Date('2026-10-15T20:00:00-05:00'))).toEqual({moduloActual:false,fechaOfrecida:'2026-11-05',fechaOficial:'2026-11-05'});
  });
  it('rotacion de julio termina por el modulo de junio', () => {
    expect(secuenciaModulos(['A','B','C','D','E','F'], 1)).toEqual(['B','C','D','E','F','A']);
  });
  it('marca tareas aunque se cancele una clase intermedia', () => {
    const anterior = planificarModulo(horario);
    expect(tareasPorReprogramacion(anterior, anterior)).toEqual([]);
    expect(tareasPorReprogramacion(anterior, planificarModulo({...horario,excluidas:['2026-10-08','2026-10-20']}))).toContain('AVISAR A LOS GRUPOS');
  });
  it('rechaza un inicio en feriado o fuera del horario', () => {
    expect(() => planificarModulo({...horario,inicio:'2026-10-08'})).toThrow('REPROGRAMAR');
    expect(() => planificarModulo({...horario,inicio:'2026-10-09'})).toThrow('REPROGRAMAR');
  });
});
