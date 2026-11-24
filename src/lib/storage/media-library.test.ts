import { beforeEach, expect, it, vi } from 'vitest';
import { legacyLibraryEntry, libraryObject, mediaKind, childLibraryFolders, libraryFolder } from './media-library';
const h = vi.hoisted(() => ({ permission: vi.fn(), from: vi.fn(), remove: vi.fn(), upload: vi.fn(), results: [] as { data: unknown; error: unknown }[], queries: [] as { table: string; filters: [string, unknown][] }[] }));
vi.mock('@/lib/auth/permissions', () => ({ requirePermission: h.permission, canInAccount: async () => true }));
vi.mock('@/lib/auth/account', () => ({ toErrorResponse: () => Response.json({ error: 'Denied' }, { status: 403 }) }));
vi.mock('@/lib/automations/admin-client', () => ({ supabaseAdmin: () => ({ from: h.from, storage: { from: () => ({ upload: h.upload, remove: h.remove, getPublicUrl: (path: string) => ({ data: { publicUrl: `https://assets.test/storage/v1/object/public/flow-media/${path}` } }) }) } }) }));
import { GET, PATCH, POST } from '@/app/api/media-library/route';
const account = '11111111-1111-4111-8111-111111111111';
const own = { id: account, name: 'Audio', folder: 'General', kind: 'audio', bucket: 'flow-media', object_path: `account-${account}/one.ogg`, archived: false };
beforeEach(() => {
  vi.clearAllMocks(); h.results = []; h.queries = [];
  h.permission.mockResolvedValue({ accountId: account, userId: 'owner' });
  h.remove.mockResolvedValue({ error: null }); h.upload.mockResolvedValue({ error: null });
  h.from.mockImplementation((table: string) => {
    const record = { table, filters: [] as [string, unknown][] }; h.queries.push(record);
    const result = h.results.shift() ?? { data: null, error: null };
    const q: Record<string, unknown> = { then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve) };
    for (const method of ['select', 'order', 'range', 'limit', 'update', 'insert', 'ilike', 'or', 'upsert', 'is']) q[method] = vi.fn(() => q);
    q.eq = vi.fn((key: string, value: unknown) => { record.filters.push([key, value]); return q; });
    q.maybeSingle = q.single = vi.fn(async () => result);
    return q;
  });
});
it('rejects private identity files, foreign hosts and malformed public paths', () => {
  expect(libraryObject('https://assets.test/storage/v1/object/public/enrollment-evidence/dni.jpg', 'https://assets.test')).toBeNull();
  expect(libraryObject('https://foreign.test/storage/v1/object/public/media/a.jpg', 'https://assets.test')).toBeNull();
  expect(libraryObject('https://assets.test/storage/v1/object/public/media/a%2F..%2Fb.jpg', 'https://assets.test')).toBeNull();
  expect(libraryObject('https://assets.test/storage/v1/object/public/media/Promos/a.ogg', 'https://assets.test')).toEqual({ bucket: 'media', path: 'Promos/a.ogg' });
  expect(mediaKind('text/html')).toBeNull();
});
it('denies requests without automation permission before touching storage or the catalog', async () => {
  h.permission.mockRejectedValue(new Error('Denied'));
  expect((await GET(new Request('https://crm.test/api/media-library'))).status).toBe(403);
  expect((await POST(new Request('https://crm.test/api/media-library', { method: 'POST' }))).status).toBe(403);
  expect(h.from).not.toHaveBeenCalled(); expect(h.upload).not.toHaveBeenCalled();
});
it('lists only the authenticated account and scopes existing automation evidence to that account', async () => {
  h.results.push({ data: [], error: null }, { data: [], error: null });
  await GET(new Request('https://crm.test/api/media-library?account_id=foreign'));
  await GET(new Request('https://crm.test/api/media-library?source=existing'));
  expect(h.queries[0].filters).toContainEqual(['account_id', account]);
  expect(h.queries[1].filters).toContainEqual(['automations.account_id', account]);
});
it('cannot archive another account file and never removes stored bytes when archiving', async () => {
  h.results.push({ data: null, error: null });
  const result = await PATCH(new Request('https://crm.test/api/media-library', { method: 'PATCH', body: JSON.stringify({ id: account, account_id: 'foreign', archived: true }) }));
  expect(result.status).toBe(404);
  expect(h.queries[0].filters).toContainEqual(['account_id', account]); expect(h.remove).not.toHaveBeenCalled();
});
it('rejects an existing file that is not actually referenced by the selected account automation', async () => {
  const previous = process.env.NEXT_PUBLIC_SUPABASE_URL; process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://assets.test';
  try {
    h.results.push({ data: [], error: null });
    const result = await POST(new Request('https://crm.test/api/media-library', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'import', id: account, url: 'https://assets.test/storage/v1/object/public/media/a.ogg' }) }));
    expect(result.status).toBe(403); expect(h.queries).toHaveLength(1); expect(h.upload).not.toHaveBeenCalled();
  } finally { if (previous === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = previous; }
});
it('reuses identical uploaded bytes rather than uploading a second copy', async () => {
  h.results.push({ data: { ...own, archived: true }, error: null }, { data: own, error: null });
  const form = new FormData(); form.set('file', new File(['original-audio'], 'audio.ogg', { type: 'audio/ogg' }));
  const result = await POST(new Request('https://crm.test/api/media-library', { method: 'POST', body: form }));
  expect(result.status).toBe(200); expect((await result.json()).reused).toBe(true);
  expect(h.upload).not.toHaveBeenCalled(); expect(h.remove).not.toHaveBeenCalled();
});
it('removes only its newly uploaded orphan if catalog insertion fails', async () => {
  h.results.push({ data: null, error: null }, { data: null, error: { code: 'unexpected' } });
  const form = new FormData(); form.set('file', new File(['original-audio'], 'audio.ogg', { type: 'audio/ogg' }));
  await POST(new Request('https://crm.test/api/media-library', { method: 'POST', body: form }));
  const path = h.upload.mock.calls[0][0];
  expect(path).toMatch(new RegExp(`^account-${account}/library/`));
  expect(h.remove).toHaveBeenCalledWith([path]);
});

