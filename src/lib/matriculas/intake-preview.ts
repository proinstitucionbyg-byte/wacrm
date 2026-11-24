import {collectEnrollmentData,collectPaymentData} from './collect-data';
import {prepareAutomaticIntake,type IntakeEvidence} from './auto-intake';
import type {AcademicModule} from './calendar';
import type {EnrollmentData} from './enrollment';
/** Pure view of existing evidence after validated payment. Saving remains versioned and explicit. */
export function previewEnrollmentIntake(data:EnrollmentData,fields:Record<string,unknown>,messages:IntakeEvidence[],calendar:AcademicModule[],receivedAt:string):EnrollmentData{
 let next=collectEnrollmentData(collectPaymentData(data,fields),messages.filter(m=>m.sender_type==='customer'));
 if(next.course)next=prepareAutomaticIntake(next,messages,calendar,receivedAt);
 return next;
}
