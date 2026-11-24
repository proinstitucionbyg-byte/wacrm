export type MediaKind = 'image' | 'audio' | 'video' | 'document';
export type LibraryFile = { id: string; name: string; folder: string; kind: MediaKind; url: string; bytes: number | null; archived: boolean; archive_group?:string|null; legacy?: boolean };
export const MEDIA_TYPES: Record<MediaKind, string[]> = {
  image: ['image/jpeg', 'image/png', 'image/webp'],
  audio: ['audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/aac', 'audio/amr', 'audio/wav', 'audio/webm', 'audio/opus'],
  video: ['video/mp4', 'video/3gpp'],
  document: ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'application/vnd.ms-powerpoint', 'application/vnd.openxmlformats-officedocument.presentationml.presentation'],
};
export type LibraryFolder = { path: string; count: number; id?: string; archived?: boolean };
/** Logical folders only: moving a catalog entry never changes its public URL. */
export function childLibraryFolders(folders: LibraryFolder[], parent: string): LibraryFolder[] {
  const children = new Map<string, number>();
  for (const folder of folders) {
    if (parent && !folder.path.startsWith(parent + '/')) continue;
    const relative = parent ? folder.path.slice(parent.length + 1) : folder.path;
    const child = relative.split('/')[0];
    if (!child) continue;
    const path = parent ? parent + '/' + child : child;
    children.set(path, (children.get(path) ?? 0) + folder.count);
  }
  return [...children].map(([path, count]) => ({ path, count })).sort((a, b) => a.path.localeCompare(b.path, 'es', { numeric: true }));
}
export function libraryFolder(value: unknown): string {
  if(value==='/')return '/';
  return libraryText(value, 80, 'General').split('/').map(part => part.trim()).filter(part => part && part !== '.' && part !== '..').join('/') || 'General';
}
export function mediaKind(mime: string): MediaKind | null {
  return (Object.keys(MEDIA_TYPES) as MediaKind[]).find(kind => MEDIA_TYPES[kind].includes(mime)) ?? null;
}
export function libraryText(value: unknown, max: number, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.trim().replace(/[\u0000-\u001f]/g, '').slice(0, max) || fallback;
}
/** Public commercial files only. Private enrollment evidence never enters this catalog. */
export function libraryObject(url: string, origin: string): { bucket: string; path: string } | null {
  try {
    const target = new URL(url), base = new URL(origin);
    if (target.origin !== base.origin || target.search || target.hash || target.username || target.password) return null;
    const match = target.pathname.match(/^\/storage\/v1\/object\/public\/(media|flow-media|chat-media)\/(.+)$/);
    if (!match) return null;
    const path = decodeURIComponent(match[2]);
    if (path.split('/').some(part => !part || part === '.' || part === '..') || /[\u0000-\u001f\\]/.test(path)) return null;
    return { bucket: match[1], path };
  } catch { return null; }
}

/** Existing commercial automation references are indexed without moving their bytes. */
export function legacyLibraryEntry(cfg:Record<string,unknown>,origin:string){
 const url=cfg.media_url??cfg.url;if(typeof url!=='string')return null;
 const object=libraryObject(url,origin);if(!object)return null;
 const name=libraryText(cfg.filename,180)||object.path.split('/').pop()||'Archivo';
 const kind=(['image','audio','video','document'] as string[]).includes(String(cfg.media_type))?cfg.media_type as MediaKind:mediaKindFromName(name);
 if(!kind)return null;
 const pathParts=object.path.split('/');pathParts.pop();
 const folder=pathParts.length&&!/^account-[a-f0-9-]+$/.test(pathParts[0])?libraryFolder(pathParts.map(x=>x.replace(/\s+/g,' ').trim()).join('/')):'/';
 return {bucket:object.bucket,object_path:object.path,name,kind,folder};
}
function mediaKindFromName(name:string):MediaKind|null{const ext=name.toLowerCase().split('.').pop()??'';if(['jpg','jpeg','png','webp'].includes(ext))return 'image';if(['ogg','mp3','m4a','aac','amr','wav','webm','opus'].includes(ext))return 'audio';if(['mp4','3gp'].includes(ext))return 'video';if(['pdf','txt','doc','docx','xls','xlsx','ppt','pptx'].includes(ext))return 'document';return null;}
