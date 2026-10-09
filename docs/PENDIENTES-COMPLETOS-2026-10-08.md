# REVISION COMPLETA DE REQUISITOS

Fecha: 08/10/2026, America/Lima. Esta lista describe requisitos y evidencia, no declara terminado el sistema de ventas. Se revisaron la conversacion, codigo real, esquema de Supabase, la pantalla de perfil y el voucher recibido. Las comprobaciones de Google mencionadas abajo fueron realizadas antes de esta revision y necesitan una prueba completa conectada con CRM.

## Actualizacion 09/10/2026

- Publicado y visto en CRM: cola de pagos con etiquetas, origen, decisiones del CEO y auditoria; cumpleaños de asesoras visible. El voucher real sigue pendiente, no fue aprobado por el agente.
- Base aplicada: cada validacion humana crea una sola ficha de matricula. Prueba con datos temporales y rollback, sin aprobar el voucher real.
- Publicado (25373c1, EasyPanel Success 09/10 07:12 UTC) y menu comprobado: editor de ficha, sugerencias del lector de DNI, pendientes, oferta de seis cuotas confirmada y cola autenticada para Google. No equivale a documentos enviados.
- PUENTE_CRM_MATRICULAS.gs guardado como archivo separado en el proyecto existente. Falta clave limitada, activar el trigger y probar el recorrido completo; no se declara instalado ni operativo aun.
- Chat interno individual/grupal preparado, base aplicada: participantes, mensajes, historial paginado, avisos y no leidos. Prueba real de permisos en transaccion con rollback: miembro puede leer; tercero no puede leer/enviar; no se puede falsificar remitente ni invitar usuarios ajenos. Pendiente publicacion y comprobacion visual.
- La bateria local paso 809/809 pruebas y build (66 paginas). La entrega de documentos al WhatsApp y las demas filas pendientes abajo siguen sin completarse. El contenido de la revision 08/10 es historico, no el estado vigente de lo resuelto arriba.

## Estado de la revision anterior (08/10; ver actualizacion arriba)

- CRM publicado: cb5c6d6. APODO visible. Navegacion Overview -> Your profile comprobada y confirmada por el usuario.
- Imagen recibida: leida por la IA, pendiente de revision. No aprobada. Confundio el servicio Yape con el destinatario; instruccion corregida localmente, aun sin publicar ni repetir la lectura visual.
- Cumpleaños de asesoras: profiles.birth_date existe, pero faltaba conectarlo al formulario. Correccion local preparada, 18 pruebas focalizadas aprobadas, typecheck y build aprobados. Falta publicar y comprobar guardar/volver a cargar un dato proporcionado por su titular.
- Chat interno: no existe pantalla ni tablas de conversaciones privadas de equipo.
- Validacion del CEO: no existe cola de comprobantes ni boton de decision. El aviso pending_review es solo resultado del lector.
- Etiquetas: existen etiquetas generales y filtro de etiquetas en Inbox. Falta crear/aplicar automaticamente las etiquetas del protocolo de venta, asesora, origen y revision de pago. El filtro no sirve para esa cola mientras no existan esos datos.

## 1. CRM, equipo y atencion

| Requisito pedido | Estado / trabajo pendiente |
| --- | --- |
| Perfil con APODO y cumpleaños de cada asesora | APODO publicado. Cumpleaños corregido localmente, pendiente de publicacion y prueba de persistencia. No hay recordatorio de cumpleaños implementado. |
| Chat interno individual y grupal, avisos y alertas internas | FALTA: conversaciones, participantes, mensajes, no leidos, notificaciones y permisos. Notas del contacto no lo sustituyen. |
| Areas de ventas, fidelizacion, administracion/finanzas; agente/coordinadora/CEO | Roles generales y permisos de modulos existen. Falta interfaz para areas/cargos y reglas especificas por area/nivel. La base dispone de area/cargo, pero el listado y edicion de miembros no implementan la experiencia pedida. |
| Traspaso aceptado/rechazado y disponibilidad de receptor | Asignacion directa existe; solicitud/aceptacion/rechazo FALTAN. La presencia existente no equivale a aceptar el caso. |
| Misma area ve todo el historial autorizado; entre areas solo tramo nuevo | FALTA control real en base y rutas para mensajes, notas, adjuntos, respuestas citadas y busquedas. El CEO conserva visibilidad completa autorizada. |
| Presentacion de nueva asesora desde APODO, tambien entre compañeras de misma area | Borrador manual publicado. Falta verificar con usuaria asignada y conectar con traspasos reales. No envia solo ni reemplaza apodo por nombre completo. |
| Pausar IA y automatizaciones al atender una asesora | PARCIAL: pausas de cinco minutos y controles actuales; falta pausa sostenida y retorno configurado de 2-3 horas con atribucion/responsable/etiqueta correctos. |
| Cuatro interacciones y derivacion en quinta; agentes de ventas configurables | Falta integrar contador/regla acordada y atribucion comercial. El round_robin actual elige primer perfil: no hace rotacion A-B-C-A ni porcentajes reales. |
| Registro de origen/campaña/anuncio y bloques alcanzados | Contacto/conversacion existen. Falta el registro completo y su relacion con reparto/comisiones pedido. |
| Promocion inicial antes de malla; farmacia 19.90 | Correccion publicada y pruebas aprobadas; falta confirmar el recorrido real y que la configuracion almacenada del bot no contradiga la regla. |
| Conservar saltos de linea bajo imagen | Compositor textarea publicado; falta comprobar un envio real autorizado con varios renglones. |

