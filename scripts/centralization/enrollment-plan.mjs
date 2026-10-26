import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const ACCOUNT = '4d761b3c-4c6c-4986-bcd8-d95f1754fe35';
const ORIGINAL = 'https://docs.google.com/spreadsheets/d/16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w/edit#gid=1794725981';
const UUID = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;
const clean = value => String(value ?? '').trim().replace(/\s+/g, ' ');
const normalized = value => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
const money = value => {
  const n = Number(String(value).replace(',', '.'));
  if (!String(value ?? '').trim() || !Number.isFinite(n) || n <= 0) throw Error('Importe inválido');
  return n;
};
export function phone(value) {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (/^9\d{8}$/.test(digits)) return `51${digits}`;
  if (/^\d{10,15}$/.test(digits)) return digits;
  throw Error('Teléfono incompleto');
}
export function sheetDate(value) {
  if (!value) return '';
  const raw = String(value);
  let date;
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(raw)) {
    const [d,m,y] = raw.split('/'); date = `${y}-${m.padStart(2,'0')}-${d.padStart(2,'0')}`;
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) date = raw;
  else {
    if (!/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(raw)) throw Error('Fecha ambigua');
    const parsed = new Date(raw);
    if (!Number.isFinite(parsed.getTime())) throw Error('Fecha inválida');
    date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima', year: 'numeric', month: '2-digit', day: '2-digit' }).format(parsed);
  }
  const ms = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0,10) !== date) throw Error('Fecha inválida');
  return ms / 86400000 + 25569;
}
function uniqueRows(rows, key, label) {
  const result = new Map();
  for (const row of rows) {
    const id = key(row);
    if (!id) continue;
    if (result.has(id)) throw Error(`${label}: identificador duplicado ${id}`);
    result.set(id, row);
  }
  return result;
}
const folder = value => /^https:\/\/drive\.google\.com\/drive\/folders\/[\w-]+$/.test(value ?? '');
const file = value => /^https:\/\/drive\.google\.com\/file\/d\/[\w-]+\//.test(value ?? '');

