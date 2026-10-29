# WACRM — Única lista vigente de pendientes

Lista creada el 28/10/2026 y actualizada el 29/10/2026 con avances P060/P061/P062/P063. Reemplaza las listas anteriores como plan de trabajo; los archivos anteriores se conservan como historial y evidencia.

**94 entregables abiertos agrupados, 5 registros de cierre/conservación y correspondencia completa con los 142 puntos del texto, los 94 IDs A–I y los 67 desgloses posteriores.** No son 94 fallos ni 94 cosas que falten programar enteras: incluyen comprobaciones, partes locales, decisiones humanas y fases posteriores. No se calcula un porcentaje de avance ficticio.

## Cómo se actualizará sin volver a duplicarse

- Cada entregable tiene un ID P fijo. Una corrección, prueba o ampliación del mismo resultado se agrega a esa fila; no se abre otra con nombre parecido.
- No renumerar IDs. Las tareas nuevas y distintas se añaden al final con el siguiente ID libre. Al cerrar una, guardar fecha/evidencia y moverla a cerradas conservando su ID.
- Marcar completa solo al cumplir la condición indicada. Código local, simulación, prueba, publicación, funcionamiento real y entrega a una persona son cosas diferentes.
- Las viñetas históricas equivalentes son referencias de la misma tarea, no pendientes extra. El cruce JSON conserva todos sus detalles y permite encontrar el origen.
- Estados EN PAUSA no se ejecutan por aparecer aquí. PREPARADO SIN PUBLICAR no es permiso pendiente de volver a pedir. Los bloqueos humanos de una tarea no detienen las demás.

## Qué va primero

**Primero, operación urgente:** P001 Validar y clasificar los pagos que siguen sin decisión → P006 Conciliar entrega por documento sin reenviar lo incierto → P048 Cerrar fallos intermitentes de sincronización comercial → P089 Identificar y comprobar el programador operativo real.

**Cierre comercial concreto:** P045 Cerrar cobertura del historial y cambios comerciales → P046 Cerrar privacidad y acceso real de bases de asesoras → P047 Cerrar ranking, metas y tarifas oficiales.

**Siguiente construcción local del bot:** continuar P063 con calendario compartido y cambios/versionado de campañas; ya hay vista local del calendario de simulación y cancelación segura de trabajos TEST pendientes. P060/P061 están conectados en código; falta activación autorizada y recorrido real.

La construcción del bot continúa en **P060/P061**; P058 ya tiene el transporte SMS construido localmente y conserva publicación y prueba física como pendientes. Registrar otra línea de simulación no se volverá a contar como otro entregable completo del bot. Actualización 29/10: el ingreso WhatsApp Web ya llama en código el mismo despacho CRM de Cloud; 111 pruebas Vitest de la ruta, guard y motores y 6 pruebas SQL/PGlite aprobaron. Conversaciones nuevas habilitan motores configurados, pasan por la regla de primer contacto y conservan las pausas previas. Las migraciones de cola, ingreso y salida ya están aplicadas en Supabase; falta publicar el código y activar la configuración; no hay respuesta real probada.

**Actualización 29/10 que sustituye el resumen de bot inmediatamente anterior:** el ingreso, despacho CRM y respuesta manual de texto del Inbox ya están conectados en código; pasaron 134 pruebas Vitest de rutas, guard, motores y ventas y 7 SQL/PGlite. Conversaciones nuevas siguen la regla de primer contacto y conservan las pausas. Migraciones aplicadas; publicación, configuración y flags pendientes; no hay respuesta real probada. El editor actual ya tiene ramas, bloques y esperas; P062 se limita a cerrar alcance multicanal sin duplicarlo.

Reconsulta de solo lectura de P001/P006: 29/10 08:48 Lima. Se conservaron como pendientes humanos los cuatro pagos sin concepto y la boleta incierta; no se aprobó, editó ni reenvió nada. P089 conserva el último estado guardado de Apps Script, sin revalidación visual en este corte.

## Restricciones que siguen vigentes

No commit/push/publicación/migraciones sin autorización concreta; conservar cambios y archivos existentes. Casilla de entrega manual local sin publicar. Prioridades históricas 3/4 pausadas salvo urgencia autorizada. No recrear alarmas de Codex. No pagos/identidades aprobados por IA, mensajes de prueba, reactivación de pausas ni reenvíos inciertos. BG8 ficticio, sin alumnos reales; S/3 DEMO. No comprar hosting, renovar dominio, migrar ni cambiar DNS antes de maqueta/decisión. Conservar campañas/borradores ajenos y marcadores de reinicio ya utilizados.

## Lista de trabajo sin repetir entregables

