import {CheckCircle2,Clock3,HelpCircle,MessageSquareWarning,XCircle} from 'lucide-react';
import type {PaymentStatus} from '@/lib/payments/review';
const statuses={
 received:{title:'Comprobante recibido',detail:'La imagen por sí sola no valida el pago. Falta enviarlo a revisión.',icon:Clock3,tone:'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'},
 pending:{title:'Pendiente de revisión',detail:'El comprobante está en revisión. El pago todavía no está validado.',icon:Clock3,tone:'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-200'},
 observation:{title:'Pago observado',detail:'Revisa el motivo y completa la aclaración solicitada. Aún no está validado.',icon:MessageSquareWarning,tone:'border-orange-500/40 bg-orange-500/10 text-orange-800 dark:text-orange-200'},
 rejected:{title:'Pago rechazado',detail:'La revisión fue rechazada. Consulta el motivo antes de continuar.',icon:XCircle,tone:'border-red-500/40 bg-red-500/10 text-red-800 dark:text-red-200'},
 validated:{title:'Pago validado',detail:'El pago está validado. La matrícula y la entrega de documentos tienen su propio estado.',icon:CheckCircle2,tone:'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'},
 unknown:{title:'Estado por confirmar',detail:'No se pudo determinar el estado. No debe darse por validado.',icon:HelpCircle,tone:'border-border bg-muted text-foreground'},
};
export function PaymentStatusNotice({status}:{status:PaymentStatus|'received'}){
 const item=Object.hasOwn(statuses,status)?statuses[status]:statuses.unknown,Icon=item.icon;
 return <section aria-label="Estado del pago" data-payment-status={Object.hasOwn(statuses,status)?status:'unknown'} className={'space-y-1 rounded-xl border p-3 '+item.tone}><p className="flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 shrink-0" aria-hidden="true"/>{item.title}</p><p className="text-xs leading-relaxed">{item.detail}</p></section>;
}
