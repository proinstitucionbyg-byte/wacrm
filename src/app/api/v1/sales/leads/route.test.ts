import { beforeEach, describe, expect, it, vi } from 'vitest';
const h = vi.hoisted(() => ({ key: vi.fn(), rows: {} as Record<string, unknown[]>, calls: [] as unknown[] }));
vi.mock('@/lib/auth/api-context', () => ({ requireApiKey: h.key }));
import { GET } from './route';
const contact = (id: string, tags: string[] = ['AREA VENTAS'], phone = '51911111111') => ({
  id, phone, phone_normalized: phone, created_at: '2026-10-23T12:00:00Z',
  name: 'CONTACTO', channel: 'whatsapp', contact_tags: tags.map(name => ({ tag: { name } })), conversations: [],
});
const payment = (contact_id: string, purpose = 'enrollment', status = 'registered') => ({
  contact_id, status: 'validated', payment_purpose: purpose, reviewed_at: '2026-10-23T13:00:00Z',
  operation_reference: '00123', sales_adviser: 'INSTITUCION', enrollments: { status, data: { prices: [19.9,49.9,49.9,49.9,49.9,49.9] }, student_folder_url: 'https://drive.google.com/drive/folders/student' },
});
beforeEach(() => {
  vi.resetAllMocks(); h.rows = {}; h.calls = [];
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    for (const method of ['select', 'eq', 'order', 'limit', 'in', 'or'])
      chain[method] = (...args: unknown[]) => { h.calls.push([table, method, args]); return chain; };
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: h.rows[table] ?? [], error: null }).then(resolve);
    return chain;
  };
  h.key.mockResolvedValue({ accountId: 'account-a', supabase: { from } });
});
describe('commercial base export', () => {
  it('uses the registered enrollment when the contact has no phone and the latest chat has no course evidence', async () => {
    h.rows.contacts=[contact('registered',['AREA FIDELIZACION'],'')];
    const paid=payment('registered');
    Object.assign(paid.enrollments.data,{course:'RECURSOS HUMANOS',phone1:'999000111'});
    h.rows.payment_reviews=[paid];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({phone_or_user_id:'999000111',course_interest:'RECURSOS HUMANOS'});
    expect(result.data[0].course_basis).toContain('matrícula registrada');
  });
  it('does not use an unfinished enrollment to invent missing contact data', async () => {
    h.rows.contacts=[contact('unfinished',[],'')];
    const paid=payment('unfinished','enrollment','collecting');
    Object.assign(paid.enrollments.data,{course:'FARMACIA',phone1:'999000111'});
    h.rows.payment_reviews=[paid];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({phone_or_user_id:'',course_interest:''});
  });
  it('keeps the current contact identifier and explicit course interests over an older registration', async () => {
    const c=contact('current');
    h.rows.contacts=[{...c,conversations:[{id:'chat',messages:[{id:'message',sender_type:'customer',content_text:'Quiero Farmacia',interactive_reply_id:null,created_at:'2026-10-27T10:00:00Z'}]}]}];
    const paid=payment('current');
    Object.assign(paid.enrollments.data,{course:'RECURSOS HUMANOS',phone1:'999000111'});
    h.rows.payment_reviews=[paid];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({phone_or_user_id:'51911111111',course_interest:'Auxiliar de farmacia'});
  });
  it('leaves conflicting registered values empty and never uses an SMS phone as an Instagram user ID', async () => {
    h.rows.contacts=[contact('conflict',[],''),{...contact('instagram',[],''),channel:'instagram'}];
    const paid=payment('conflict'), ig=payment('instagram');
    Object.assign(ig.enrollments.data,{course:'FARMACIA',phone1:'999000111'});
    h.rows.payment_reviews=[{...paid,enrollments:[
      {...paid.enrollments,data:{course:'FARMACIA',phone1:'999000111'}},
      {...paid.enrollments,data:{course:'RECURSOS HUMANOS',phone1:'999000222'}},
    ]},ig];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({phone_or_user_id:'',course_interest:''});
    expect(result.data[1].phone_or_user_id).toBe('');
  });
  it('keeps a historical sale and its owner after all sales labels and the current assignment disappear', async () => {
    h.rows.contacts=[contact('history',['AREA FIDELIZACION'])];
    h.rows.contact_sales_states=[{contact_id:'history',commercial_status:'VENTA',status_changed_at:'2026-10-23T13:00:00Z',sale_at:'2026-10-23T13:00:00Z',sales_owner_id:'staff-a',sales_owner_name:'ANA',explicitly_cleared:false}];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({id:'history',commercial_status:'VENTA',sale_owner_id:'staff-a',commercial_sale_countable:true,sale_validated:false});
    expect(h.calls).toContainEqual(['contact_sales_states','eq',['account_id','account-a']]);
  });
  it('preserves the validated payment but stops counting a sale explicitly removed in the adviser base', async () => {
    h.rows.contacts=[contact('cleared',['AREA FIDELIZACION','PAGO VALIDADO'])];
    h.rows.payment_reviews=[payment('cleared')];
    h.rows.contact_sales_states=[{contact_id:'cleared',commercial_status:null,sale_at:'2026-10-23T13:00:00Z',sales_owner_id:'staff-a',sales_owner_name:'ANA',explicitly_cleared:true}];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({commercial_status:'',commercial_sale_countable:false,sale_validated:true,sale_owner_id:'staff-a'});
  });
  it('uses the newest CRM commercial tag instead of an older followup tag', async () => {
    const row=contact('latest');
    h.rows.contacts=[{...row,contact_tags:[
      {tag:{name:'SEGUIMIENTO DE VENTAS'},created_at:'2026-10-23T10:00:00Z'},
      {tag:{name:'VENTA'},created_at:'2026-10-24T10:00:00Z'},
    ]}];
    const result=await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data[0]).toMatchObject({commercial_status:'VENTA',commercial_status_at:'2026-10-24T10:00:00Z'});
  });
  it('accepts object, array and absent enrollment relations returned by PostgREST', async () => {
    h.rows.contacts = [contact('object', []),contact('array', []),contact('none', [])];
    const object = payment('object');
    const array = payment('array');
    h.rows.payment_reviews = [object,{...array,enrollments:[array.enrollments]},{...payment('none','unclassified'),enrollments:null}];
    const response = await GET(new Request('https://crm.example/api/v1/sales/leads'));
    expect(response.status).toBe(200);
    const result = await response.json();
    expect(result.data.map((row: {id: string}) => row.id)).toEqual(['object','array']);
    expect(result.data.every((row: {student_folder_url: string}) => row.student_folder_url.endsWith('/student'))).toBe(true);
  });
  it('keeps human-validated enrollment sales after moving to Fidelización without changing tags', async () => {
    h.rows.contacts = [contact('paid', ['PAGO VALIDADO', 'AREA FIDELIZACION']), contact('prospect')];
    h.rows.payment_reviews = [payment('paid')];
    const result = await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data).toHaveLength(2);
    expect(result.data[0]).toMatchObject({ id: 'paid', sale_validated: true, sale_monthly_price:49.9, sales_adviser: 'INSTITUCION', operation_reference: '00123', crm_tags: ['PAGO VALIDADO', 'AREA FIDELIZACION'] });
    expect(result.data[1].sale_validated).toBe(false);
    expect(h.key).toHaveBeenCalledWith(expect.any(Request),'sales:read');
    expect(h.calls).toContainEqual(['payment_reviews', 'eq', ['account_id', 'account-a']]);
    expect(h.calls).toContainEqual(['payment_reviews', 'eq', ['status', 'validated']]);
  });
  it('excludes tuition, other payments, unfinished unclassified payments and the known enrollment test', async () => {
    h.rows.contacts = [contact('tuition', []), contact('other', []), contact('unknown', []), contact('test', [], '+51 987 020 644'), contact('legacy', [])];
    h.rows.payment_reviews = [payment('tuition','tuition'), payment('other','other'), payment('unknown','unclassified','collecting'), payment('test'), payment('legacy','unclassified')];
    const result = await (await GET(new Request('https://crm.example/api/v1/sales/leads'))).json();
    expect(result.data.map((row: { id: string }) => row.id)).toEqual(['legacy']);
  });
  it('preserves pagination across a page with no sales contacts', async () => {
    h.rows.contacts = [contact('11111111-1111-4111-8111-111111111111',[]), contact('22222222-2222-4222-8222-222222222222',[])];
    const result = await (await GET(new Request('https://crm.example/api/v1/sales/leads?limit=1'))).json();
    expect(result.data).toEqual([]);
    expect(result.meta.next_cursor).toEqual(expect.any(String));
  });
});
