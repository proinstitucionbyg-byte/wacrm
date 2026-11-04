/** Tab-separated table copied from Excel/Sheets; no guessing of consent/payments. */
export function parseRecipientList(text: string) {
  const lines = text.replace(/^\uFEFF/,'').split(/\r?\n/);
  while(lines.length && !lines[0].trim()) lines.shift();
  const expected = ['ID','DESTINO','NOMBRE','PERMISO','PAGO'];
  const header = lines.shift()?.split('\t').map(value=>value.trim().toUpperCase());
  if (!header || header.length !== expected.length || header.some((value,index)=>value!==expected[index])) {
    throw new Error('La primera fila debe contener ID, Destino, Nombre, Permiso y Pago, separados por tabulaciones.');
  }
  const rows=lines.map((line,index)=>({line,index:index+2})).filter(({line})=>line.trim());
  if (!rows.length || rows.length>5000) throw new Error('Pega entre 1 y 5000 destinatarios.');
  return rows.map(({line,index})=>{
    const cells=line.split('\t').map(value=>value.trim());
    if(cells.length!==5) throw new Error(`Fila ${index}: deben ser cinco columnas; revisa las tabulaciones.`);
    const [id,destination,nombre,permission,payment]=cells;
    if(!id || !destination) throw new Error(`Fila ${index}: falta ID o destino.`);
    const consent=permission.toUpperCase();
    if(!['SI','SÍ','NO','PENDIENTE',''].includes(consent)) throw new Error(`Fila ${index}: Permiso debe ser Sí, No o Pendiente.`);
    const value=payment.toUpperCase();
    if(!['PENDIENTE','RESUELTO','POR CONFIRMAR','DESCONOCIDO',''].includes(value)) throw new Error(`Fila ${index}: Pago debe ser Pendiente, Resuelto o Por confirmar.`);
    return {
      id,destination,permission_confirmed:['SI','SÍ'].includes(consent),
      payment_status:(value==='PENDIENTE'?'pending':value==='RESUELTO'?'resolved':'unknown') as 'pending'|'resolved'|'unknown',
      variables:{nombre},
    };
  });
}

/** Prepare only deferred recipients after the prior batch is confirmed saved. */
export function remainingRecipientList(text:string, deferred:{recipient_id:string;destination:string}[]) {
  const wanted=new Set(deferred.map(r=>JSON.stringify([r.recipient_id,r.destination])));
  const seen=new Set<string>();
  const rows=parseRecipientList(text).filter(r=>{
    const key=JSON.stringify([r.id,r.destination]);
    if(!wanted.has(key)||seen.has(key)) return false;
    seen.add(key);return true;
  });
  if(!rows.length) throw new Error('No hay destinatarios para otro lote.');
  return ['ID\tDestino\tNombre\tPermiso\tPago',...rows.map(r=>[
    r.id,r.destination,r.variables.nombre,r.permission_confirmed?'Sí':'No',
    r.payment_status==='pending'?'Pendiente':r.payment_status==='resolved'?'Resuelto':'Por confirmar',
  ].join('\t'))].join('\n');
}

/** The UI explicitly labels these local wall-clock inputs as Lima (UTC-05). */
export function limaInputToISO(value: string) {
  if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Completa fecha y hora de Lima.');
  const date=new Date(`${value}:00-05:00`);
  if(!Number.isFinite(date.getTime())) throw new Error('Fecha inválida.');
  const roundTrip=new Intl.DateTimeFormat('sv-SE',{
    timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23',
  }).format(date).replace(' ','T');
  if(roundTrip!==value) throw new Error('La fecha indicada no existe.');
  return date.toISOString();
}
