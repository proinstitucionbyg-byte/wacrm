/** Reject explicit conversational instructions without guessing a person's name. */
export function isConversationInsteadOfName(value:string):boolean{
 const text=value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().replace(/\s+/g,' ').toUpperCase();
 return /^(?:(?:COMENZAMOS|EMPEZAMOS|INICIAMOS|ARRANCAMOS|COMENZAR|EMPEZAR|INICIAR)\s+(?:DESDE|DE NUEVO|OTRA VEZ)|DESDE CERO\b|ESTOY (?:FUERA|EN CASA|TRABAJANDO)\b|(?:YA )?(?:PAGUE|ENVIE|MANDE)\b|LISTO (?:VERIFIQUE|YA)\b|(?:CONTINUEMOS|SIGAMOS)\s+(?:CON|EL|LA|DESDE)\b)/.test(text);
}
