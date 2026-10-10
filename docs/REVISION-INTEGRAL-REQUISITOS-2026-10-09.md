# REVISION INTEGRAL DE REQUISITOS

Revision: 09/10/2026, America/Lima. Contrasta la conversacion disponible, sus correcciones, el ultimo texto adjunto, el codigo actual y consultas actuales de Google Sheets y Supabase. No certifica conversaciones de otros chats que no esten incluidas en este historial.

Este documento consolida el estado actual. Las listas del 08/10 describen estados historicos y contienen pendientes ya resueltos; no deben interpretarse como el estado vigente. Se corrigio codigo y se instalaron funciones de Google y base de datos durante esta revision. No se aprobo un pago ni se enviaron mensajes de prueba a estudiantes o companeras reales.

## COMO LEER EL ESTADO

- COMPROBADO: hay evidencia directa indicada, limitada a ese alcance.
- IMPLEMENTADO / FALTA PRUEBA COMPLETA: existe la conexion en codigo; no se ha demostrado todo el recorrido con un estudiante.
- PENDIENTE: falta una conexion, pantalla, regla o configuracion identificada.
- POSTERIOR: el usuario expresamente lo dejo para otra etapa.

## CORRECCIONES QUE PREVALECEN

1. El CEO define cuentas, areas, cargos, permisos y porcentajes. El programador no los asigna por su cuenta.
2. Tras cuatro bloques, el siguiente contacto permite a la asesora ver el chat mediante asignacion/etiqueta. Asignar o poner PENDIENTE DE VALIDACION no debe detener la IA ni la automatizacion. La pausa breve por intervencion humana es otra regla existente; no equivale a detenerla durante dos horas.
3. Ventana comercial de dos horas: se reinicia con cada mensaje o comando de la asesora. Mensajes del estudiante y del bot no la reinician. Al vencer se retira su responsabilidad/etiqueta y continua la institucion.
4. Atribucion de venta por APODO y gestion humana vigente; INSTITUCION si la IA la cierra. Debe conservarse al aprobar el pago.
5. Fidelizacion comparte sus chats, sin porcentajes comerciales. Esto no significa que deba ver todos los chats de ventas.
6. Misma area: historial completo. Entre areas: tramo reciente por defecto, con opcion autorizada de compartir completo.
7. Presentacion por APODO, preparada para envio manual; primera atencion y nueva derivacion deben presentarse de nuevo, sin desplegarla en cada visita.
8. Cumpleanos en cada asesora. Correccion del ultimo adjunto: avisar una semana antes a CEO/administracion/coordinadores, y el mismo dia a companeros excepto a quien cumple anos.
9. Cinco cursos confirmados. La mencion inicial de seis listas fue corregida al proporcionar cinco cursos; no inventar un sexto.
10. CUADRO DE INICIOS en MATRICULAS Y CONTROL DE INGRESOS; conservar formato. Mostrar fechas solo del modulo actual y siguiente; actual verde; ocho clases efectivas, ciclo continuo.
11. Cancelaciones informadas: 07/10/2026 en ASISTENTE ADMINISTRATIVO y AUXILIAR DE EDUCACION INICIAL. Excluir feriados peruanos en la proyeccion.
12. Inscripcion hasta antes del comienzo de la tercera clase. Se ofrece la siguiente sesion disponible, pero se registra el inicio oficial del modulo para cronograma/cobranza.
13. Listas de WhatsApp: NUMERO, CURSO, FECHA DE INICIO, CELULAR; fecha grande horizontal roja; renovar cuatro dias despues del inicio, sin borrar la matricula original.
14. MAINET 11:00-13:00 y ANTONELLA 18:00-22:00; tres gestiones de ingreso/llamadas al dia cada una. Este cupo no bloquea documentos ni bienvenida.
15. Beneficiario: LUIS BRAYAN PALACIOS CARHUAPOMA. Un nombre truncado necesita revision; OCR no confirma que el dinero haya llegado al banco.
16. Carpetas: GENERAL / MES-ANO / DIA-MES / NOMBRE-DOCUMENTO / CURSO / PRIMER PAGO. Reutilizar identidad por nombre y documento al agregar otro curso; enlace en registro apunta al estudiante.
17. PRIMER PAGO conserva voucher, fotos de documento y tres PDF. Las copias de trabajo se eliminan despues de exportar correctamente; las plantillas originales se conservan.
18. BOLETA, FICHA y CRONOGRAMA: formato original aprobado, una pagina A4 cada uno, nombres con nombre/documento; fechas alineadas a izquierda y horarios comprensibles como 8:00-10:00 PM.
19. Cronograma: inicio 1-9 -> 30 del mismo mes; 10-25 -> 15 del siguiente; 26-fin -> 30 del siguiente; febrero 28/29. Montos incluyen IGV. Usar promocion ofrecida al estudiante, no la que este activa despues.
20. MAYUSCULAS SIN TILDES para nombres de hojas/libros/carpetas; datos personales ordenados en mayuscula, documento/telefono sin espacios; conservar correos y enlaces validos.
21. Una sola publicacion coherente por lote; no confundir codigo preparado con funcion instalada y demostrada.

