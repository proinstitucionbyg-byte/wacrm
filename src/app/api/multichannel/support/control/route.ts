import {NextResponse} from 'next/server';
import {requireRole,toErrorResponse} from '@/lib/auth/account';
import {supabaseAdmin} from '@/lib/automations/admin-client';
import {z} from 'zod';
const schema=z.object({enabled:z.boolean(),line_order:z.array(z.string().regex(/^WA-[A-Za-z0-9_-]{1,60}$/)).min(1).max(20)}).strict();
export async function GET(){try{
 const ctx=await requireRole('owner'),db=supabaseAdmin();
 const [lines,route]=await Promise.all([db.from('multichannel_whatsapp_session_lines').select('line_key,linked_phone,paused,support_ready_at').eq('account_id',ctx.accountId),db.from('whatsapp_support_routes').select('enabled,line_order').eq('account_id',ctx.accountId).maybeSingle()]);
 if(lines.error||route.error)throw Error('No se pudo leer la ruta de soporte.');
 return NextResponse.json({lines:lines.data,route:route.data,featureEnabled:process.env.MULTICHANNEL_CLOUD_SUPPORT_ENABLED==='true'},{headers:{'Cache-Control':'no-store'}});
}catch(error){return toErrorResponse(error);}}
export async function POST(request:Request){try{
 const ctx=await requireRole('owner'),db=supabaseAdmin(),input=schema.safeParse(await request.json().catch(()=>null));
 if(!input.success||new Set(input.data.line_order).size!==input.data.line_order.length)return NextResponse.json({error:'Selecciona un orden sin números repetidos.'},{status:400});
 const lines=await db.from('multichannel_whatsapp_session_lines').select('line_key').eq('account_id',ctx.accountId).in('line_key',input.data.line_order);
 if(lines.error||lines.data?.length!==input.data.line_order.length)return NextResponse.json({error:'Solo puedes elegir números registrados en tu cuenta.'},{status:400});
 const saved=await db.from('whatsapp_support_routes').upsert({account_id:ctx.accountId,enabled:input.data.enabled,line_order:input.data.line_order,updated_at:new Date().toISOString()},{onConflict:'account_id'});
 if(saved.error)throw Error('No se pudo guardar la ruta.');return NextResponse.json({saved:true});
}catch(error){return toErrorResponse(error);}}
