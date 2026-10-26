# Altas de consulta y entregas confirmadas: maestro y Fidelización

El complemento vive en el mismo proyecto de Google Apps Script que registra las matrículas. Cada diez minutos consulta el puente que ya existe. No necesita mantener la laptop encendida.

Cuando una matrícula está registrada, su pago ya fue validado por una persona y existen la boleta, el cronograma y la ficha, añade el expediente que falta a los dos archivos: maestro privado de gerencia y formato de Fidelización. La misma persona mantiene su identificador; otra matrícula del mismo alumno tiene su propio identificador.

En ALUMNOS verás su perfil; en MATRICULAS, el curso y la carpeta; en PAGOS, la validación que ya existía; en DOCUMENTOS, los tres enlaces. Generado significa que existe el archivo, no que se envió o recibió. Los dieciséis pagos históricos pendientes siguen pendientes.

El complemento agrega filas nuevas. También puede actualizar en DOCUMENTOS el estado, canal, fecha y observación de una entrega cuando Meta confirma delivered/read en el chat de esa matrícula. Un registro de envío aceptado, por sí solo, no confirma entrega. Conserva nombres corregidos, bienvenida, responsables y notas humanas. Si cambia el archivo o detecta una entrega manual o una nota distinta, conserva esa fila y cuenta un conflicto para revisión. La edición bilateral de los demás campos de los formatos nuevos no está conectada todavía. La base comercial anterior conserva su circuito independiente.

Si faltan registro o documentos, el expediente sigue visible en la hoja original de Matrículas y espera allí; no se inventan importes ni enlaces. Si hay un documento repetido con otro identificador, una relación incoherente o una página incompleta del CRM, la copia se detiene para conciliarlo. No vuelve a aprobar pagos ni reinicia automatizaciones.

Para revisar la conexión en Apps Script, elige `VERIFICAR_PUENTE_CENTRAL_CONSULTA`: solo lee y muestra cantidades de altas, delivery_updates y delivery_conflicts. `SINCRONIZAR_CENTRAL_CONSULTA` agrega lo que falta y actualiza únicamente las entregas confirmadas que conservan su texto automático original. Revisa la fila si aparece un conflicto; no borres las notas para forzarla. No ejecutes funciones de numeración o generación de boletas para comprobar este conector.

Comprobación del 26/10/2026: catorce expedientes CRM completos frente a treinta alumnos en el lote central (incluye históricos), cero duplicados añadidos. Preflight e instalación completados a las 09:21 Lima y primera sincronización a las 09:25, en once segundos. Veinticinco pruebas locales de conciliación y consumidor aprobadas. Falta observar la primera alta nueva natural después de esta instalación; no se creó una matrícula ficticia en producción para demostrarla.

Fuentes del complemento: `scripts/centralization/enrollment-plan.mjs`, `central-consumer-adapter.gs` y `build-consumer.mjs`. El archivo para Apps Script se genera con `node scripts/centralization/build-consumer.mjs`; no incluye claves ni capturas privadas.

Actualización de código del 26/10: 33 pruebas de lectura/puente, 21 de consumidor/conciliación, ESLint y build aprobados. El código no supone instalada su actualización: comprobar la versión publicada del CRM y el registro de ejecución de Google antes de afirmar que el activador ya actualiza las entregas.
