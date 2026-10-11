# Origen de anuncios y seguimiento de pagos

Se añade una referencia opcional a los mensajes recibidos de Meta. Solo se guardan campos presentes en el webhook firmado: identificador de anuncio/post, tipo, referencia, título, texto y enlace HTTPS. La recepción y las automatizaciones existentes continúan igual cuando no hay referencia.

En Estadísticas, el CEO puede consultar un periodo y descargar un CSV con el canal, ID y título recibidos, conversaciones, pagos validados y matrículas registradas. Se atribuye cada conversación a su primera referencia guardada. Pagos y matrículas posteriores se cuentan hasta el fin del periodo según su estado actual; no se contabiliza un voucher pendiente como pago validado. No se reconstruyen anuncios históricos ni se denomina «orgánico» a un contacto sin evidencia de origen.

El título del anuncio no es el nombre de la campaña. Obtener nombres, conjuntos, presupuestos o inversión de Marketing API requiere su acceso correspondiente; esta implementación no solicita permisos nuevos ni modifica tokens. No se presentan esos datos como disponibles.

## Comprobaciones

- 1.202 pruebas en 129 archivos aprobadas y compilación correcta.
- Prueba transaccional de base de datos: primera referencia, pago validado y matrícula registrada, sin atribución duplicada al segundo anuncio.
- Reporte exclusivo del CEO; agente denegado y modificación de evidencia por cliente autenticado denegada.
- Pruebas ficticias revertidas; no se enviaron anuncios ni mensajes a estudiantes.

## Fuentes de contrato

- Meta, WhatsApp Messages Object: https://www.postman.com/meta/whatsapp-business-platform/folder/1dtuocp/messages-object
- Meta, detalles de anuncio en Marketing API: https://www.postman.com/meta/facebook-marketing-api/request/8byc7qo/getdetailsfromadid

Eliminar medios mediante la API no equivale a retirar un mensaje del teléfono del destinatario. No se añade un botón de «eliminar para todos» sin un endpoint oficial comprobado para el canal.
