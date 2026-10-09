import {describe,expect,it} from 'vitest';
import {parseSalesRouting} from './sales-routing';
const row={user_id:'11111111-1111-4111-8111-111111111111',area:'VENTAS',cargo:'AGENTE',percentage:100};
describe('CEO sales routing configuration',()=>{
  it('accepts a single agent at 100%',()=>expect(parseSalesRouting({enabled:true,version:0,members:[row]})).not.toBeNull());
  it('accepts disabled setup at zero without assigning anybody',()=>expect(parseSalesRouting({enabled:false,version:0,members:[{...row,percentage:0}]})).not.toBeNull());
  it('requires a total of 100 to activate',()=>expect(parseSalesRouting({enabled:true,version:0,members:[{...row,percentage:30}]})).toBeNull());
  it('rejects percentages outside sales',()=>expect(parseSalesRouting({enabled:true,version:0,members:[{...row,area:'FIDELIZACION'}]})).toBeNull());
  it('rejects duplicate users',()=>expect(parseSalesRouting({enabled:true,version:0,members:[{...row,percentage:50},{...row,percentage:50}]})).toBeNull());
  it('rejects fractional percentages and invalid versions',()=>{expect(parseSalesRouting({enabled:false,version:0,members:[{...row,percentage:10.5}]})).toBeNull();expect(parseSalesRouting({enabled:true,version:-1,members:[row]})).toBeNull();});
  it('requires a position for an active recipient',()=>expect(parseSalesRouting({enabled:true,version:0,members:[{...row,cargo:''}]})).toBeNull());
});
