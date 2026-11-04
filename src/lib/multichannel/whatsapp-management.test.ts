import {describe,it,expect} from 'vitest';
import {managementAction,managementHeartbeat} from './whatsapp-management';
describe('owner WhatsApp management protocol',()=>{
 it('requires the selected phone before unlinking or replacing a profile',()=>{
  const action={action:'manage_line',worker_id:'11111111-1111-4111-8111-111111111111',operation:'unlink',line_key:'WA-test'};
  expect(managementAction.safeParse(action).success).toBe(false);
  expect(managementAction.safeParse({...action,expected_phone:'51911111111'}).success).toBe(true);
 });
 it('accepts only PNG QR data and never arbitrary URLs or message fields',()=>{
  const line={lineKey:'WA-test',label:'Soporte',status:'awaiting_qr',active:true,linkedPhone:null,qr:'data:image/png;base64,YQ=='};
  expect(managementHeartbeat.safeParse({lines:[line]}).success).toBe(true);
  expect(managementHeartbeat.safeParse({lines:[{...line,qr:'https://example.test/track'}]}).success).toBe(false);
  expect(managementHeartbeat.safeParse({lines:[{...line,messages:['private']}]}).success).toBe(false);
 });
});