### 1. Pagos, matrícula y documentos — 10

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P001 | HUMANO | Validar y clasificar los pagos que siguen sin decisión | Reconsulta de solo lectura 29/10 08:48 Lima: siguen 1 pago `pending/unclassified` y 3 `validated/unclassified` en INSTICRECESEO; los 15 enrollment y 2 other siguen clasificados. Los cuatro sin concepto requieren decisión humana con evidencia, responsable y fecha; no inferir por importe. | A03, O01 |
| P002 | PARCIAL | Registrar cada matrícula y conciliarla con sus pagos | Cada matrícula nueva, también manual o completada desde chat/WhatsApp normal, tiene registro único en Matrículas/Ingresos, curso/pago elegido, numeración estable y fecha original. Se excluyen pruebas y se comprueba concurrencia. Último corte: cero pagadas sin registro/carpeta, no cierre permanente. | A01, A02, A03, A12 |
| P003 | VERIFICAR | Cerrar validación de comprobantes y sus excepciones | Importe, beneficiario, fecha, operación, duplicados, promoción y excesos revisados; aprobar/rechazar/observar y Otros dejan nota, responsable y derivación si corresponde. La lectura de IA nunca aprueba. | A04, A05 |
| P004 | PARCIAL | Completar la ficha desde el chat sin perder datos | Admite documentos previstos, dirección/segundo teléfono opcionales; solo pide lo faltante, conserva casillas/valores, resuelve conflictos reales y deja revisar fotos o respaldo escrito. Panel desplegable compacto en computadora y celular. | A06, A07, A08, A09 |
| P005 | PARCIAL | Cerrar contenido y generación/reutilización de los tres PDF | Boleta, cronograma y ficha correctos en A4, nombres, números, importes y promoción. Genera aunque no se pueda enviar y ofrece enlaces. Reutiliza Amanda/Katty/Garfield; el último lote comprobó metadatos, no todo el contenido de cada PDF. | A10, A11, B03 |
| P006 | REVISIÓN | Conciliar entrega por documento sin reenviar lo incierto | Reconsulta de solo lectura 29/10 08:48 Lima: se mantienen 14 `sent` por tipo BOLETA/CRONOGRAMA/FICHA y 1 BOLETA `review`, creada 25/10 19:56 UTC, sin ID del proveedor ni `sent_at`. Se conserva como incierta hasta verificar evidencia humana; no reintentar por ausencia de acuse. | A01, A11, B05, O02 |
| P007 | PARCIAL | Cerrar carpetas, originales y reutilización multicurso | Estructura mes/día/estudiante/curso/primer pago, próximo mes con cinco días de anticipación, originales y PDF en lugar correcto. Las 13 carpetas de respaldo se conservan hasta verificar referencias; limpieza solo de copias demostradas. | B01, B02, A11 |
| P008 | VERIFICAR | Comprobar calendario de cuotas por inicio oficial | Reglas de inicio 1–9 / 10–25 / 26–fin y febrero comprobadas, sin alterar fecha oficial por ingreso tardío ni promoción ofrecida. | B04, A03 |
| P009 | VERIFICAR | Cerrar contador y avisos de validaciones | Contador correcto por rol y oculto al llegar a cero; alertas no repiten bienvenida, cuentas ni datos ya entregados. | A14 |
| P010 | PREPARADO SIN PUBLICAR | Conservar la casilla de entrega manual y completar su enlace central cuando corresponda | Mantener el código local por orden expresa. Falta exportar marca/responsable/fecha al maestro. Publicación y migración siguen prohibidas hasta nueva orden específica; no preguntar otra vez como si faltara respuesta. | A10, B05, K11, O06 |

### 2. Automatizaciones comerciales: cambios generales pausados — 7

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P011 | EN PAUSA | Cerrar materiales, keywords y orden de todos los cursos/versiones | Farmacia, Nutrición, Estética, Administrativo, RRHH, Inicial y demás configurados: materiales reales, referencias entre bloques, promoción correcta, imágenes 49.90 solo donde corresponde, respaldos 79.90, MINEDU/certificación/Office y audios. Cinco recorridos publicados no cierran todos. | C01, C02, C03, C07 |
| P012 | EN PAUSA | Comprobar retorno contextual completo de consultas y botones | Responder sin repetir saludo/temario/pedidos y retomar curso/paso real en todas las variantes. El arreglo puntual 951cb16 ya está publicado; este pendiente es su cobertura integral, no volver a publicarlo. | C01, C04 |
| P013 | EN PAUSA | Cerrar seguimientos de pago y sus botones | 15/90/120 minutos y ramas Estoy en proceso / Ya aboné / Necesito ayuda en orden y sin saltar esperas. Detener peticiones de pago/cuentas al recibir comprobante y conservar etapa tras preguntas. | C01, C06 |
| P014 | EN PAUSA | Cerrar último contacto de las 23 horas | Imagen/texto académico, audio, título y botón en orden, solo para prospectos elegibles; ventanas y pagos/matrículas excluidos. Prueba por conversación y ausencia de duplicados, sin reinicios excepcionales nuevos. | C01, C08, C09 |
| P015 | EN PAUSA | Comprobar oferta, inicio y promoción comunicados | Precios/inicios realmente vigentes por estudiante y botón Activa mi promo con retorno correcto, sin escasez inventada ni sustituir la oferta histórica. | C10 |
| P016 | EN PAUSA | Cerrar pausa indefinida y reanudación contextual | Desactivar IA/automatizaciones frena también pendientes y tareas programadas; solo reactivación explícita y lectura de lo conversado entretanto. No habilitar pausas para probar. | C12, F03 |
| P017 | PARCIAL / COMPARTIDO CON SESIÓN | Cerrar etiquetado de primera atención comercial | El despachador CRM compartido aplica AREA VENTAS al mensaje comercial; la migración `20261023201537_sales_institute_bot_attribution` está aplicada y añade ASESOR INSTITUTO al responder el bot si no hay responsable humano, retirándolo al asignar una persona. El ingreso de WhatsApp Web llama el mismo despachador. Esta continuación agregó una expectativa de prueba para comprobar el etiquetado en sesiones. Falta cubrir todos los caminos históricos/automáticos y verificar el cambio con una asignación humana real ya autorizada. | C11 |

