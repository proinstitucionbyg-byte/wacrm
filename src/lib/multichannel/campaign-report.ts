export type ReportJob={id:string;contact_id:string;recipient:string;mode:string;status:string;campaign_sequence:number;campaign_step:number|null;started_at:string|null;provider_id:string|null;routing_alert:string|null};
export type ReportRecipient={position:number;phone:string;name:string;status:string;accepted:number;delivered:number;steps:number;safeToExport:boolean;variables:Record<string,string>};
export const reportLabels:Record<string,string>={completed:'Secuencia enviada',partial:'Envío parcial',pending:'Sin iniciar',failed:'Falló',review:'Resultado por revisar',processing:'En proceso',handled:'Atendido manualmente',cancelled:'Cancelado',expired:'Vencido'};
export function campaignReport(jobs:ReportJob[],variables:Record<string,Record<string,string>>={}){
 const groups=new Map<string,ReportJob[]>();for(const job of jobs){const key=job.contact_id||job.recipient;groups.set(key,[...groups.get(key)??[],job]);}
 const recipients:ReportRecipient[]=[];
 for(const [contact,all] of groups){
  const sms=all.filter(j=>j.mode==='sms_live'),steps=sms.length?sms:all.filter(j=>j.mode==='whatsapp_live');
  const accepted=steps.filter(j=>['accepted','sent','delivered'].includes(j.status)).length,delivered=steps.filter(j=>j.status==='delivered').length;
  const handled=all.some(j=>j.routing_alert==='handled_manually'),review=all.some(j=>j.status==='needs_review'),processing=all.some(j=>['claimed','dispatching'].includes(j.status));
  const status=review?'review':processing?'processing':accepted===steps.length&&steps.length?'completed':handled?'handled':accepted?'partial':steps.some(j=>j.status==='failed')?'failed':steps.some(j=>j.status==='queued')?'pending':steps.some(j=>j.status==='expired')?'expired':'cancelled';
  const vars=variables[contact]??{};
  recipients.push({position:Math.min(...all.map(j=>j.campaign_sequence))+1,phone:all[0].recipient,name:vars.nombre??'',status,accepted,delivered,steps:steps.length,variables:vars,safeToExport:!handled&&!review&&!processing&&!all.some(j=>j.started_at||j.provider_id||['accepted','sent','delivered'].includes(j.status))});
 }
 recipients.sort((a,b)=>a.position-b.position);
 const counts=Object.fromEntries(Object.keys(reportLabels).map(key=>[key,recipients.filter(r=>r.status===key).length]));
 return{total:recipients.length,counts,acceptedMessages:jobs.filter(j=>['accepted','sent','delivered'].includes(j.status)).length,deliveredMessages:jobs.filter(j=>j.status==='delivered').length,fullyDelivered:recipients.filter(r=>r.steps>0&&r.delivered===r.steps).length,safePending:recipients.filter(r=>r.safeToExport).length,recipients};
}
export type CampaignReport=ReturnType<typeof campaignReport>;
export function campaignReportCsv(report:CampaignReport,pendingOnly:boolean){
 const rows=report.recipients.filter(r=>!pendingOnly||r.safeToExport),keys=[...new Set(rows.flatMap(r=>Object.keys(r.variables)))].filter(k=>!['nombre','telefono'].includes(k));
 const cell=(v:string)=>'"'+(/^[=+@-]/.test(v)?"'"+v:v).replaceAll('"','""')+'"';
 return '\uFEFF'+[['Telefono','Nombre',...keys,...(pendingOnly?[]:['Estado','Posicion','Pasos enviados','Pasos totales'])],...rows.map(r=>[r.phone.replace(/^\+/,''),r.name,...keys.map(k=>r.variables[k]??''),...(pendingOnly?[]:[reportLabels[r.status]??r.status,String(r.position),String(r.accepted),String(r.steps)])])].map(row=>row.map(cell).join(',')).join('\r\n');
}
