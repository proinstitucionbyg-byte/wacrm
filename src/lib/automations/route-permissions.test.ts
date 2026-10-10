import { beforeEach, describe, expect, it, vi } from 'vitest';
const h=vi.hoisted(()=>({permission:vi.fn(),db:vi.fn()}));
vi.mock('@/lib/auth/permissions',()=>({requirePermission:h.permission}));
vi.mock('@/lib/auth/account',()=>({toErrorResponse:()=>new Response(null,{status:403})}));
vi.mock('@/lib/supabase/server',()=>({createClient:h.db}));
vi.mock('@/lib/automations/admin-client',()=>({supabaseAdmin:h.db}));
vi.mock('@/lib/automations/engine',()=>({runAutomationsForTrigger:vi.fn()}));
import * as automations from '@/app/api/automations/route';
import * as item from '@/app/api/automations/[id]/route';
import * as folders from '@/app/api/automations/folders/route';
import {POST as copyFolder} from '@/app/api/automations/folders/duplicate/route';
import {POST as copyAutomation} from '@/app/api/automations/[id]/duplicate/route';
import {POST as execute} from '@/app/api/automations/engine/route';
beforeEach(()=>{vi.clearAllMocks();h.permission.mockRejectedValue(new Error('denied'));});
const request=new Request('http://localhost',{method:'POST',body:'{}'});
const params={params:Promise.resolve({id:'test'})};
describe('automation APIs enforce the permissions configured by the CEO',()=>{
  it.each([
    ['view',()=>automations.GET()],['create',()=>automations.POST(request)],
    ['view',()=>item.GET(request,params)],['edit',()=>item.PATCH(request,params)],['delete',()=>item.DELETE(request,params)],
    ['view',()=>folders.GET()],['create',()=>folders.POST(request)],['edit',()=>folders.PATCH(request)],['delete',()=>folders.DELETE(request)],
    ['create',()=>copyFolder(request)],['create',()=>copyAutomation(request,params)],['edit',()=>execute(request)],
  ] as const)('checks automations/%s before accessing data',async(action,run)=>{
    expect((await run()).status).toBe(403);expect(h.permission).toHaveBeenCalledExactlyOnceWith('automations',action);expect(h.db).not.toHaveBeenCalled();
  });
});