### 3. Origen publicitario, costos y analítica — 8

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P018 | PARCIAL | Cerrar captura del origen desde el primer mensaje | Referral/source_id y prueba original conservados y reconciliados cuando Meta demora; no inventar origen ni perderlo por mirar solo mensajes recientes. | D01 |
| P019 | PARCIAL | Reconciliar la regla vigente de apertura y la excepción económica antigua | El texto pegado habla de un minuto; código/publicación posterior difieren a diez y no lanzan ese flujo sin origen confirmado. Revisar llamadas a la ruta económica antigua y documentación. Sin keyword/origen, atención humana urgente; sin reiniciar antiguos/matriculados. | D02, D03 |
| P020 | PARCIAL | Cerrar ventanas y decisión informada en pantalla | Mostrar atención/publicidad/vencimiento/plantilla y GRATIS/PAGO/POR CONFIRMAR, sin confundir ventana abierta con gratuidad ni estimación con cargo. Atención manual ve qué puede costar antes de decidir. | D04, D06, D07 |
| P021 | VERIFICAR | Conciliar información económica real de Meta | Guardar clasificación recibida, mensaje, número empresarial, responsable y entrega; asociar costo estimado frente a cargo confirmado. | D05 |
| P022 | PARCIAL | Revalidar condiciones antes de todo envío y pendiente | En cada canal: permisos, bajas, pago/deuda vigente, pausa, atención humana, ventana, presupuesto, vencimiento y límites. Bloqueo no corta recepción; no usa etiqueta o dato pegado como deuda confirmada. Reutilizar políticas existentes. | D06, D07, J05, J06 |
| P023 | VERIFICAR | Cerrar prevención de bucles y exclusión de pruebas | Excluir pruebas/bots sin abandonar leads válidos ni crear conversaciones automáticas repetidas. | D08 |
| P024 | PARCIAL | Cerrar costos, abandono y conversión con datos comparables | Panel por mensaje/conversación/día/responsable y diferencias Meta; tres casos del texto. Análisis por curso/bloque/promoción/campaña, botones/textos/peticiones humanas, inversión y cierres externos. No presentar correlación pequeña como causa. | D09, I05, O05 |
| P025 | VIABILIDAD | Demostrar o descartar la meta económica solicitada | Evaluación verificable del objetivo de más de 100.000 mensajes por máximo S/300 y límites reales. Sin prometer gratuidad ilimitada o ausencia de bloqueos; separar evaluación de contratación. | D10 |

