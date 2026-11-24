/** Codes documented by the installed whatsapp-web.js GroupChat.addParticipants. */
export function groupParticipantOutcome(code:number|null){
 if(code===200)return{label:'Agregado',confirmed:true};
 if(code===409)return{label:'Ya estaba en el grupo',confirmed:true};
 const labels:Record<number,string>={403:'Requiere invitación privada',404:'Número no registrado en WhatsApp',408:'Salió del grupo recientemente',417:'Requiere invitación por enlace',419:'El grupo está lleno'};
 return{label:code===null?'Sin confirmación de WhatsApp':labels[code]??`Revisar resultado · código ${code}`,confirmed:false};
}
