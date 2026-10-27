# Prioridades y comprobaciones — 27/10/2026

## Inventario conservado

La lista completa sigue en `LISTA_MAESTRA_RECONCILIADA_2026-10-24.md`: **104 requisitos**, distribuidos en A pagos/matrícula (14), B documentos (5), C automatizaciones (12), D costos (10), E Inbox (14), F asesoras/áreas (8), G prioridad 6 (11), H académica (11), I integraciones/cierre (9). Se mantienen las ampliaciones del historial: centralización, certificados, bot multicanal y llamadas automáticas al final. No se borran requisitos porque un flujo comercial se haya publicado.

Los estados V24/REVISAR son históricos, no una declaración de funcionamiento actual. La continuidad del 26/10 prevalece sobre los cortes de doce/veintiocho alumnos del 25/10. La publicación comercial del 27/10 está documentada aparte.

## Orden de ejecución sin intervención innecesaria

1. **A01–A14/B01–B05: urgencias pagadas.** Comprobar identidad humana, datos completos, registro en la hoja, carpeta, tres documentos y entrega. No convertir cuotas en matrículas; no confundir generado con enviado. Con pausa, costo o ventana bloqueada, dejar enlaces manuales. Caso nuevo resuelto: Malú, pago previamente validado; el propietario confirmó nombre, DNI, nacimiento y foto por este chat. La validación local no encontró pendientes. El puente existente registró el número 17, comprobado en MATRÍCULAS fila 16; carpeta y tres PDF comprobados en Drive por metadatos y contenido. Meta confirmó tres documentos delivered. No se envió una segunda copia manual.
2. **C/D/I01: observar el recorrido comercial publicado.** Curso, orden, botones y retorno, esperas, cierre, ventanas y duplicados. El reinicio excepcional no vuelve a ejecutarse. No mandar mensajes ni forzar crons para probar.
3. **G/F: cerrar prioridad 6.** Reconciliar CRM/base comercial y responsables, historial de venta tras Fidelización, bases privadas, ranking/metas, comisiones y manual. La prueba BG8 requiere sesión ajena: mantenerla ficticia, no repartirle clientes. No inventar tarifas; S/3 sigue siendo PRUEBA.
4. **Centralización histórica/academia.** Reutilizar IDs y mapeos conciliados. Completar lotes y actualizaciones permitidas preservando notas y conflictos. El consumidor de altas y entregas existente no significa edición bilateral académica completa.
5. **Multicanal.** Integrar el transporte local SMS con la cola y las respuestas/derivaciones. El transporte SMSGate existe separado; el panel/worker general sigue limitado a simulación. No retirar esa protección para aparentar una integración terminada. Reutilizar los dispositivos preparados sin esperar otros teléfonos.
6. **H/I y ampliaciones posteriores.** Calendarios/Meet, accesos y docentes, portal, certificados y conectores. Primero verificar las reglas y sistemas existentes. El sistema de certificados del propietario debe conservar correlativos y formatos. Llamadas automáticas quedan al final por su instrucción.
7. **Manual global y verificación por rol.** Ampliar el manual comercial existente, sin compartir la matriz del CEO ni datos de otras asesoras.

Prioridades históricas 3/4 permanecen pausadas salvo urgencias concretas autorizadas. Las autorizaciones comerciales específicas no permiten rehacer todo el Inbox. No reactivar alarmas antiguas ni invalidar pausas, pagos o intervención humana.

## Corte observado del flujo nuevo

Captura de solo lectura del **27/10 a las 11:06:37 Lima**: quince recorridos de versión completa (incluye el lote excepcional y una entrada regular), catorce con continuidad programada y uno retenido por falta de tiempo seguro antes del vencimiento. Ninguno presentó pasos exitosos ajenos al curso, regresión de orden, envíos repetidos del mismo paso, espera atrasada más de cinco minutos o programación posterior a las 24 horas en esa captura.

Esto **no** demuestra que los cierres futuros se hayan entregado. En la revisión previa de las 10:xx, el lote excepcional todavía no tenía respuestas ni clics nuevos; no afirmar retorno real de botones observado donde solo existen simulaciones locales. La captura posterior deberá volver a contar las interacciones.

