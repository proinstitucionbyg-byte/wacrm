# Bot multicanal: primera etapa local

## Estado real

### Corte de verificación 29/10/2026 — puente CRM

Las rutas P060/P061 ya enlazan el texto entrante al despachador común de Flows/automatizaciones/ventas/soporte, y la salida automática y manual de texto usa en código la cola de la línea de origen. Se reparó el test de ingreso que conservaba el mock anterior al despachador. Verificado localmente en este corte: **25/25 pruebas Vitest**, **13/13 pruebas SQL/PGlite** (migraciones de entrada y salida en PostgreSQL temporal) y **77/77 pruebas del ejecutor**.

La cola base, el puente de ingreso y la cola de salida están aplicados en Supabase (`20261029151921`, `20261029151930`, `20261029151956`). El worker privado y la línea `WA-bot-2` están configurados y habilitados. Verificación viva: `ready`, `CONNECTED`, sin QR y `repliesEnabled=true`; las rutas remotas están activas y la línea no está pausada. No se enviaron mensajes de prueba ni hay entradas reales aún, así que falta confirmar el recorrido entrada → automatización → respuesta con un mensaje propio. Medios, botones/plantillas y los hilos grupales dentro de Inbox siguen pendientes.

### El recorrido, explicado simple

1. El estudiante escribe al número que se eligió.
2. El bot manda el texto al WACRM, y el WACRM busca el Flow o la automatización que ya existe. No hay que volver a crear las ramas.
3. Si la regla dice responder, WACRM deja la respuesta en la cola de ese mismo número.
4. El ejecutor del teléfono la envía. Si una asesora toma el chat, las respuestas automáticas se pausan.

Los pasos 2 y 3 están conectados al CRM y el paso 4 está habilitado para texto en la línea vinculada. Falta observar una entrada real para comprobar la respuesta completa; no se enviará una prueba a estudiantes. Los archivos adjuntos y Gmail requieren sus propias conexiones de canal.

### Actualización local 29/10 — respuesta manual y despacho al motor CRM

El panel del ejecutor mantiene el compositor local para chats y grupos ya cargados; exige el token local y guarda sus intentos sin reenvío ciego. Separadamente, la respuesta manual de texto del Inbox quedó conectada a la cola de la línea WhatsApp Web de origen y pausa los motores CRM. La pestaña del ejecutor se reinició con el perfil guardado, sin QR. No se envió ningún mensaje real ni se crearon entradas de prueba.

Decisión confirmada por el propietario: mantener ventas, soporte, Flows y automatizaciones en el CRM como fuente única. WhatsApp Web llama los mismos motores del webhook y usa la cola/transporte de su número como salida; no duplica reglas. **Actualización 29/10:** se extrajo el despacho común en `src/lib/whatsapp/inbound-dispatch.ts` y se conectó tanto al webhook Cloud como a la ruta de ingreso de sesión. Los textos ingresan por los mismos filtros, Flows, automatizaciones, asignación, soporte docente, pausa humana y respuesta IA. La respuesta manual de texto desde el Inbox también queda en la cola de su línea, se guarda como mensaje de asesora y pausa los motores CRM; su acceso se verifica al encolar y de nuevo al autorizar el envío. Chats y grupos que solo existen dentro del panel local no aparecen como hilos grupales del Inbox. Una conversación nueva de sesión habilita los motores configurados, pero una primera entrada sin palabra reconocida se pausa y deriva a una persona; pausas existentes permanecen apagadas. Pasaron 134 pruebas Vitest relacionadas, 7 SQL/PGlite y el build completo con 95 páginas. El typecheck independiente sigue mostrando errores previos en pruebas y auxiliares ajenos. Migraciones y flags siguen apagados, por lo que esto es código local verificado, no respuesta operativa en el teléfono. Medios, botones y listas siguen pendientes.

### P062 — selector explícito de canal de simulación

La pantalla del bot ahora permite preparar un lote de prueba como SMS o WhatsApp de soporte. Si el origen es COMUNICACIONES, la fila debe declarar el mismo canal seleccionado; un valor distinto o ambiguo se bloquea antes de generar trabajos. El canal escogido se conserva en cada fila de la vista previa y al registrar la línea TEST. Esto continúa siendo una simulación, sin leer ni modificar hojas, activar workers ni enviar mensajes. La automatización CRM existente sigue siendo el editor de ramas y secuencias; no se crea una copia. Pasaron 48 pruebas del preview/puente/rutas y el build generó 95 páginas. Pendiente: selección de canales y números reales con sus capacidades, y segmentación SMS.

### Requisito corregido por el propietario — P069

El bot debe poder conectarse al número propio que el propietario elija, de WhatsApp Business o WhatsApp normal, para recibir y responder. **No solicitó coexistencia con Cloud API**. Se construyó el adaptador local por sesión descrito abajo; todavía no se ha demostrado funcionamiento físico con ambas aplicaciones. Conservar aislamiento de sesiones/números, estado de conexión y pausa del bot durante atención humana. No modificar la línea comercial API existente para intentar cumplir este requisito.

El trabajo anterior de coexistencia queda conservado y desactivado como exploración de otra vía: no cierra P069 ni condiciona la construcción del bot a una incorporación oficial de coexistencia.

### Adaptador por sesión: QR real y recepción local — P069 parcial

**Continuación de varias líneas:** administrador y bandeja local rediseñada construidos; Principal (`WA-bot-2`) conectada y Soporte preparada detenida. Registro privado, conexión/detención conservando perfil, lectores aislados, búsqueda y filtro Grupos. Límite inicial 3 sesiones abiertas/20 registros; no es carga física comprobada. Verificación actual: `ready`, `CONNECTED`, sin QR y respuestas habilitadas. Revisión visual del rediseño sigue pendiente; no se vinculó otro teléfono. Las ramas de ventas/soporte reutilizan el motor existente; P060/P061 están activos para texto, falta comprobar una entrada real.

