# REVISION DE CANALES — 10 OCTUBRE 2026

## LIMITES DEL CAMBIO

Conservar la conexion, permisos y envio actuales de WhatsApp. No retirar ni volver a solicitar permisos aprobados para conectar otro canal. No modificar accesos de Drive ajenos al trabajo solicitado.

## TIKTOK

- Portal observado: VORTEX 2.0, app 7678902717397336084, estado Approved.
- Los permisos inspeccionados no muestran endpoints de mensajes privados. Approved no demuestra acceso a Business Messaging.
- La guia oficial exige una app aprobada y una revision adicional de seguridad y privacidad para gestionar mensajes privados.
- Formulario oficial encontrado desde la guia: https://bytedance.sg.larkoffice.com/share/base/form/shrlg7vFArGhg9V20neYCEwIKrb
- Campos obligatorios: empresa desarrolladora, razon social, sede, web, contacto y correo, tipo de solicitud, app ID y regiones.
- Datos confirmados por el usuario: INSTITUTO DE FORMACION Y CRECIMIENTO PROFESIONAL INSTICRECE S.A.C.S; sede LIMA, PERU; contacto LUIS BRAYAN PALACIOS CARHUAPOMA; correo pro.institucionbyg@gmail.com. No se presento solicitud todavia.
- El formulario inicial observado no pide video. La guia indica que la revision se inicia dentro de 10 dias laborables y se recibe un cuestionario por correo. No prometer fecha de aprobacion.
- El formulario termino de cargar en el dominio original. Se completaron empresa, razon social, sede, web, contacto, app ID, primera solicitud y LATAM. No se envio: el texto completo exige correo individual con dominio de empresa; pendiente de respuesta porque el usuario proporciono Gmail. No inventar una direccion @insticrece.com.
- Busqueda limitada en Gmail conectado no encontro una comunicacion de revision de Business Messaging; esto no descarta una solicitud asociada a otro correo.
- Fuente: https://business-api.tiktok.com/gateway/docs/index?doc_id=1832184145137922

## META / INSTAGRAM

- Revision anterior 1003006269409196: instagram_basic e instagram_manage_messages no aprobados.
- Motivo observado: el video no demuestra el envio desde la interfaz de la app y la recepcion del mismo mensaje en el cliente nativo.
- Revisor pide seleccionar el activo visible, enviar en vivo desde el CRM y mostrar la entrega en Instagram. Mostrar autenticacion completa o explicar si se usa servidor a servidor / usuario del sistema.
- Preparar una grabacion real cuando la conexion de prueba funcione; no fabricar evidencia de una integracion inexistente.
- No se volvio a enviar la solicitud y no se alteraron permisos de WhatsApp.
- Detalle: https://developers.facebook.com/apps/981740201535803/app-review/submissions/feedback/?submission_id=1003006269409196

## ESTADO DEL CODIGO LOCAL

Cambios de creacion de asesoras, restablecimiento de claves y perfiles recomendados preparados localmente, aun sin publicar. Se agregaron pruebas especificas de creacion y perfiles: autenticacion, validaciones, proteccion de administradores, no adopcion de correos existentes, asignacion mediante funcion con controles en base de datos y fallos de activacion. Ultima suite: 1066 pruebas aprobadas en 113 archivos. Build de produccion y TypeScript aprobados, 75 paginas. Conservar la modificacion preexistente en src/lib/supabase/client.ts.
