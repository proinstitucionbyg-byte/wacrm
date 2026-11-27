import { afterEach, describe, expect, it, vi } from 'vitest';
import { publishBusinessPhoto } from './business-profile';

afterEach(()=>vi.unstubAllGlobals());
const photo=()=>new File([new Uint8Array([137,80,78,71])],'profile.png',{type:'image/png'});
const responses=(rows:unknown[])=>{const fetch=vi.fn();for(const row of rows)fetch.mockResolvedValueOnce({ok:true,json:async()=>row});vi.stubGlobal('fetch',fetch);return fetch;};
describe('public Cloud API photo',()=>{
 it('uploads a handle, publishes only the selected connection, and reads Meta back',async()=>{
  const fetch=responses([{display_phone_number:'+51 937 467 119'},{data:[{profile_picture_url:'https://example.test/old'}]},{id:'upload:123'},{h:'new-handle'},{success:true},{display_phone_number:'+51 937 467 119'},{data:[{profile_picture_url:'https://example.test/new'}]}]);
  const result=await publishBusinessPhoto('secret','123','51937467119',photo());
  expect(result).toMatchObject({published:true,readback:true,photoUrl:'https://example.test/new'});
  expect(JSON.parse(fetch.mock.calls[4][1].body)).toEqual({messaging_product:'whatsapp',profile_picture_handle:'new-handle'});
  expect(fetch.mock.calls.every(([url])=>!String(url).includes('secret'))).toBe(true);
 });
 it('does not upload when the connection changed to another phone',async()=>{
  const fetch=responses([{display_phone_number:'+51 900 000 000'},{data:[]}]);
  await expect(publishBusinessPhoto('secret','123','51937467119',photo())).rejects.toThrow('número de la conexión cambió');
  expect(fetch).toHaveBeenCalledTimes(2);
 });
 it('reports publication separately when the readback fails',async()=>{
  responses([{display_phone_number:'51937467119'},{data:[]},{id:'upload:123'},{h:'handle'},{success:true}]);
  expect(await publishBusinessPhoto('secret','123','51937467119',photo())).toMatchObject({published:true,readback:false,photoUrl:null});
 });
});
