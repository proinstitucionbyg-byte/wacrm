import { expect,it } from 'vitest';
import { declarationImage } from './declaration-image';
it('genera un PNG privado del texto real, sin sustituirlo por un DNI ficticio',async()=>{
  const response=declarationImage({content_text:'NOMBRE: ALUMNO DE PRUEBA\nDNI: 00000000\nCORREO: prueba@example.com',created_at:'2026-10-09T20:00:00Z'});
  const bytes=new Uint8Array(await response.arrayBuffer());
  expect([...bytes.slice(0,8)]).toEqual([137,80,78,71,13,10,26,10]);
  expect(response.headers.get('cache-control')).toBe('private, no-store');
},20000);
