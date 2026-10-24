export const SALES_COMMERCIAL_STATUSES = [
  'FUERA DE SERVICIO',
  'VA A PAGAR',
  'NO INTERESADO',
  'APAGADO',
  'TIMBRE OFF',
  'INCORRECTO',
  'NO CONTESTA',
  'DEVOLVER LLAMADA',
  'ENVIAR INFORMACIÓN',
  'INTERESADO',
  'SEGUIMIENTO DE VENTAS',
  'VENTA',
  'VENTA SOLO',
  'SOLO QUIERE CURSO GRATIS',
  'NO INTERESADO-R',
] as const;

export type SalesCommercialStatus = (typeof SALES_COMMERCIAL_STATUSES)[number];

export function normalizeSalesCommercialStatus(value: unknown): SalesCommercialStatus | null | undefined {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLocaleUpperCase('es-PE');
  return SALES_COMMERCIAL_STATUSES.find((status) => status === normalized);
}
