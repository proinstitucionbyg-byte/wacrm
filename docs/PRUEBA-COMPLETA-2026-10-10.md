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

## Segunda revision integral — madrugada del 10-10-2026

Esta revision encontro fallos posteriores a la primera prueba. Los resultados anteriores no deben interpretarse como una aprobacion total del producto.

| Punto | Evidencia y alcance |
| --- | --- |
| Etiquetas y filtros | En el inbox del CEO se comprobo el filtro PAGO VALIDADO y las etiquetas PAGO VALIDADO / AREA FIDELIZACION en la conversacion de prueba. |
| Derivacion y visibilidad | Prueba transaccional real con identidades autenticadas de ventas y fidelizacion: el destinatario ve el chat y sus etiquetas; el anterior deja de verlo; historial completo conserva mensajes y restringido limita los anteriores. ROLLBACK restauro todas las asignaciones. |
| Permiso de pagos | Se denego y concedio payments/view al agente mediante las funciones reales y se comprobo has_member_permission en ambos casos. ROLLBACK, sin cambiar los permisos definitivos. |
| Permisos de automatizaciones | Se detectaron rutas que solo exigian rol agente, sin consultar el permiso especifico. Lectura, creacion, edicion, eliminacion, duplicacion y ejecucion manual ahora consultan automations/view, create, edit o delete segun corresponda. Doce pruebas de acceso denegado verifican que se bloquea antes de acceder a los datos. |
| Reprogramacion | Se simulo un cambio del cuadro mediante sync_academic_calendar: se genero REVISAR CAMBIO EN CUADRO DE INICIOS con accion pendiente y la cuenta de fidelizacion pudo completar el check. ROLLBACK, sin cambiar fechas reales. |
| Proximo inicio | publish_operational_notices genero PREPARAR INGRESO A GRUPOS para un inicio dentro de dos dias. Una segunda ejecucion no duplico avisos. ROLLBACK. |
| Adjuntos del inbox | Menu real visible con Photo, Video, Document y Voice note. No equivale a probar cada formato y tamaño posible. |
| Cumpleanos | Campo Cumpleaños visible en Configuracion / Perfil, junto a Apodo; no se invento ninguna fecha. |
| Navegacion | ATRAS y ADELANTE conservaron la carpeta PROMO 19.90-79.90 en la interfaz. CARPETA ANTERIOR esta disponible. |
| Duplicar carpetas | Se encontro que se copiaban automatizaciones sin sus pasos y se mantenia su activacion. Corregido: copiar pasos y referencias padre/hijo, copias inactivas y limpieza de copias incompletas. Cubierto por pruebas automaticas de la ruta. |
| Historial largo | Se encontro que el inbox podia quedar limitado por la cantidad maxima de filas de la API. Carga paginada explicita con comprobacion de errores y cancelacion al cambiar de chat; prueba con 758 mensajes. |
| Reenvio | Pruebas automaticas existentes de texto, saltos de linea, imagen, audio, video, documento y bloqueo por falta de acceso aprobadas. El reenvio completo mediante dos sesiones visuales sigue sin acreditarse. |
| PRIMER PAGO | Se encontraron dos copias adicionales de voucher/DNI creadas por la rutina manual. Solo esas copias fueron a la papelera recuperable; originales y PDF conservados. Se corrigio Codigo.gs para reutilizar originales ya presentes. Lectura de vuelta tras recargar confirmo el guardado. ACTUALIZAR_MATRICULAS_V2 finalizo 02:12:17 Lima; Drive siguio mostrando seis archivos, tres imagenes y tres PDF, sin hojas temporales. |
| Audio promocional | WhatsApp recibio imagen y audio reales de NUTRICION 19.90 a las 02:05. El mensaje guardado contiene la transcripcion de la mensualidad 79.90 y primer mes 19.90. Se encontro y corrigio el filtro JSON que impedia reutilizar la transcripcion. |
| Respuesta de precios | La primera prueba del audio aun pidio confirmar el curso. Corregido: responder los importes explicitos del audio enviado, sin otra llamada generativa, usando el mismo lector de importes para preparar la matricula. No confundir precios publicos con saldos privados. |

Los audios se reutilizan cuando su URL no cambia. Si se reemplaza el contenido del archivo, usar una URL nueva para que no se conserve una transcripcion anterior. Una transcripcion automatica puede contener errores: si no identifica los importes y la duracion, no confirma automaticamente la oferta. No se reescriben las promociones ni los documentos ya enviados.

### Limites que requieren completar una prueba real