**Vista comprobada anteriormente:** el panel lista conversaciones existentes (275 en la sesión real) y abre hasta 40 mensajes ya cargados por chat. Imágenes/archivos aparecen como avisos o descripción; no descarga medios. La lectura manual de ese historial no importa conversaciones antiguas al CRM ni dispara automatizaciones; los mensajes entrantes nuevos sí tienen el puente local descrito en P060. `start.ps1` inicia el ejecutor en segundo plano y conserva el perfil; falta arranque/supervisión de Windows. Acta: `auditoria/VISTA_WHATSAPP_2026-10-28.md`.

**Actualización posterior:** se confirmó un vínculo real (`CONNECTED`, identidad propia e integración cargada) y su recuperación al reiniciar el mismo perfil sin nuevo escaneo. El corte inicial solo confirmaba recepción local. En el corte vivo actual de arriba también se activaron la entrada CRM y la cola de respuesta de texto; falta un mensaje propio para comprobar el recorrido real. El panel consulta estado vivo y no confunde QR tardíos con desconexión. ETag/304 evita borrar/redibujar el mismo QR cada tres segundos. Las pruebas más recientes del ejecutor son 77/77. No se modificó la API Cloud existente.

Implementado en `scripts/multichannel/whatsapp-session/` con dependencias propias fijadas, sin modificar las del CRM. `store.mjs` conserva identidad y diario, `adapter.mjs` recibe eventos y contiene el transporte condicionado a permiso, `navigation-client.mjs` controla interrupciones iniciales de página, `panel.mjs` sirve el QR de forma privada y `cli.mjs` conecta/detiene el ejecutor. `inspect.mjs` consulta solo salud y disponibilidad del QR, sin mostrar números ni mensajes.

**Corte QR inicial (histórico, anterior al vínculo confirmado):** se verificó generación de QR real y SVG, estado `awaiting_qr` y visualización en navegador. Ese corte no tenía un número vinculado y mostraba «Solo recepción. El bot todavía no responde». Luego el propietario vinculó un número; el estado actual se documenta arriba. No usar este registro histórico para describir la conexión actual.

### P060 — recepción central y despacho CRM activados para texto

Se aplicó `20261029151930_whatsapp_session_inbound_bridge.sql`: enlace de línea/worker pausado, recibos idempotentes, procedencia por línea, marca de primer mensaje y fecha previa. `POST /api/multichannel/whatsapp/control` permite a un owner registrar worker/línea y pausar; `POST /api/multichannel/whatsapp/inbound` acepta eventos solo con token de worker y deriva la cuenta desde su hash. La RPC guarda contacto/conversación/mensaje en una transacción, separa cada mensaje por línea y no rellena evidencia de facturación Meta. La nueva ruta consulta el recibo y llama el mismo `dispatchInboundThroughCrm` que el webhook. Los chats nuevos habilitan motores CRM; primera entrada desconocida se pausa para atención humana, y configuraciones existentes se preservan. El ejecutor local reintenta eventos cuyo acuse central se perdió; Flows y automatizaciones conservan sus claves de deduplicación.

`MULTICHANNEL_WHATSAPP_SESSION_BRIDGE_ENABLED=true` está activo para el worker enlazado a `WA-bot-2`; la recepción real en Inbox todavía requiere observar una entrada propia. Los chats `@lid` requieren resolver el teléfono y quedan en revisión, sin inventarlo. Si llega un adjunto sin sus bytes, la historia muestra un aviso; todavía no se sincronizan medios. La burbuja del Inbox muestra el identificador de línea cuando el mensaje contiene ese dato. El filtro «Unassigned» y el control de asignación respetan la visibilidad RLS actual.

Comprobación de código anterior: 122 pruebas Vitest del contrato del evento, despacho compartido, transporte, motores existentes y exportación comercial pasaron; las 6 pruebas SQL/PGlite también. El build generó 95 páginas con exit 0. El corte vivo actual de publicación y configuración se describe en «Estado real» al inicio.

### P061 — cola de respuestas y ejecutor local; motor común conectado en código

El motor actual y sus ramas de ventas/soporte ya comparten el límite de texto que detecta la línea de origen y encola la respuesta en esa sesión. Se conserva la guardia que impide responder por Meta Cloud desde una conversación de WhatsApp Web. La cola servidor→ejecutor y el sondeador del worker validan línea, conversación, último mensaje entrante, texto y pausa humana antes de permitir el envío; deduplican, guardan el resultado y mandan a revisión un envío incierto sin repetirlo. Un segundo sondeador no puede reclamar una tarea activa. Al aceptar WhatsApp, el mensaje del Inbox recibe el ID real del proveedor.

El CLI mantiene la salida apagada por defecto para líneas sin configurar; la línea elegida declara expresamente `crmOutbound.enabled=true` y el servidor tiene `MULTICHANNEL_WHATSAPP_SESSION_SEND_ENABLED=true`. Las migraciones P060/P061 están aplicadas y las rutas publicadas. El ingreso usa el mismo orden de Flows, automatizaciones, ventas/soporte, pausas humanas y fallback IA que Cloud. La respuesta manual del Inbox también se guarda y encola con autoría de asesora y pausa humana. Verificación: 19 pruebas Vitest CRM, 13 SQL/PGlite y 77 del ejecutor aprobadas; panel `ready`, `CONNECTED`, `repliesEnabled=true`. **Pendiente:** observar una respuesta real desde un mensaje propio. Grupos del panel, medios, plantillas e interacción aún no tienen salida desde Inbox.

Sesiones privadas y dependencias están excluidas de Git. Los tokens y QR no se guardan en documentación. El QR debe escanearlo el propietario desde el teléfono elegido; no existe vinculación automática. Los perfiles originales de diagnóstico se conservaron; no borrar historial ante fallos. Instrucciones completas y límites en `scripts/multichannel/whatsapp-session/README.md`.

### Exploración anterior de API: comprobación y ecos — no equivale al bot solicitado

Consulta **solo lectura del 28/10/2026 14:05 Lima**: Meta devolvió `is_on_biz_app=false` y `platform_type=CLOUD_API` para la configuración actual. Hay conexión API; no coexistencia con la aplicación del celular. No se cambió el número ni se enviaron mensajes.

