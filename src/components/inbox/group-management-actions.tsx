'use client';
import { useState } from 'react';
import { z } from 'zod';
import { groupRequest } from '@/lib/multichannel/whatsapp-groups';
import { campaignPhone } from '@/lib/multichannel/campaign-phone';
import {
  uploadAccountMedia,
  MEDIA_MAX_BYTES_BY_KIND,
} from '@/lib/storage/upload-media';
type Request = Extract<
  z.infer<typeof groupRequest>['request'],
  { kind: 'mutate' }
>;
type Change = Request['change'];
const input =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm';
const button =
  'rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-40';
export function groupParticipantPhones(text: string) {
  const rows = text
    .split(/[\n,;]+/)
    .map((row) => row.trim())
    .filter(Boolean);
  if (!rows.length || rows.length > 50)
    throw Error('Pega entre 1 y 50 teléfonos, uno por línea.');
  const result = rows.map((row) => {
    const parsed = campaignPhone(row);
    if (!parsed) throw Error('Revisa este teléfono: ' + row);
    return parsed.phone.replace(/^\+/, '') + '@c.us';
  });
  return [...new Set(result)];
}
export function GroupManagementActions({
  disabled,
  onAction,
  onBusy,
  onError,
}: {
  disabled: boolean;
  onAction: (change: Change) => void;
  onBusy: (value: boolean) => void;
  onError: (value: string) => void;
}) {
  const [phones, setPhones] = useState(''),
    [review, setReview] = useState<string[]>([]),
    [permission, setPermission] = useState<
      'messages_admins_only' | 'info_admins_only' | 'add_members_admins_only'
    >('messages_admins_only');
  const [adminsOnly, setAdminsOnly] = useState(true),
    [picture, setPicture] = useState<string | null>(null),
    [uploading, setUploading] = useState(false);
  const locked = disabled || uploading;
  async function upload(file: File) {
    if (
      !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
      !file.size ||
      file.size > MEDIA_MAX_BYTES_BY_KIND.image
    ) {
      onError('Elige una foto JPG, PNG o WebP de hasta 5 MB.');
      return;
    }
    setUploading(true);
    onBusy(true);
    onError('');
    setPicture(null);
    try {
      const result = await uploadAccountMedia('flow-media', file);
      setPicture(result.publicUrl);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : 'No se pudo cargar la foto.'
      );
    } finally {
      setUploading(false);
      onBusy(false);
    }
  }
  return (
    <div className="border-border space-y-3 border-t pt-3">
      <details>
        <summary className="cursor-pointer font-medium">
          Agregar integrantes
        </summary>
        <p className="text-muted-foreground my-2 text-sm">
          Un teléfono por línea. Los números peruanos pueden tener 9 dígitos;
          para otros países incluye el prefijo. WhatsApp puede impedir agregar a
          alguien por sus ajustes de privacidad.
        </p>
        <textarea
          aria-label="Teléfonos para agregar al grupo"
          className={input}
          rows={3}
          value={phones}
          maxLength={3000}
          disabled={locked}
          onChange={(event) => {
            setPhones(event.target.value);
            setReview([]);
          }}
        />
        <button
          className={button}
          disabled={locked}
          onClick={() => {
            try {
              setReview(groupParticipantPhones(phones));
              onError('');
            } catch (error) {
              onError(
                error instanceof Error ? error.message : 'Revisa la lista.'
              );
            }
          }}
        >
          Revisar teléfonos
        </button>
        {!!review.length && (
          <div>
            <p className="text-sm break-words">
              Se agregarán {review.length}:{' '}
              {review.map((id) => '+' + id.replace('@c.us', '')).join(', ')}
            </p>
            <button
              className={button}
              disabled={locked}
              onClick={() => onAction({ operation: 'add', value: review })}
            >
              Confirmar y agregar
            </button>
          </div>
        )}
      </details>
      <details>
        <summary className="cursor-pointer font-medium">
          Permisos del grupo
        </summary>
        <p className="text-muted-foreground my-2 text-sm">
          Aplica únicamente el ajuste que elijas al grupo abierto.
        </p>
        <select
          className={input}
          aria-label="Ajuste del grupo"
          value={permission}
          disabled={locked}
          onChange={(event) =>
            setPermission(event.target.value as typeof permission)
          }
        >
          <option value="messages_admins_only">
            Quién puede enviar mensajes
          </option>
          <option value="info_admins_only">
            Quién puede editar la información
          </option>
          <option value="add_members_admins_only">
            Quién puede agregar participantes
          </option>
        </select>
        <select
          className={input}
          aria-label="Quién puede realizar esta acción"
          value={String(adminsOnly)}
          disabled={locked}
          onChange={(event) => setAdminsOnly(event.target.value === 'true')}
        >
          <option value="true">Solo administradores</option>
          <option value="false">Todos los participantes</option>
        </select>
        <button
          className={button}
          disabled={locked}
          onClick={() => onAction({ operation: permission, value: adminsOnly })}
        >
          Aplicar este permiso
        </button>
      </details>
      <details>
        <summary className="cursor-pointer font-medium">
          Cambiar foto del grupo
        </summary>
        <input
          aria-label="Foto nueva del grupo"
          className={input}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          disabled={locked}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) void upload(file);
          }}
        />
        {picture && (
          <>
            <a
              href={picture}
              className="text-sm underline"
              target="_blank"
              rel="noreferrer"
            >
              Revisar foto cargada
            </a>
            <button
              className={button}
              disabled={locked}
              onClick={() =>
                onAction({
                  operation: 'picture',
                  value: { kind: 'image', url: picture },
                })
              }
            >
              Aplicar foto al grupo
            </button>
          </>
        )}
      </details>
    </div>
  );
}
