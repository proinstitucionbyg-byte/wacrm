# Guía operativa WACRM

Guía de los procesos comprobados y sus límites. No declara terminado el portal ni todos los pendientes. El manual comercial más detallado está en `ventas/MANUAL_BASE_COMERCIAL.md`.

## Qué archivo usar

| Necesidad | Dónde entrar | Qué permite |
|---|---|---|
| Atender una conversación | Inbox del CRM | Revisar el historial, responsable, etiquetas y pausas. |
| Validar un comprobante | Validación de pagos | Una persona revisa y decide; VENTA no sustituye esta decisión. |
| Completar datos del ingresante | Cuadro de matrícula en el chat o Registro de matrículas | Completar lo faltante y confirmar la evidencia correspondiente. |
| Ver registro académico original | [Matrículas y Control de Ingresos](https://docs.google.com/spreadsheets/d/16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w/edit?gid=1794725981#gid=1794725981) | Revisar curso, inicio, carpeta y bienvenida. |
| Gestionar ventas y ranking | [Base Comercial](https://docs.google.com/spreadsheets/d/1qtO6wN-jbbZppcM7qWjoJ2Bv9HVYCrX-jIEH5nGRZGs/edit) | Estados comerciales, responsables, metas y ranking; archivo general exclusivo del CEO. |
| Consultar información central de Fidelización | [Base de Fidelización](https://docs.google.com/spreadsheets/d/1b1ZlP9PWKu0I9VaJIE9bYDJsy5Ooy6OYtCupfBa-0eo/edit) | Consultar alumnos y registros conciliados. No asumir edición bilateral académica completa. |

## De pago a matrícula y documentos

1. Revisar el concepto: matrícula nueva, cuota u otro pago. El monto por sí solo no determina una matrícula.
2. Una persona valida el pago. La IA y las etiquetas comerciales no lo aprueban.
3. Completar los datos que faltan. Dirección y segundo celular son opcionales. No volver a escribir datos correctos ni crear otro expediente para resolver un faltante.
4. Revisar la foto correcta del documento o el respaldo escrito admitido por el sistema. El OCR es una sugerencia. Ante diferencias, confirmar los datos verdaderos; no marcar todas las fotos por costumbre.
5. Guardar y continuar. El proceso tiene etapas: datos guardados, en cola, procesando y registrado. La toma del servicio de Google no significa todavía que existan los tres PDF.
6. Comprobar fila de Matrículas, carpeta y boleta, cronograma y ficha. La matrícula debe registrarse aunque la entrega vaya a hacerse por otro medio.
7. Comprobar entrega por separado. Aceptado/enviado no equivale a entregado/leído.

Si aparece un conflicto de edición, conservar lo escrito y revisar la ficha actual antes de guardar otra vez. No borrar la matrícula para resolverlo.

## Cuando WhatsApp no permite enviar

Con pausa, ventana vencida o costo bloqueado, el registro y los documentos pueden completarse sin reactivar mensajes. Usar **Descargar documentos**, abrir la carpeta y entregar los archivos por el medio elegido por el propietario. No modificar permisos de Drive automáticamente.

Si un documento figura por revisar, comprobar el intento anterior: pudo haber sido aceptado por Meta aunque faltara la confirmación. No pulsar varias veces ni borrar una reserva para reenviar. Protocolo detallado: `ventas/ENTREGA_MANUAL_DOCUMENTOS.md`.

## Bienvenida y responsables

En MATRÍCULAS, la columna W registra NO REALIZADO/REALIZADO para la gestión de bienvenida. Marcar REALIZADO después de gestionarla; esto no sustituye una matrícula completa ni valida identidad o pago.

La asesora de ingreso y la responsable histórica de la venta cumplen funciones distintas. No reasignar una venta histórica cambiando una celda de bienvenida. Los problemas de edición que se revierte se investigan en el puente; no se resuelven borrando etiquetas al azar.

## Ventas y ranking

La base general y los ratios completos pertenecen al CEO. Cada asesora debe usar su archivo independiente; no compartirle la matriz completa para que vea solo sus clientes. El ranking compartido debe limitarse a nombres, ventas y metas.

Cambiar el estado comercial en la base o el CRM se refleja según la sincronización, que es cada diez minutos. Consultar la última terminación en PANEL: recargar el navegador no ejecuta por sí solo otra sincronización.

Una venta que pasa a Fidelización conserva su historial. Quitar etiquetas operativas para el traspaso no debe borrar el cierre ni sus documentos. Corregir expresamente una VENTA desde la base sí modifica el cómputo comercial, conservando el pago y la matrícula reales.

S/3 es una tarifa de ejemplo PRUEBA. Configurar las tarifas definitivas en COMISIONES y las metas en METAS. SIN META significa que no hay objetivo configurado; no equivale a cero rendimiento.

## Automatizaciones y pausas

Una espera programada para otra franja horaria no es un atasco. El sistema debe conservar curso, paso, ventana y motivos de bloqueo. Un botón de material debe responder y volver al cursor del curso, sin reiniciar todo el saludo.

La desactivación manual debe respetarse. No reactivar para generar PDF, conseguir un enlace o probar el flujo. Una solicitud de persona y un pago detienen el seguimiento comercial según sus reglas.

GRATIS/DE PAGO/POR CONFIRMAR describe la información económica disponible. Estar dentro de las 24 horas no basta para atribuir gratuidad; una estimación no es un cargo confirmado.

## Bot multicanal y funciones pendientes

Las pruebas puntuales con teléfonos SMS no significan que una campaña central esté habilitada. El lector y transporte SMSGate existen separados; la cola/panel general continúa protegido en simulación hasta terminar su integración. No habilitar números, campañas o respuestas reales solo porque se pueda consultar el teléfono.

Portal académico completo, correo, soporte de WhatsApp normal, Meet/Classroom y certificados siguen sujetos a sus pendientes e integraciones. Las llamadas automáticas se harán al final. No presentar estas funciones como listas por figurar en una plantilla.

## Ante un problema

Conservar conversación o ID de expediente, acción realizada, hora y mensaje exacto. Consultar primero si quedó guardado, registrado o enviado. Evitar un segundo expediente o un segundo envío para comprobar el primero.

Orden de resolución y pendientes: `CONTINUIDAD_PRIORIDADES_2026-10-27.md`. Los 104 requisitos originales permanecen en `LISTA_MAESTRA_RECONCILIADA_2026-10-24.md`.
