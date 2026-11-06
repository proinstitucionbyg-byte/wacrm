# Reparación del puente de matrículas

Verificado en Apps Script AUTOMATIZACION MATRICULAS, proyecto `1gipxZogfs1iSMVXJb3TcnNs-erk1qnEFrtKkLHHLbc4qVM6gvBC6Zt5N`.

El activador SINCRONIZAR_CRM_MATRICULAS fallaba cada cinco minutos publicando el calendario (`Revisa los cinco cursos y las dos fechas de cada cuadro`), antes de recoger matrículas listas. El cuadro de Administrativo muestra inicio actual 05/11/2026, jueves, mientras el generador aplica miércoles/viernes. No se cambiaron fechas oficiales.

Cambio mínimo guardado en el archivo real PUENTE_CRM_MATRICULAS.gs: la publicación del calendario registra una advertencia y permite continuar las tareas independientes. C_REGISTRAR_ conserva la validación individual de curso, fecha oficial, identidad, oferta, operación única y pago. No se fabrican registros ni PDFs.

16 pruebas de crm-bridge.test.ts pasaron; git diff --check sin errores. Ejecutado desde Apps Script a las 19:54 Lima. Paul (draft 3963f45f-b784-4048-9ca8-a73ab7cead75) quedó registered/version8, matrícula 21, sin error. El generador original GENERAR_DOCUMENTOS_PENDIENTES terminó a las 20:00:33; DOCUMENTOS GENERADOS fila19 confirma BOLETA B002-1032029, cronograma y ficha GENERADO. La entrega aún no está comprobada. No repetir envío ni alterar el estado manualmente.

Advertencia adicional de otra entrega pendiente: draft d2d3f72d-f3f4-4675-95cb-b74b17b056c8 recibió HTTP409 al intentar BOLETA. No se forzó ni se modificó ese caso.

Paul: entrega automática rechazada con HTTP409 porque el chat mantiene automation_enabled=false. Se conservó esa pausa. La boleta se adjuntó y envió manualmente desde el CRM al chat verificado 51986813393, con autorización expresa del propietario. Mensaje c27fd5f7-8906-4b7f-b84b-8404a4ad6a56, 06/11 02:21:16 UTC: estado read confirmado por SQL. SHA256 del PDF 02004338b93db0887ccd9dada9fe766390d8a8d37b4de65e4330ebc293e052f2. Se concilió BOLETA en enrollment_document_deliveries con el identificador real y la URL del adjunto manual para impedir repetición automática. Cronograma/ficha generados, no enviados en este paso.

Pendiente: corregir por separado la incompatibilidad del calendario sin inventar fechas; verificar la sincronización comercial publicada en 01a8b15; completar los demás requisitos del adjunto. Contabo sigue sin autorización de ejecución.
