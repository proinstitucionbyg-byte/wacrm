import { uploadResumableMedia } from './meta-api';

/** Meta's business profile uses a resumable-upload handle, not a message media ID. */
export async function businessProfileRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.facebook.com/v26.0/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json().catch(() => { throw new Error(`Meta devolvió una respuesta no válida (HTTP ${response.status}). La operación no quedó confirmada.`); });
  if (!response.ok || body.error) {
    // Do not expose provider URLs, tokens, or raw error messages to clients.
    throw new Error('Meta no pudo completar la operación. Revisa los permisos de administración de WhatsApp de la conexión.');
  }
  return body;
}

export async function readBusinessPhoto(token: string, phoneNumberId: string) {
  if (!/^\d+$/.test(phoneNumberId)) throw new Error('La conexión de WhatsApp API no es válida.');
  const phone = await businessProfileRequest(token, `${phoneNumberId}?fields=display_phone_number`);
  const profile = await businessProfileRequest(token, `${phoneNumberId}/whatsapp_business_profile?fields=profile_picture_url`);
  return { phoneNumberId, phone: String(phone.display_phone_number ?? ''), photoUrl: profile.data?.[0]?.profile_picture_url ?? null };
}

export async function publishBusinessPhoto(token: string, phoneNumberId: string, expectedPhone: string, file: File) {
  if (!['image/jpeg', 'image/png'].includes(file.type) || file.size === 0 || file.size > 5 * 1024 * 1024) {
    throw new Error('Elige una imagen PNG o JPG de hasta 5 MB.');
  }
  const current = await readBusinessPhoto(token, phoneNumberId);
  const digits = (value: string) => value.replace(/\D/g, '');
  if (!digits(expectedPhone) || digits(expectedPhone) !== digits(current.phone)) {
    throw new Error('El número de la conexión cambió. Actualiza la pantalla antes de publicar.');
  }
  // Resolve the app bound to this token; do not guess among subscribed applications.
  const appId = process.env.META_APP_ID || (await businessProfileRequest(token, 'app?fields=id')).id;
  if (!appId || !/^\d+$/.test(appId)) throw new Error('Falta configurar el identificador de la aplicación Meta para subir fotos.');
  let handle: string;
  try {
    ({ handle } = await uploadResumableMedia({ appId, accessToken: token, fileName: file.name,
      mimeType: file.type, bytes: new Uint8Array(await file.arrayBuffer()), authorizationInHeader: true }));
  } catch { throw new Error('Meta no confirmó la carga de la foto. Revisa la autorización de la aplicación conectada.'); }
  const saved = await businessProfileRequest(token, `${phoneNumberId}/whatsapp_business_profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: handle }),
  });
  if (saved.success !== true) throw new Error('Meta no confirmó el cambio de foto.');
  // Publication and readback are distinct; never report an old URL as a verified new image.
  try { return { ...await readBusinessPhoto(token, phoneNumberId), published: true, readback: true }; }
  catch { return { ...current, photoUrl: null, published: true, readback: false }; }
}