Se agregó un verificador privado del propietario (`GET /api/whatsapp/business-app-status`) y el inspector `scripts/multichannel/inspect-whatsapp-business.mjs`. Solo consultan los campos oficiales; datos ausentes/error quedan como desconocidos y no exponen token, número ni payload de Meta. El endpoint usa v26.0 para esta consulta, sin cambiar las funciones de envío existentes.

El webhook firmado reconoce `smb_message_echoes` mediante `business-app-echo.ts`. La migración local **sin aplicar** `20261028191121_whatsapp_business_app_echoes.sql` registra el eco como respuesta de agente con origen `business_app`, empleado desconocido y facturación desconocida. No incrementa no leídos, genera entrada de cliente, amplía ventana gratuita, dispara automatizaciones ni asigna comisiones. Detiene IA, automatizaciones pendientes y flujos conservando su posición. Un duplicado no vuelve a pausar una reanudación posterior. La operación es transaccional y verifica cuenta, WABA y número; un mensaje antiguo no sustituye una vista previa más reciente. El origen solo puede escribirlo el servidor.

`WHATSAPP_BUSINESS_APP_ECHOES_ENABLED` queda **desactivado por defecto**. Esto todavía no activa el bot del celular. Falta el proceso oficial de vinculación humana, comprobar requisitos de proveedor/Embedded Signup y versión vigente, suscribir los eventos necesarios y realizar una prueba expresamente autorizada. El historial antiguo, sincronización de contactos, recuperación durable de fallos de webhook y descarga de archivos de ecos no están resueltos por este bloque: los medios se representan con tipo/caption, sin inventar URL. El webhook mantiene el mecanismo existente de procesamiento posterior al acuse; no garantiza recuperar un fallo posterior. No habilitar el indicador con la migración pendiente.

La app y Cloud API tienen reglas de cobro distintas. Las respuestas automáticas del CRM siguen pasando por sus controles vigentes de costo y atención humana. Los mensajes enviados por la app no abren la ventana de respuesta de la API. No se incorporan números nuevos ni se reemplaza la línea comercial.

Fuente oficial consultada: [Meta: incorporación de usuarios de la aplicación y coexistencia](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users), incluidos `is_on_biz_app` y `smb_message_echoes`. La vinculación real queda pendiente; no afirmar que WhatsApp Business normal ya responde como bot.

Comprobaciones del bloque: **58 pruebas distintas aprobadas**, incluidas 26 nuevas (14 de estado/payload/registro, cinco de acceso al verificador y siete de SQL real en PostgreSQL temporal). Las restantes verifican firma, estados de entrega, ventanas/costos, resolución del chat y envío existente con servicios simulados. TypeScript del alcance y ESLint aprobados; `npm run build` exit 0, 92 páginas. El comando general `npm run typecheck -- --incremental false` sigue fallando en archivos previos de pruebas de `output/` y de otros bloques (`course-detour`, `paid-intake-handoff`, `workbook-sync`); no se declara aprobado ese comando ni se modificaron esos archivos para esconder el resultado. No hubo envío real, publicación, migración aplicada ni cambio de configuración.

### Servidor y ejecutor SMS construidos localmente — P058

La fase posterior ya conecta en código la cola y el transporte: `sms-protocol.ts`, `/api/multichannel/sms/control`, `/api/multichannel/sms/worker`, `smsgate-queue-client.mjs` y `smsgate-worker.mjs`. La migración `20261028173948_multichannel_sms_dispatch.sql`, creada con CLI, extiende **multichannel_jobs existente**, sin otra cola. No está aplicada ni publicada. `MULTICHANNEL_SMS_ENABLED=true` es un interruptor separado y deshabilitado por defecto; no se cambió ninguna configuración real. El panel visible anterior continúa siendo una maqueta de simulación.

El propietario puede registrar/revocar laptops, configurar una línea SMS y sus bindings, pausarla, marcar disponibilidad, registrar/revocar un permiso con contacto/destino internacional explícito/finalidad/vigencia/evidencia y encolar un aviso. Actor y cuenta proceden de la sesión y vuelven a comprobarse en SQL. El teléfono se contrasta con el contacto vigente; no se inventa prefijo. El destinatario del trabajo se deriva del permiso vigente, nunca de un campo que envíe el preparador. Se conserva el historial de altas/revocaciones del permiso.

Una línea nueva nace pausada/no disponible. Requiere intervalo entre intentos, límite diario y nota de configuración explícitos del propietario: no se heredan límites de simulación ni se considera aprobado el uso por la operadora solo por configurarlos. La salud reportada mediante credencial de laptop vence a los 45 segundos y se comprueba por laptop/línea, no se presta entre ejecutores. El cliente consulta `/health` y solo reporta listo ante `status=pass`. Fallo/ausencia de confirmación impide reservar.

Avisos y soporte revalidan permiso/vigencia, cuenta/contacto/teléfono, disponibilidad/pausas, intervención humana y límites antes de reservar/iniciar y después de iniciar. Los intentos iniciados, incluso inciertos, cuentan conservadoramente contra límites; el día se calcula en Lima. El trabajo queda deduplicado por cuenta/clave y su identidad no se puede cambiar después de crearlo. El modo simulación no puede reservar o completar trabajos SMS reales.

El servidor conserva ID del proveedor, estado y reserva de forma atómica. HTTP 202 es accepted, no delivered. Accepted/sent se consultan después; los inciertos solo se concilian. No se vuelve a emitir POST por perder respuesta, vencer la reserva o cambiar de laptop. Otra laptop autorizada para el mismo dispositivo puede consultar el ID central sin diario compartido: solo GET y verificación de ID/dispositivo. Un estado sent confirmado no retrocede a accepted por una lectura posterior. No hay arranque automático ni CLI que habilite envíos: `createSmsGateWorker` se construye deshabilitado por defecto y ejecuta una vuelta solo por llamada explícita.

