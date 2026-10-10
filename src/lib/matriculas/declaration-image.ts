import { ImageResponse } from 'next/og';
import { createElement as h } from 'react';

/** PNG evidence of the customer's stored text, explicitly labelled as a declaration. */
export function declarationImage(message: { content_text: string; created_at: string }): Response {
  const text = message.content_text.replace(/\\n/g, '\n').slice(0,6000);
  const lines = text.split('\n').flatMap(line => line.match(/.{1,65}/gu) ?? ['']);
  return new ImageResponse(h('div', {
    style: { display:'flex', flexDirection:'column', width:'100%', height:'100%', background:'#fff', color:'#111827', padding:40, fontSize:22 },
  },
  h('div',{style:{display:'flex',fontWeight:700,fontSize:28}},'DATOS DECLARADOS POR EL ESTUDIANTE'),
  h('div',{style:{display:'flex',color:'#b45309',fontSize:18,marginTop:16}},'RESPALDO DEL CHAT. FOTO DEL DOCUMENTO PENDIENTE.'),
  h('div',{style:{display:'flex',fontSize:16,marginTop:16,marginBottom:24}},new Date(message.created_at).toLocaleString('es-PE',{timeZone:'America/Lima'})),
  ...lines.map((line,i)=>h('div',{key:i,style:{display:'flex',minHeight:30}},line || ' '))
  ), { width:1000, height:Math.max(380,220+lines.length*32), headers:{'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'} });
}
