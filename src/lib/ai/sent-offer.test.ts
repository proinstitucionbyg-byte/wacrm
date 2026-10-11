import { describe, expect, it } from 'vitest';
import { sentOfferPriceReply } from './sent-offer';
import { quotedOfferPrices } from '@/lib/matriculas/offer-prices';
const audio = '[AUDIO ENVIADO: NUTRICION 19.90. TRANSCRIPCION AUTOMATICA; NO ES VALIDACION DE PAGO]\nLa mensualidad en 79.90. Tu primer mes solo estarias cancelando 19.90. Nuestra duracion es de seis meses.';
describe('answers grounded in the audio actually sent', () => {
  it('answers from the text actually sent when audio transcription was unnecessary', () => {
    const written = '[OFERTA ENVIADA: NUTRICION 19.90. DATOS DEL TEXTO O PIE DE IMAGEN ENVIADOS]\nPrimer mes S/19.90. Mensualidad S/49.90. Duracion 6 meses.';
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'assistant',content:written},{role:'user',content:'Cuanto pago?'}])).toContain('S/49.90');
  });
  it('extracts the real transcription without a spoken currency label', () => {
    expect(quotedOfferPrices(audio)).toEqual([19.9,79.9,79.9,79.9,79.9,79.9]);
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'user',content:'¿Cuanto pago el primer mes y desde el segundo?'}])).toContain('S/79.90');
  });
  it('uses the latest audio offer, including a changed promotion', () => {
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'assistant',content:audio.replace('79.90','49.90')},{role:'user',content:'Cuanto pago?'}])).toContain('S/49.90');
  });
  it('does not interpret a customer message as institutional offer evidence', () => {
    expect(sentOfferPriceReply([{role:'user',content:audio+' cuanto pago?'}])).toBeNull();
  });
  it('does not use a different course, missing price, or private debt question', () => {
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'user',content:'Cuanto cuesta farmacia?'}])).toBeNull();
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'assistant',content:'[AUDIO ENVIADO: NUTRICION] Seis meses, consulta el precio.'},{role:'user',content:'Cuanto pago?'}])).toBeNull();
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'user',content:'Cuanto es mi deuda?'}])).toBeNull();
    expect(sentOfferPriceReply([{role:'assistant',content:audio},{role:'user',content:'Cuanto cuesta el certificado?'}])).toBeNull();
    expect(quotedOfferPrices('Primer mes S/20. Mensualidad S/80. Seis meses.')).toEqual([20,80,80,80,80,80]);
    expect(quotedOfferPrices('6 meses. ~Mensualidad S/79.90~ Primer mes S/19.90')).toBeNull();
  });
});
