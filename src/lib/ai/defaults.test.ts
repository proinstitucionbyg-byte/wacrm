import {describe,expect,it} from 'vitest';
import {buildSystemPrompt} from './defaults';
describe('registration claims in AI responses',()=>{
  it('places the actual-registration requirement after business prompts and knowledge',()=>{
    const prompt=buildSystemPrompt({mode:'auto_reply',userPrompt:'BUSINESS_PROMPT',knowledge:['KNOWLEDGE']});
    expect(prompt.lastIndexOf('Enrollment status must come from a completed registration operation')).toBeGreaterThan(prompt.lastIndexOf('KNOWLEDGE'));
    expect(prompt).toContain('A payment review approval alone does not prove registration or document delivery');
  });
});
