import{describe,it,expect}from'vitest';
import{groupRequest,groupResult}from'./whatsapp-groups';
import{managementHeartbeat}from'./whatsapp-management';
const id='11111111-1111-4111-8111-111111111111';
const request={request_id:id,worker_id:id,line_key:'WA-one',expected_phone:'51900000001',request:{kind:'list'}};
describe('group management protocol',()=>{
 it('requires the request identity, line and confirmed phone',()=>{
  expect(groupRequest.safeParse(request).success).toBe(true);
  for(const patch of [{request_id:undefined},{line_key:'TEST-one'},{expected_phone:null},{account_id:id}])expect(groupRequest.safeParse({...request,...patch}).success).toBe(false);
 });
 it('accepts group metadata while rejecting messages and unsupported operations',()=>{
  const details={kind:'details',id:'123456789@g.us',name:'Grupo',description:'Curso',canManage:true,messagesRetained:false,participants:[]};
  expect(groupResult.safeParse(details).success).toBe(true);
  expect(groupResult.safeParse({...details,messages:[{text:'Private'}]}).success).toBe(false);
  expect(groupRequest.safeParse({...request,request:{kind:'mutate',group_id:details.id,change:{operation:'delete',value:true}}}).success).toBe(false);
 });
 it('accepts a review-required result in the existing heartbeat without loosening line snapshots',()=>{
  expect(managementHeartbeat.safeParse({lines:[],completed:{id,status:'needs_review',result:'Revisar',result_data:{kind:'mutation',state:'needs_review'}}}).success).toBe(true);
  expect(managementHeartbeat.safeParse({lines:[],completed:{id,status:'done',result:'Grupo',result_data:{kind:'list',total:0,offset:0,groups:[],messages:[]}}}).success).toBe(false);
 });
});

it('accepts typed media attachments but refuses extra fields and unsafe filenames',()=>{const value={kind:'audio',url:'https://media.example/original.ogg',filename:'Original.ogg'};const make=(v:unknown)=>({...request,request:{kind:'mutate',group_id:'123456789@g.us',change:{operation:'media',value:v}}});expect(groupRequest.safeParse(make(value)).success).toBe(true);expect(groupRequest.safeParse(make({...value,filename:'../private.ogg'})).success).toBe(false);expect(groupRequest.safeParse(make({...value,kind:'executable'})).success).toBe(false);expect(groupRequest.safeParse(make({...value,data:'private-bytes'})).success).toBe(false);});