## A. EQUIPO, PERMISOS Y CHAT

| Pedido | Estado real |
|---|---|
| APODO y fecha de nacimiento de asesoras | IMPLEMENTADO: formulario guarda birth_date y apodo. Pantalla comprobada en publicacion previa. Falta prueba de guardar/recargar fecha real proporcionada por su titular |
| CEO edita area, cargo y reparto | IMPLEMENTADO: sales-routing-panel y API. Fidelizacion oculta porcentaje. Falta recorrido de reparto real con las cuentas y valores que el CEO seleccione |
| CEO/administrador controla permisos por modulo y accion | IMPLEMENTADO: permisos en servidor y base. Decision de pago comprueba payments.view y payments.review tambien en funcion real de Supabase. Falta matriz de pruebas con cada tipo de cuenta real |
| Asesora ve sus chats; fidelizacion comparte los de su area | IMPLEMENTADO mediante permisos, etiquetas y limites de historial. Falta prueba operativa completa con varias cuentas, incluidos cambios de area |
| Etiquetas por persona/apodo, area, roles y combinaciones | IMPLEMENTADO: gestor distingue acceso y proceso; audiencia por usuarios/areas/roles. Crear una etiqueta decorativa no basta para dar acceso: debe configurarse como acceso |
| Agentes aplican etiquetas autorizadas; coordinacion/admin/CEO las gestionan | IMPLEMENTADO con permisos tags.manage y controles de audiencia. Falta comprobar configuracion exacta de cada cuenta y presentacion agrupada visualmente por area |
| Seleccionar varios chats, aplicar/quitar etiquetas y ver etiquetas arriba | PUBLICADO y comprobado en lote anterior. Falta recorrido con etiqueta real de acceso y cuenta de asesora despues de quitarla |
| Cuatro bloques y asignacion en siguiente contacto | IMPLEMENTADO con reparto comercial; falta prueba real de contador, quinta interaccion, disponibilidad y porcentajes |
| Ventana comercial dos horas, renovacion solo por asesora | IMPLEMENTADO y pruebas previas. Falta prueba de transcurso real completo con cuentas de usuario |
| Atribucion por APODO o INSTITUCION | IMPLEMENTADO con snapshot en revision de pago. Falta comprobar en la fila Google de una matricula completa |
| Priorizar promo inicial, luego malla | IMPLEMENTADO; ejemplos de FARMACIA 19.90 probados. Falta recorrido comercial completo en WhatsApp real |
| MANDAR(promocion/malla...) con palabras aproximadas | IMPLEMENTADO y probado, seleccion unica de automatizacion activa; no se envia el comando literal ni se elige entre promociones ambiguas |
| MANDAR(medios de pago) | CONFIGURADO: bloque MEDIOS DE PAGO activo de un paso, con imagen y texto ya usados en el CRM, beneficiario completo confirmado. Falta envio real autorizado |
| Texto multilinea debajo de imagen | IMPLEMENTADO; usuario aprobo resultado visual previo. Mantener comprobacion en envio completo |
| Chat interno individual/grupal, avisos y no leidos | PUBLICADO, pantalla y permisos comprobados previamente; no se enviaron mensajes a companeras reales como prueba |
| Presencia verde/amarilla y ficha del miembro | IMPLEMENTADO en componentes de presencia y datos de equipo, incluidos apodo/area/cargo/birth_date. Falta prueba visual de cambio conectado/pausa/desconectado entre cuentas |
| Derivar numero/conversacion desde chat interno | PUBLICADO: seleccion de chat visible, destinatario y alcance del historial. Falta traspaso real entre dos cuentas |
| Historial completo misma area y limitado entre areas | IMPLEMENTADO en funcion de transferencia y accesos. Las derivaciones automaticas corrigen el limite al ultimo mensaje del cliente. Falta prueba de mensajes/notas/citas/adjuntos/busqueda con cuentas reales |
| Presentacion preparada por nueva asesora | CORREGIDO: fecha de nueva asignacion en base y clave de presentacion por asignacion. Pruebas de interaccion anterior y nueva derivacion pasaron; falta recorrido visual con varias cuentas |
| Archivar personal, archivar todos, recuperar por CEO y eliminar definitivamente | PUBLICADO, botones comprobados. No se eliminaron chats reales como prueba. Archivar conserva historial; eliminar definitivamente no es recuperacion |
| Adjuntos por selector/arrastre en WhatsApp y chat interno | CORREGIDO en este lote: boton ADJUNTAR ARCHIVO visible y zona de arrastre en chats internos/grupos; privado hasta 16 MB. Pruebas de permisos/tipos/tamano pasaron. Falta envio real autorizado y limpieza de archivos abandonados |
| Derivacion directa entre areas, sin pedir aceptacion | CORREGIDO en este lote: boton DERIVAR en cabecera, area/persona y alcance completo/reciente. API inmediata probada; falta ejercicio entre cuentas reales |
| Reenviar mensajes antiguos a destinatario con ventana abierta | CORREGIDO: no arrastra referencia de respuesta del chat original; valida 24h desde ultimo mensaje del destinatario, permisos y cuenta. Pruebas texto multilinea/imagen/PDF/audio/video pasaron. Ubicacion y cabeceras de plantillas requieren recorrido especifico |
| Avisos SISTEMA y cumplimiento en el mismo aviso | IMPLEMENTADO en este lote: color distintivo, marcar/desmarcar, responsable/hora e historial de acciones visible para administracion en Dashboard. Base probada con rollback, sin tareas reales marcadas |
| Cumpleanos: aviso previo y el mismo dia | INSTALADO en base y llamado desde cron en este lote. Pruebas de destinatarios, exclusion de cumpleanero e idempotencia pasaron. Falta primera ejecucion con fechas reales registradas; 29 de febrero en ano no bisiesto requiere criterio |
| Tiempo de conexion y pausa por asesora | INSTALADO historial de intervalos y resumen administrativo de 7/30 dias en este lote. Prueba de 60 s activos y 105 s pausa con corte desconectado paso. Empieza desde instalacion, no reconstruye pasado ni prueba trabajo realizado |
| Estudiante que pide ayuda no debe ir a ventas | CORREGIDO respaldo por mensajes propios de alumno/clases/notas/acceso; solicitudes explicitas de ventas prevalecen. Nueve pruebas pasaron. No identifica automaticamente alumnos antiguos fuera de la base/conversacion |
| IA no repite preguntas ya contestadas | INSTRUCCIONES reforzadas: responde duda actual, usa datos previos, no reinicia ventas a estudiante. Falta revisar ejemplo real de redundancia y verificar respuesta del modelo; instrucciones no garantizan ausencia total de errores |
| Origen/campana/anuncio y seguimiento para reportes | PARCIAL: origen del pago/asesora existe. No se acredita atribucion publicitaria completa desde anuncio hasta venta |