**Límite de esta fase:** no hay envío físico nuevo ni instalación/configuración en producción. Cobranza se rechaza en API/SQL; no existe saldo conciliado conectado que permita autorizarla. El consentimiento de COMUNICACIONES no se importó automáticamente a este registro. Recepción en Inbox, respuestas y derivación multicanal, panel operativo y supervisión automática siguen en sus propios pendientes. P058 permanece abierto hasta la aplicación/publicación/configuración y comprobación física específicamente autorizadas.

Comprobaciones de esta fase: 76 pruebas Vitest multicanal; 17 SQL SMS con PostgreSQL temporal, ocho de cliente/ejecutor, 31 de enlace/lector/transporte y 18 de la cola anterior. Total 150 pruebas distintas. Prueba integrada de cliente HTTP → SQL → ejecutor → transporte con red simulada y recuperación por otro worker sin otro POST; no sustituye varias conexiones SQL/laptops físicas ni recepción humana. TypeScript focalizado, ESLint y `npm run build` (exit 0, 91 páginas) aprobados. Se conserva prioridad/antigüedad de la cola para evitar postergar indefinidamente los trabajos antiguos.

### Corte anterior de P058: solo el módulo de enlace (histórico)

Se añadió `scripts/multichannel/smsgate-queue-bridge.mjs`. Es una función de orquestación, sin CLI ni ejecución automática y deshabilitada por defecto. Usa el transporte SMSGate existente y exige adaptadores explícitos de cola (`claim`, `start`, `recordResult`) y revalidación autorizada. Comprueba cuenta/laptop/línea/dispositivo/reserva, inmoviliza texto/destinatario y vuelve a validar después de iniciar. Pausa, atención humana, deuda resuelta, permiso viejo o dispositivo no disponible impiden llamar al transporte. Inciertos/guardados fallidos se concilian sin repetir POST; 202 sigue siendo aceptado, no entregado. Se fijó la identidad del dispositivo en el transporte para evitar cambios por mutación del objeto de configuración.

**Todavía falta la conexión real del servidor:** el contrato `sms_live` del módulo no está soportado por la ruta actual, que conserva solo simulación. No hay adaptador HTTP nuevo, ni migración aplicada, ni fuente vigente de permiso/deuda conectada. No tomar un campo de la hoja o una marca de simulación como autorización. El módulo solo se ejercitó con cola de contrato ficticia y transporte de código con red simulada: 31 pruebas offline del bloque, 16 del enlace. No es prueba SQL de integración ni envío físico. P058 permanece EN CURSO LOCAL en `PENDIENTES_UNICOS_WACRM.md`.

### Continuación del 28/10/2026: controles de líneas, solo locales

La cola existente ahora comprueba un registro de líneas antes de reservar y antes de iniciar. Una línea nueva nace pausada y no disponible. Registrar de nuevo conserva sus estados; cambiar disponibilidad no reanuda una pausa. Cuenta y canal deben coincidir con el trabajo. Si se pausa después de reservar y antes de iniciar, el trabajo vuelve a pendiente sin simularse; si el intento ya comenzó, se conserva su resultado. `needs_review` sigue sin reintento automático.

Se amplió la migración `20261029151921_multichannel_worker_queue.sql`, sin crear otra cola; quedó aplicada en producción el 29/10. La consulta anterior del 28/10 confirmó que las tablas todavía no existían. Los controles de línea y los pasos del worker comparten el bloqueo breve por cuenta; solamente el backend puede invocarlos. La API deriva la cuenta de la sesión del propietario. Simulación continúa deshabilitada por defecto y solo acepta TEST-.

`GET /api/multichannel/control` incluye las primeras cien líneas. Acciones POST del propietario:

```json
{"action":"register_line","line_key":"TEST-linea-1","channel":"sms"}
{"action":"set_line_availability","line_key":"TEST-linea-1","value":true}
{"action":"pause_line","line_key":"TEST-linea-1","value":false}
```

En un entorno de prueba configurado, registrar la línea antes de simular los trabajos de los ejemplos de este documento. Guardar un trabajo no registra ni habilita su línea: puede permanecer pendiente hasta que esté disponible y reanudada. El panel permite esos cambios, con disponibilidad de prueba expresamente manual: **no es una consulta de salud al celular**. No hay transporte real nuevo, respuesta automática, cobro conciliado ni permisos de alumnos revalidados por esta etapa.

Comprobación: 18 pruebas SQL en PostgreSQL en memoria, 63 pruebas multicanal, 15 del lector/transporte SMSGate offline, tipos y ESLint. Una función auxiliar de `central-campaign.test.ts` ahora admite campos opcionales, corrigiendo un error de tipos anterior sin cambiar el producto. Prueba visual con línea ficticia: registrar → disponible conservando pausa → reanudar → pausar → registrar de nuevo conservando pausa. Captura: `output/multichannel-ui/line-controls-2026-10-28.png`. No sustituye una prueba con varias conexiones SQL reales ni una línea física.

La maqueta sigue respondiendo 503 al control por defecto. Para probar solo controles ficticios en memoria, usar `WACRM_LINE_UI_FIXTURE=true`; `WACRM_UI_PREVIEW_PORT` permite elegir un puerto libre (predeterminado 3188). Este modo tampoco guarda campañas y pierde sus datos ficticios al cerrar el proceso. Los dos servidores creados en esta continuación se cerraron; se conservó el proceso preexistente de 3188.

Resultado detallado y compilación general en `docs/auditoria/CONTINUACION_URGENTES_BOT_2026-10-28.md`. Próximo paso: conectar SMSGate a esta reserva con capacidades por laptop/línea, revalidación real de permisos y pagos, estados de aceptación/envío/entrega y conciliación sin reenvíos. No habilitar envíos para probar este panel.

Se construyó la cola y el cliente de simulación. No es todavía un bot conectado al celular. No envía SMS, no abre WhatsApp normal, no usa la API de Meta ni OpenAI y no está publicado. No se modificaron los contenidos ni los flujos comerciales actuales. La migración no se aplicó a producción.

