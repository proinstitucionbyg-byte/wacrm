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
- Commit 8068f64 publicado: EasyPanel Success 2026-10-11 10:38:20 UTC. Prueba IG-LUIS-1011D: entrega real de la imagen y el texto original de Nutrición en Instagram. El bloqueo de autorización desapareció con la ruta correcta y sin cambiar la clave. El audio del bloque falló con código 100; no considerar todavía el bloque completo aprobado.
- Se prepara conversión del audio original Ogg/Opus a M4A/AAC para Instagram exclusivamente. El archivo original y WhatsApp se conservan; Meta recibe un enlace privado temporal. Se añade ffmpeg al contenedor, descarga limitada y protección contra listas de reproducción, con limpieza de archivos temporales. 1123 pruebas aprobadas; entrega real del audio pendiente de la siguiente publicación.

## Resultado real posterior: Instagram desbloqueado en pruebas

- Commit c782f76 publicado: EasyPanel Success 2026-10-11 11:56:43 UTC. Ninguna clave rotada. La ruta y la conversión de audio fueron las correcciones aplicadas.
- Prueba IG-LUIS-1011E desde luistbrayan a instituto.insticrece: llegaron la imagen original, el texto original y el audio de 1:46. Confirmación de envío y registro de audio; reproducción disponible en el cliente nativo. Ejecución e4bf1406-8013-4ce0-87e1-6219574432b2 inicialmente success; luego partial al continuar el usuario con el siguiente bloque (sin error de envío).
- Continuación real solicitando activar la promoción y medios Yape/Plin: se entregó el bloque original de medios de pago. Ejecución 892961a9-9591-4b04-82a2-e0e99d094aa7 success, sin error.
- Evidencias locales: output/INSTAGRAM-BLOQUE-COMPLETO-2026-10-11.jpg y output/INSTAGRAM-MEDIOS-PAGO-2026-10-11.jpg. Ambas quedaron adjuntadas al borrador de revisión de Meta (3 archivos en total, incluyendo la grabación antigua).
- Se corrigieron las instrucciones de revisión: URL anterior mal escrita e instrucciones sin pasos de prueba. Guardado automático confirmado. No se envió la revisión pública: aún hace falta acceso dedicado del revisor y completar los requisitos del permiso, incluido el video vigente. No afirmar habilitación para todos los usuarios a partir de una prueba con el administrador.

## TikTok: bloqueo de habilitación escalado

- Privacidad: formulario original sigue mostrando Enviada; no duplicado.
- Consulta oficial #4487581 enviada el 2026-10-11 07:00:54 Lima, categoría Allowlisting / Rate Limit / Scope Change. Estado Processing; soporte confirmó recepción y que responderá. Se pidió el estado de la solicitud, requisitos pendientes y enlace del formulario adicional de Accounts API si corresponde.
- No se solicitó ni introdujo otra clave. No se simuló éxito de una conexión inexistente. Todavía faltan habilitación Business Messaging, autorización de cuenta y transporte TikTok en el CRM; no basta esperar aprobación para que el código aparezca automáticamente.
- Evidencia: output/TIKTOK-TICKET-4487581-2026-10-11.jpg.

## Nuevos requisitos registrados, pendientes de implementación

- El CEO puede borrar conversaciones completas y delegar el permiso. Para mensajes recibidos, ocultar localmente; para enviados, verificar primero las capacidades y límites reales de la API de Meta para retirar para todos, sin asumir que coincide con la aplicación de WhatsApp.
- Estadística de primera frase textual entrante y primera frase textual saliente por conversación, ignorando imágenes iniciales. Informe semanal los sábados temprano, acumulado mensual y alertas solo para CEO.
- Abrir el detalle completo de las alertas al pulsarlas para que el texto sea legible.
- Estos requisitos no se consideran implementados; la prioridad actual sigue siendo Instagram y TikTok.

## Implementación posterior: gestión del Inbox, informes y alertas

- Eliminación recuperable del historial del Inbox, lista de recuperación y ocultación de mensajes solo para el usuario. No borra archivos, matrículas, vouchers ni mensajes del teléfono del estudiante. No se implementa retirada para todos sin un endpoint oficial comprobado.
- Nuevos permisos `inbox_management.conversations` y `inbox_management.messages`: exclusivos del CEO por defecto, delegables explícitamente por él. Administradores y asesoras no los heredan; las rutas antiguas de permisos también están protegidas. No se cambia ningún otro permiso existente.
- Informes de primera frase y primera palabra, recibida y enviada por conversación; imágenes y audios iniciales se ignoran. Tabla y CSV exclusivos del CEO, acumulación mensual hasta el corte. Generación/aviso semanal sábado 07:00 Lima mediante el programador existente del contenedor, independiente de la laptop.
- Alertas abren un diálogo amplio y desplazable, conservando sus listas de comprobación y acceso a hoja/conversación.
- Migraciones aditivas aplicadas. Pruebas transaccionales revertidas: agente no puede cambiar directamente el corte; CEO elimina/lista/recupera; RLS permite al CEO ocultar/restaurar sus mensajes y leer informes, e impide a agentes ver informes. Sin eliminación permanente de datos de clientes.
- 1.143 pruebas aprobadas en 122 archivos; build de producción aprobado. La compilación detectó una referencia fuera de contexto en el manejador realtime, corregida antes de publicar.
- Video real actualizado: `output/INSTAGRAM-CRM-Y-ENTREGA-2026-10-11.mp4`, secuencia del CRM y cliente Instagram con reproducción real, con cortes entre tomas y sin sonido grabado. Se recorta la lista de otros contactos personales. No sustituye el requisito de credenciales del revisor ni demuestra acceso público aprobado.
