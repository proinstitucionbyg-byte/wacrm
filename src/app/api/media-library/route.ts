import { createHash, randomUUID } from 'node:crypto';
import { NextResponse } from 'next/server';
import { requirePermission, canInAccount } from '@/lib/auth/permissions';
import { toErrorResponse } from '@/lib/auth/account';
import { supabaseAdmin } from '@/lib/automations/admin-client';
import { legacyLibraryEntry, libraryObject, libraryText, libraryFolder, mediaKind, type MediaKind } from '@/lib/storage/media-library';

export const runtime = 'nodejs';
const TABLE = 'automation_media_library';
const bad = (error: string, status = 400) => NextResponse.json({ error }, { status });
function fileView(row: Record<string, unknown>) {
  const bucket = row.bucket as string, path = row.object_path as string;
  return { id: row.id, name: row.name, folder: row.folder, kind: row.kind, bytes: row.bytes, archived: row.archived, archive_group:row.archive_group,
    url: supabaseAdmin().storage.from(bucket).getPublicUrl(path).data.publicUrl };
}
const FOLDERS = 'automation_media_folders';
async function saveFolder(db: ReturnType<typeof supabaseAdmin>, accountId: string, userId: string, path: string) {
  if(path==='/')return;
  const parts=path.split('/');
  const rows=parts.map((_,i)=>({account_id:accountId,created_by:userId,path:parts.slice(0,i+1).join('/')}));
  const result=await db.from(FOLDERS).upsert(rows,{onConflict:'account_id,path',ignoreDuplicates:true});
  if(result.error)throw result.error;
}
async function syncExistingLibrary(db: ReturnType<typeof supabaseAdmin>, accountId:string,userId:string) {
  const known=new Set<string>(),paths=new Set<string>();
  for(let start=0;;start+=500){const r=await db.from(TABLE).select('bucket,object_path,folder').eq('account_id',accountId).order('id').range(start,start+499);if(r.error)throw r.error;for(const row of r.data??[]){known.add(row.bucket+':'+row.object_path);if(typeof row.folder==='string'&&row.folder!=='/')paths.add(row.folder);}if(!r.data||r.data.length<500)break;}
  let added=0,skipped=0;
  for(let start=0;;start+=500){
    const r=await db.from('automation_steps').select('id,step_config,automations!inner(account_id)').eq('automations.account_id',accountId).eq('step_type','send_media').order('id').range(start,start+499);
    if(r.error)throw r.error;
    const rows=[];
    for(const step of r.data??[]){const entry=legacyLibraryEntry(step.step_config as Record<string,unknown>,process.env.NEXT_PUBLIC_SUPABASE_URL!);if(!entry){skipped++;continue;}const key=entry.bucket+':'+entry.object_path;if(known.has(key))continue;known.add(key);if(entry.folder!=='/')paths.add(entry.folder);rows.push({...entry,account_id:accountId,created_by:userId});}
    if(rows.length){const saved=await db.from(TABLE).upsert(rows,{onConflict:'account_id,bucket,object_path',ignoreDuplicates:true}).select('id');if(saved.error)throw saved.error;added+=saved.data?.length??0;}
    if(!r.data||r.data.length<500)break;
  }
  const folderRows=new Map<string,{account_id:string;created_by:string;path:string}>();for(const path of paths){const parts=path.split('/');for(let i=0;i<parts.length;i++){const parent=parts.slice(0,i+1).join('/');folderRows.set(parent,{account_id:accountId,created_by:userId,path:parent});}}
  const allFolders=[...folderRows.values()];for(let i=0;i<allFolders.length;i+=250){const saved=await db.from(FOLDERS).upsert(allFolders.slice(i,i+250),{onConflict:'account_id,path',ignoreDuplicates:true});if(saved.error)throw saved.error;}
  return {added,skipped};
}