it('navigates nested folders without prefix collisions and sorts familiar names', () => {
  const folders = [{path:'Audios generales/Audios navideños',count:3},{path:'Audios generales/Bienvenida',count:2},{path:'Audios generales',count:1},{path:'Audios generales extra',count:9}];
  expect(childLibraryFolders(folders,'')).toEqual([{path:'Audios generales',count:6},{path:'Audios generales extra',count:9}]);
  expect(childLibraryFolders(folders,'Audios generales')).toEqual([{path:'Audios generales/Audios navideños',count:3},{path:'Audios generales/Bienvenida',count:2}]);
  expect(libraryFolder(' Audios generales / Audios navideños ')).toBe('Audios generales/Audios navideños');
});
it('lists folders beyond the first page, scoped by account, type and trash', async () => {
  h.results.push({data:Array.from({length:500},()=>({folder:'Audios generales/Audios navideños'})),error:null},{data:[{folder:'Audios generales/Bienvenida'}],error:null});
  const response = await GET(new Request('https://crm.test/api/media-library?folders=true&kind=audio&trash=true&account_id=foreign'));
  expect((await response.json()).folders).toEqual([{path:'Audios generales/Audios navideños',count:500},{path:'Audios generales/Bienvenida',count:1}]);
  expect(h.queries).toHaveLength(2);
  for (const query of h.queries) { expect(query.filters).toContainEqual(['account_id',account]);expect(query.filters).toContainEqual(['archived',true]);expect(query.filters).toContainEqual(['kind','audio']); }
  expect(h.upload).not.toHaveBeenCalled();expect(h.remove).not.toHaveBeenCalled();
});