Confirmación posterior del usuario: dispositivos Android, una línea Claro y dos Entel. Se identificó un Huawei P Smart 2019 POT-LX3 con Entel; su número está en el inventario privado local, excluido de Git. Versión Android y conexión pendientes. No se activaron líneas ni se modificó ningún celular.

### Actualización comprobada del 26/10/2026

El párrafo anterior describe el corte de simulación, no la configuración posterior de teléfonos. El propietario instaló SMSGate 1.77.4 en un Samsung Galaxy J6+ con Android 10 y arrancó su servidor local. La laptop consultó `/health`: HTTP 200, Wi-Fi disponible y advertencia de batería al 10 %, cargando. Después de una consulta rechazada con HTTP 401 por la clave interpretada de la foto, el propietario proporcionó la clave exacta; quedó guardada cifrada para el usuario de Windows y la autenticación funcionó. Se ejecutó una prueba independiente de la cola: un POST por cada uno de los dos destinos autorizados, ambos HTTP 202; una consulta posterior por sus identificadores confirmó `Sent` para ambos. No equivale a `Delivered` ni confirma recepción humana. No hubo reintentos de envío. El script conserva un registro previo al POST y no repite intentos existentes. Los números, identificadores, credenciales y respuestas permanecen únicamente en el directorio privado, fuera de Git. La aplicación reporta fechas del día 25 mientras la fecha del cliente es 26/10/2026: revisar el reloj del teléfono antes de programar campañas. La cola general sigue siendo de simulación; esta prueba puntual no la habilitó para envíos reales.

SMSGate es un proyecto externo (`capcom6/android-sms-gateway`); no es una aplicación desarrollada por WACRM. Su conexión física no equivale a haber integrado la cola, confirmado entregas ni implementado respuestas automáticas.

Prueba de retorno: el propietario confirmó recibir el SMS en uno de los teléfonos y contestó `Ok`. La consulta local logró leer esa respuesta del destinatario autorizado: tipo `MMS_DOWNLOADED`. El filtro inicial `type=SMS` la excluía; la lectura del conector deberá admitir los tipos soportados y distinguir SMS de MMS sin descargar adjuntos por defecto. Se conserva únicamente la respuesta autorizada en el directorio privado. Los identificadores MMS pueden repetirse entre dispositivos: no deduplicar por el ID del mensaje sin la identidad del dispositivo. El reloj del equipo y los estados del proveedor se conservarán como datos separados. Esta comprobación acredita envío y lectura de respuesta en la prueba puntual, no integración con el CRM ni respuesta automática. No hubo nuevos envíos después de los dos autorizados.

Lector reutilizable añadido en `scripts/multichannel/smsgate-reader.mjs`: exclusivamente GET, conexión a dirección local explícita, sin redirecciones ni adjuntos, fechas y remitentes autorizados obligatorios, paginación y claves de identidad por dispositivo/tipo/ID/remitente/fecha. Acepta texto SMS y MMS descargado; no trata un aviso de MMS como respuesta. Nueve pruebas offline aprobadas (`node --test scripts/multichannel/smsgate-reader.test.mjs`) y una lectura real posterior con la credencial cifrada recuperó el mismo OK sin nuevos envíos. No activa la cola, respuestas automáticas ni campañas reales. Prueba privada en `output/multichannel-private/install/reader-live-verification.json`.

Inventario solicitado: preparar hasta cuatro celulares; los números se pueden completar al activar las líneas, no son requisito para copiar el APK o comprobar instalación. Solo el Samsung de prueba tiene conexión y envío comprobados. El Huawei P Smart 2019 POT-LX3, Entel, EMUI 12, fue detectado por USB pero Windows mostró que seguía conectándose sin acceso al almacenamiento. Android aún no está confirmado por las fotos; EMUI 12 no se considera Android 12. No instalar HiSuite ni habilitar depuración USB para resolver esta copia. Mantener envíos deshabilitados en equipos sin prueba terminada. El objetivo de diez o veinte mil alumnos es una meta de capacidad futura, no una capacidad probada ni un volumen autorizado por la operadora.

## Diseño central solicitado: una sola gestión multicanal

Requisito confirmado por el propietario el 26/10/2026. Esta sección describe la ampliación acordada; no declara estas funciones implementadas.

- Un solo panel para listas, segmentos, plantillas, secuencias, calendarios, programación, pausas e historial. SMS, WhatsApp, correo y el futuro chat web serán conexiones de ese mismo sistema, no paneles independientes.
- Cada campaña tendrá finalidad, audiencia, canal o combinación explícita de canales, cuenta/línea remitente, zona horaria de Lima, inicio, vencimiento e intervalos entre destinatarios.
- Cada secuencia podrá contener bloques ordenados y esperas entre bloques en segundos, minutos u horas. La espera entre destinatarios es distinta de la espera entre bloques de una conversación.
- El editor mostrará únicamente capacidades reales de la conexión elegida: SMS con texto/enlace y cálculo de segmentos; imágenes, audio, documentos y botones solo cuando el canal y su transporte lo admitan. No convertir SMS en MMS ni cambiar a otro canal con costo sin una decisión explícita.
- Los calendarios de cursos, pagos y eventos deberán alimentar las fechas de los recordatorios. Se podrán editar, añadir, retirar o pausar pasos. Las modificaciones afectarán pendientes según una regla visible, manteniendo la versión e historial de lo ya enviado y sin reiniciar secuencias en marcha.
- Antes de cada ejecución se revalidarán las condiciones vigentes: pago resuelto, pausa, intervención humana, permisos de contacto, vencimiento y límites propios del canal. Un pago resuelto excluirá recordatorios futuros de cobranza; no modificará la validación humana del pago.
- Recepción, respuesta automática y derivación a asesores utilizarán el mismo contacto e historial. La inteligencia de respuesta y las reglas serán independientes del transporte que entrega el mensaje.
- Una cola central coordinará las computadoras ejecutoras para reservar trabajos y líneas, mantener orden y evitar envíos simultáneos de la misma secuencia. Los resultados inciertos requerirán conciliación; no se reenviarán automáticamente.
- El funcionamiento programado no dependerá de este chat de Codex. Requerirá que el servicio ejecutor y el dispositivo/conector correspondiente estén disponibles.

