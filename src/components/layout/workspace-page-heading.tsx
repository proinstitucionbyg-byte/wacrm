import type {ReactNode} from 'react';
import {Bot,ChevronDown,CheckCheck,Clock3,Info,MessageCircle,MessagesSquare,Smartphone,UsersRound} from 'lucide-react';
import type {Conversation} from '@/types';

export function InboxWorkspaceHeading({conversations,compact=false}:{conversations:Conversation[];compact?:boolean}){
 const metrics=[{label:'Conversaciones',value:conversations.length,Icon:MessagesSquare,tone:'green'},
  {label:'Sin leer',value:conversations.filter(row=>row.unread_count>0).length,Icon:UsersRound,tone:'violet'},
  {label:'Abiertas',value:conversations.filter(row=>row.status==='open').length,Icon:CheckCheck,tone:'cyan'},
  {label:'Pendientes',value:conversations.filter(row=>row.status==='pending').length,Icon:Clock3,tone:'amber'}];
 return <details className={'crm-page-hero crm-inbox-overview '+(compact?'crm-overview-mobile-compact':'')} aria-label="Resumen de Inbox">
  <summary className="crm-overview-toggle"><span>Resumen de Inbox</span><ChevronDown aria-hidden="true"/></summary><div className="crm-overview-body">
  <div className="crm-page-identity"><span className="crm-page-symbol" aria-hidden="true"><MessageCircle/></span><div><h1>Inbox</h1><p>Gestiona tus conversaciones y oportunidades</p></div></div>
  <div className="crm-overview-metrics" title="Resumen de las conversaciones cargadas en esta lista, no de matrículas ni pagos."><span className="sr-only">Estas cifras corresponden a la lista cargada.</span>{metrics.map(({label,value,Icon,tone})=><div className="crm-overview-metric" data-tone={tone} key={label}><span className="crm-metric-symbol" aria-hidden="true"><Icon/></span><div><strong>{new Intl.NumberFormat('es-PE').format(value)}</strong><span>{label}</span></div></div>)}</div>
 </div></details>;
}
export function CampaignWorkspaceHeading({actions}:{actions?:ReactNode}){return <section className="crm-page-hero crm-campaign-hero">
 <div className="crm-page-identity"><span className="crm-page-symbol" aria-hidden="true"><Bot/></span><div><h1>Bot multicanal</h1><p>Organiza tus campañas por <span className="crm-channel-pill"><Smartphone/>WhatsApp</span> y <span className="crm-channel-pill crm-channel-sms"><MessagesSquare/>SMS</span></p></div></div>
 {actions?<aside className="crm-hero-mode-picker"><span>¿Qué deseas gestionar?</span>{actions}</aside>:<aside className="crm-hero-tip"><Info aria-hidden="true"/><span>Prepara destinatarios, mensajes y horarios.<br/>Revisa cada campaña antes de activarla.</span></aside>}
 </section>;}