### 4. Inbox y uso diario: prioridad general pausada — 12

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P026 | EN PAUSA | Corregir el reinicio al volver de otra aplicación | Reproducir y demostrar causa; al volver conserva chat, búsqueda, posición y borrador sin expulsar al usuario. No publicar otro arreglo sin prueba. | E01 |
| P027 | EN PAUSA | Cerrar búsqueda por formatos de teléfono | +51, 51, espacios, separadores y prefijos encuentran el mismo contacto. | E02 |
| P028 | EN PAUSA | Cerrar adjuntos, grabación y controles de envío | Selector común imagen/video/documento/audio, subir audio existente, grabar junto al envío y arrastrar archivos. Enviar a la derecha y controles cómodos, incluidos celular; compactación de ficha de matrícula se gestiona en P004. | E03, E04 |
| P029 | EN PAUSA | Permitir botones para un mensaje concreto | Crear interacción específica sin modificar una automatización global. | E05 |
| P030 | EN PAUSA | Cerrar reenvío de bloques a varios destinatarios | Buscador/selección/lista por comas, aviso de no encontrados o no elegibles, Escape cancela y piezas/orden conservados sin duplicaciones. | E06, E07 |
| P031 | EN PAUSA | Cerrar sonido y no leídos | Sonido tenue y contador basado en mensajes recibidos, sin alterar prioridades por mensajes enviados automáticamente. | E08 |
| P032 | EN PAUSA / VIABILIDAD | Verificar avisos de llamadas entrantes | Demostrar capacidad de la integración oficial y aviso/tarea de devolución antes de prometerlo. | E09 |
| P033 | EN PAUSA | Cerrar salto al último mensaje y continuidad de audio | Flecha funcional; audio sigue al cambiar de conversación y ofrece parada visible. | E10 |
| P034 | EN PAUSA | Cerrar avance visible y respeto del estado del chat | Paso/estado de automatización, prioridad de pagos, archivados/ocultos recuperables y etiquetas retiradas se respetan. | E11 |
| P035 | EN PAUSA | Eliminar notas manuales propias de forma visible | Opción usable en computador/celular; permisos correctos, sin borrar notas ajenas ni confundir resúmenes automáticos. | E12 |
| P036 | EN PAUSA | Explicar y simplificar los estados de casos | Registro de caso/Solución/Pendiente/Resuelto se entienden según comportamiento real y quedan documentados. La mecánica de transferencia se gestiona en el pendiente de derivaciones. | E13 |
| P037 | EN PAUSA | Cerrar gestión de recordatorios y notificaciones del CRM | Editar/eliminar, destinatarios/permisos/enlaces útiles y etiquetas manejables. Esto no recrea alarmas de Codex eliminadas. | E14 |

### 5. Equipo, reparto y derivaciones — 7

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P038 | PARCIAL | Cerrar gestión de cuentas, áreas y cargos configurables | Altas/activación/desactivación preparadas para muchas asesoras; docentes/coordinación/audiovisual configurables. Sin personal activo usa ASESOR INSTITUTO. No crear asesoras reales para probar. | F01, F08 |
| P039 | PARCIAL | Cerrar reparto y atribución por gestión real | Turnos/porcentajes editables y visibles en CRM, responsables correctos y comisiones no atribuidas solo por una asignación sin gestión. | F02 |
| P040 | PARCIAL | Cerrar intervención humana, inactividad y devolución de gestión | Una persona detiene atención automática. Plazo configurable de atención/renovación y devolución de gestión respetan pausas indefinidas, cuarto/quinto bloque e interacción real. No confundir plazo operativo con siete días. | C05, F03 |
| P041 | DEFINIR | Definir e implementar la permanencia de asesor durante siete días | Precisar alcance, vencimiento y liberación, diferenciándolo del plazo operativo de dos horas; después comprobar su implementación. | F04 |
| P042 | PARCIAL | Cerrar traspasos y permisos de historial entre áreas/canales | Disponibilidad, solicitud, aceptación/rechazo, resumen, responsable único, plazo/alerta/cierre. Fidelización recibe lo necesario sin borrar historia comercial; CEO mantiene acceso total. Reutilizar para canales nuevos. | F05, F06, H01, J09 |
| P043 | VERIFICAR | Cerrar perfil, turnos y disponibilidad del equipo | Apodo/presentación, cumpleaños, horarios, prioridad y recordatorios del equipo; límites de llamadas definidos, personal inactivo respetado. | F07 |
| P044 | PARCIAL | Cerrar chat interno y avisos por rol | Individual/grupal, no leídos, avisos y visibilidad/disponibilidad correctos por área y persona. | F08 |

### 6. Base comercial, privacidad y ranking — 4

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P045 | PARCIAL | Cerrar cobertura del historial y cambios comerciales | Conservar lo publicado: contactos/cierres tras Fidelización, estados entre CRM/base general/individual y separación venta/pago. Retirar VENTA cambia cómputo sin borrar pagos/matrícula/documentos. Verificar huecos sin reconstruir el circuito existente. | G01, G02, G03 |
| P046 | HUMANO / PARCIAL | Cerrar privacidad y acceso real de bases de asesoras | General/ratios solo propietario; archivo por asesora; ranking sin contactos ajenos. Comprobar acceso y edición desde BG8 ficticio; al terminar retirar acceso/archivo. Lotes ya publicados no se rehacen. | G04, G05, G06 |
| P047 | DEFINIR / PARCIAL | Cerrar ranking, metas y tarifas oficiales | Conservar ranking/gráficos existentes. Comprobar mes/sistema/asesoras y configurar metas individuales/grupales, tramos/vigencias. S/3 sigue DEMO hasta decisión del propietario. | G07, G08 |
| P048 | INCIDENCIA / CORRECCIÓN LOCAL | Cerrar fallos intermitentes de sincronización comercial | Apps Script conserva 10,73 % de fallos en el último corte consultado; las 50 ejecuciones visibles allí completaron. La ruta optimizada carga mensajes solo para contactos elegibles. Repetí el 29/10 las 11 pruebas de la ruta y pasaron. La tasa no puede medirse hasta publicar con autorización; por ello la causa raíz no se declara resuelta. Mantener frecuencia/lotes, notas y orden. | G09, O03 |

