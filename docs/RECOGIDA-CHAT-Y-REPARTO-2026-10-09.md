# RECOGIDA DE DATOS Y COMPLEMENTOS DEL CRM

## Correccion de matricula

- El webhook recoge datos escritos y OCR despues de guardar el mensaje, aunque la IA este pausada.
- La validacion humana recoge tambien los datos enviados desde el voucher antes de validar.
- Al abrir una ficha, POST /api/enrollments/[id]/collect recupera los datos existentes.
- Solo se procesa una ficha COLLECTING por conversacion y cuenta, con pago VALIDATED.
- El periodo empieza en la fecha del voucher del caso. Fotos anteriores deben seleccionarse manualmente para evitar reutilizar documentos viejos.
- Se completan campos vacios. Conflictos de texto/OCR no se resuelven inventando; las correcciones manuales prevalecen.
- No se aprueba identidad, pago ni oferta. No se inventa fecha oficial ni seis cuotas a partir del nombre de una promocion.
- Se copia el importe real del comprobante; no se iguala al precio de una oferta.
- Guardado condicionado por cuenta, estado y version. No modifica fichas en cola/proceso/registradas.
- Pruebas: 824/824 y npm run build correcto antes de publicar. La comprobacion en produccion se documentara por separado.

## Requisitos adicionales confirmados por el usuario

Estos son pendientes; no son afirmaciones de implementacion.

1. Etiquetas administradas por CEO, nombres/colores, seleccionar varios chats y aplicar/quitar etiquetas, menu con clic derecho. Asesoras ven/aplican las etiquetas permitidas. Estado de pago automatico al validar.
2. Atajos mandar(medios de pago), mandar(promocion de 19.90 del curso auxiliar de farmacia), mandar(malla curricular de auxiliar de farmacia). Se envia el bloque real preparado de imagen/texto/audio, nunca el comando literal ni una respuesta inventada. Disponible durante atencion humana.
3. El CEO configura las cuentas por correo: AREA (VENTAS/FIDELIZACION), CARGO (AGENTE/COORDINADORA) y permisos. Son dimensiones distintas del porcentaje.
4. El CEO reparte el 100% de leads derivados a ventas entre las asesoras, por ejemplo 40/30/30. Porcentaje configurable, asignacion sin duplicados y con control de concurrencia.
5. Cuatro interacciones automaticas y derivacion en la quinta, pendiente de implementar y verificar exactamente. No confundir con el limite actual de respuestas IA.

## Pendientes del registro completo

- Fuente automatica de fecha oficial desde CUADRO DE INICIOS.
- Oferta real de seis cuotas registrada en el momento de ofrecerse, no inferida del voucher o del nombre.
- Completar revision y probar fila de Google, fotos, tres PDF y entrega al estudiante.
- Bienvenida con imagen y audio: usuario enviara recursos en otro momento.
