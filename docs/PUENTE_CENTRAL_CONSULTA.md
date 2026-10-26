# Altas automáticas de consulta: maestro y Fidelización

El complemento vive en el mismo proyecto de Google Apps Script que registra las matrículas. Cada diez minutos consulta el puente que ya existe. No necesita mantener la laptop encendida.

Cuando una matrícula está registrada, su pago ya fue validado por una persona y existen la boleta, el cronograma y la ficha, añade el expediente que falta a los dos archivos: maestro privado de gerencia y formato de Fidelización. La misma persona mantiene su identificador; otra matrícula del mismo alumno tiene su propio identificador.

En ALUMNOS verás su perfil; en MATRICULAS, el curso y la carpeta; en PAGOS, la validación que ya existía; en DOCUMENTOS, los tres enlaces. Generado significa que existe el archivo, no que se envió o recibió. Los dieciséis pagos históricos pendientes siguen pendientes.

Este primer complemento agrega filas nuevas. Conserva todas las filas existentes: nombres corregidos, estados, bienvenida, notas y confirmaciones de entrega. La edición bilateral de los formatos nuevos no está conectada todavía. La base comercial anterior conserva su circuito independiente.

Si faltan registro o documentos, el expediente sigue visible en la hoja original de Matrículas y espera allí; no se inventan importes ni enlaces. Si hay un documento repetido con otro identificador, una relación incoherente o una página incompleta del CRM, la copia se detiene para conciliarlo. No vuelve a aprobar pagos ni reinicia automatizaciones.

Para revisar la conexión en Apps Script, elige `VERIFICAR_PUENTE_CENTRAL_CONSULTA`: solo lee y muestra cantidades. `SINCRONIZAR_CENTRAL_CONSULTA` hace la misma comprobación y agrega exclusivamente lo que falta. No ejecutes funciones de numeración o generación de boletas para comprobar este conector.

Comprobación del 26/10/2026: catorce expedientes CRM completos frente a treinta alumnos en el lote central (incluye históricos), cero duplicados añadidos. Preflight e instalación completados a las 09:21 Lima y primera sincronización a las 09:25, en once segundos. Veinticinco pruebas locales de conciliación y consumidor aprobadas. Falta observar la primera alta nueva natural después de esta instalación; no se creó una matrícula ficticia en producción para demostrarla.

Fuentes del complemento: `scripts/centralization/enrollment-plan.mjs`, `central-consumer-adapter.gs` y `build-consumer.mjs`. El archivo para Apps Script se genera con `node scripts/centralization/build-consumer.mjs`; no incluye claves ni capturas privadas.