### 7. Fidelización, calendario y docentes — 9

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P049 | PARCIAL | Cerrar bienvenida y alertas sin duplicación | Plazo humano/automático de dos horas, horario y responsable/turno; marcar bienvenida no cierra datos de matrícula aún faltantes. | H02 |
| P050 | PARCIAL | Cerrar inicios y cambios oficiales con avisos | Curso/fecha/horario/próximo inicio, sin históricos confusos; cambio con motivo, aviso rojo, fecha anterior, tareas a afectados y enlace a pestaña exacta. | H03, H05 |
| P051 | VERIFICAR | Cerrar módulos y clases frente a cuotas | Ocho clases por módulo, feriados/canceladas, ingreso antes de tercera clase sin desplazar el inicio oficial de cuotas. | H04 |
| P052 | CORREGIDO PUBLICADO / SEGUIMIENTO | Cerrar listas y tareas de grupos WhatsApp | Listas de todos los matriculados corregidas: Farmacia 2 alumnos. E desplegable NO/SI sincroniza con U de MATRICULAS en ambos sentidos, sin confundir ESTADO de contacto. Activador real comprobado y 20 pruebas; renovación a cuatro días conserva el estado en origen. Incorporación física a grupos sigue siendo humana. | H06 |
| P053 | VERIFICAR | Cerrar calendarios y avisos de asesoras/docentes | Inicios/ausencias/cancelaciones/reprogramaciones con responsables y permisos; comprobar aviso externo, no solo notificación interna. | H07 |
| P054 | VERIFICAR | Cerrar control de clases y cortes mensuales | Distinguir programada/dictada; cortes 6–20 y 21–5 a las 22:00, resumen mensual e historial conservado. | H08 |
| P055 | VERIFICAR | Cerrar informes de viernes por persona y área | Contactos, mensajes y matrículas a las 22:00, con destinatarios y ejecución real comprobados. | H09 |
| P056 | POSTERIOR | Cerrar acceso habilitado a clases, Meet y Calendar | Identidad y matrícula verificadas, altas/bajas y enlaces restringidos reales. Anotación de acceso no es permiso concedido. | H10, K10 |
| P057 | POSTERIOR | Evaluar calidad docente con evidencia | Resumen mensual desde grabaciones/transcripciones, marcas de tiempo y evidencias sin inventar puntuaciones. | H11 |