### Qué está hecho y qué no

- **WhatsApp elegido por el propietario:** hay un ejecutor local por número y una ruta de ingreso al CRM. En código, los mensajes de texto entran al mismo motor de Flows/automatizaciones y las respuestas automáticas y manuales se guardan en la cola de esa línea. Falta activar las dos migraciones y credenciales; aún no está contestando desde el teléfono en producción.
- **Ramas:** el CRM ya tiene editor de pasos, decisiones Sí/No, esperas, campos, envío de texto/medios, botones/listas y derivación. WhatsApp Web de sesión reutiliza los motores existentes; no se duplican ramas.
- **SMS y campañas:** el ejecutor SMS ya se probó por separado en local, pero campañas y programación siguen en simulación hasta enlazar su fuente, permisos y transportes reales.
- **Gmail:** es técnicamente viable usar Gmail API para enviar y leer respuestas con autorización OAuth. No hay aún conector, remitente autorizado, cola ni conversación de Gmail en WACRM. `gmail.send` permite envío; leer correos requiere permisos más amplios y revisión OAuth adicional. Se construirá como otro transporte del mismo sistema, no fingiendo que el correo sale por WhatsApp.
- **Archivos:** la sesión de WhatsApp todavía no descarga los bytes de audio/PDF/imagen al almacenamiento del CRM. Hasta completar ese puente, el Inbox puede mostrar que llegó un archivo, pero no analizarlo ni enviarlo de vuelta desde esa sesión.
- **Grupos:** el ejecutor local puede escribir manualmente a un grupo ya existente. Los grupos todavía no son conversaciones del Inbox, así que reglas CRM y campañas no pueden dirigir allí como si fuera un chat individual.

No se crean envíos reales ni conexiones de Gmail con una cuenta ajena sin autorización explícita del propietario. La simulación permanece separada de los canales reales.

### Enrutamiento y soporte académico acordados el 26/10/2026

Requisitos de diseño pendientes de implementación, no capacidades ya publicadas:

- Una bandeja de WACRM reunirá contactos e historial, mostrando siempre canal y número remitente. Las respuestas saldrán por la conexión elegida; la ubicación visual dentro del CRM no determina su costo.
- Los leads publicitarios elegibles seguirán sus automatizaciones comerciales por la conexión oficial existente, respetando las reglas y ventanas comprobadas. No asumir gratuidad ilimitada solo por tener origen publicitario.
- Para estudiantes identificados en la base académica se podrá asignar soporte por un número configurado. Antes de iniciar desde un número diferente, comprobar continuidad y autorización de contacto, responsable y si ya existe una atención abierta. No trasladar ni presentar como trasladado el hilo de WhatsApp entre números: se vincula el historial interno del estudiante.
- Configurar uno o varios números de soporte con disponibilidad y responsable. Una conversación tendrá un responsable activo y se evitarán respuestas simultáneas del bot y una asesora. Un número de respaldo no se utilizará para eludir bloqueos ni duplicar mensajes inciertos.
- Si una consulta de ventas llega a soporte, aplicar la clasificación comercial y el flujo permitido en esa conexión; no exigir que sea estudiante matriculado para recibir información de cursos.
- Priorizar respuestas por reglas y materiales definidos. IA opcional, con presupuesto explícito. Si no se resuelve, crear un caso, asignar Fidelización o Ventas, conservar el resumen mínimo y pausar la respuesta automática durante la atención humana.
- El caso tendrá aceptación por parte de la asesora, plazo, alerta de falta de aceptación y cierre. Preferir notificaciones internas del CRM. El aviso a un WhatsApp personal será opcional, dirigido a una asesora autorizada y por una conexión realmente disponible, sin incluir documentos privados por defecto.
- El futuro chat web tendrá recepción y respuesta en WACRM. Podrá implantarse antes del portal académico completo. Reutilizar la lógica de automatizaciones con adaptadores de canal; el motor actual no se vuelve multicanal solo por registrar un nuevo contacto.
- Gmail tendrá conexión OAuth autorizada, remitente, plantillas, adjuntos, programación, límites, respuestas e historial. El envío se puede hacer con Gmail API, pero requiere un proyecto OAuth y la aprobación del dueño de la cuenta. `gmail.send` es un permiso sensible; para leer respuestas se requieren permisos restringidos como `gmail.readonly`, que pueden exigir verificación y evaluación de seguridad si la aplicación guarda o transmite esos datos. Las cuotas cambian y Google indica un umbral diario de uso de API sujeto a facturación que se actualizará más adelante en 2026; no prometer correo masivo ilimitado.
- WhatsApp Business normal no ofrece la misma conexión oficial para bots complejos que la plataforma. Una implementación externa requiere evaluar estabilidad y condiciones; no prometer automatización ilimitada, gratuidad absoluta ni ausencia de bloqueos.

Referencias consultadas: https://whatsappbusiness.com/resources/faq/ ; https://faq.whatsapp.com/361005896189245/ ; https://developers.google.com/workspace/gmail/api/guides/sending ; https://developers.google.com/workspace/gmail/api/auth/scopes ; https://developers.google.com/workspace/gmail/api/reference/quota ; https://support.google.com/mail/answer/22839 . El FAQ de Meta incluye el cambio de servicio desde el 01/10/2026; otros textos de marketing aún pueden describir el régimen previo. Verificar la clasificación real de entrega y facturación de la cuenta antes de cambiar controles económicos.

## Pantalla de gestión local

Ruta `/multichannel`, con acceso de propietario y entrada “Bot multicanal · prueba” en el menú. Ya está implementada y compila; todavía no publicada.