## B. PAGOS Y MATRICULA

| Pedido | Estado real |
|---|---|
| Lectura de voucher, monto, fecha, operacion, nombre | PUBLICADO, voucher recibido y leido. Hay revision humana; no se acredita conciliacion bancaria automatica |
| Lector de DNI/CE y comparacion con texto | IMPLEMENTADO: datos sugeridos, fotos asociadas, identidad consistente antes de registrar. FALTA prueba completa con imagen legible y texto coincidente |
| Cola visible con etiquetas y filtros, origen y asesora | PUBLICADO; ya existe un pago validado en la base real |
| VALIDADO / NO VALIDADO / EN OBSERVACION con motivo y auditoria | IMPLEMENTADO; decision humana, control de permisos/version y registro de autor/fecha. Pago validado queda bloqueado para cambios |
| Rechazado/observado vuelve a asesora vigente con motivo | CORREGIDO e INSTALADO: recupera gestion comercial vigente o cola de ventas configurada por CEO, notifica motivo. Prueba transaccional paso sin modificar el pago real |
| Validar sin detener conversaciones | IMPLEMENTADO: no hay pausa por etiqueta; limite de respuestas aumentado a 1000. Persisten limites reales y pausa humana breve; no equivale a respuestas ilimitadas |
| Datos, dos celulares, Gmail preferente y observaciones | IMPLEMENTADO recoleccion/edicion y observaciones de correo no Gmail en Sheets. Segundo telefono no bloquea registro. Falta comprobar solicitud automatica de cada faltante al estudiante |
| Promocion ofrecida y seis cuotas conservadas | IMPLEMENTADO: usa oferta enviada por automatizacion antes del voucher, exige coincidencia unica. No interpreta audios para resolver ofertas ambiguas ni registra cualquier excepcion negociada automaticamente |
| Oferta con importe distinto al pago | PENDIENTE regla de excedentes: hoy exige igualdad exacta; S/20 frente a S/19.90 bloquea, aunque el pago este validado. No cambiar el monto real para eludirlo |
| Registro automatico despues de validar y completar | IMPLEMENTADO: collecting -> ready -> processing -> registered con puente Google. No hay matricula completa registrada desde CRM todavia |
| Provisional: pagado sin DNI y clase hoy | PENDIENTE: el registro normal exige identidad confirmada. Falta ingreso provisional, restriccion de acceso y seguimiento |
| Operacion repetida/antiguedad aceptada/beneficiario truncado | Revision humana disponible. Falta protocolo cerrado y prueba de duplicado financiero, antiguedad y variantes permitidas; idempotencia tecnica no demuestra pago unico bancario |
| Varias matriculas simultaneas del mismo chat | PARCIAL: carpetas admiten cursos diferentes; recoleccion automatica evita adivinar si hay varias fichas pendientes. Falta seleccion explicita de curso/pago en ese escenario |