/** Offline plan only. Does not approve payments, change academic states or send messages. */
export function planEnrollments(source) {
  const sheets = source.matriculas.values;
  const docs = source.documents.values;
  if (sheets[0]?.[6] !== 'NOMBRE COMPLETO' || sheets[0]?.[22] !== 'ESTADO' || docs[0]?.[12] !== 'BOLETA PDF') throw Error('Cabeceras de origen cambiaron');
  const registrations = uniqueRows(sheets.slice(1).map((values, i) => ({ values, row: i + 2 })), r => clean(r.values[0]), 'MATRICULAS');
  const documentRows = uniqueRows(docs.slice(1), r => clean(r[0]), 'DOCUMENTOS GENERADOS');
  const enrollments = uniqueRows(source.enrollments, r => r.id, 'CRM');
  const students = new Map(), identities = new Map();
  const tables = { ALUMNOS: [], MATRICULAS: [], PAGOS: [], DOCUMENTOS: [] };
  const sourceIds = [];
  const orderedEnrollments = [...enrollments.values()].sort((a,b)=>String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')) || a.id.localeCompare(b.id));
  for (const e of orderedEnrollments) {
    const d = e.data;
    if (e.account_id !== ACCOUNT || !UUID.test(e.id) || !UUID.test(e.contact_id) || !UUID.test(e.review_id)) throw Error('Identidad o cuenta inválida');
    if (phone(d.phone1) === '51987020644') continue;
    if (e.status !== 'registered' || e.payment_status !== 'validated' || ['tuition','other'].includes(e.payment_purpose)) throw Error(`Expediente no elegible: ${e.id}`);
    const match = registrations.get(String(e.registered_number));
    const generated = documentRows.get(String(e.registered_number));
    if (!match || !generated || generated[15] !== 'GENERADO') throw Error(`Registro/documentos faltantes: ${e.registered_number}`);
    const r = match.values;
    if (clean(r[8]) !== clean(d.document_number) || normalized(r[6]) !== normalized(d.full_name) || phone(r[11]) !== phone(d.phone1) || r[17] !== e.student_folder_url || !folder(e.student_folder_url)) throw Error(`Conflicto CRM/hoja: ${e.registered_number}`);
    if (!['DNI','CE','PASAPORTE','OTRO'].includes(normalized(d.document_type))) throw Error('Tipo de documento no mapeado');
    if (!Array.isArray(d.prices) || d.prices.length !== 6) throw Error('Oferta incompleta');
    const prices = d.prices.map(money);
    const paid = money(d.amount);
    if (Math.abs(money(generated[9])-paid) > 0.001) throw Error(`Monto de pago no coincide: ${e.registered_number}`);
    if (generated.slice(12,15).some(url => !file(url))) throw Error('Documento sin enlace válido');
    const studentId = `EST-${e.contact_id}`, enrollmentId = `MAT-${e.id}`, paymentId = `PAG-${e.review_id}`;
    const identity = `${normalized(d.document_type)}:${normalized(d.document_number)}`;
    if (identities.has(identity) && identities.get(identity) !== studentId) throw Error('Documento repetido en contactos diferentes; conciliar antes de unir');
    identities.set(identity,studentId);
    const url = `${ORIGINAL}&range=A${match.row}:W${match.row}`;
    const documentType = normalized(d.document_type) === 'CE' ? 'Carné de extranjería' : normalized(d.document_type) === 'PASAPORTE' ? 'Pasaporte' : normalized(d.document_type) === 'OTRO' ? 'Otro' : 'DNI';
    const person = [studentId,e.contact_id,clean(d.full_name).toUpperCase(),documentType,clean(d.document_number),clean(r[11]),phone(d.phone1),clean(d.email),sheetDate(d.birth_date),'','',e.first_ad_referral ? 'Referencia Meta almacenada' : 'Origen sin confirmar',clean(e.first_ad_referral?.source_id ?? e.first_ad_referral?.ad_id),e.student_folder_url,sheetDate(e.contact_created_at),sheetDate(e.updated_at),url,'Estado académico por conciliar. Carga de consulta; integración automática pendiente.'];
    const existing = students.get(studentId);
    if (existing && JSON.stringify(existing.slice(2,9)) !== JSON.stringify(person.slice(2,9))) throw Error('Datos personales diferentes para el mismo contacto');
    if (!existing) { students.set(studentId,person); tables.ALUMNOS.push(person); }
    const welcome = normalized(r[22]) === 'REALIZADO' ? 'Realizado' : normalized(r[22]) === 'NO REALIZADO' ? 'No realizado' : '';
    if (!welcome) throw Error('Estado de bienvenida no reconocido');
    tables.MATRICULAS.push([enrollmentId,studentId,sheetDate(r[1]),r[3],r[18],'',sheetDate(d.start_date),`Inicial S/${prices[0].toFixed(2)} · siguientes: ${prices.slice(1).map(p=>p.toFixed(2)).join(' / ')}`,prices[0],'',clean(e.sales_adviser),'',...generated.slice(12,15),e.student_folder_url,welcome,'',url,sheetDate(e.updated_at)]);
    const method = normalized(d.payment_method);
    const methods = { YAPE:'Yape',PLIN:'Plin',TRANSFERENCIA:'Transferencia',TARJETA:'Tarjeta',EFECTIVO:'Efectivo' };
    tables.PAGOS.push([paymentId,studentId,enrollmentId,'Matrícula',paid,'',sheetDate(d.payment_date),methods[method] ?? 'Otro',clean(e.operation_reference),e.payment_evidence_url ?? '', 'Validado',e.reviewed_by ?? '',sheetDate(e.reviewed_at),[e.payment_note,'Pago inicial incluye matrícula y primera mensualidad.',paid !== prices[0] ? `Importe validado S/${paid.toFixed(2)}; precio inicial S/${prices[0].toFixed(2)}. No se alteraron.` : ''].filter(Boolean).join(' '),url]);
    ['BOLETA','CRONOGRAMA','FICHA'].forEach((kind,i)=>{
      const delivery = e.deliveries.find(x=>x.kind===kind);
      const delivered = ['delivered','read'].includes(delivery?.message_status);
      const state = delivered ? 'Entregado' : delivery?.status === 'review' ? 'Observado' : 'Generado';
      const note = delivery?.status==='review' ? 'Entrega por revisar. No repetir el envío incierto. Descargar para gestión manual.'
        : delivered ? `Entrega confirmada por Meta (${delivery.message_status}).` : delivery?.status==='sent'
          ? 'Enviado a Meta; entrega todavía sin confirmar.' : 'Sin registro API no se presume entrega; puede haberse enviado por otro medio.';
      tables.DOCUMENTOS.push([`DOC-${e.id}-${kind}`,studentId,enrollmentId,paymentId,['Boleta','Cronograma','Ficha matrícula'][i],i===0?generated[11]:'',sheetDate(generated[10]),generated[12+i],e.student_folder_url,state,delivery?.status==='sent'?'WhatsApp API':'',delivered ? sheetDate(delivery?.delivered_at) : '','',note]);
    });
    sourceIds.push({ enrollment: e.id, contact: e.contact_id, sourceRow: match.row, registration: e.registered_number });
  }
  uniqueRows(tables.PAGOS,r=>r[0],'PAGOS destino');
  for (const [table,dateColumn] of Object.entries({ ALUMNOS:14, MATRICULAS:2, PAGOS:6, DOCUMENTOS:6 })) {
    tables[table].sort((a,b)=>Number(a[dateColumn])-Number(b[dateColumn]) || String(a[0]).localeCompare(String(b[0])));
  }
  return { version: 1, accountId: ACCOUNT, mode: 'consulta-sin-envios', tables, sourceIds, warnings: ['Estado académico y grupo/cohorte pendientes de conciliación histórica.','No implica sincronización automática ni edición bilateral.'] };
}

/** Append-only: a repeated batch is a no-op; an existing human edit is never overwritten. */
export function planAppend(existingRows, incomingRows) {
  const existing = uniqueRows(existingRows,r=>clean(r[0]),'Destino');
  const incoming = uniqueRows(incomingRows,r=>clean(r[0]),'Lote');
  const additions=[];
  for (const [id,row] of incoming) {
    const before = existing.get(id);
    if (before && JSON.stringify(before.map(v=>v??'')) !== JSON.stringify(row.map(v=>v??''))) throw Error(`Datos existentes diferentes: ${id}`);
    if (!before) additions.push(row);
  }
  return additions;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input,output] = process.argv.slice(2);
  if (!input || !output) throw Error('Uso: node enrollment-plan.mjs origen.json plan.json');
  const plan = planEnrollments(JSON.parse(readFileSync(input,'utf8')));
  writeFileSync(output,JSON.stringify(plan,null,2)+'\n');
  console.log(JSON.stringify({ mode:plan.mode, counts:Object.fromEntries(Object.entries(plan.tables).map(([k,v])=>[k,v.length])) }));
}