### 8. Bot multicanal: integración real pendiente — 13

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P058 | CONSTRUIDO LOCAL / FALTA VALIDACIÓN REAL | Conectar SMSGate con la cola central existente | Ya hay migración, servidor, cliente HTTP y ejecutor para avisos/soporte con reserva/resultado atómicos, permiso humano con evidencia/vigencia, capacidad de laptop/línea y límites configurados. Flujo completo probado en base temporal/red simulada. Falta aplicación/publicación autorizada, configuración y prueba física expresamente autorizada. Cobranza sigue bloqueada por falta de saldos conciliados; no marcar bot completo. | J01, J02, J03, J27 |
| P059 | PARCIAL LOCAL | Terminar disponibilidad real y preparación de líneas | Ya hay salud reciente por laptop/línea y revalidación antes de iniciar. Falta configurar y comprobar dispositivos físicos y límites realmente autorizados: Samsung tiene ida/vuelta histórica; Huawei salud/autenticación sin envío demostrado. Terminar otros teléfonos sin repetir permisos ni hacer envíos no autorizados. | J04, J22 |
| P060 | PARCIAL LOCAL | Integrar recepción e historial unificado por contacto | Construido el puente idempotente por línea y aplicado en Supabase (20261029151930). El ingreso entrega texto al mismo despachador CRM del webhook; se conserva origen, primer mensaje y fecha previa. La burbuja muestra la línea, el filtro Unassigned respeta RLS. Acepta teléfonos @c.us; @lid queda en revisión y los bytes de adjuntos aún no se copian. Pruebas: 19 Vitest CRM y 13 SQL/PGlite aprobadas. Falta publicar las rutas, configurar crmBridge, activar el puente y comprobar la recepción real en Inbox. | J07, J10 |
| P061 | PARCIAL LOCAL / TEXTO AUTOMÁTICO Y MANUAL CONECTADOS EN CÓDIGO | Conectar respuestas por reglas y derivación permitida | La entrada de sesión llama los Flows y automatizaciones CRM; las respuestas de texto automáticas/manuales se encolan para la línea origen. La respuesta humana se atribuye a la asesora y pausa IA/automatizaciones/Flows. El worker revalida permisos y no reintenta resultados inciertos. Salida aplicada en Supabase (20261029151956); suite del ejecutor: 77/77. Falta publicar las rutas, configurar crmOutbound, activar el envío y comprobar entrada → automatización → respuesta. Grupos en Inbox, medios y botones siguen pendientes. | J08, J12 |
| P062 | PARCIAL EXISTENTE | Completar el editor multicanal a partir de las automatizaciones actuales | El CRM ya ofrece editor de bloques ordenados, ramas Sí/No anidadas, variables/campos, plantillas aprobadas, medios, botones/listas, esperas de minutos/horas/días, revisión de cambios y duplicación. No rehacer ese editor. La pantalla multicanal ahora selecciona explícitamente SMS o WhatsApp de soporte para campañas de prueba y verifica que la fila COMUNICACIONES y campaña declaren el mismo canal; el canal también se conserva al previsualizar y registrar la línea TEST. Sigue siendo simulación. Pasaron 48 pruebas del preview/puente/rutas y build con 95 páginas. Falta llevar ese selector a campañas reales/líneas vinculadas, segmentos SMS y validar capacidades/costos por transporte. WhatsApp Web admite texto en esta etapa; medios, botones y plantillas se mantienen bloqueados. | J14, J15, J16 |
| P063 | PARCIAL LOCAL | Completar programación, calendario y cambios de campañas | La simulación programa inicio/vencimiento en hora de Lima y permite pausar líneas. La cancelación TEST solo afecta trabajos `queued` y conserva historial. El calendario ahora consulta el mes elegido directamente por `run_at`, en hora Lima, por cuenta y modo simulación; muestra hasta 500 resultados. Pasaron 25 pruebas de calendario/rutas. El build y typecheck de este incremento quedaron sin resultado porque ambos procesos se atascaron sin salida; no se marca compilación aprobada. Falta paginación sobre 500, calendario compartido, edición/versionado y operación real autorizada. | J17, J18, J19 |
| P064 | PARCIAL LOCAL | Conectar hojas de comunicación con tareas y resultados reales | Verificación de solo lectura 29/10: el maestro conserva 32 pestañas, COMUNICACIONES está en `sheetId` 2000000108 y sus cabeceras A4:Q4 coinciden con el contrato local. K5:K54 no muestra estados cargados. La vista previa todavía depende de copiar/pegar y no verifica deuda ni guarda resultados; falta la conexión segura en ejecución y retorno de resultados reales. | J13 |
| P065 | PARCIAL LOCAL | Instalar arranque automático y supervisión de ejecutores | WhatsApp dispone de start.ps1 para proceso oculto independiente de una herramienta, con perfil conservado y control de copias; recuperación del vínculo comprobada. Falta arranque con Windows, supervisión y recuperación al despertar; al apagar ejecutores no debe perderse la cola. | J21 |
| P066 | PARCIAL LOCAL | Demostrar concurrencia y recuperación entre laptops | Recuperación entre dos workers y conciliación sin diario compartido probadas en PostgreSQL temporal con red simulada. Faltan varias conexiones/laptops físicas, carga real y apagado/despertar. Metas futuras 10–20 mil alumnos no son capacidad ni volumen autorizado. | J20, J26 |
| P067 | PENDIENTE | Integrar chat web real con WACRM | Recepción y respuesta mediante adaptador del motor común, antes del portal completo si corresponde, con historial/permisos y atención humana. | J23 |
| P068 | PENDIENTE / VIABLE | Integrar correo/Gmail al mismo bot multicanal | Gmail API puede enviar correo con OAuth; no hay conector ni remitente configurado en WACRM. Para responder y mostrar historial hay que solicitar acceso de lectura y cumplir la revisión OAuth que corresponda. Construir adaptador, cola, adjuntos permitidos, respuestas e historial reutilizando las reglas CRM; no es una función lista ni una conexión autorizada todavía. | J24 |
| P069 | PARCIAL / ADMINISTRADOR LOCAL | Conectar el bot al número elegido de WhatsApp Business o WhatsApp normal | Sin coexistencia. Principal vinculada y recuperada sin nuevo QR; 275 chats por lectura real. Administrador por cuenta permite registro/conexión/detención y lectores aislados; Soporte preparada detenida. Límite inicial 3 sesiones abiertas/20 registros, sin carga física demostrada. El despacho CRM y texto manual de Inbox usan localmente la cola de la línea de origen; composer local admite texto en chats/grupos existentes. La suite de ejecutor pasó 77/77. Faltan migraciones y publicación autorizadas, `crmBridge`/`crmOutbound`, habilitar compuertas y prueba real; el uso con Business y WhatsApp normal no se ha comprobado por separado. Grupos no aparecen como hilos grupales de Inbox. | J11, J25, D10 |
| P070 | PARCIAL LOCAL | Completar el panel multicanal operativo | Bandeja con pestañas por línea, búsqueda, grupos, hilo móvil y compositor manual de texto. Añadí una prueba de interfaz simulada que escribe y envía a un grupo seleccionado; el recorrido conserva el ID del grupo. Suite del ejecutor: 77/77 aprobada. Falta revisión visual del panel actualizado y envío físico autorizado; no hubo envío real. También faltan integración central de respuestas/medios, gestión de segmentos/responsables/pendientes e historial con editor y programador comunes. | J28 |

