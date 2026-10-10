/** Reglas sin envios. El integrador debe aportar confirmaciones reales de entrega y contacto. */
export type SeguimientoContacto = {
  matriculaId: string;
  registradoEn: string;
  pagoValidado: boolean;
  documentosEntregados: { boleta: boolean; ficha: boolean; cronograma: boolean };
  bienvenidaEn: string | null;
  primerContactoEn: string | null;
  audioEn: string | null;
  alertaEn: string | null;
  asesora: string | null;
  /** Debe calcularse con el turno vigente al vencer el plazo, no con la hora del proceso. */
  asesoraEnTurnoAlVencer: boolean;
  origen: 'MANUAL' | 'AUTOMATICO';
};

function instante(value: string): number {
  if (!/(Z|[+-]\d{2}:\d{2})$/.test(value)) throw new Error('LA FECHA NECESITA ZONA HORARIA');
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('FECHA INVALIDA');
  return ms;
}

export function evaluarSeguimientoContacto(estado: SeguimientoContacto, ahora: string) {
  if (!estado.matriculaId.trim()) throw new Error('FALTA ID DE MATRICULA');
  const registro = instante(estado.registradoEn), actual = instante(ahora);
  const limite = registro + 2 * 60 * 60 * 1000;
  const entregados = Object.values(estado.documentosEntregados).every(Boolean);
  const eventos = [estado.bienvenidaEn, estado.primerContactoEn, estado.audioEn, estado.alertaEn];
  eventos.forEach((evento) => {
    if (evento && (instante(evento) < registro || instante(evento) > actual)) throw new Error('EVENTO FUERA DE SECUENCIA');
  });
  const contactado = Boolean(estado.primerContactoEn);
  const vencido = actual >= limite;
  return {
    limiteContacto: new Date(limite).toISOString(),
    bienvenidaPendiente: estado.pagoValidado && entregados && !estado.bienvenidaEn,
    audioPendiente: estado.pagoValidado && entregados && Boolean(estado.bienvenidaEn) && vencido && !contactado && !estado.audioEn,
    alertaPendiente: estado.pagoValidado && vencido && !contactado && Boolean(estado.asesora) && estado.asesoraEnTurnoAlVencer && !estado.alertaEn,
    color: contactado ? 'SIN COLOR' : estado.origen === 'AUTOMATICO' ? 'AZUL' : 'AMARILLO',
    // Reservar estas claves de forma atomica antes de enviar; la funcion por si sola no impide carreras.
    clavesEnvio: {
      bienvenida: `matricula:${estado.matriculaId}:bienvenida`,
      audio: `matricula:${estado.matriculaId}:audio`,
      alerta: `matricula:${estado.matriculaId}:alerta`,
    },
  };
}
