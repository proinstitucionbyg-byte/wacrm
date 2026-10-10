/** Calendario academico. Las fechas civiles y horas se interpretan en Lima. */
export interface HorarioModulo {
  inicio: string;
  dias: number[]; // 0 DOMINGO ... 6 SABADO
  hora: string; // HH:mm
  excluidas: string[]; // Feriados confirmados y cancelaciones de este grupo
}
export interface PlanModulo {
  inicio: string;
  clases: string[];
  siguienteInicio: string;
  hora: string;
}

function fechaCivil(fecha: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) throw new Error('FECHA INVALIDA');
  const value = new Date(fecha + 'T12:00:00Z');
  if (Number.isNaN(value.getTime()) || value.toISOString().slice(0, 10) !== fecha) throw new Error('FECHA INVALIDA');
  return value;
}

export function planificarModulo(horario: HorarioModulo): PlanModulo {
  const fecha = fechaCivil(horario.inicio);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(horario.hora)) throw new Error('HORA INVALIDA');
  if (!horario.dias.length || horario.dias.some(d => !Number.isInteger(d) || d < 0 || d > 6)) throw new Error('DIAS INVALIDOS');
  const excluidas = new Set(horario.excluidas.map(d => { fechaCivil(d); return d; }));
  if (!horario.dias.includes(fecha.getUTCDay()) || excluidas.has(horario.inicio)) throw new Error('INICIO SIN CLASE: REPROGRAMAR');
  const clases: string[] = [];
  // No se adivinan fechas si todo el periodo fue suspendido.
  for (let i = 0; i < 730; i++) {
    const dia = fecha.toISOString().slice(0, 10);
    if (horario.dias.includes(fecha.getUTCDay()) && !excluidas.has(dia)) {
      if (clases.length === 8) return { inicio: horario.inicio, clases, siguienteInicio: dia, hora: horario.hora };
      clases.push(dia);
    }
    fecha.setUTCDate(fecha.getUTCDate() + 1);
  }
  throw new Error('NO HAY NUEVE FECHAS DISPONIBLES');
}

export function secuenciaModulos(modulos: string[], primerIndice: number): string[] {
  if (modulos.length !== 6 || new Set(modulos).size !== 6 || modulos.some(m => !m.trim())) throw new Error('SE REQUIEREN SEIS MODULOS DISTINTOS');
  if (!Number.isInteger(primerIndice) || primerIndice < 0 || primerIndice > 5) throw new Error('MODULO INVALIDO');
  return modulos.map((_, i) => modulos[(primerIndice + i) % 6]);
}

export function ofertaDeInicio(plan: PlanModulo, ahora: Date) {
  if (Number.isNaN(ahora.getTime())) throw new Error('FECHA INVALIDA');
  const instante = (dia: string) => new Date(`${dia}T${plan.hora}:00-05:00`).getTime();
  // Al comenzar la tercera clase deja de ofrecerse como ingreso ordinario.
  if (ahora.getTime() >= instante(plan.clases[2])) {
    return { moduloActual: false, fechaOfrecida: plan.siguienteInicio, fechaOficial: plan.siguienteInicio };
  }
  const proxima = plan.clases.find(d => instante(d) > ahora.getTime());
  return { moduloActual: true, fechaOfrecida: proxima!, fechaOficial: plan.inicio };
}

export function tareasPorReprogramacion(anterior: PlanModulo, actualizado: PlanModulo): string[] {
  if (anterior.inicio === actualizado.inicio && anterior.hora === actualizado.hora && anterior.siguienteInicio === actualizado.siguienteInicio && anterior.clases.join() === actualizado.clases.join()) return [];
  return ['AVISAR A LOS GRUPOS', 'AVISAR AL DOCENTE', 'AVISAR A LOS NUEVOS INGRESOS', 'ACTUALIZAR FECHAS EN MATRICULAS', 'REVISAR CRONOGRAMAS YA EMITIDOS'];
}

/** Cuenta calendario, no asistencia. Dictadas requiere confirmacion aparte. */
export function contarClasesPeriodo(horario: HorarioModulo, desde: string, hasta: string) {
  const dia = fechaCivil(desde), fin = fechaCivil(hasta);
  planificarModulo(horario); // Validar dias, hora y exclusiones.
  if (dia > fin) throw new Error('PERIODO INVALIDO');
  const programadas: string[] = [], canceladas: string[] = [], previstas: string[] = [];
  const excluidas = new Set(horario.excluidas);
  while (dia <= fin) {
    const fecha = dia.toISOString().slice(0, 10);
    if (fecha >= horario.inicio && horario.dias.includes(dia.getUTCDay())) {
      programadas.push(fecha);
      (excluidas.has(fecha) ? canceladas : previstas).push(fecha);
    }
    dia.setUTCDate(dia.getUTCDate() + 1);
  }
  return {programadas,canceladas,previstas};
}
