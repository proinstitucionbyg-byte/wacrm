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

- 1116 pruebas aprobadas en 118 archivos (incluido el callback compartido de Meta).
- Incluyen firma inválida, rechazo de otro activo, comprobación de cuenta, envío confirmado, fallo real de Meta, OCR sin aprobación automática, prioridades del embudo, captura del primer teléfono y entrega validada de PDF.
- Un envío con una imagen y un texto son dos mensajes: si falla el segundo, se conserva la evidencia del primero y se informa el error. No se promete atomicidad de la entrega de bloques.
- La deduplicación actual de webhooks comprueba mensajes guardados; no hay todavía una cola duradera con reservas de procesamiento para reintentos simultáneos.

## Bloqueos externos y pendientes de prueba real

- Instagram recibió mensajes de la cuenta de prueba, pero rechazó el envío con el código 3: la app no tiene capacidad para esa llamada. No confundir con el error anterior de token 190.
- Los permisos instagram_basic e instagram_manage_messages están agregados al borrador 1063999973309825. La solicitud NO está enviada: falta completar los requisitos de Meta, incluido el video real, instrucciones y declaraciones de tratamiento de datos.
- TikTok VORTEX2.0 7678902717397336084 aparece Approved, pero eso no demuestra acceso a Business Messaging. El formulario de seguridad/privacidad se envió con info.instituto@insticrece.com y se vio la confirmación Enviada. No duplicar la solicitud.
- TikTok no tiene aún transporte implementado ni prueba de envío en este repositorio. Requiere la habilitación de mensajería y documentación/credenciales correspondientes.
- La suite local no demuestra entrega real en los clientes nativos. La publicación y las pruebas de cada plataforma se documentarán por separado.

## Primera publicación y prueba real

- Commit 63f6cdd, publicado correctamente por EasyPanel: Success, 11 octubre 2026 05:16:56 UTC.
- Mensaje PRUEBA MESS-1011 enviado desde el perfil personal a Instituto.insticrece. El CRM recibió el mensaje y lanzó el bloque existente de Nutrición.
- El bloque falló al intentar enviar su imagen: Meta rechazó la autorización de Messenger (código 190). Se pidió al propietario renovar únicamente MESSENGER_PAGE_ACCESS_TOKEN; no declarar este canal operativo hasta confirmar la respuesta en Messenger.
- En la pantalla de Meta se verificó que Instagram entrega sus eventos a /api/messenger/webhook. Se añadió recepción del objeto Instagram en ese callback compartido, conservando firma y validación del activo; no cambiar la configuración existente de webhooks.
- Las descripciones de uso de instagram_basic e instagram_manage_messages quedaron guardadas en el borrador. Sin video ni certificaciones marcadas; no enviado.

## Corrección de envío Instagram y siguientes comprobaciones

- La documentación oficial de Instagram Messaging con Facebook Login indica POST /PAGE-ID/messages con token de página. El código estaba enviando al identificador de Instagram. Se corrige únicamente el destino del envío usando MESSENGER_PAGE_ID; se conserva INSTAGRAM_ACCESS_TOKEN y el identificador de Instagram para validar eventos entrantes. Fuente: https://developers.facebook.com/documentation/business-messaging/instagram-messaging/features/send-message
- 1118 pruebas aprobadas en 118 archivos y build de producción correcto. Pendiente confirmar la entrega real después de publicar esta corrección; el diagnóstico anterior de permisos no basta para descartar este error de ruta.
- Messenger ya confirmó una respuesta real con imagen, texto y audio del bloque original de Nutrición después de renovar su clave.

## Nuevos requisitos registrados, pendientes de implementación

- El CEO puede borrar conversaciones completas y delegar el permiso. Para mensajes recibidos, ocultar localmente; para enviados, verificar primero las capacidades y límites reales de la API de Meta para retirar para todos, sin asumir que coincide con la aplicación de WhatsApp.
- Estadística de primera frase textual entrante y primera frase textual saliente por conversación, ignorando imágenes iniciales. Informe semanal los sábados temprano, acumulado mensual y alertas solo para CEO.
- Abrir el detalle completo de las alertas al pulsarlas para que el texto sea legible.
- Estos requisitos no se consideran implementados; la prioridad actual sigue siendo Instagram y TikTok.
