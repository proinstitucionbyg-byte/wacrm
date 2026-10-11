export const MEMBER_PRESETS = {
  ventas: { label: 'AGENTE DE VENTAS', role: 'agent', area: 'VENTAS', cargo: 'AGENTE' },
  fidelizacion: { label: 'AGENTE DE FIDELIZACION', role: 'agent', area: 'FIDELIZACION', cargo: 'AGENTE' },
  coordinador: { label: 'COORDINADOR', role: 'agent', area: 'SIN AREA', cargo: 'COORDINADOR' },
  administrador: { label: 'ADMINISTRADOR', role: 'admin', area: 'ADMINISTRATIVA', cargo: 'ADMINISTRADOR' },
} as const;
export type MemberPreset = keyof typeof MEMBER_PRESETS;
export function isMemberPreset(value: unknown): value is MemberPreset {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(MEMBER_PRESETS, value);
}
