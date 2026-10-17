function normalize(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Conservative detector for messages that explicitly identify themselves as
 * automatic. It intentionally avoids guessing from short or repetitive text:
 * a real student who writes "hola" several times must still be attended.
 */
export function isLikelyAutomatedInbound(value: string | null | undefined): boolean {
  const text = normalize(value ?? '')
  if (!text) return false

  const explicitSignals = [
    /\b(?:este|esto) es (?:un )?mensaje (?:automatico|automatizado)\b/,
    /\bmensaje (?:generado )?(?:automaticamente|automatizado)\b/,
    /\brespuesta automatica\b/,
    /\bno respond(?:a|as|er) (?:a )?este mensaje\b/,
    /\bdo not reply\b/,
    /\bautomated (?:message|response)\b/,
    /\b(?:soy|somos) (?:el |la |un |una )?(?:asistente virtual|chatbot|bot)\b/,
    /\bte (?:atiende|saluda) (?:el |la |nuestro |nuestra )?(?:asistente virtual|chatbot|bot)\b/,
    /\bsoy (?:una? )?(?:inteligencia artificial|asistente (?:de |con )?inteligencia artificial)\b/,
  ]
  if (explicitSignals.some((pattern) => pattern.test(text))) return true

  // Outbound-only service numbers often rotate the support link on every
  // reply. Their body is automated even when it never uses the word "bot".
  const outboundOnly = /\b(?:este (?:numero|canal)|esta linea) (?:es |se usa |se utiliza )?(?:exclusiv[oa]|unicamente|solo) (?:para )?(?:enviar|envio de) (?:comunicaciones|mensajes|notificaciones)\b/.test(text)
  const redirectsSupport = /\b(?:consulta|consultas|servicio|atencion)\b/.test(text)
    && /\b(?:escribenos|escribe|contacta|comunicate|ingresa)\b/.test(text)
  if (outboundOnly && redirectsSupport) return true

  const menuInstruction = /\b(?:selecciona|seleccione|elige|elija|presiona|presione|digita|marque?)\b/.test(text)
  const menuObject = /\b(?:una opcion|el numero|una alternativa|menu de opciones)\b/.test(text)
  const serviceSignature = /\b(?:gracias por comunicarte|gracias por contactarnos|horario de atencion|nuestros agentes|todos nuestros asesores)\b/.test(text)
  return menuInstruction && menuObject && serviceSignature
}
