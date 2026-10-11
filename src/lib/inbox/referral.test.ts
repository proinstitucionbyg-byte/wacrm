import { describe, expect, it } from 'vitest';
import { parseReferral } from './referral';
describe('Meta referral evidence', () => {
  it('does not manufacture an ad from a greeting or unknown fields', () => {
    expect(parseReferral({text:'información farmacia', campaign_name:'invented'})).toBeNull();
    for (const input of [null, undefined, 'anuncio', [], 42]) expect(parseReferral(input)).toBeNull();
  });
  it('keeps exact ad identifiers and copy supplied by Meta', () => {
    expect(parseReferral({source_type:'ad',source_id:'123',headline:'Nutrición',ctwa_clid:'click123',extra:'private'})).toEqual({source_type:'ad',source_id:'123',headline:'Nutrición',ctwa_clid:'click123'});
  });
  it('keeps Messenger referral evidence without turning a post into an ad', () => {
    expect(parseReferral({source:'ADS',ad_id:'567',ref:'nutri'})).toEqual({source:'ADS',ad_id:'567',ref:'nutri'});
    expect(parseReferral({source_type:'post',source_id:'555'})).toEqual({source_type:'post',source_id:'555'});
  });
  it('rejects unsafe URLs, objects and oversized content', () => {
    expect(parseReferral({source_url:'javascript:alert(1)',ad_id:{id:'1'}})).toBeNull();
    expect(parseReferral({source_url:'https://www.facebook.com/123',body:'x'.repeat(3000)})).toEqual({source_url:'https://www.facebook.com/123',body:'x'.repeat(2000)});
  });
});