export async function GET(request: Request) {
  try {
    const ctx = await requirePermission('automations', 'view');
    const db = supabaseAdmin(), params = new URL(request.url).searchParams;
    const offset = Math.floor(Math.max(0, Math.min(100000, Number(params.get('offset')) || 0)));
    const canEdit = await canInAccount(ctx, 'automations', 'edit');
    if (params.get('folders') === 'true') {
      const counts = new Map<string, number>();
      // Read all metadata pages, never download media to build the folder browser.
      for (let start = 0; ; start += 500) {
        let query = db.from(TABLE).select('id,folder').eq('account_id', ctx.accountId).eq('archived', params.get('trash') === 'true');
        if (['image','audio','video','document'].includes(params.get('kind') || '')) query = query.eq('kind', params.get('kind'));
        const { data, error } = await query.order('id').range(start, start + 499);
        if (error) throw error;
        for (const row of data ?? []) counts.set(row.folder, (counts.get(row.folder) ?? 0) + 1);
        if (!data || data.length < 500) break;
      }
      if(params.get('includeEmpty')==='true'){
        const meta=new Map<string,{id:string;archived:boolean}>();
        for(let start=0;;start+=500){const stored=await db.from(FOLDERS).select('id,path,archived').eq('account_id',ctx.accountId).eq('archived',params.get('trash')==='true').order('path').range(start,start+499);if(stored.error)throw stored.error;for(const item of stored.data??[]){meta.set(item.path,{id:item.id,archived:item.archived});if(!counts.has(item.path))counts.set(item.path,0);}if(!stored.data||stored.data.length<500)break;}
        return NextResponse.json({folders:[...counts].filter(([path])=>params.get('trash')!=='true'||meta.has(path)).map(([path,count])=>({path,count,...meta.get(path)})),canEdit});
      }
      return NextResponse.json({ folders: [...counts].map(([path, count]) => ({ path, count })), canEdit });
    }
    if (params.get('source') === 'existing') {
      const { data, error } = await db.from('automation_steps').select('id,step_config,automations!inner(account_id,name)')
        .eq('automations.account_id', ctx.accountId).eq('step_type', 'send_media').order('id').range(offset, offset + 49);
      if (error) throw error;
      const unique = new Map<string, object>();
      for (const row of data ?? []) {
        const cfg = row.step_config as Record<string, unknown>;
        const url = cfg.media_url ?? cfg.url;
        if (typeof url !== 'string' || !libraryObject(url, process.env.NEXT_PUBLIC_SUPABASE_URL!)) continue;
        const kind = ['image','audio','video','document'].includes(String(cfg.media_type)) ? cfg.media_type as MediaKind : 'image';
        const name = libraryText(cfg.filename, 180) || decodeURIComponent(new URL(url).pathname.split('/').pop() || 'Archivo');
        unique.set(url, { id: row.id, url, name, kind, folder: 'En automatizaciones', bytes: null, archived: false, legacy: true });
      }
      return NextResponse.json({ files: [...unique.values()], more: data?.length === 50, canEdit });
    }
    let query = db.from(TABLE).select('*').eq('account_id', ctx.accountId).eq('archived', params.get('trash') === 'true');
    if(params.get('trash')==='true'&&params.get('rootTrash')==='true')query=query.is('archive_group',null);
    const folder = libraryText(params.get('folder'), 80), search = libraryText(params.get('search'), 100);
    if (folder) query = query.eq('folder', folder);
    if(search){const slash=String.fromCharCode(92);const escaped=search.replaceAll(slash,slash+slash).replace(/[%_]/g,char=>slash+char);const pattern=JSON.stringify('%'+escaped+'%');query=query.or('name.ilike.'+pattern+',folder.ilike.'+pattern);}
    if (['image','audio','video','document'].includes(params.get('kind') || '')) query = query.eq('kind', params.get('kind'));
    const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(offset, offset + 39);
    if (error) throw error;
    return NextResponse.json({ files: (data ?? []).map(fileView), more: data?.length === 40, canEdit });
  } catch (error) { return toErrorResponse(error); }
}
export async function POST(request: Request) {
  let uploaded: string | null = null;
  try {
    const ctx = await requirePermission('automations', 'edit'), db = supabaseAdmin();
    if (request.headers.get('content-type')?.includes('application/json')) {
      const input = await request.json();
      if(input.action==='sync-existing')return NextResponse.json(await syncExistingLibrary(db,ctx.accountId,ctx.userId));
      if(input.action==='create-folder'){
        if(typeof input.path!=='string'||input.path.length>80||!input.path.trim()||input.path.split('/').some((x:string)=>!x.trim()||['.','..'].includes(x.trim())))return bad('Escribe un nombre de carpeta válido (hasta 80 caracteres en la ruta).');
        const path=libraryFolder(input.path);const existingFolder=await db.from(FOLDERS).select('id,archived').eq('account_id',ctx.accountId).eq('path',path).maybeSingle();if(existingFolder.error)throw existingFolder.error;if(existingFolder.data)return bad(existingFolder.data.archived?'Esa carpeta está en Papelera. Restáurala o usa otro nombre.':'Ya existe una carpeta con ese nombre.',409);await saveFolder(db,ctx.accountId,ctx.userId,path);return NextResponse.json({folder:{path,count:0}}, {status:201});
      }
      if (input.action !== 'import' || typeof input.url !== 'string') return bad('Solicitud inválida.');
      const object = libraryObject(input.url, process.env.NEXT_PUBLIC_SUPABASE_URL!);
      if (!object) return bad('El archivo debe pertenecer al almacenamiento del CRM.');
      // A legacy public URL is owned only when an automation of this account actually uses it.
      const { data: rows, error } = await db.from('automation_steps').select('step_config,automations!inner(account_id)')
        .eq('automations.account_id', ctx.accountId).eq('step_type', 'send_media')
        .eq('id', input.id).limit(1);
      if (error) throw error;
      const cfg = rows?.[0]?.step_config as Record<string, unknown> | undefined;
      if (!cfg || (cfg.media_url ?? cfg.url) !== input.url) return bad('No se encontró ese archivo en tus automatizaciones.', 403);
      const { data: old, error: oldError } = await db.from(TABLE).select('*').eq('account_id', ctx.accountId).eq('bucket', object.bucket).eq('object_path', object.path).maybeSingle();
      if (oldError) throw oldError;
      if (old) {
        const restored = await db.from(TABLE).update({ archived: false }).eq('id', old.id).eq('account_id', ctx.accountId).select('*').single();
        if (restored.error) throw restored.error;
        return NextResponse.json({ file: fileView(restored.data), reused: true });
      }
      const kind = ['image','audio','video','document'].includes(String(cfg.media_type)) ? cfg.media_type : 'image';
      const { data, error: insertError } = await db.from(TABLE).insert({ account_id: ctx.accountId, created_by: ctx.userId, bucket: object.bucket,
        object_path: object.path, name: libraryText(input.name, 180, 'Archivo existente'), folder: libraryFolder(input.folder), kind }).select('*').single();
      if (insertError) throw insertError;
      return NextResponse.json({ file: fileView(data) });
    }
    const length = Number(request.headers.get('content-length') || 0);
    if (length > 17 * 1024 * 1024) return bad('El archivo supera el límite permitido.');
    const form = await request.formData(), file = form.get('file');
    if (!(file instanceof File)) return bad('Selecciona un archivo.');
    const kind = mediaKind(file.type), limit = kind === 'image' ? 5 * 1024 * 1024 : 16 * 1024 * 1024;
    if (!kind || !file.size || file.size > limit) return bad('Formato no admitido o tamaño excesivo. Imagen: 5 MB; audio, video y documento: 16 MB.');
    const buffer = Buffer.from(await file.arrayBuffer()), digest = createHash('sha256').update(buffer).digest('hex');
    const { data: existing, error: findError } = await db.from(TABLE).select('*').eq('account_id', ctx.accountId).eq('sha256', digest).maybeSingle();
    if (findError) throw findError;
    if (existing) {
      const { data, error } = await db.from(TABLE).update({ archived: false }).eq('id', existing.id).eq('account_id', ctx.accountId).select('*').single();
      if (error) throw error;
      return NextResponse.json({ file: fileView(data), reused: true });
    }
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-100) || 'archivo';
    const path = `account-${ctx.accountId}/library/${randomUUID()}-${safeName}`;
    const { error: uploadError } = await db.storage.from('flow-media').upload(path, buffer, { contentType: file.type, upsert: false });
    if (uploadError) throw uploadError;
    uploaded = path;
    const { data, error } = await db.from(TABLE).insert({ account_id: ctx.accountId, created_by: ctx.userId, bucket: 'flow-media', object_path: path,
      name: libraryText(form.get('name'), 180, file.name.slice(0,180)), folder: libraryFolder(form.get('folder')), kind, bytes: file.size, sha256: digest }).select('*').single();
    if (error) {
      if (error.code === '23505') {
        const winner = await db.from(TABLE).select('*').eq('account_id', ctx.accountId).eq('sha256', digest).maybeSingle();
        if (winner.error) throw winner.error;
        if (winner.data) { await db.storage.from('flow-media').remove([path]); uploaded = null; return NextResponse.json({ file: fileView(winner.data), reused: true }); }
      }
      throw error;
    }
    uploaded = null;
    return NextResponse.json({ file: fileView(data) }, { status: 201 });
  } catch (error) {
    if (uploaded) await supabaseAdmin().storage.from('flow-media').remove([uploaded]);
    return toErrorResponse(error);
  }
}
export async function PATCH(request: Request) {
  try {
    const ctx = await requirePermission('automations', 'edit'), input = await request.json();
    if (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/i.test(input.id)) return bad('Archivo inválido.');
    const patch: Record<string, unknown> = {};
    if (typeof input.name === 'string') patch.name = libraryText(input.name, 180, 'Archivo');
    if (typeof input.folder === 'string') patch.folder = libraryFolder(input.folder);
    if (typeof input.archived === 'boolean') {if(input.archived===false){const own=await supabaseAdmin().from(TABLE).select('archive_group,folder').eq('id',input.id).eq('account_id',ctx.accountId).maybeSingle();if(own.error)throw own.error;if(own.data?.archive_group)return bad('Restaura primero la carpeta para recuperar este archivo.',409);if(typeof own.data?.folder==='string'&&own.data.folder!=='/'){const parents=await supabaseAdmin().from(FOLDERS).select('path').eq('account_id',ctx.accountId).eq('archived',true);if(parents.error)throw parents.error;if((parents.data??[]).some(parent=>own.data!.folder===parent.path||own.data!.folder.startsWith(parent.path+'/')))return bad('Restaura primero la carpeta para recuperar este archivo.',409);}}patch.archived=input.archived;patch.archive_group=null;}
    if (!Object.keys(patch).length) return bad('No hay cambios para guardar.');
    if(typeof patch.folder==='string')await saveFolder(supabaseAdmin(),ctx.accountId,ctx.userId,patch.folder);
    const { data, error } = await supabaseAdmin().from(TABLE).update(patch).eq('id', input.id).eq('account_id', ctx.accountId).select('*').maybeSingle();
    if (error) throw error;
    if (!data) return bad('Archivo no encontrado.', 404);
    return NextResponse.json({ file: fileView(data) });
  } catch (error) { return toErrorResponse(error); }
}
