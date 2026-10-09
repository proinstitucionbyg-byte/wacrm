# PERMISOS Y ORDEN DEL CRM

## CIERRE DEL LOTE 09/10/2026 — ESTADO ACTUAL

Las secciones posteriores conservan el historial de trabajo. Este apartado sustituye los pendientes antiguos que ya se implementaron.

- Aplicadas seis migraciones: ventana comercial, etiquetas y traspasos, comandos, archivo del chat interno, entrega de documentos e identidad mínima del responsable.
- Ventana de dos horas renovada por cada mensaje de la asesora. Cliente y bot no renuevan. La asignación conserva IA y automatización.
- Etiquetas de acceso y de proceso separadas; catálogo con destinatarios combinables, selección múltiple y menú contextual. Servidor y RLS verifican permisos.
- Traspaso con historial completo o desde el último mensaje del estudiante. Presentación con APODO pendiente de envío.
- MANDAR(NOMBRE DEL BLOQUE) y selector de bloques activos. Identificador de envío único; el comando nunca sale como mensaje literal.
- Chat interno con ficha, cumpleaños, presencia, archivo personal/restauración, supervisión administrativa y eliminación definitiva reservada al CEO con confirmación.
- Barrido de cola de ventas y caducidad. Programador incluido en el contenedor para ejecutar las rutas existentes de automatizaciones y flujos, sin laptop ni navegador. Utiliza el secreto ya configurado; un ciclo no se solapa consigo mismo.
- Atribución comercial capturada al recibir el comprobante y protegida del JSON editable. Se escribe ASESORA DE VTAS. en Google.
- Puente Apps Script actualizado y reinstalado: ejecución completada a las 11:21 del 09/10/2026. Activador de cinco minutos reutilizado.
- PDF: subida privada a Meta y entrega de BOLETA, CRONOGRAMA y FICHA con registro independiente por documento. Un envío incierto exige revisión para evitar duplicados.
- Prueba PostgreSQL con ROLLBACK aprobada: historial restringido, renovación, caducidad, retirada de etiqueta, atribución inmutable, límites de agentes y archivo/restauración del chat interno. No dejó datos de prueba.
- Pendiente de comprobación final: despliegue de este lote y recorrido real de WhatsApp a Google/documentos. Las pruebas locales y SQL no equivalen a esa prueba real.

### DATOS QUE SIGUEN DEPENDIENDO DEL USUARIO

- El CEO configura área, cargo y porcentajes reales. No se han inventado ni activado esos valores.
- Completar APODO de cada asesora. Hay cuentas sin APODO y una sin nombre; no se asignarán chats a perfiles sin identidad. Se conserva el nombre como alternativa para los perfiles existentes.
- Imagen, audio y texto de bienvenida aplazados expresamente por el usuario. No se declara activa esa bienvenida.
- No se adjudican ventas históricas sin captura de atribución. Requieren revisión.
- Una promoción, identidad o inicio incompletos quedan pendientes de confirmación; la lectura de imagen no valida por sí sola un pago.

## DECISIONES DEL USUARIO

- El CEO configura por cuenta/correo el AREA, CARGO y PORCENTAJE. No asignar esos valores por él.
- CEO y administradores pueden administrar los permisos de los miembros.
- Separar VER PAGOS, VALIDAR PAGOS y DERIVAR COMPROBANTES.
- Ordenar la interfaz de manera consistente; los botones nuevos deben integrarse con el resto.
- Repartir ventas después de cuatro interacciones automáticas. Probar con Luis solo después de que el CEO lo configure y esté conectado.
- Etiquetas con colores, selección múltiple y menú del botón derecho, además de etiquetas automáticas de pagos/asignación.
- Atajos MANDAR(...) ejecutan bloques preparados con imagen/texto/audio; el comando literal nunca se envía al alumno.
- Traspaso de conversación con selección de historial. Dentro de la misma área, historial completo por defecto. Presentación preparada con APODO de la persona receptora, pendiente de que ella pulse ENVIAR.
- Chat interno: perfil/presencia, conversaciones y grupos archivables; recuperación y supervisión por el CEO. No confundir archivar con borrar definitivamente.

## CAMBIO REAL PREPARADO: PERMISOS OPERATIVOS

- Catálogo y RLS: migración `20261009090000_operational_permissions.sql`, aplicada en Supabase.
- API y pantalla consultan la misma función existente `has_member_permission`.
- Pagos: consultar, decidir y derivar son permisos independientes. Agentes sin acceso a Finanzas pueden derivar, pero no consultar su bandeja.
- Matrículas: consulta separada de edición. El modo consulta no ejecuta la recogida de datos ni muestra botones de guardado/envío.
- El servidor recoge datos y consulta el estado del pago después de comprobar el permiso y la cuenta; no se concede acceso a toda Finanzas a quien solo gestiona matrículas.
- Panel de permisos agrupado por módulo, con controles bloqueados mientras se guarda. CEO y administradores conservan el acceso total existente y se explica en pantalla.
- Navegación: pagos/matrículas/chat interno integrados en la misma lista, estilo y marcado de sección activa.
- Actualización de permisos al volver a la ventana y cada minuto; las restricciones del servidor y RLS se comprueban en cada operación.

