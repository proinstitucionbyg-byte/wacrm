# Messenger e Instagram — 11 octubre 2026

## Cambios del lote

- Transporte compartido para envío manual, IA, flujos y automatizaciones guardadas.
- Recepción con firma de Meta y vinculación explícita a la cuenta del CRM.
- Mismo embudo: flujo, bloques preparados y después IA si ninguno atendió el mensaje.
- Lectura de imágenes, transcripción entrante, cola de revisión de pagos y captura de datos académicos. Recibir un voucher NO valida el pago.
- Entrega de documentos después de la validación, con las mismas reservas y comprobaciones del proceso existente.
- Messenger entrega archivos; Instagram entrega el nombre y enlace privado de descarga del PDF (vigencia de siete días). El archivo archivado en Drive conserva el proceso existente.
- Imágenes guardadas en un depósito privado; la visualización requiere acceso a la conversación. Las claves y las URLs privadas no se imprimen en los registros del transporte.
- No se alteran las credenciales, permisos ni la ruta de envío de WhatsApp.

## Configuración aplicada

- META_CHANNEL_ACCOUNT_ID: 4d761b3c-4c6c-4986-bcd8-d95f1754fe35.
- MESSENGER_PAGE_ID: 436809086180308, verificado en la pantalla de configuración de Messenger: Instituto.insticrece.
- Se conservaron todas las variables anteriores byte por byte y se comprobaron después de agregar estas dos.
- Migración social_private_media aplicada: depósito social-media privado, máximo 10 MB, sin políticas públicas.

## Comprobaciones locales

- 1115 pruebas aprobadas en 118 archivos.
- Incluyen firma inválida, rechazo de otro activo, comprobación de cuenta, envío confirmado, fallo real de Meta, OCR sin aprobación automática, prioridades del embudo, captura del primer teléfono y entrega validada de PDF.
- Un envío con una imagen y un texto son dos mensajes: si falla el segundo, se conserva la evidencia del primero y se informa el error. No se promete atomicidad de la entrega de bloques.
- La deduplicación actual de webhooks comprueba mensajes guardados; no hay todavía una cola duradera con reservas de procesamiento para reintentos simultáneos.

## Bloqueos externos y pendientes de prueba real

- Instagram recibió mensajes de la cuenta de prueba, pero rechazó el envío con el código 3: la app no tiene capacidad para esa llamada. No confundir con el error anterior de token 190.
- Los permisos instagram_basic e instagram_manage_messages están agregados al borrador 1063999973309825. La solicitud NO está enviada: falta completar los requisitos de Meta, incluido el video real, instrucciones y declaraciones de tratamiento de datos.
- TikTok VORTEX2.0 7678902717397336084 aparece Approved, pero eso no demuestra acceso a Business Messaging. El formulario de seguridad/privacidad se envió con info.instituto@insticrece.com y se vio la confirmación Enviada. No duplicar la solicitud.
- TikTok no tiene aún transporte implementado ni prueba de envío en este repositorio. Requiere la habilitación de mensajería y documentación/credenciales correspondientes.
- La suite local no demuestra entrega real en los clientes nativos. La publicación y las pruebas de cada plataforma se documentarán por separado.
