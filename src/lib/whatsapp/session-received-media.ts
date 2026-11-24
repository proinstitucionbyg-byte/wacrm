export const SESSION_MEDIA_BUCKET = 'whatsapp-session-media';
export const SESSION_MEDIA_LIMIT = 16 * 1024 * 1024;
const kinds: Record<string, string> = {
  'image/jpeg':'image','image/png':'image','image/webp':'image','image/gif':'image',
  'audio/ogg':'audio','audio/mpeg':'audio','audio/mp4':'audio','audio/aac':'audio','audio/amr':'audio','audio/wav':'audio','audio/webm':'audio','audio/opus':'audio',
  'video/mp4':'video','video/3gpp':'video',
  'application/pdf':'document','text/plain':'document','application/msword':'document',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':'document',
  'application/vnd.ms-excel':'document','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'document',
  'application/vnd.ms-powerpoint':'document','application/vnd.openxmlformats-officedocument.presentationml.presentation':'document',
};
export function receivedMime(value: string): string {
  const mime = value.split(';')[0].trim().toLowerCase();
  return mime === 'application/ogg' ? 'audio/ogg' : mime === 'audio/x-wav' ? 'audio/wav' : mime;
}
export function receivedMediaKind(mime: string): string | null { return kinds[receivedMime(mime)] ?? null; }
export function sessionMediaResponse(blob: Blob, range: string | null): Response {
  const mime = receivedMime(blob.type), kind = receivedMediaKind(mime);
  if (!kind) return Response.json({ error:'Formato de archivo no permitido.' }, { status:415 });
  const headers: Record<string,string> = { 'Content-Type':mime, 'Cache-Control':'private, no-store', 'X-Content-Type-Options':'nosniff', 'Accept-Ranges':'bytes', 'Content-Disposition':kind === 'document' ? 'attachment' : 'inline' };
  if (!range) return new Response(blob, { headers:{...headers,'Content-Length':String(blob.size)} });
  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  let start = Number(match?.[1] || 0), end = match?.[2] ? Number(match[2]) : blob.size - 1;
  if (match && !match[1] && match[2]) { start = Math.max(0,blob.size - Number(match[2])); end = blob.size - 1; }
  if (!match || (!match[1] && !match[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= blob.size || end < start) return new Response(null,{status:416,headers:{...headers,'Content-Range':`bytes */${blob.size}`}});
  end = Math.min(end,blob.size - 1);
  return new Response(blob.slice(start,end+1,mime),{status:206,headers:{...headers,'Content-Length':String(end-start+1),'Content-Range':`bytes ${start}-${end}/${blob.size}`}});
}