## COMPROBACION REAL

- 18 pruebas dirigidas de API/permisos: aprobadas.
- TypeScript: aprobado.
- Prueba de RLS ejecutada con rol authenticated: agente sin acceso a pagos no ve filas; negar consulta de matrículas oculta las filas. Todas las excepciones de prueba se revirtieron con ROLLBACK; no se modificaron asignaciones reales.
- 830 pruebas completas aprobadas; compilación aprobada. Publicado en commit f2b051b y panel de permisos comprobado en el CRM.

## REPARTO DE VENTAS PREPARADO

- Panel integrado en AJUSTES > MIEMBROS: cada cuenta muestra AREA, CARGO, PORCENTAJE y presencia. El usuario elige todos los valores.
- Guardado en una sola transacción con versión; no permite sobreescribir cambios de otra sesión ni un equipo que cambió durante la edición.
- El cargo comercial no cambia el rol de acceso: COORDINADOR no equivale automáticamente a administrador.
- Reparto se activa solo con total 100%, destinatarios de ventas y permisos de consulta/envío del chat. Cero excluye a una cuenta.
- Se cuentan cuatro grupos de respuestas del bot desde que se activa el reparto. Imagen/texto/audio consecutivos forman un mismo turno. Al siguiente mensaje del alumno se deriva.
- Rotación ponderada, serializada por cuenta; solo candidatos conectados con heartbeat reciente. Si queda uno conectado, recibe los nuevos chats pendientes que escriban aunque los demás estén desconectados.
- Al asignar: etiqueta AREA VENTAS y ASESOR [APODO/NOMBRE]. La asignación conserva IA, automatizaciones, esperas y flujos activos. Solo habilita seguimiento por la asesora; no equivale a que haya respondido.
- Si no hay candidatos: PENDIENTE DE ASIGNACION VENTAS. Se reintenta al recibir otro mensaje. **Todavía no hay barrido periódico que reasigne pendientes sin que llegue un nuevo mensaje.**
- Simulación SQL original: antes de cuatro turnos no asigna; siguiente mensaje asigna al único agente al 100%. La pausa añadida originalmente fue un error corregido tras aclaración del usuario.
- 12 pruebas dirigidas y 842 pruebas completas aprobadas. TypeScript, lint y compilación aprobados.
- La configuración real se deja desactivada/sin porcentajes hasta que el CEO guarde sus valores.
- En la verificación publicada se detectó un bloqueo del panel: dos consumidores de usePresence reutilizaban un canal Realtime ya suscrito. Cada consumidor ahora tiene un identificador de canal propio. También se completó la etiqueta de navegación de respuestas rápidas.

### CORRECCION: ASIGNAR NO PAUSA LA AUTOMATIZACION

- El usuario aclaró que desde el quinto contacto la asesora obtiene acceso/etiquetado para seguimiento, mientras la IA y automatización continúan.
- Migración keep_sales_assignment_automation_running aplicada: asignación ya no cambia banderas de IA/automatización, no marca handoff ni cancela esperas/flujos.
- Webhook corregido: el resultado de asignar no forma parte de automationPaused; el mensaje sigue pasando por los flujos y la IA existentes.
- Asignación interna no envía al alumno el anuncio automático de que una persona continuará la atención.
- La pausa existente por una respuesta humana se mantiene separada de la asignación; no se activa por recibir una etiqueta.
- Prueba SQL real con ROLLBACK: asignado=true, IA activa=true, automatización activa=true, espera pendiente conservada, flujo activo conservado y etiqueta de ventas presente. Sin mensajes de prueba persistentes ni cambios de porcentajes reales.
- 843 pruebas completas aprobadas, TypeScript/lint/compilación aprobados. Prueba WhatsApp real sigue pendiente.

## INCIDENCIA DE CONECTIVIDAD RESUELTA

- El servidor standalone usaba el HOSTNAME del contenedor y escuchaba en una sola red.
- Desde el contenedor: 10.0.1.86:80 devolvía 200; 10.11.0.95:80 y 127.0.0.1:80 rechazaban conexión.
- Dockerfile fija HOSTNAME=0.0.0.0. Commit 507017c publicado.
- CRM volvió a abrir. La ficha de prueba muestra automáticamente nombre, DNI, nacimiento, teléfonos, dirección, curso, promoción escrita y pago real de 20.00.
- Aún falta inicio oficial y confirmar oferta/identidad para enviar esa ficha a registro. No afirmar matrícula ni entrega de documentos completadas.

