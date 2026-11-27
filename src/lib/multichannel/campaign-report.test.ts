import{describe,it,expect}from'vitest';
import{campaignReport,campaignReportCsv,type ReportJob}from'./campaign-report';
const job=(phone:string,status:string,patch:Partial<ReportJob>={}):ReportJob=>({id:phone+status,contact_id:phone,recipient:phone,mode:'whatsapp_live',status,campaign_sequence:0,campaign_step:0,started_at:null,provider_id:null,routing_alert:null,...patch});
describe('campaign result report',()=>{
 it('counts people once, distinguishes partial and uncertain results, and exports only untouched recipients',()=>{
  const report=campaignReport([job('+5191','accepted',{started_at:'now',provider_id:'one'}),job('+5191','queued',{campaign_step:1}),job('+5192','queued',{campaign_sequence:1}),job('+5193','needs_review',{campaign_sequence:2,started_at:'now'}),job('+5194','delivered',{campaign_sequence:3,provider_id:'two'}),job('+5195','cancelled',{campaign_sequence:4,routing_alert:'handled_manually'})],{'+5192':{nombre:'Pedro',fecha1:'28/11'}});
  expect(report.total).toBe(5);expect(report.counts).toMatchObject({partial:1,pending:1,review:1,completed:1,handled:1});expect(report.safePending).toBe(1);
  const csv=campaignReportCsv(report,true);expect(csv).toContain('Pedro');expect(csv).toContain('28/11');expect(csv).not.toContain('5191');expect(csv).not.toContain('5193');
 });
 it('counts a successful SMS fallback without counting cancelled WhatsApp steps as unsent',()=>{
  const r=campaignReport([job('phone','cancelled',{routing_alert:'routed_to_sms'}),job('phone','sent',{mode:'sms_live',provider_id:'sms'})]);expect(r.total).toBe(1);expect(r.counts.completed).toBe(1);expect(r.safePending).toBe(0);
 });
 it('does not export a failed attempt or a currently reserved recipient',()=>{expect(campaignReport([job('a','failed',{started_at:'now'}),job('b','claimed')]).safePending).toBe(0);});
});