## C. GOOGLE, CARPETAS Y DOCUMENTOS

| Pedido | Estado real |
|---|---|
| Registro manual/automatico con numero, fecha/hora Lima, instituto | Manual confirmado por usuario; codigo conserva valores previos y usa correlativo mayor existente. Falta fila automatica real desde CRM |
| Tipo de documento antes del numero; nombres/documentos/celulares ordenados; edad | IMPLEMENTADO y cabeceras reales comprobadas. Caracteres invalidos se observan, no se borran letras sin aviso |
| MAINET 11-13 / ANTONELLA 18-22, maximo tres | COMPROBADO hoy en MATRIZ: ambos horarios y limite 3. Desborde y fuera de horario siguen vacios; calendarios sin ID |
| Prioridad y REALIZADO al agregar WhatsApp | IMPLEMENTADO en Apps Script. Falta confirmar colores y estado de contacto humano sincronizado con CRM |
| Estructura de carpetas y reutilizar alumno entre cursos | IMPLEMENTADO, simulacion previa. Falta recorrido con originales reales desde CRM y segundo curso del mismo alumno |
| Crear mes siguiente cinco dias antes | Codigo preparado. Falta evidencia actual de activador y ejecucion independiente de esa funcion |
| PDF A4 una pagina, plantillas originales y margenes aprobados | Formatos aprobados por usuario en simulacion y exportador configurado. Falta verificar documentos de la primera matricula completa real |
| Boleta correlativa y totales/IGV incluido | IMPLEMENTADO contador y serie conservada por matricula; falta prueba de dos matriculas distintas y reintento de la misma sin duplicar numero |
| Cronograma por inicio oficial, rangos y febrero | IMPLEMENTADO; falta prueba documental integrada con inicio/promocion reales |
| Fotos originales de DNI y voucher a PRIMER PAGO | IMPLEMENTADO endpoint autenticado y puente. Falta prueba real de descarga/copia desde CRM |
| Solo tres PDF y originales, sin Excel temporal | IMPLEMENTADO limpieza despues de completar tres PDF; no elimina plantillas. Falta revisar/limpiar copias antiguas de simulacion y comprobar carpeta real final |
| Tres PDF enviados al mismo chat | IMPLEMENTADO en puente y API; 15 pruebas de envio/puente pasaron en esta sesion. CERO envios reales registrados hasta la consulta actual |
| Libro operativo limpio y matriz administrativa aparte | COMPROBADO: operativo con MATRICULAS, CUADRO DE INICIOS y cinco WA; matriz con ocho pestañas administrativas incluido CONTROL DE CLASES. Se compararon siete rangos completos antes de retirar duplicados; respaldo RESPALDO MATRICULAS ANTES DE LIMPIEZA 09-10-2026 conservado |
| Permisos privados de Google por equipo | Falta verificar lista de acceso real de ambos libros/carpeta; no afirmar privacidad por existir matriz separada |