## 2. Pago, identidad y control del CEO

| Requisito pedido | Estado / trabajo pendiente |
| --- | --- |
| Etiquetas automaticas: origen VENTAS, asesora y CONFIRMACION DE PAGO | FALTA aplicar protocolo automatico/manual restringido y origen verificable; no inventar VENTAS si no consta. |
| Cola visible y filtro PENDIENTE DE VALIDACION | FALTA. Los comprobantes recibidos deben aparecer sin abrir cada chat. No confundir pago recibido por revisar con cuota aun no pagada. |
| CEO decide VALIDADO / NO VALIDADO / EN OBSERVACION | FALTA pantalla, botones, autorizacion en servidor/base y auditoria de decision, usuario, fecha y comentario. La IA no toma esa decision. |
| Observado/rechazado vuelve a asesora vigente | FALTA derivacion, aviso y tarea con motivo. |
| Leer DNI, CE u otro documento y comparar con datos escritos | Lector publicado; falta prueba DNI, extraccion de nacimiento/direccion y comparacion/faltantes. Actualmente el lector no tiene campos de nacimiento/direccion. |
| Leer voucher: monto, fecha, operacion y beneficiario | Primer voucher leido. Corregir separacion destinatario/entidad. Falta comparar monto con oferta registrada, antiguedad aceptada y operaciones repetidas. Beneficiario exacto: LUIS BRAYAN PALACIOS CARHUAPOMA; nombres abreviados requieren revision. |
| Solicitar nombres, documento foto/texto, dos celulares, correo y voucher | FALTA formulario/estado de recoleccion conectado a conversacion. Correo no Gmail y segundo celular faltante generan observaciones segun protocolo. |
| Promocion realmente ofrecida fijada por estudiante | Funcion de oferta existe en Apps Script; falta guardar/conectar la oferta de CRM. No inferir precio mirando solo promociones activas del dia del pago. |
| Promociones activables/desactivables | Automatizaciones pueden activarse, pero falta el catalogo/oferta estructurada que alimente cuotas y documentos sin lectura costosa reiterada de IA. |
| Pago aprobado con DNI faltante y clase hoy | FALTA admision provisional, observacion, acceso solo autorizado a clase y seguimiento. No dar acceso completo automaticamente. |

## 3. Registro en hojas, carpetas y PDF

| Requisito pedido | Estado / trabajo pendiente |
| --- | --- |
| MAYUSCULAS SIN TILDES en nombres de libros/pestañas/carpetas | Convencion adoptada en scripts; falta comprobar todos los artefactos y evitar cambiar mensajes naturales, correos o enlaces. |
| Numero correlativo, fecha/hora de Lima, instituto y registro manual estandarizado | Instalado previamente y confirmado por usuario. Falta prueba automatica desde CRM; preservar fecha/hora original al editar y prevenir duplicados/concurrencia. |
| Nombres en mayusculas, espacios unicos, documento por tipo, telefonos normalizados, edad | Preparado/instalado en Apps Script. No borrar letras erroneas silenciosamente; observarlas. Lectura de DNI no esta conectada al registro. |
| Asesora de ventas real; MAINET 11-13 y ANTONELLA 18-22, maximo 3 llamadas por dia | Configuracion de horarios preparada. Falta conexion con CRM, prioridad de urgentes y desborde. El limite no bloquea PDF/bienvenida. |
| Estructura de carpeta exacta | GENERAL / MES-ANO / DIA-MES / NOMBRE-DOCUMENTO / CURSO / PRIMER PAGO preparada. Reutilizar estudiante por nombre/documento para varios cursos y guardar enlace de estudiante. Falta recorrido conectado con archivos reales de WhatsApp. |
| Mes siguiente creado cinco dias antes | Codigo preparado; falta revisar activador y comprobar ejecucion independiente instalada. |
| Solo voucher, fotos DNI y tres PDF en PRIMER PAGO | Generador actualizado limpia copias de trabajo al completar PDF. Falta limpiar copias de simulaciones antiguas y comprobar fallos parciales/duplicados. No borrar plantillas. |
| Boleta original A4 una pagina, contador correlativo, IGV incluido y nombre BOLETA-NOMBRE-DOCUMENTO | Simulacion aprobada antes. Falta prueba real con contador oficial, pago validado y entrega. Pagos parciales futuros requieren protocolo adicional. |
| Ficha y cronograma originales A4 una pagina, margenes, rango completo, fechas izquierda y horario comprensible | Simulacion/formato aprobados antes. Falta verificar recorrido final conectado; no usar 20 PM ni 22 PM: formato consistente 8:00-10:00 PM. |
| Cronograma desde inicio oficial del modulo | Calculo preparado: 1-9 -> 30 del mismo mes; 10-25 -> 15 siguiente; 26-fin -> 30 siguiente; febrero ultimo dia. Falta alimentar inicio/oferta correctos desde CRM. |
| Envio de tres PDF y almacenamiento Drive | FALTA conexion autenticada, originales descargados desde WhatsApp, generacion tras aprobacion y envio con registro de entrega/reintentos sin duplicados. |
| Matriz administrativa aparte y solo pestañas utiles para asesoras | PARCIAL: matriz creada antes; faltan conexiones correctas, retirar duplicados sin romper referencias y aplicar accesos privados de equipo. |