1. Cargar el ejemplo ficticio o pegar hasta 5.000 filas en cinco columnas desde Excel: ID, Destino, Nombre, Permiso y Pago. Cada guardado sigue limitado a 500 trabajos.
2. Elegir finalidad, fechas de Lima, texto y límite. “Ajustes de simulación” despliega intervalo y versión.
3. Pulsar “Revisar destinatarios”. Se muestra motivo de cada bloqueo, repetido o destinatario listo. Cambiar cualquier campo elimina esa revisión; hay que revisarlo nuevamente antes de guardar.
4. “Guardar solo los listos…” usa la cola de prueba. Si falta configurar la base, aparece el aviso y conserva el formulario. No significa que haya enviado SMS.
5. “Consultar pendientes e historial” muestra los últimos cien trabajos. Actualización manual, sin refrescar automáticamente la página.

Las llamadas tienen un límite de espera de 15 segundos. Si se pierde la respuesta de guardado, revisar la cola antes de repetir; la clave estable evita volver a registrar el mismo trabajo.

Prueba visual separada: `node scripts/multichannel/ui-preview-server.mjs` abre un servidor local en 127.0.0.1:3188, con el componente real y preparación ficticia. No usa sesiones ni base real; el guardado devuelve siempre 503 para comprobar el aviso. No confundir esta vista con una instalación publicada. Cerrar ese proceso al terminar la revisión.

## Preparación de campañas añadida

`POST /api/multichannel/preview`, solo para el propietario, revisa listas de hasta 5.000 destinatarios en lotes de hasta 500. Funciona sin habilitar workers y sin guardar nada. Devuelve resumen, filas con motivos y trabajos de simulación listos para revisar.

Ampliación posterior: identificador de línea TEST- editable, sin límite fijo de tres líneas; vista previa de 50 filas por página. Después de confirmar el guardado del lote se puede preparar el siguiente, conservando solo diferidos y avanzando su horario. Vuelve a exigir revisión; no activa automáticamente todos los lotes ni teléfonos reales.

- Detecta IDs/destinos repetidos dentro de la lista.
- Personaliza `{{variable}}` con los valores del destinatario; bloquea variables faltantes o texto inválido.
- En cobranza exige estado `pending`; excluye pagos `resolved` y bloquea estado `unknown`. Son datos recibidos por el preparador; todavía no consulta ni certifica los pagos de las hojas o del CRM.
- Exige permiso confirmado. Los teléfonos reales quedan bloqueados mientras no exista transporte conectado.
- Distribuye los trabajos por intervalos, respeta el límite del lote y su vencimiento. El intervalo predeterminado de 20 segundos es de simulación; no es un límite aprobado por Claro, Entel o WhatsApp.
- Devuelve `enqueued:false`: previsualizar no guarda ni envía.

Ejemplo de preparación con datos ficticios:

```json
{
  "campaign_id": "campana-prueba-1",
  "version": 1,
  "purpose": "collection",
  "line_key": "TEST-linea-1",
  "template": "Hola {{nombre}}, revisa {{enlace}}.",
  "run_at": "2027-01-01T09:00:00-05:00",
  "expires_at": "2027-01-01T18:00:00-05:00",
  "interval_seconds": 20,
  "batch_limit": 100,
  "recipients": [{
    "id": "alumno-prueba-1",
    "destination": "TEST-alumno-1",
    "permission_confirmed": true,
    "payment_status": "pending",
    "variables": {"nombre": "Estudiante de prueba", "enlace": "https://example.test/curso"}
  }]
}
```

Para guardar deliberadamente los trabajos revisados en una base de prueba, el propietario puede enviar `{"action":"enqueue_batch","jobs":[...]}` a `/api/multichannel/control`, con los objetos `jobs` devueltos por la vista previa. Requiere la migración y la activación de simulación descritas abajo. Es una sola inserción: si hay claves existentes devuelve 409 y no guarda ninguna parte del lote. No reintenta filas por separado. Una clave se conserva al reordenar la lista o cambiar de línea; una nueva versión de campaña genera claves nuevas. No cambiar versión para eludir una advertencia de duplicado.

La cola existente `automation_pending_executions` sirve a pasos de automatizaciones de WhatsApp. Se conservó intacta. Se reutilizaron su patrón de reserva y el criterio de los recordatorios existentes: si el servidor se interrumpe después de iniciar un envío, no reenviarlo a ciegas.

## Qué resuelve esta etapa

- Guarda trabajos en el servidor, separados por cuenta. Apagar una laptop no elimina la lista.
- Reserva un trabajo por laptop y uno por línea. Otra laptop puede tomar pendientes de otras líneas.
- Ordena por prioridad y antigüedad. Respeta la fecha de programación y descarta trabajos vencidos.
- Una reserva dura dos minutos. Si termina antes de iniciar el envío, otra laptop puede recuperarla con una nueva reserva.
- Si se interrumpe después de iniciar, queda `needs_review` (revisión pendiente); no se reenvía automáticamente.
- Conserva el trabajo, sus intentos, fechas y última laptop responsable al finalizar.
- Una llave distinta por laptop; se guarda solo su huella, y el propietario puede revocarla. No se entrega la llave principal de Supabase.

Esto no garantiza entrega exactamente una vez frente a un futuro operador externo. Si el operador recibe un mensaje y la conexión cae antes de devolver su respuesta, habrá que conciliarlo. Por eso existe revisión pendiente.

## Estados de la cola

| Estado | Significado |
|---|---|
| queued | Pendiente de su fecha y de una laptop disponible |
| claimed | Reservado; todavía no se inició |
| dispatching | Se inició el intento |
| simulated | Prueba terminada; **no equivale a mensaje enviado** |
| needs_review | Resultado incierto; revisar antes de repetir |
| expired | Venció su plazo |
| cancelled | Reservado para cancelación futura; aún sin botón de gestión |

## Archivos implementados