- Los perfiles, areas, cargos, porcentajes y apodos finales los configura el CEO. No se asignaron valores ficticios al equipo.
- La pantalla real de miembros mostraba reparto desactivado y total 0%: no corresponde afirmar que ya esta repartiendo nuevos leads. El CEO dispone de los selectores y del boton Guardar areas y reparto.
- Las pruebas de servidor con identidades reales comprueban permisos, pero falta abrir dos sesiones de asesoras para acreditar visualmente el traspaso completo y el reparto con los valores definitivos.
- No se ha acreditado un recorrido completo docente identificado -> cancelacion urgente -> cambio automatico de fechas. El aviso de cambio y su check si se probaron, con rollback.
- Calendar/Meet y enlaces externos siguen aplazados por indicacion del usuario.

Evidencia adicional local: output/primer-pago-sin-duplicados-2026-10-10.png.

Comprobacion local final de este lote: 1018 pruebas en 110 archivos aprobadas; compilacion de produccion y TypeScript aprobados, 74 paginas. El calendario sincronizado se consulto de nuevo: cinco cursos, dos modulos por curso, ocho clases por modulo y actualizacion automatica registrada a las 02:56 Lima. Esto acredita sincronizacion del calendario existente, no una cancelacion urgente nueva por mensaje de docente.

### Cierre de publicacion y prueba real posterior

- EasyPanel confirmo Success para e0fb9c3 a las 03:07:12 Lima (08:07:12 UTC). Incluye los cambios anteriores de precios, historial y duplicacion; no se reinicio otro despliegue mientras construia.
- WhatsApp personal EDU450: pregunta de mensualidades a las 03:08, respuesta recibida con primer mes S/19.90 y segundo a sexto S/79.90. Datos obtenidos del audio realmente enviado, sin otra llamada generativa.
- Solicitud de informacion a las 03:09: llegaron imagen y audio originales de NUTRICION 19.90; posteriormente aparecieron los botones de la secuencia. No se sustituyo la automatizacion por texto generado.
- Se comprobo en automation_steps el cache de audio de NUTRICION: URL exacta y transcripcion de 1673 caracteres guardadas. Se corrigio la causa que antes impedia guardar ese cache.
- Tras recargar el CRM, el contenido visible del documento incluye los mensajes mas recientes del 10 de octubre a las 03:09. La captura de accesibilidad larga tambien puede truncarse; se verifico el final real del DOM, no solo esa captura.
- Reenvio real desde el inbox: se seleccionaron dos textos y se reenviaron al propio numero autorizado de Luis. Ambos quedaron delivered y llegaron a WhatsApp en el orden original a las 03:11. No se envio informacion a otros contactos.
- Segunda seleccion real: imagen y audio promocionales reenviados juntos desde el inbox al mismo numero autorizado; ambos llegaron a WhatsApp a las 03:12, imagen primero y audio despues. Evidencia: output/prueba-reenvio-medios-2026-10-10.png. No se reenviaron los 758 mensajes ni conversaciones privadas de otros estudiantes.
- Las comprobaciones de permisos y traspasos entre identidades siguen siendo transaccionales con rollback; no se modificaron roles, porcentajes ni accesos definitivos de las asesoras.

### Prueba con las areas elegidas por el CEO, 03:26-03:35 Lima

- Consulta actual: COORDINADORES (insticrece.education@gmail.com) en VENTAS; LUIS PALACIOS (palacios7581@gmail.com) en FIDELIZACION. ASHLY AGENTE sin area. Se conservaron estas elecciones del CEO.
- Con autorizacion expresa para valores de prueba, configure_sales_routing guardo version 5, reparto activado y 100% COORDINADORES, 0% los demas. Valores temporales; restaurar al terminar la prueba, sin cambiar areas/cargos elegidos por el CEO.
- Numero de prueba indicado por el usuario: 51933691668, conversacion 6c909993-c22f-4663-a505-da66489532fb. Solicitud real desde CHAT INTERNO al miembro de VENTAS con historial completo; destinatario acepto y el usuario confirmo que ve todo el historial.
- Consulta posterior: responsable COORDINADORES; etiquetas ASESOR COORDINADORES y AREA VENTAS; ai_enabled y automation_enabled permanecen true. Esto comprueba derivacion aceptada, no el contador de cuatro interacciones en un lead nuevo.
- Siguiente prueba solicitada: desde VENTAS enviar a LUIS con historial restringido y aceptar en FIDELIZACION. Pendiente de completar por las sesiones del usuario.
- Promocion: se usa texto/pie de imagen completo de la misma ejecucion antes de transcribir audio. Si mensualidad falta o esta tachada, se conserva el respaldo de audio y su cache por URL. 1021 pruebas aprobadas en 110 archivos. No es lectura OCR de todas las imagenes promocionales.
- La reprogramacion urgente iniciada por mensaje de docente sigue pendiente; no presentar los avisos de calendario existentes como prueba de ese recorrido.

Evidencia visual: output/reparto-prueba-actual-2026-10-10.png y output/derivacion-ventas-solicitada-2026-10-10.png.