## 4. Inicios, fidelizacion y docentes

| Requisito pedido | Estado / trabajo pendiente |
| --- | --- |
| Cuadro visual en MATRICULAS, actual verde y solo siguiente inicio | Instalado previamente con activador de renovacion. Falta revalidar que lector de matriculas use historico correcto y evitar IDs repetidos en otra vuelta del mismo año. |
| Modulos ciclicos independientes, ocho clases, feriados y cancelaciones | Calculo preparado y cancelacion 07/10 de ADMINISTRATIVO e INICIAL incorporada. Falta control operativo de nuevas cancelaciones y conexion con mensajes de docentes. |
| Aviso rojo por cambio de fecha y tareas a docente/grupos/nuevos ingresos | FALTA conectar cambio a tareas, responsables y notificaciones; no solo nota acumulada. |
| Ofrecer incorporacion hasta antes de comenzar tercera clase | Calculo preparado, falta conexion a ventas. Registrar inicio original del modulo para cobranza, aunque se ofrezca asistir a siguiente sesion. |
| UA por curso: NUMERO, CURSO, FECHA DE INICIO, CELULAR | Pestañas creadas antes; corregir fuente operativa vs matriz. Fecha grande roja y renovacion cuatro dias despues aun necesitan instalacion/comprobacion. Cinco cursos confirmados; no inventar un sexto. |
| Prioridad por cercania, REALIZADO al agregar WhatsApp y colores de pendientes/automaticos | Parte preparada en registro. Falta colores definitivos y estados de contacto humano sincronizados con CRM. |
| Bienvenida texto/imagen y audio a dos horas sin contacto, una sola vez | FALTA integracion. Fuera de turno tambien envia audio; alerta por incumplimiento solo si habia responsable en turno. |
| Calendarios de asesoras y alertas de inicio | Codigo preparado pero configuracion desactivada; faltan IDs/accesos y hora de aviso. |
| CONTROL DE CLASES separado, cortes 6-20 22h y 21-5, por curso | Calculo local; FALTA pestaña operativa, renovacion mensual, confirmacion de dictadas y cancelaciones explicadas. Clase programada no demuestra que se dicto. |

## 5. Posteriores que tambien siguen registrados

- Calendario de Meet de otra cuenta, consulta de link de clase previa identificacion y acceso vigente: pendiente de integracion/accesos.
- Resumenes/evaluacion docente mensual y puntos debiles: acordado para despues; necesita documentos y, para medir silencios/break, tiempos en grabacion/transcripcion.
- Plataforma estudiante, consulta unica DNI/nombre de cursos/notas/pagos/deudas/modulos, cobranza/moras y certificados: fase posterior.
- Estudiantes gratuitos, conciliacion por celular/documento y certificaciones de modulo; cursos asincronicos y nuevos horarios: fase posterior, no mezclar automaticamente con matriculados regulares.

## Informacion ya proporcionada: NO volver a pedirla

Libro operativo y matriz, carpeta general, tres plantillas, beneficiario correcto, horarios/capacidad de MAINET y ANTONELLA, cinco cursos y horarios, rangos de cuotas, IGV incluido, estructura de carpetas, modulos ciclicos/ocho clases, cuatro dias de renovacion UA, cumpleaños solo asesoras y WhatsApp personal utilizado para enviar el voucher.

## Informacion que aun necesita definicion cuando se conecte cada parte

Archivos y texto definitivos de bienvenida/audio; responsable de desborde/cuentas de finanzas; lista/porcentajes de ventas; calendarios y hora de aviso; cuentas Google del equipo para compartir privadamente; protocolo para pagos parciales/cambios de documentos/correcciones de pagos ya aprobados.

El voucher enviado habilita comprobar recepcion y lectura. No autoriza al agente a aprobar el pago por el CEO ni a enviar documentos a otros estudiantes. La prueba de aprobacion se realiza con la decision del usuario.