## TRABAJO QUE SIGUE PENDIENTE

### REGLAS DE ETIQUETADO ACLARADAS POR EL USUARIO

- Crear y administrar el catálogo: CEO, administradores y coordinadores autorizados. Las asesoras aplican etiquetas existentes disponibles para su área; no crean el catálogo.
- Destinatarios combinables: persona concreta identificada por APODO, coordinadores, administración o área. ASHLEY permite a Ashley; ASHLEY + COORDINADORES permite a ambos. El CEO conserva supervisión global.
- Separar destinatarios/acceso al chat de estados de trabajo. SEGUIMIENTO o VENTA SEGURA son estados de ventas; RESOLUCION DE PROBLEMAS, EGRESADO o POSIBLE COBRANZA son estados de fidelización. Aplicar un estado común no concede acceso al chat a todos los miembros del área.
- Traspaso: reemplazar la etiqueta de responsable saliente por la receptora, actualizar área/responsable y conservar trazabilidad de la venta original.
- En un mismo traspaso se selecciona historial completo o acotado. Misma área: completo por defecto. Nueva asesora recibe presentación preparada con su APODO y pulsa ENVIAR.
- Cargo escrito en el perfil no concede autoridad por sí solo: capacidad de administrar etiquetas debe concederse por permisos del CEO/administrador.
- Verificación de código: TagManager administra etiquetas sin destinatarios; message-thread cambia assigned_agent_id directamente. El control de destinatarios/historial aún no está implementado; no darlo por terminado.

- Prueba WhatsApp real del reparto, después de que el CEO configure a Luis y los porcentajes desde el panel.
- Reasignar automáticamente la cola sin conexión cuando una persona vuelva a conectarse, sin esperar un nuevo mensaje.
- Etiquetado múltiple/contextual, restricciones por etiqueta y etiquetas de agente/área.
- Atajos MANDAR(...) y selector de bloques preparados.
- Traspaso con alcance de historial y presentación pendiente de envío.
- Supervisión/archivo/recuperación del chat interno y acceso por conversación.
- Revisar el resto de módulos existentes: disponer de un interruptor en el catálogo no acredita que todas las rutas y tablas históricas lo apliquen.
- Entrega de PDF por WhatsApp y bienvenida con imagen/audio: pendiente; el usuario aplazó enviar esos recursos.

## VENTANA COMERCIAL Y ATRIBUCION — LOTE LOCAL, NO PUBLICADO

- Aclaración expresa: **cada mensaje de la asesora reinicia dos horas completas**. No se aplica un umbral de 90 minutos. Cliente e IA no renuevan.
- Preparación local: `20261009151931_sales_assignment_two_hour_window.sql`. Asignación inicial abre la ventana; solo mensajes enviados por su responsable la renuevan. La intervención se registra junto con el mensaje exitoso, después de la aceptación por Meta. Un envío rechazado no cuenta.
- Caducidad: retirar asignación y su etiqueta exacta, conservar etiquetas de proceso, no reasignar inmediatamente el mismo contacto. Barrido en el cron existente y comprobación al volver a recibir mensajes. La frecuencia real del cron todavía debe verificarse antes de activarlo.
- Recibo: congelar APODO de la responsable que intervino dentro de la ventana; si no hubo intervención válida, INSTITUCION. OCR tardío, validación del CEO y cambios posteriores del apodo no deben modificar esa atribución.
- Matrícula: transmitir atribución en columna protegida separada del JSON editable; el puente escribe ASESORA DE VTAS. Los recibos históricos sin captura quedan sin atribución y requieren revisión; no adjudicarles una asesora por suposición ni bloquear por ellos los trabajos nuevos.
- Pendiente de comprobación en PostgreSQL: límites exactos de dos horas, bloqueo concurrente renovación/caducidad, retirada de etiqueta y conservación de atribución al validar. No se ha aplicado esta migración ni actualizado Apps Script en producción.
- El traspaso manual, los comandos MANDAR y las restricciones por destinatarios siguen siendo trabajo del lote: deben integrarse con esta ventana antes de dar por terminado el flujo completo.
- Publicación acumulada solicitada por el usuario: no hacer push/despliegues individuales de esta preparación.
- Comprobaciones locales del lote parcial: **847/847 pruebas aprobadas**, TypeScript sin errores, lint de archivos tocados sin errores y compilación de 67 páginas aprobada. Informe: output/verificacion/ventana-asesora-tests.json. Esto no verifica todavía la nueva migración en PostgreSQL ni el flujo WhatsApp en producción.