## D. INICIOS, FIDELIZACION Y DOCENTES

| Pedido | Estado real |
|---|---|
| Cuadro actual+siguiente, cinco cursos, ocho clases y ciclo | COMPROBADO sincronizado: 10 modulos en CRM; codigo de renovacion conserva dos fechas por curso |
| Feriados y cancelaciones del 07/10 | IMPLEMENTADO; nutricion siguiente 05/11 tras excluir 08/10. No equivale a detectar automaticamente futuras cancelaciones de docentes |
| IA consulta cuadro para fechas y tercera clase | IMPLEMENTADO, contexto con fecha oficial y proxima sesion; si copia tiene mas de 30 minutos no inventa. Falta conversacion real preguntando fechas |
| Cambio de fecha: aviso rojo y tareas de avisar | IMPLEMENTADO notificacion del CRM a fidelizacion/admin con enlace y lista de tareas. Falta cierre/confirmacion individual de tareas y evidencia de cambio visual rojo en Google |
| Docente comunica urgencia, verificacion y reprogramacion inmediata | PENDIENTE conectar mensaje identificado del docente a cancelacion/recalculo seguro y alertas; no se ha demostrado ese flujo |
| Reprogramar todos los afectados/cronogramas ya emitidos | PARCIAL: recalculo de fechas y avisos. Falta recorrido para matriculas antiguas, documentos emitidos y control de notificacion/regeneracion |
| Listas WhatsApp cuatro columnas por curso | CORREGIDO e INSTALADO: fuente MATRICULAS directa, normalizacion de curso; cinco vistas verificadas. Fuente no depende de duplicados administrativos eliminados |
| Fecha grande roja y renovar a los cuatro dias | INSTALADO y comprobado visualmente en cinco listas. Activador cada cinco minutos; actualiza lista al cuarto dia sin borrar matriculas |
| CONTROL DE CLASES: cortes 6-20 22h y 21-5, conteo por curso, cancelaciones | INSTALADO en matriz: programadas, feriados, canceladas, previstas, dictadas confirmadas y observacion separadas. Conserva cortes anteriores y campos manuales. Nutricion 5-1=4; farmacia 4; RRHH 4; administrativo 4-1=3; inicial 4-1=3. Dictadas reales no se deducen del calendario: administracion confirma |
| Alertas y Calendar de asesoras | PENDIENTE: CALENDARIO ACTIVO=NO; HORA AVISO e IDs vacios. Notificaciones del CRM no sustituyen esta conexion |
| Bienvenida texto/imagen y audio tras dos horas sin contacto | POSTERGADO por usuario el envio de archivos; integracion operativa aun pendiente. Existe calculo local de reglas, no envio completo instalado |
| Audio fuera de horario y alerta de incumplimiento en turno | PENDIENTE junto a bienvenida/contacto humano y configuracion de desborde; no confundir con ventana comercial de dos horas |
| Reporte semanal viernes por persona/area | IMPLEMENTADO notificacion desde 22:00 Lima con contactos, mensajes y matriculas registradas; pendiente primera ejecucion real del viernes y validacion de cifras |
| Reporte de quejas, razones y soluciones | PENDIENTE clasificacion estructurada. El reporte actual no inventa esas cifras |
| Notificaciones dentro de WhatsApp/chat interno con enlaces exactos | PARCIAL: notificaciones del CRM existen; no se ha acreditado envio en chat interno/WhatsApp ni enlace a pestaña concreta de cada curso para todos los casos |

