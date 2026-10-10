# PRUEBA DEL RECORRIDO DE NUTRICION — 10-10-2026

Este informe sustituye los estados historicos de pruebas pendientes del recorrido documental. No declara terminadas todas las funciones futuras del CRM.

## Comprobado en los servicios reales

- WhatsApp personal -> EDU450: consulta de Nutricion, promocion activa, medios de pago, voucher y ambas caras del documento recibidos.
- Lectura de imagen: voucher con monto, fecha y operacion; identidad y direccion del documento. Se corrigio la confusion entre el codigo impreso del reverso y el numero de identidad.
- Comprobante enviado a revision y aprobado como SIMULACION TECNICA autorizada. No acredita un nuevo pago real.
- Continuacion despues del pago: texto y audio de la automatizacion interna enviados.
- Registro en Google: una fila de prueba, numero 2, fecha y hora de Lima; atribucion INSTITUCION. Sin duplicar la fila durante la recuperacion del error.
- Se corrigieron validaciones antiguas de las celdas de asesora y curso que rechazaban valores verificados del CRM. Se conservan las opciones anteriores del desplegable.
- Carpeta del estudiante -> curso -> PRIMER PAGO: exactamente seis archivos, voucher, dos fotos de documento y tres PDF. Ninguna hoja de calculo temporal en esa carpeta.
- Boleta generada con la serie existente B002 - 1031955, monto real S/20, IGV incluido y desglose 16.95 + 3.05.
- Los tres documentos se enviaron al mismo WhatsApp a las 01:19 Lima. Las tres entregas constan como enviadas, sin error.
- Los tres PDF descargados tienen una pagina A4 (595 x 842 puntos). Se inspeccionaron sus imagenes. Cronograma con seis cuotas, horario 8:00 PM A 10:00 PM, inicio oficial 06/10/2026 y febrero ajustado al 28/02/2027.
- Despues de los tres PDF se ejecuto la automatizacion interna del dia 30.
- Bienvenida de respaldo: imagen y audio recibidos a las 01:22 Lima. El proceso automatico marco el envio pendiente como DONE y registro backup_sent_at sin error. Un mensaje adicional del estudiante no cancelo el envio.

## Condiciones de la simulacion

- La conversacion ya contenia pruebas anteriores con datos incompatibles. El sistema detuvo el registro para revision; se aislo una ficha antigua y se completo la ficha nueva con los datos comprobados. No se presento esta intervencion como recopilacion completamente automatica.
- Correo y segundo telefono usados como datos de prueba; no se inventaron datos reales del estudiante.
- La bienvenida conserva una espera general de dos horas. Para no esperar ese tiempo, se adelanto exclusivamente run_at de la ejecucion de prueba. No se modifico la duracion de la automatizacion.
- Se genero un numero real de la serie para la prueba. No se retrocedio el contador ni se eliminaron evidencias.
- Las verificaciones de transferencia se hicieron contra las funciones reales de la base, con rollback: aceptar con historial completo y aceptar con historial restringido. No equivalen a una sesion visual de dos asesoras distintas.
- El check de bienvenida se probo en la base con rollback, incluyendo repeticion idempotente. La ejecucion real de respaldo se dejo sin marcar para probar el envio.

## Verificacion local y publicacion

- 977 pruebas automaticas en 105 archivos aprobadas tras la correccion del puente Google.
- Compilacion de produccion y TypeScript aprobados; 74 paginas. Las ultimas modificaciones adicionales afectan al script Google y sus pruebas, no al codigo de la aplicacion compilada.
- e76b1e3 publicado: secuencias protegidas y transferencias aceptadas.
- b48e3a0 publicado: correccion del documento de identidad. EasyPanel confirmo Success a las 01:12:07 Lima.
- Puente Google corregido, guardado y leido de vuelta; ejecucion real de registro y envio posterior correcta.
- No se cambiaron permisos de otros archivos ni configuraciones de cuentas del equipo.

## Pendientes que esta prueba no acredita

- El CEO debe configurar sus cuentas, areas, cargos, porcentajes y apodos definitivos. No se asignaron cuentas ni porcentajes inventados; MAINET y ANTONELLA requieren corresponder a miembros reales.
- Falta una prueba visual con dos cuentas de asesoras para reparto, visibilidad por permisos y aceptacion de traspaso. Las comprobaciones de servidor y pruebas automaticas no sustituyen esa sesion.
- No se acredito con mensajes reales la cancelacion urgente de un docente y su recalculo automatico. No declararlo terminado por tener calendario y avisos implementados.
- Calendar/Meet, enlaces de clase de otra cuenta y analisis docente permanecen aplazados por el usuario.
- Plataforma, cobranza completa, cursos gratuitos/certificados y reportes estructurados de quejas siguen siendo fases posteriores.
- En el cronograma, el texto inferior de la firma requiere revisar la altura de su celda en la plantilla; no se cambio el diseno previamente aprobado. Las seis cuotas y datos academicos aparecen completos.

## Evidencias locales

- output/prueba-whatsapp-tres-pdf-2026-10-10.png
- output/prueba-whatsapp-bienvenida-2026-10-10.png
- output/BOLETA-PRUEBA.pdf y .png
- output/CRONOGRAMA-PRUEBA.pdf y .png
- output/FICHA-PRUEBA.pdf y .png

Las evidencias con datos personales se conservan localmente y no se incluyen en Git.
