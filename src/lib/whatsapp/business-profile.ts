/** Meta's business profile uses a resumable-upload handle, not a message media ID. */
export async function businessProfileRequest(token: string, path: string, init: RequestInit = {}) {
  const response = await fetch(`https://graph.facebook.com/v26.0/${path}`, {
    ...init, headers: { Authorization: `Bearer ${token}`, ...init.headers },
    cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(25_000),
  });
  const body = await response.json();
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
  const query = new URLSearchParams({ file_length: String(file.size), file_type: file.type, file_name: file.name });
  const session = await businessProfileRequest(token, `app/uploads?${query}`, { method: 'POST' });
  if (typeof session.id !== 'string' || !session.id.startsWith('upload:')) throw new Error('Meta no creó la carga de la imagen.');
  const upload = await businessProfileRequest(token, encodeURIComponent(session.id), {
    method: 'POST', headers: { file_offset: '0', 'Content-Type': file.type }, body: await file.arrayBuffer(),
  });
  if (typeof upload.h !== 'string' || !upload.h) throw new Error('Meta no confirmó la carga de la imagen.');
  const saved = await businessProfileRequest(token, `${phoneNumberId}/whatsapp_business_profile`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', profile_picture_handle: upload.h }),
  });
  if (saved.success !== true) throw new Error('Meta no confirmó el cambio de foto.');
  // Publication and readback are distinct; never report an old URL as a verified new image.
  try { return { ...await readBusinessPhoto(token, phoneNumberId), published: true, readback: true }; }
  catch { return { ...current, photoUrl: null, published: true, readback: false }; }
}