- `supabase/migrations/20261029151921_multichannel_worker_queue.sql`: tablas, restricciones y transición atómica. Solo backend con rol de servicio puede consultarlas; los roles de navegador no tienen acceso.
- `src/lib/multichannel/protocol.ts`: acepta solo líneas/destinatarios ficticios `TEST-...`, fechas con zona horaria y prioridades 0–100.
- `src/app/api/multichannel/control/route.ts`: administración por propietario; listar últimos 100 trabajos y laptops, registrar/revocar laptop y encolar pruebas individuales o por lote.
- `src/app/api/multichannel/worker/route.ts`: consulta y avance con credencial de laptop. La cuenta se deriva de la credencial, nunca de lo que envíe el cliente.
- `scripts/multichannel/simulation-worker.mjs`: cliente Node que consulta cada 20 segundos. Se puede ejecutar en varias laptops con credenciales diferentes. No se instaló inicio automático en ningún equipo.

## Reproducir las pruebas locales

La dependencia PostgreSQL de verificación se instala únicamente bajo `output/multichannel-verification`; no modifica el `package.json` del CRM:

```powershell
npm install --prefix output/multichannel-verification --no-save --package-lock=false @electric-sql/pglite
node --test scripts/multichannel/queue.integration.test.mjs
npx --no-install vitest run src/lib/multichannel
npx --no-install tsc --project scripts/multichannel/tsconfig.verification.json --noEmit
npm run build
```

Las pruebas SQL crean una base PostgreSQL temporal en memoria, con cuentas ficticias. PGlite ejecuta en una sesión: comprueba reservas, restricciones y recuperación, pero no sustituye una prueba de carga con varias conexiones al servidor real.

## Activación de simulación en un entorno de prueba

Primero revisar/aplicar la migración **solo en una base de prueba**. Luego configurar `MULTICHANNEL_SIMULATION_ENABLED=true` en ese servidor. Por defecto las rutas devuelven 503 y no trabajan. Nunca habilitarlo como sustituto de un transporte real.

Con la sesión del propietario, POST a `/api/multichannel/control`:

```json
{"action":"register_worker","worker":{"name":"Laptop de prueba 1"}}
```

La respuesta muestra `token` una vez; guardarlo de forma privada. Se revoca con `{"action":"revoke_worker","worker_id":"UUID de la laptop"}`. No pegar el token en el chat, hojas o repositorio.

Para probar un trabajo, POST al mismo endpoint, usando fechas futuras vigentes al ejecutar:

```json
{
  "action": "enqueue",
  "job": {
    "channel": "sms",
    "line_key": "TEST-linea-1",
    "recipient": "TEST-alumno-1",
    "body": "Recordatorio ficticio",
    "dedup_key": "prueba-campana-1-alumno-1",
    "priority": 50,
    "run_at": "2026-11-01T09:00:00-05:00",
    "expires_at": "2026-11-01T18:00:00-05:00"
  }
}
```

En cada laptop, configurar en privado `WACRM_WORKER_URL` (URL HTTPS del servidor de prueba) y `WACRM_WORKER_TOKEN`, y ejecutar:

```powershell
node scripts/multichannel/simulation-worker.mjs
```

Al consultar GET `/api/multichannel/control`, el resultado será `simulated`, jamás `sent`. No hay que dejar un navegador abierto para este cliente; necesita Node y conexión al servidor. Al apagar todas las laptops, no avanza; al encender una, hay que iniciar el cliente hasta implementar el arranque automático.

## Integración con la centralización: siguiente etapa, aún no conectada

Los formatos actuales tienen PLANTILLAS MENSAJE, CAMPAÑAS SMS, COMUNICACIONES y CALENDARIO AVISOS. Se conservarán como planificación e historial, no como cuatro listas independientes de envío.

Flujo previsto: campaña autorizada → seleccionar alumnos y revalidar pagos/bajas → generar un trabajo por alumno → cola central → resultado en COMUNICACIONES y CRM. La clave de deduplicación debe identificar campaña, alumno y versión; refrescar/importar una hoja no puede crear otro envío para la misma clave. Los estados `simulated` y `needs_review` nunca se convertirán en “entregado”.

Antes de conectar hay que leer las cabeceras vigentes de las hojas nativas y definir el mapeo; el XLSX inicial tiene menos pestañas y **no debe reemplazar el maestro actual de 32 pestañas**. No se copiaron alumnos reales ni se activó sincronización con estos formatos en este bloque.

## Pendientes necesarios para operar

1. Confirmar versión Android/permisos del Huawei Entel identificado y los otros dos equipos; comprobar el mecanismo permitido para enviar desde sus propias SIM. No se presupone que el plan ilimitado admita cualquier volumen.
2. Implementar y probar ese transporte con confirmaciones reales de aceptación y entrega. El bot no supondrá éxito por pulsar un botón.
3. P063 tiene ya una vista de calendario local que consulta el mes elegido para trabajos TEST por `run_at`, cuenta y hora de Lima, con tope visible de 500; la cancelación conserva el historial y solo actúa si sigue pendiente. No se implementó rotación para eludir restricciones. Faltan paginación, calendario compartido, edición/versionado y operación real autorizada.
4. Probar con varias conexiones y laptops reales; luego configurar arranque automático y supervisión.
5. WhatsApp del bot: verificar un adaptador para el número propio elegido de WhatsApp Business o WhatsApp normal, según la corrección posterior del propietario. No exigir coexistencia con Cloud API. El canal `whatsapp_support` sigue siendo una categoría de simulación hasta implementar y comprobar el transporte solicitado.
6. Handoff al asesor activo: reutilizar asignación y pausas existentes, sin crear dos responsables ni reactivar IA cuando una persona toma el caso.
7. Conciliar fuentes, migrar por lotes y conectar portal/hojas/CRM después de verificar IDs, permisos y datos.

## Etapa final solicitada: llamadas con audio grabado (26/10/2026)

Pendiente para el final, por orden del propietario. Evaluar un bot que llame a una lista autorizada, reproduzca un audio grabado, cuelgue y continúe con el siguiente destinatario. Primero comprobar la viabilidad con los celulares y SIM disponibles sin contratar una API de pago. No se ha demostrado que esos equipos permitan transmitir el audio grabado dentro de una llamada. Si requiere equipo o servicio adicional, explicar el costo antes de contratarlo. SMSGate no implementa este transporte de llamadas. No activar llamadas ni realizar pruebas de llamadas en esta etapa.