## E. POSTERIORES REGISTRADOS, SIN DECLARARLOS TERMINADOS

- Consulta de link de clase en Calendar/Meet de otra cuenta previa identificacion y vigencia del estudiante.
- Resumen mensual de calidad docente a partir de resumen/transcripcion/grabacion. Medir silencio/break requiere tiempos; un resumen por si solo no los acredita.
- Plataforma del estudiante y expediente unico por DNI/nombre: cursos, notas, pagos, deudas, moras, modulos y certificados.
- Cursos gratuitos, cruce de celular/documento, certificacion por modulo y cursos asincronicos.
- Cobranza completa y pagos parciales futuros; definir adelanto/saldo/correcciones sin alterar recibos anteriores.
- Mas cursos y franjas futuras: el calendario actual valida exactamente cinco cursos; necesita ampliacion de configuracion cuando se incorporen otros.

## DIAGNOSTICO ACTUAL DE LA PRUEBA

Consultas reales de esta revision:

- Un pago VALIDATED.
- Una ficha COLLECTING; cero matriculas REGISTERED.
- Cero registros de entrega de PDF.
- La ficha ya tiene curso NUTRICION Y DIETETICA, inicio oficial 06/10/2026, datos escritos y oferta confirmada de 19.90 + cinco cuotas 79.90.
- Falta identity_confirmed; fotos asociadas no equivalen a identidad confirmada.
- amount=20.00 frente a primera cuota=19.90. enrollmentIssues bloquea cualquier diferencia, incluido excedente. Es una regla por resolver, no un dato faltante que deba rellenarse con un monto falso.
- Calendario: 10 modulos, actualizado automaticamente 09/10/2026 20:31:11 UTC / 15:31:11 Lima, despues de la sincronizacion manual anterior. Confirma continuidad del puente en esa consulta; no garantiza disponibilidad perpetua.
- Las seis tablas publicas revisadas de pagos/matriculas/entregas/calendario/chat tienen RLS habilitado. Esto no sustituye todas las pruebas de permisos por cuenta.

## INFORMACION YA RECIBIDA: NO VOLVER A PEDIR