it('indexes the original commercial folder without moving the object or admitting private/foreign URLs',()=>{
 const cfg={url:'https://assets.test/storage/v1/object/public/media/AUDIOS%20%20GENERALES/OFFICE/office.ogg',media_type:'audio'};
 expect(legacyLibraryEntry(cfg,'https://assets.test')).toEqual({bucket:'media',object_path:'AUDIOS  GENERALES/OFFICE/office.ogg',name:'office.ogg',kind:'audio',folder:'AUDIOS GENERALES/OFFICE'});
 expect(legacyLibraryEntry({...cfg,url:'https://other.test/storage/v1/object/public/media/a.ogg'},'https://assets.test')).toBeNull();
 expect(legacyLibraryEntry({...cfg,url:'https://assets.test/storage/v1/object/public/enrollment-evidence/dni.jpg'},'https://assets.test')).toBeNull();
 expect(libraryFolder('/')).toBe('/');
});
it('persists empty parent and child folders only for the authorized account',async()=>{
 const r=await POST(new Request('https://crm.test/api/media-library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'create-folder',path:'Material/Farmacia',account_id:'foreign'})}));
 expect(r.status).toBe(201);expect((await r.json()).folder.path).toBe('Material/Farmacia');
 expect(h.queries[0].table).toBe('automation_media_folders');
 expect(h.from.mock.results[1].value.upsert.mock.calls[0][0]).toEqual([{account_id:account,created_by:'owner',path:'Material'},{account_id:account,created_by:'owner',path:'Material/Farmacia'}]);
 expect(h.upload).not.toHaveBeenCalled();
});
it('includes saved empty folders when browsing, without mixing another account',async()=>{
 h.results.push({data:[{folder:'Material/Existente'}],error:null},{data:[{path:'Material/Vacia'}],error:null});
 const r=await GET(new Request('https://crm.test/api/media-library?folders=true&includeEmpty=true'));
 expect((await r.json()).folders).toEqual([{path:'Material/Existente',count:1},{path:'Material/Vacia',count:0}]);
 for(const q of h.queries)expect(q.filters).toContainEqual(['account_id',account]);
});
it('recovers verified automation files once while preserving archived entries and rejecting other storage',async()=>{
 const old=process.env.NEXT_PUBLIC_SUPABASE_URL;process.env.NEXT_PUBLIC_SUPABASE_URL='https://assets.test';
 try{h.results.push({data:[{bucket:'media',object_path:'old.ogg'}],error:null},{data:[{step_config:{url:'https://assets.test/storage/v1/object/public/media/old.ogg',media_type:'audio'}},{step_config:{url:'https://assets.test/storage/v1/object/public/media/Audios/new.ogg',media_type:'audio'}},{step_config:{url:'https://foreign.test/storage/v1/object/public/media/foreign.ogg',media_type:'audio'}}],error:null},{data:[{id:'saved'}],error:null});
 const r=await POST(new Request('https://crm.test/api/media-library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'sync-existing'})}));
 expect((await r.json()).added).toBe(1);expect(h.queries[1].filters).toContainEqual(['automations.account_id',account]);
 const rows=h.from.mock.results[2].value.upsert.mock.calls[0][0];expect(rows).toHaveLength(1);expect(rows[0].object_path).toBe('Audios/new.ogg');expect(rows[0].account_id).toBe(account);expect(rows[0]).not.toHaveProperty('archived');expect(h.upload).not.toHaveBeenCalled();
 }finally{if(old===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=old;}
});

it('does not restore an individually archived file into a folder still in Trash',async()=>{h.results.push({data:{archive_group:null,folder:'Material/Hija'},error:null},{data:[{path:'Material'}],error:null});const r=await PATCH(new Request('https://crm.test/api/media-library',{method:'PATCH',body:JSON.stringify({id:account,archived:false})}));expect(r.status).toBe(409);expect((await r.json()).error).toContain('Restaura primero la carpeta');expect(h.queries[1].filters).toContainEqual(['account_id',account]);});
