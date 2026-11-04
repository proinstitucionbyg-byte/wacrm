# Bot de WhatsApp: abrir, vincular y recuperar

## Abrir y empezar a trabajar

1. En la carpeta `wacrm`, haz doble clic en **ABRIR_BOT.cmd**. Abre el panel privado de tu computadora; si el ejecutor ya estaba activo, reutiliza esa instancia. No cambia ni borra los perfiles.
2. Selecciona **Soporte** y comprueba el teléfono **933691668** y el estado **Conectado**. Si el vínculo sigue vigente, se recupera sin otro QR.
3. Entra al CRM → **Bot multicanal**. En el orden de atención, Soporte debe ser el primero; después, los respaldos que habilitaste.
4. Las asesoras responden desde **Inbox del CRM**. Debajo de cada mensaje aparece el WhatsApp por el que salió. La pestaña muestra `(N) WACRM`: contactos pendientes de respuesta, no cantidad de mensajes.

Este acceso inicia Soporte; las demás líneas detenidas se conectan desde su propia pestaña. No abre Principal/Luis por defecto. El vínculo no equivale a diez teléfonos probados ni a SMS configurado.

## Qué ocurre cuando escribe alguien

- Si es una conversación de pauta confirmada o una continuidad comercial habilitada, se mantiene su recorrido comercial y su número original.
- Si es un primer contacto sin pauta confirmada, se registra una espera de **tres minutos desde el mensaje recibido**. No se envía una respuesta automática por API durante esa espera. Otros mensajes no reinician el plazo.
- Al terminar la espera se relee la evidencia real de Meta. Si confirmó pauta, continúa en el CRM. Si no, abre la atención desde Soporte; si la primera línea no está disponible antes del envío, usa el siguiente respaldo autorizado.
- Desde esa derivación, las respuestas manuales y automáticas conservan el WhatsApp de soporte. No vuelven a API solo porque tenga cupo disponible. Un resultado de envío incierto se revisa; no se repite por otro número.
- En WhatsApp normal las opciones se muestran numeradas; responder con el número utiliza las mismas ramas guardadas en el CRM.
- SMS es una opción separada: necesita equipo/configuración real y autorización. No sustituye las respuestas normales por WhatsApp.

Los tres minutos son el plazo configurado para clasificar. La ejecución y la entrega dependen del servidor y de WhatsApp; una caída debe quedar para revisión, no producir un envío por otro canal a ciegas.

## Vincular, detener o cambiar de teléfono

- **Conectar esta línea**: intenta usar el vínculo guardado. Si WhatsApp lo revocó, muestra QR para escanear desde el teléfono → Dispositivos vinculados → Vincular dispositivo.
- **Detener línea**: cierra su ejecución y conserva vínculo e historial. No significa desvincular el teléfono.
- **Desvincular WhatsApp**: revoca el vínculo. Para otro número, usa esa acción y después conecta/escanea el nuevo QR. Cambia solamente la pestaña elegida.
- Confirma siempre el teléfono que aparece tras escanear. No registres dos veces el mismo número en distintas líneas.
- Tras añadir un teléfono, regístralo/habilítalo en **Bot multicanal → Mis números de WhatsApp** y, si será respaldo, añádelo al orden de atención.

## Pausar y recuperar

1. Para que una asesora atienda un caso, desactiva IA/automatización de esa conversación. La respuesta manual conserva la línea asignada.
2. Para detener temporalmente el ejecutor, usa su pausa del panel. Para continuar, reanuda expresamente.
3. Si una línea parece trabada, usa **Revisar y recuperar esta línea**. Respeta las pausas y no debe reenviar resultados inciertos.
4. Si cerraste la computadora, vuelve a abrir **ABRIR_BOT.cmd**. Revisa Soporte y conecta los respaldos que necesites.
5. Si aparece un bloqueo o un perfil en uso, conserva los archivos y revisa qué instancia está abierta. No borres carpetas de sesión ni abras varias copias para intentar arreglarlo.

## Entrega, historial y límites actuales

- Reloj: falta confirmación. Un check: enviado. Dos checks verdes: entregado o leído; el texto al pasar el cursor distingue ambos. El color no debe sustituir un acuse real.
- Los mensajes escritos directamente desde el teléfono también se sincronizan con el CRM. El historial se conserva al detener/desvincular; no se promete recuperar lo que WhatsApp nunca cargó.
- La computadora y el ejecutor deben estar encendidos en esta instalación. El traslado a Contabo todavía es un trabajo separado.
- Grupos tendrán reglas distintas de los estudiantes: selector por número, empezando por 933691668, y grupos autorizados para responder frente a grupos de solo consulta. La interfaz completa dentro del CRM está pendiente. No activar un bot en todos los grupos por defecto.
- Archivos/stickers, control completo de vouchers duplicados, campañas y SMS físicos siguen pendientes de terminar y comprobar. No aprobar otra matrícula ni otro pago por recibir de nuevo un comprobante.

## Prueba de aceptación pendiente

Un teléfono nuevo autorizado escribe sin pauta al API → se registra la espera → se comprueba la evidencia de Meta → llega una sola apertura desde 933691668 → el teléfono responde una opción → continúa la rama existente → la asesora contesta desde CRM → el mismo WhatsApp entrega la respuesta. Comprobar teléfono de salida, acuse, visibilidad y ausencia de consumo/respuesta por API para ese recorrido de soporte. No dar por cerrado el recorrido solo por ver una bienvenida.
