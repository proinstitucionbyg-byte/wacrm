import {describe,expect,it} from 'vitest';
import {buildSystemPrompt} from './defaults';
describe('registration claims in AI responses',()=>{
  it.each(['auto_reply','draft'] as const)('keeps the verified virtual modality in %s after retrieved context',mode=>{
    const prompt=buildSystemPrompt({mode,userPrompt:'BUSINESS_PROMPT',knowledge:['KNOWLEDGE']});
    expect(prompt.lastIndexOf('VERIFIED COURSE MODALITY')).toBeGreaterThan(prompt.lastIndexOf('KNOWLEDGE'));
    expect(prompt).toContain('Never claim that any course or class is presencial');
    expect(prompt).toContain('answer clearly that they are virtual');
  });
  it('keeps sales follow-ups focused on completing payment without inventing urgency',()=>{
    const prompt=buildSystemPrompt({mode:'auto_reply',userPrompt:'BUSINESS_PROMPT',knowledge:['KNOWLEDGE']});
    expect(prompt.lastIndexOf('SALES PAYMENT FOLLOW-UP')).toBeGreaterThan(prompt.lastIndexOf('KNOWLEDGE'));
    expect(prompt).toContain('Never say "tómate el tiempo que necesites"');
    expect(prompt).toContain('Do not invent deadlines');
    expect(prompt).toContain('Respect a refusal');
  });
  it.each(['auto_reply','draft'] as const)('protects institutional privacy in %s after account context and knowledge',mode=>{
    const prompt=buildSystemPrompt({mode,userPrompt:'BUSINESS_PROMPT',knowledge:['KNOWLEDGE']});
    expect(prompt.lastIndexOf('INSTITUTIONAL PRIVACY')).toBeGreaterThan(prompt.lastIndexOf('KNOWLEDGE'));
    expect(prompt).toContain('must never be identified as director, CEO, owner');
    expect(prompt).toContain('The sole payment exception is the verified account-holder name LUIS BRAYAN PALACIOS CARHUAPOMA');
    expect(prompt).toContain('must first be reviewed by the academic area');
    expect(prompt).toContain('never give direct contact, invent an email, claim approval');
  });
  it('places the actual-registration requirement after business prompts and knowledge',()=>{
    const prompt=buildSystemPrompt({mode:'auto_reply',userPrompt:'BUSINESS_PROMPT',knowledge:['KNOWLEDGE']});
    expect(prompt.lastIndexOf('Enrollment status must come from a completed registration operation')).toBeGreaterThan(prompt.lastIndexOf('KNOWLEDGE'));
    expect(prompt).toContain('A payment review approval alone does not prove registration or document delivery');
  });
  it('requires greeting continuity and a response for unknown messages',()=>{
    const prompt=buildSystemPrompt({mode:'auto_reply',userPrompt:null});
    expect(prompt).toContain('SALUDO Y CONTINUIDAD');
    expect(prompt).toContain('Continuar');
    expect(prompt).toContain('2 horas 59 minutos');
    expect(prompt).toContain('UNKNOWN REQUESTS');
    expect(prompt).toContain('Never end with silence');
  });
});
