import { z } from 'zod';
import { groupResult } from './whatsapp-groups';

const commandResponse = z.object({
  command: z.object({
    id: z.string().uuid(),
    status: z.string(),
    result: z.string().nullable().optional(),
    result_data: groupResult.nullable().optional(),
  }),
});

// Poll only the original command. A timeout must never submit another mutation.
export async function readGroupCommand(id: string, signal: AbortSignal) {
  const response = await fetch(
    '/api/multichannel/whatsapp/groups?command_id=' + encodeURIComponent(id),
    {
      cache: 'no-store',
      signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
    }
  );
  const body = await response.json();
  if (!response.ok)
    throw Error(body.error || 'No se pudo consultar la acción.');
  const command = commandResponse.parse(body).command;
  if (command.id !== id)
    throw Error('La respuesta no corresponde a esta acción.');
  if (
    ['error', 'cancelled', 'expired', 'needs_review'].includes(command.status)
  ) {
    throw Error(
      command.result || 'Revisa el grupo antes de solicitar otra acción.'
    );
  }
  if (command.status === 'done') {
    if (!command.result_data)
      throw Error('Falta confirmar el resultado de esta acción.');
    return command.result_data;
  }
  return null;
}