Libros operativo y matriz; carpeta general; tres plantillas y formato aprobado; beneficiario exacto; cinco cursos y horarios; ocho clases y ciclo; cancelaciones indicadas; regla tercera clase; rangos de cuotas y febrero; IGV incluido; estructura de carpetas; MAINET/ANTONELLA y tres gestiones; renovacion WhatsApp cuatro dias; cumpleanos solo asesoras; reparto elegido por CEO; dos horas renovadas por cada mensaje humano; IA continua al asignar/validar.

## LO QUE REALMENTE QUEDA POR DEFINIR/APORTAR

No hace falta reenviar el relato ni las plantillas. Cuando se conecte cada punto:

- Imagen, audio y texto de bienvenida, aplazados expresamente por el usuario.
- Calendarios/cuenta autorizada y hora de alerta; personas Google autorizadas si se va a ajustar privacidad de archivos.
- Desborde humano cuando ambas asesoras alcanzan tres y responsable fuera de turno; no bloquear automatizacion documental por ello.
- Criterio de excedentes/adelantos y modificaciones de pagos/documentos aprobados. No aplicar igualdad exacta como si el usuario la hubiera solicitado.
- CEO configura cuentas, cargos, permisos y porcentajes directamente; no tiene que enviar esa lista para que el programador los decida.

## ORDEN PARA CERRAR

1. Resolver bloqueos reales del ingreso: identidad comprobada y tratamiento de S/20 frente a S/19.90; sin falsear datos ni aprobar por el CEO.
2. Probar una matricula completa: fila, carpeta, originales, boleta correlativa, tres PDF A4, entrega al chat y reintento sin duplicados.
3. Listas WhatsApp, encabezado rojo, renovacion cuatro dias y retiro de duplicados: INSTALADOS. Ejecucion Google completada 09/10/2026 19:56:04 Lima; conservar respaldo.
4. CONTROL DE CLASES instalado en matriz. Seguimiento de tareas SISTEMA e historial de presencia instalados en base; nuevas pantallas incluidas en el lote actual.
5. Devolucion de pagos observados, MEDIOS DE PAGO y nueva presentacion: corregidos. Siguen pruebas operativas de reparto/permisos y limpieza de adjuntos abandonados.
6. Conectar bienvenida/audio/calendarios cuando esten los recursos; completar reporte de quejas/soluciones.

CONCLUSION: la informacion principal esta recogida, pero el sistema no esta terminado de extremo a extremo. Hay implementaciones publicadas, pruebas pendientes y faltantes concretos. Esta revision no reemplaza esos faltantes con una afirmacion de que todo funciona.

## COMPROBACIONES DEL LOTE ACTUAL

- 944 pruebas automaticas, 101 archivos, sin fallos (09/10/2026 19:55 Lima).
- Compilacion de produccion y TypeScript correctos. ESLint de los cambios nuevos correcto tras corregir orden de callbacks; no se certifica el lint global, que tiene fallos previos.
- Base real: pruebas transaccionales de retorno de pago observado, nueva asignacion, tareas compartidas/idempotencia/reapertura, destinatarios de cumpleanos y tiempos de presencia. Todo con rollback; no quedan pagos, tareas o cumpleanos ficticios.
- Control administrativo de tiempos y tareas rechaza a agentes; CEO ve titulo de tarea, responsable y hora mediante funciones limitadas a su cuenta.
- Historial de presencia empieza al instalarse: no se inventan tiempos de los tres dias anteriores. Desconexion se detecta con el umbral existente de 75 segundos; no se cuenta indefinidamente una pestaña cerrada.
- Capturas locales: output/verificacion/lista-whatsapp-20261009.png y control-clases-20261009.png.
- Privacidad: separar pestañas administrativas no acredita que los archivos Google sean privados. Se observo acceso por enlace en el libro operativo; falta revisar destinatarios autorizados antes de ajustar permisos.
