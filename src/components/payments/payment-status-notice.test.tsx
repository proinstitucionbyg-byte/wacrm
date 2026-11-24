import {expect,it} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {PaymentStatusNotice} from './payment-status-notice';
it('never presents receiving an image as approval',()=>{const html=renderToStaticMarkup(<PaymentStatusNotice status="received"/>);expect(html).toContain('Comprobante recibido');expect(html).toContain('por sí sola no valida');expect(html).not.toContain('data-payment-status="validated"');});
it('does not imply enrollment or delivery from a validated payment',()=>{const html=renderToStaticMarkup(<PaymentStatusNotice status="validated"/>);expect(html).toContain('Pago validado');expect(html).toContain('tienen su propio estado');});
it('keeps pending, observed and rejected visibly distinct',()=>{for(const [status,label] of [['pending','Pendiente de revisión'],['observation','Pago observado'],['rejected','Pago rechazado']] as const)expect(renderToStaticMarkup(<PaymentStatusNotice status={status}/>)).toContain(label);});
it('fails closed when an unexpected status reaches the view',()=>{const html=renderToStaticMarkup(<PaymentStatusNotice status={'invalid' as 'pending'}/>);expect(html).toContain('Estado por confirmar');expect(html).not.toContain('data-payment-status="validated"');});
