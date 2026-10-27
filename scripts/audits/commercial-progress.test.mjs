import test from 'node:test';
import assert from 'node:assert/strict';
import {auditCommercialProgress} from './commercial-progress.mjs';
const run = (extra={}) => ({id:'r1',automation_id:'course-a',step_ids:['image','audio','close'],close_step_id:'close',
  status:'partial',last_customer_message_at:'2026-10-27T08:00:00Z',steps_executed:[],
  pending:[{automation_id:'course-a',status:'pending',run_at:'2026-10-27T16:00:00Z'}],...extra});
const audit = r => auditCommercialProgress({captured_at:'2026-10-27T15:30:00Z',runs:[r]}).results[0];
const send = id => ({step_id:id,status:'success',detail:'media sent via Meta (wamid.fake)'});
test('a future strategic wait is not a stopped flow',()=>assert.equal(audit(run()).state,'scheduled'));
test('an overdue continuation requires investigation',()=>assert.deepEqual(audit(run({pending:[{automation_id:'course-a',status:'pending',run_at:'2026-10-27T15:20:00Z'}]})).issues,['overdue_pending']));
test('manual or window holds do not become automatic restart instructions',()=>assert.equal(audit(run({pending:[{automation_id:'course-a',status:'paused',run_at:'2026-10-27T14:00:00Z'}]})).state,'held'));
test('a foreign-course successful step is detected',()=>assert.ok(audit(run({steps_executed:[send('foreign')]})).issues.includes('step_outside_course')));
test('caption continuation belongs to the original image',()=>assert.deepEqual(audit(run({steps_executed:[send('image'),send('image:caption')]})).issues,[]));
test('repeated skip bookkeeping is not counted as repeated sending',()=>assert.deepEqual(audit(run({steps_executed:[send('image'),{step_id:'audio',status:'skipped'},{step_id:'audio',status:'skipped'}]})).issues,[]));
test('two successful sends for the same step are flagged',()=>assert.ok(audit(run({steps_executed:[send('audio'),send('audio')]})).issues.includes('repeated_send_step')));
test('successful blocks must retain the declared course order',()=>assert.ok(audit(run({step_order:['image','audio','close'],steps_executed:[send('audio'),send('image')]})).issues.includes('send_order_regressed')));
test('a split caption retains its image position before audio',()=>assert.deepEqual(audit(run({step_order:['image','audio','close'],steps_executed:[send('image'),send('image:caption'),send('audio')]})).issues,[]));
test('a scheduled closing does not mean the closing was sent',()=>assert.equal(audit(run()).close_sent,false));
test('completed without closing needs review unless payment or human took over',()=>{
  assert.ok(audit(run({status:'success',pending:[]})).issues.includes('completed_without_closing'));
  assert.deepEqual(audit(run({status:'success',pending:[],payment_or_human:true})).issues,[]);
});
test('a successful closing is not claimed as delivered',()=>{
  const result=audit(run({status:'success',pending:[],steps_executed:[send('close')]}));
  assert.equal(result.state,'closing_sent');assert.equal(result.delivery_verified,false);
});
test('a partial run without a continuation is detected',()=>assert.ok(audit(run({pending:[]})).issues.includes('partial_without_continuation')));
test('a pending job in another course is detected',()=>assert.ok(audit(run({pending:[{automation_id:'other',status:'pending',run_at:'2026-10-27T16:00:00Z'}]})).issues.includes('pending_course_mismatch')));
test('scheduling at or after 24 hours is detected',()=>assert.ok(audit(run({pending:[{automation_id:'course-a',status:'pending',run_at:'2026-10-28T08:00:00Z'}]})).issues.includes('schedule_outside_service_window')));
test('an invalid capture or duplicate run fails instead of publishing bad counts',()=>{
  assert.throws(()=>auditCommercialProgress({captured_at:'bad',runs:[]}));
  assert.throws(()=>auditCommercialProgress({captured_at:'2026-10-27T15:30:00Z',runs:[run(),run()]}));
});
