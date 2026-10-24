import type { Tag } from '@/types';
import { SALES_COMMERCIAL_STATUSES } from '@/lib/sales/commercial-status';

const normalized = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
const sales = new Set<string>(SALES_COMMERCIAL_STATUSES.map(normalized));

export function tagGroup(tag: Tag): string {
  const name = normalized(tag.name);
  if (sales.has(name) || ['AREA VENTAS','ASESOR INSTITUTO','ASESOR URGENTE','ASISTENCIA ASESOR HUMANO','PENDIENTE DE ASIGNACION VENTAS'].includes(name)) return 'VENTAS';
  if (name.includes('FIDELIZACION') || name.includes('EXPEDIENTE DE MATRICULA')) return 'FIDELIZACIÓN';
  if (/PAGO|VALIDACION|MATRICULA/.test(name)) return 'PAGOS Y MATRÍCULAS';
  const areas = [...new Set((tag.audience?.areas ?? []).map(normalized))];
  if (areas.length === 1) return areas[0] === 'FIDELIZACION' ? 'FIDELIZACIÓN' : areas[0];
  if (name.startsWith('ASESOR ') || tag.kind === 'system') return 'RESPONSABLES';
  return 'OTRAS ETIQUETAS';
}

/** Only arranges the caller's already-authorized tags; never expands visibility. */
export function groupTags(tags: Tag[]): Array<{ name: string; tags: Tag[] }> {
  const groups = new Map<string, Tag[]>();
  for (const tag of tags) {
    const name = tagGroup(tag);
    groups.set(name, [...(groups.get(name) ?? []), tag]);
  }
  const priority = ['VENTAS','FIDELIZACIÓN','PAGOS Y MATRÍCULAS','RESPONSABLES','OTRAS ETIQUETAS'];
  return [...groups].sort(([a],[b]) => {
    const rank = (name: string) => priority.includes(name) ? priority.indexOf(name) : 4;
    return rank(a) - rank(b) || a.localeCompare(b, 'es');
  }).map(([name, items]) => ({ name, tags: [...items].sort((a,b) => a.name.localeCompare(b.name, 'es')) }));
}