Verificador offline nuevo: `scripts/audits/commercial-progress.mjs`, con 16 pruebas. Lee una captura guardada; no consulta la red, no modifica datos ni envía. Distingue envío de entrega, espera futura de atasco y pausa de autorización para reiniciar. Evidencia con identificadores en el directorio privado ya ignorado por Git, no en este documento.

Otras comprobaciones de esta continuación: 114 pruebas de recorrido/calendario, 29 de centralización y 15 de lector/transporte SMS aprobadas. Son pruebas locales; no acreditan publicación del panel multicanal ni campañas reales. No se cambió el comportamiento comercial publicado durante esta revisión.

## Recordatorio vigente

Creado y confirmado ACTIVE: `verificar-flujos-y-continuar-prioridades-wacrm`, cada treinta minutos, en este mismo chat. Revisa flujos y continúa por dependencias, en silencio si no hay novedades. El antiguo recordatorio cada cinco horas estaba PAUSED y se conservó así.

## Intervenciones humanas pendientes

- Pagos e identidades que todavía no haya confirmado una persona.
- Prueba de acceso BG8 desde la cuenta de demostración del usuario.
- Tarifas y metas definitivas cuando el propietario las tenga.
- Nuevos permisos externos o del teléfono cuando sean indispensables; no repetir los ya concedidos.

Continuar mientras se esperan respuestas o ejecuciones de Google. Ninguna de estas dependencias detiene todos los demás pendientes.

## Ampliaciones de la recuperación excepcional, misma fecha

El propietario aclaró después que también deben recuperarse los recorridos antiguos y las derivaciones humanas automáticas, excluyendo pagos y aperturas sin keyword. No repetir el lote inicial ni contactos que ya tengan el marcador nuevo.

- `owner_no_flow_2026-10-27_once`: un prospecto de Nutrición, previamente excluido mientras esperaba entrega. Reinicio iniciado y dos primeros envíos aceptados por Meta, seguido de su espera inicial.
- `owner_legacy_recover_2026-10-27_once`: dos prospectos de Recursos Humanos; sus entregas pendientes antiguas estaban confirmadas delivered/read. Se sustituyeron únicamente sus pendientes antiguos por el recorrido nuevo. Ambos iniciaron sin errores.
- `owner_human_recover_2026-10-27_once`: el propietario autorizó expresamente reactivar los siete casos clasificados como humanos, siempre con keyword válido. Tres cumplieron: Administrativo uno y Nutrición dos. Se retiró la pausa para esos tres dentro de la operación autorizada y se cancelaron sus pendientes anteriores. Los tres iniciaron sin errores. Los otros cuatro no coincidieron con keywords activos; no se enviaron.
- Corte de la revisión completa: 27 chats con ventana abierta; 22 incorporados al recorrido nuevo después de estas operaciones, uno pagado excluido y cuatro sin keyword válido excluidos. No llamar a esto 22 ventas ni 22 recorridos terminados. No usar la coincidencia de palabras aproximada para inventar un keyword.

Corrección de prioridad 6 publicada separadamente en `2ac1790`: respaldo de teléfono/curso desde matrícula registrada si falta en el contacto, conservando datos actuales y conflictos. En Google Apps Script se corrigió únicamente la coincidencia singular/plural de Recursos Humanos, se guardó y se comprobó después de recargar. La hoja ya muestra Recursos Humanos en la fila del caso nuevo. No se cambiaron permisos: la base general mantiene únicamente al propietario. Evidencia visual: `output/sales-workbook-2026-10/recursos-humanos-correccion-2026-10-27.png`.

Dos nuevas correcciones solicitadas están comprobándose localmente antes de publicar: relectura de origen a los diez minutos para aperturas con keyword activo (sin origen confirmado queda POR CONFIRMAR, sin forzar envío pagado); texto largo de la introducción como un mensaje completo después de la imagen y antes del audio, sin una frase final suelta. No regenerar ni reenviar la introducción de Jun por la corrección visual.