### 9. Centralización de datos y finanzas — 5

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P071 | PARCIAL | Completar migración histórica con identidades y fuentes conciliadas | Lotes de alumnos/matrículas/cursos/notas/pagos/documentos/certificados/calendarios; catálogos, IDs y multicurso. Relacionar grupos 21–23 sin inventar identidades; preservar maestro 32 pestañas, originales y cambios humanos. Reglas de gratuitos/asincrónicos/reingresos explícitas. | K01, K06, K07, K09, I06 |
| P072 | POSTERIOR / PENDIENTE | Completar obligaciones, deuda y cobranzas reales | Cruzar cuotas/pagos/aplicaciones/abonos, mora y correcciones de comprobantes; no tomar cuotas/reingresos como matrícula. El bot consulta este saldo, no inventa otro sistema financiero. | K02, I07 |
| P073 | PARCIAL | Completar edición bilateral académica y actualizaciones posteriores | Reutilizar consumidor de altas/entregas existente para cambios permitidos de filas, versiones/conflictos/historial y preservar ediciones humanas. No confundirlo con el circuito comercial ya bilateral. | K03, K04 |
| P074 | PARCIAL | Cerrar permisos y uso real de los archivos por área | Fidelización/Académica/Finanzas/Docente/Audiovisual/Ranking, maestro privado y acceso por rol comprobado. Separado de bases comerciales privadas de asesoras. | K05 |
| P075 | REVISIÓN | Cerrar discrepancia histórica de inicio de Milena | Conciliar 09/11 de G-24 frente a inicio oficial 16/11 conservado, con evidencia/decisión y rastro; no alterar fuente por inferencia. | K08 |

### 10. Certificados — 5

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P076 | PENDIENTE | Auditar el sistema de certificados existente | Ubicar hoja/script/plantillas/buscador/correlativos, leer y conservar formato/numeración antes de modificar. | L01 |
| P077 | PENDIENTE / DEFINIR | Conectar solicitud y autorización de certificado | Reglas de curso/estado académico/activos/egresados, entrada portal/WhatsApp cuando exista conexión. Recibo crea pendiente y aviso al propietario; solo validación humana habilita emisión. | L02, L03, L04 |
| P078 | PENDIENTE | Cerrar expediente, correlativo y estados de emisión | ID estable, evidencia/carpeta reutilizada, sin duplicar certificado/correlativo; pendiente/validado/cola/generado/revisado/entregado separados. | L05, L06 |
| P079 | PENDIENTE | Crear pantalla de emisión y validación móvil comprensible | Manual simple con búsqueda/correlativo/orden y bandeja móvil de urgencias/validaciones consecutivas por responsable; pruebas ficticias sin títulos reales. | L07, L09 |
| P080 | PENDIENTE | Integrar entrega y descarga de certificados | Archivo en portal/enlace descargable; WhatsApp opcional con permisos/ventana/costo/pausa y alternativa manual, sin confundir PDF con entrega. | L08 |

### 11. Aula y web institucional — 6

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P081 | PENDIENTE | Entregar maqueta del aula y acceso desde la web | Conservar/mejorar presentación institucional y botón Aula virtual; revisión de la maqueta antes de contratar/publicar. | M01, M02 |
| P082 | POSTERIOR | Construir portal por estudiante y personal | Identidad unificada, permisos/habilitación por matrícula/curso, cursos/módulos/notas/pagos/deuda/certificados; reglas de gratuitos/asincrónicos/nuevos cursos. | M03, M04, I06 |
| P083 | POSTERIOR | Integrar aula con cuentas, CRM, hojas y avisos | Reutilizar cuentas/datos con seguridad, enlaces/calendarios/notificaciones por rol; alojamiento de aplicación separado de tener base disponible. | M05, M06 |
| P084 | PRUEBA POSTERIOR | Demostrar capacidad para el uso acordado del aula | 1.000 registrados; normalmente 10–20 simultáneos, picos 30–50 y después 200. Medición de carga y límites antes de afirmar capacidad. | M07 |
| P085 | REVISIÓN | Identificar web antigua y servidor antes de decidir traslado | Tecnología/compatibilidad real y facilidad de conservar o trasladar web; proveedor/factura y recursos del servidor actual comprobados. | M08 |
| P086 | DECISIÓN POSTERIOR | Decidir y ejecutar infraestructura del aula cuando esté autorizada | Tras maqueta/compatibilidad/carga: hosting/dominio/subdominios/DNS/HTTPS y costo aprobado. No contratar, renovar ni migrar por este inventario. | M09 |

### 12. Llamadas con audio: última fase — 2

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P087 | POSTERIOR / VIABILIDAD | Comprobar llamadas con audio grabado y costo real | Demostrar llamada y audio dentro de ella desde equipos disponibles; SMSGate no prueba esta capacidad. Identificar equipo/servicio/costo antes de contratar o hacer pruebas reales. | N01, N03 |
| P088 | POSTERIOR | Implementar secuencia autorizada de llamadas | Lista, llamada/audio/cuelgue/siguiente, resultados y conservación de inciertos sin reintento ciego, después de demostrar viabilidad. | N02 |

### 13. Infraestructura, canales y cierre del proyecto — 6

| ID | Estado | Entregable único | Se cierra cuando… | Origen |
|---|---|---|---|---|
| P089 | PARCIAL / PROGRAMADOR IDENTIFICADO | Identificar y comprobar el programador operativo real | Apps Script es el programador activo de `SYNC_VENTAS_CRM`: activador por tiempo cada 10 minutos y activador de edición para `SYNC_ESTADO_VENTA_EDITADO_CRM`; no se vio otro cron en esta consulta. Última ejecución visible 29/10 02:59 Lima, completada en 53,805 s; 50 ejecuciones recientes visibles concluidas. La tasa de error del activador era 10,73 %. Falta revisar más historial y validar la mejora P048; no activar un cron duplicado. | I01, O04 |
| P090 | VERIFICAR | Cerrar situación vigente de Instagram, Messenger y TikTok | Autorizaciones, recepción/envío y límites reales por canal; pruebas históricas no acreditan todos funcionando hoy. | I03 |
| P091 | PENDIENTE | Completar registro de proveedor Meta | Soluciones para socios, después del bloque comercial y con su comprobación externa; abrir la página no lo cierra. | I04 |
| P092 | POSTERIOR | Definir y publicar campaña de interacción cuando corresponda | Después del cierre comercial y con autorización concreta. Conservar campaña específica ya reactivada, presupuestos y borradores ajenos. La medición comercial está en el pendiente de analítica. | I05 |
| P093 | PARCIAL | Completar manual único de todo WACRM por rol | Ampliar el manual comercial existente con uso real CEO/asesora/Fidelización y otras áreas, bases/ranking/metas/comisiones, frecuencias y recuperación de errores de los módulos entregados. No compartir datos ajenos. | G11, I08 |
| P094 | DIAGNÓSTICO | Diagnosticar la lentitud local si sigue ocurriendo | Causa demostrada y medición del síntoma: cerrar pestañas no prueba resolver modelo/conectores; no borrar procesos/trabajo ajeno. | O07 |

## Cerrado, conservado o retirado: no volver a ejecutarlo como pendiente

| ID | Registro | Estado | Límite / conservación |
|---|---|---|---|
| R01 | Columna W: NO REALIZADO inicial y REALIZADO humano conservado | COMPROBADO DOCUMENTADO; CONSERVAR | No es tarea nueva; verificar regresión si se toca el sincronizador. |
| R02 | Corrección puntual de retorno entre consultas | PUBLICADO DOCUMENTADO | 951cb16. La cobertura integral sigue una sola vez en el pendiente de retorno contextual; no repetir publicación. |
| R03 | Orden cronológico, IDs y distribución comercial existentes | COMPROBADO DOCUMENTADO; CONSERVAR | No rehacer ni reordenar trabajo humano por este inventario. |
| R04 | Eliminar las alarmas antiguas de Codex | RETIRADO: NO RECREAR | La instrucción posterior las eliminó. Los crons operativos son un asunto separado. |
| R05 | Lista única con correspondencia completa | ACTUALIZADA EN ESTA REVISIÓN | Este archivo es la lista de trabajo. La lista A–I y el cruce literal quedan como evidencia histórica, no tres planes de ejecución. |

## Correspondencia y fuentes sin otra lista paralela

- [Cruce literal completo de los 142 puntos y sus fuentes](CRUCE_COMPLETO_PENDIENTES_2026-10-28.md). Documento de consulta, no plan paralelo.
- [Correspondencias a IDs actuales en JSON](../output/reconciliacion-pendientes-2026-10-28/lista-unica.json). Incluye cada punto literal, sus IDs antiguos y sus entregables actuales.
- [Continuidad operativa](../CONTINUAR_WACRM.md). Entrada para retomar; apunta a esta lista, sin duplicar sus tareas.
- La evidencia A–I/estados/documentos y los desgloses J–O están en el cruce. Cada origen de las tablas es un alias de consulta; varios alias no multiplican una tarea.

**Resultado del control de integridad:** 142/142 puntos enlazados; 94/94 requisitos antiguos y 67/67 desgloses posteriores conservados; cero títulos/claves de tarea repetidos. La revisión elimina duplicados de entregables por su alcance; no afirma haber ejecutado o probado todas las funciones.
