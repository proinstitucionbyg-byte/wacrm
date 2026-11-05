# WACRM / VORTEX — informe de continuidad del bot

Fecha del corte operativo: 4 de noviembre de 2026, hora de Lima. Este documento permite continuar con otra IA o con un programador sin reconstruir todo el chat. Separa lo comprobado de lo que todavía falta. No declara terminado todo el proyecto.

## 1. Qué abrir primero

1. Para trabajar: [CRM, bandeja de conversaciones](https://personal-wacrm.exjald.easypanel.host/inbox).
2. Para vincular teléfonos, pausarlos, recuperarlos y preparar campañas: [Bot multicanal](https://personal-wacrm.exjald.easypanel.host/multichannel).
3. Para editar los textos y ramas existentes: [Automatizaciones](https://personal-wacrm.exjald.easypanel.host/automations).
4. Para revisar Flows: [Flows](https://personal-wacrm.exjald.easypanel.host/flows). Tener un registro Flow no significa que contenga un recorrido completo.
5. Para revisar pagos: [Validación de pagos](https://personal-wacrm.exjald.easypanel.host/payments).
6. Código propio: [repositorio WACRM](https://github.com/proinstitucionbyg-byte/wacrm). Es este repositorio; el enlace ArnasDon del package.json es el proyecto original, no nuestra copia de trabajo.
7. Base de datos: [proyecto Supabase](https://supabase.com/dashboard/project/jntyifplwjciikwyouwe). Proyecto: `jntyifplwjciikwyouwe`.
8. Publicación de la web CRM: [EasyPanel](http://13.140.140.71:3000/), proyecto `personal`, aplicación `wacrm`. Iniciar sesión personalmente. No pegar la contraseña en otro chat.

Carpeta de trabajo en esta laptop: `C:\Users\lenovo\Desktop\wacrm`.

Código del último arreglo del ejecutor: [d8b0c78](https://github.com/proinstitucionbyg-byte/wacrm/commit/d8b0c78). Está guardado y subido a `main`. Incluye el acuse de campañas y la comprobación del teléfono propio durante una reconexión. Subir un commit y terminar un despliegue son cosas distintas: confirmar EasyPanel antes de atribuir a la web cualquier publicación posterior. El ejecutor local usa los archivos de esta laptop.

## 2. Panorama explicado sin programación

Hay varias piezas que deben comunicarse:

| Pieza | Para qué sirve | Dónde vive ahora |
|---|---|---|
| CRM | Las asesoras ven y contestan conversaciones; el propietario configura permisos y automatizaciones | Web publicada en EasyPanel |
| Base Supabase | Guarda conversaciones, reglas, estados de envíos, permisos y tareas pendientes | Proyecto indicado arriba |
| Ejecutor WhatsApp | Mantiene abiertos los WhatsApps normales/Business vinculados y ejecuta sus envíos | Esta laptop, dentro de `scripts/multichannel/whatsapp-session` |
| Hojas / Apps Script | Registros comerciales, matrículas, pagos y futuras fechas que dispararán comunicaciones | Integración existente; este frente no se ha dado por cerrado en este informe |
| Aula virtual | Futuro acceso del alumno, soporte, recursos y comunicaciones académicas | Proyecto separado `C:\Users\lenovo\Desktop\insticrece-web` |
| Contabo | Futuro alojamiento permanente del ejecutor y los servicios que se acuerden | Migración pendiente; todavía no mantiene este bot encendido |

La asesora debe trabajar desde el CRM. El propietario vincula sus teléfonos en el mismo CRM. Que el QR esté en la web no significa que WhatsApp se ejecute en el servidor: por ahora se ejecuta en esta laptop.

Cerrar una pestaña no equivale a apagar el bot. Apagar/suspender la laptop o cerrar su ejecutor sí interrumpe este funcionamiento local. El vínculo puede permanecer guardado. Migrar a Contabo será la siguiente fase, después de cerrar y probar el bot, según la orden del propietario.

## 3. Teléfonos, orden y resultado real

Destino único de las pruebas nuevas autorizadas: **+51 969 383 871**. No se incluyeron otros estudiantes en estas pruebas.

| Orden de soporte | Tarjeta | Número | Automatizaciones en CRM | Prueba de texto al 969 |
|---|---|---|---|---|
| 1 | Soporte | +51 933 691 668 | Habilitadas | Entregada |
| 2 | WhatsApp 02 | +51 922 779 439 | Habilitadas | Entregada |
| 3 | WhatsApp 03 | +51 924 413 651 | Habilitadas | Entregada |
| 4 | WhatsApp 04 | +51 947 370 506 | Habilitadas | Entregada |
| 5 | WhatsApp 05 | +51 994 174 238 | Habilitadas | Entregada |

Las cinco tareas guardaron un identificador de proveedor real y estado `delivered`. Las dos primeras requirieron conciliación contra su mensaje real y acuse de WhatsApp; no se reenviaron. Las tres siguientes quedaron aceptadas y entregadas por el circuito corregido. Esto prueba cinco envíos de texto desde cinco líneas; no prueba todos los archivos, todas las ramas comerciales ni todos los mecanismos de respaldo.

**Estado posterior a la recuperación:** la última lectura durante la preparación del informe confirmó Soporte y 03 `ready`; 02 y 04 estaban reconectando, con socket conectado y teléfono guardado; 05 volvió a `awaiting_qr`/`UNPAIRED`. Por tanto, antes de una nueva campaña hay que comprobar las tarjetas actuales. La prueba entregada anteriormente no certifica que una sesión siga conectada para siempre. No registrar otra tarjeta para solucionar 05: conservar su identidad y revisar/vincular el mismo 994 si sigue pidiendo QR. Principal nuevo está detenido por petición del propietario.

Antiguos 987020644 y 934215366: historial, no líneas activas. No reactivar las ocho tareas antiguas de Principal a ciegas. El historial y los perfiles no se borraron. El mismo número no debe duplicarse en dos tarjetas.

El límite implementado es **10 sesiones simultáneas**. Cinco teléfonos fueron probados. No se han probado diez teléfonos físicos ni la capacidad permanente de esta laptop para diez sesiones cargadas de grupos.

## 4. Qué está listo y qué no

| Función | Situación real | Comprobación que falta |
|---|---|---|
| Vincular y cambiar números desde CRM | Implementado; uso real comprobado | Vigilar reconexión de 05 después del último reinicio |
| Separar historial y evitar tarjetas repetidas | Publicado; historiales de solo consulta sin QR | Mantener regresiones al cambiar el panel |
| Hasta diez WhatsApps | Capacidad implementada | Prueba física con diez, si se necesitan |
| Cinco envíos de texto a un destinatario autorizado | Cinco entregas comprobadas | Respuestas entrantes posteriores desde cada línea y recorrido comercial completo |
| Responder manualmente desde Inbox por soporte | Prueba previa real por 933 comprobada | Repetir aceptación por cada respaldo cuando se cierre su rama |
| Sincronizar mensajes de teléfono y CRM | Ya comprobado para texto | Adjuntos, acuses tardíos y casos especiales siguen requiriendo cobertura |
| Prioridad 933 y respaldos | Orden guardado con cinco líneas | Pruebas de operación continua y alertas finales |
| Salto al segundo si el primero no está disponible | Pruebas automatizadas y comprobación transaccional en la base real aprobadas | No se provocó una restricción real de WhatsApp ni se desconectó un teléfono para simular un bloqueo comercial |
| Esperar hasta tres minutos por pauta | Implementado; recorrido real previo con espera y apertura desde 933 comprobado | Seguir cubriendo confirmaciones tardías y continuidad de ventas |
| Menús 1/2/3 usando las mismas ramas | Implementados con contexto de conversación/línea y títulos originales | Completar y probar la rama comercial que contiene medios |
| Campañas de texto manuales/programadas | Panel, cola y ejecutor existentes; cinco campañas de un destinatario probadas | Una campaña con varios destinatarios, pausas y bloques reales bajo supervisión |
| Importar Excel/CSV o pegar números | Implementado y probado técnicamente | Una revisión operativa de la lista real antes de activarla |
| Texto → imagen → audio → video en WhatsApp normal | Pendiente de transporte completo | Implementar y probar, sin pasar silenciosamente a Cloud |
| Emojis | Incorporados en el compositor | Stickers completos siguen pendientes |
| Grupos dentro del CRM con permisos y selector de línea | Pendiente; existe lectura local parcial y exportación de participantes cargados | Alta/baja de participantes, descripción, foto, permisos, envío y reglas de archivo |
| SMS de SIM, bidireccional | Esquema, rutas y pruebas técnicas existen | Equipo/proveedor real, recepción, envío, autorización y prueba física |
| Respaldo WhatsApp → SMS | Preparado con condiciones de autorización/disponibilidad | Sin SMS físico configurado, debe quedar alerta; no prometer entrega SMS |
| Vouchers e imágenes de WhatsApp normal | Incompleto | Descargar archivo, mostrarlo y asociarlo al pago anterior sin duplicar validaciones |
| Contador `(N) WACRM`, checks verdes, búsqueda, Escape, etiquetas compactas | Cambios publicados y verificaciones anteriores registradas | Seguir revisando casos pendientes, sin confundir checks con un estado inventado |
| Etiqueta CONTACTADO y desplegables de Base Comercial | Pendiente de cerrar | Sincronización en ambos sentidos y revisión de permisos de las hojas |
| Aula web / hojas / pagos / certificados conectados de extremo a extremo | Pendiente | Contratos reales, accesos, pruebas y validación humana |
| Migración a Contabo | Pendiente, siguiente fase acordada | Inventario, respaldo privado, despliegue, recuperación y prueba continua |

No se expresa un porcentaje de avance: hay partes comprobadas y otras que todavía no deben usarse como si estuvieran terminadas.

## 5. Protocolo de atención que hay que conservar

### A. Persona que llega por publicidad

Mantener el recorrido comercial en Cloud/API cuando existe evidencia de pauta y la continuidad está habilitada. No trasladar una venta activa a Soporte solo porque el siguiente mensaje no contiene otra referencia de anuncio. Las opciones de venta deben continuar la rama ya iniciada.

### B. Primer mensaje al API sin pauta confirmada

1. Guardar el mensaje auténtico y esperar hasta tres minutos desde su recepción.
2. No reiniciar ese plazo por cada mensaje adicional.
3. Volver a comprobar la evidencia de Meta al vencer.
4. Si confirma pauta, continuar su recorrido comercial por Cloud.
5. Si sigue sin pauta, abrir desde 933 y conservar la consulta. Si ya sabemos lo que necesita, no reiniciar con preguntas vacías.
6. Mantener después las respuestas manuales y automáticas por esa línea de soporte. No regresar a Cloud solo porque haya saldo/cupo.

Los mensajes recibidos directamente en el WhatsApp normal de soporte no necesitan esperar la clasificación de un anuncio Cloud.

### C. Respaldos y resultado incierto

Orden guardado: **933 → 922 → 924 → 947 → 994**. Las líneas nuevas deben registrarse, habilitarse y añadirse al orden cuando el propietario lo decida.

Si una línea está detenida o no disponible **antes de iniciar el envío**, elegir el siguiente respaldo autorizado. Una restricción confirmada debe quedar clasificada y visible; falta completar la cobertura operativa de todos esos errores. Si el mensaje pudo haber salido pero falta el acuse, no enviarlo de nuevo desde otra línea. Primero leer el mensaje/acuse real. El envío incierto no equivale a un rechazo confirmado.

SMS es un canal distinto, solo si está programado/autorizado y existe un equipo operativo. No es el modo normal de responder WhatsApp. Sin ruta disponible debe quedar una alerta.

### D. Menús y continuidad

En WhatsApp normal usar menús de texto numerados compatibles con las ramas existentes. La respuesta «1» se resuelve contra el último menú válido entregado en esa conversación y línea. No crear una regla global «si escribe 1, mandar siempre X». Se conservan ID y título originales; menús consumidos, vencidos o de otra línea no deben activar otra rama.

### E. Soporte académico y pagos

La intención es identificar al estudiante, solicitar DNI/CE/pasaporte cuando la consulta lo requiera, consultar sus datos oficiales y evitar preguntas repetidas. Deuda, acceso, pago, boleta y certificado son hechos distintos. Una imagen o una etiqueta no autoriza un pago, un certificado o una matrícula nueva.

Si no se resuelve, derivar a una asesora disponible con resumen, número e identidad ya verificada. La integración académica completa y las consultas reales a hojas/aula siguen pendientes. No inventar deuda, horarios, cuentas de pago ni datos faltantes. Los números de cuenta deben salir de la configuración/documentación vigente del CRM.

La explicación aprobada de clases grabadas: todas las clases y PPT disponibles en plataforma 24 horas; no desaprobar por inasistencia; evaluación periódica después de ocho clases; si no puede entrar o llega tarde, puede repasar la grabación. Verificar su incorporación efectiva a las reglas/IA antes de marcar este requisito cerrado.

## 6. Dónde está cada código

Todas las rutas siguientes parten de `C:\Users\lenovo\Desktop\wacrm`.

| Qué quieres localizar | Archivo o carpeta |
|---|---|
| Reglas de desarrollo | `AGENTS.md` y las reglas entregadas por el propietario en este chat |
| Arranque para otro chat | `CONTINUAR_WACRM.md`; sus bloques antiguos son históricos |
| Estado operativo más reciente | `docs/BOT_VERIFICACION_2026-11-04.md` y este informe |
| Alcance / lista general del bot | `docs/BOT_ALCANCE_VIGENTE.md`, `docs/BOT_MULTICANAL.md` |
| Guía de botones y recuperación | `docs/BOT_GUIA_OPERATIVA.md` |
| Pantalla Bot multicanal | `src/app/(dashboard)/multichannel/page.tsx` |
| Tarjetas, QR, vincular, detener y cambiar | `src/components/multichannel/whatsapp-connection-manager.tsx` |
| Orden de Soporte y respaldos | `src/components/multichannel/support-routing-manager.tsx` |
| Panel de campañas reales | `src/components/multichannel/live-campaign-manager.tsx` |
| Simulaciones antiguas | `src/components/multichannel/campaign-manager.tsx`; no confundir con envíos reales |
| Entrada del ejecutor local | `scripts/multichannel/whatsapp-session/cli.mjs` |
| Permisos, envíos, estados y acuses del teléfono | `scripts/multichannel/whatsapp-session/adapter.mjs` |
| Perfiles independientes e historial de líneas | `scripts/multichannel/whatsapp-session/line-manager.mjs` |
| Puente de gestión CRM → ejecutor | `scripts/multichannel/whatsapp-session/crm-management.mjs` |
| Entradas / salidas CRM de una sesión | `scripts/multichannel/whatsapp-session/crm-inbound.mjs`, `crm-outbound.mjs` |
| Campañas del ejecutor | `scripts/multichannel/whatsapp-session/campaign-client.mjs` |
| Arranque robusto, QR y compatibilidad de WhatsApp | `navigation-client.mjs`, `native-qr.mjs`, `message-model-compat.mjs`, en la misma carpeta |
| Diario y archivo local | `store.mjs`, `history-archive.mjs`, `retaining-local-auth.mjs`, en la misma carpeta |
| Teléfonos LID y lectura de chats | `phone-resolver.mjs`, `chat-reader.mjs`, `cached-chat-source.mjs`, en la misma carpeta |
| Abrir desde Windows | `ABRIR_BOT.cmd` y `scripts/multichannel/whatsapp-session/start.ps1` |
| API de gestión / entrada / salida | `src/app/api/multichannel/whatsapp/control/route.ts`, `manage/route.ts`, `inbound/route.ts`, `outbound/route.ts` |
| API de campañas | `src/app/api/multichannel/campaigns/route.ts`, `campaigns/worker/route.ts` |
| API de SMS | `src/app/api/multichannel/sms/control/route.ts`, `sms/worker/route.ts` |
| Espera de Meta y derivación | `src/lib/whatsapp/cloud-support.ts`, `cloud-support-wait.ts`, `first-inbound-routing.ts` |
| Tarea que procesa derivaciones pendientes | `src/app/api/multichannel/support/cron/route.ts` |
| Bloqueo de salida por un canal equivocado | `src/lib/whatsapp/session-transport-guard.ts` |
| Contexto de línea y menús | `src/lib/whatsapp/session-inbound-context.ts`, `session-text-menu.ts` |
| Motor comercial actual | `src/lib/automations/engine.ts`, `meta-send.ts` |
| Motor Flows | `src/lib/flows/` |
| IA, información y derivación | `src/lib/ai/auto-reply.ts`, `config.ts`, `knowledge.ts`, `handoff.ts`, `student-support.ts` |
| Buscador, lista y etiquetas | `src/components/inbox/conversation-list.tsx`, `grouped-tags.tsx` |
| Mensajes, checks y compositor | `src/components/inbox/message-thread.tsx`, `message-bubble.tsx`, `message-composer.tsx` |
| Número y ficha de la derecha | `src/components/inbox/contact-sidebar.tsx` |
| Contador de la pestaña | `src/components/inbox/pending-title.tsx`, `src/app/api/inbox/pending-count/route.ts` |
| Búsqueda dentro del chat | `src/components/inbox/thread-search.tsx` |
| Limpieza, permisos y recuperación | `src/components/inbox/inbox-cleanup.tsx`, `src/lib/auth/permissions.ts`, `src/app/api/inbox/conversations/clear/route.ts` |
| Importación de teléfonos y campañas | `src/lib/multichannel/recipient-import.ts`, `campaign-phone.ts`, `campaign-audience.ts`, `live-campaign.ts` |
| Esquemas de base de datos | `supabase/migrations/` |
| Puentes de hojas y Apps Script existentes | `docs/apps-script/`, `scripts/centralization/`, `output/sales-workbook-2026-10/` |

**Bloqueo concreto de medios:** `engineSendMedia` en `src/lib/automations/meta-send.ts` todavía llama a `rejectUnsupportedSessionTransport(..., 'media')`. Por eso no hay que declarar completa la rama comercial por WhatsApp normal. La automatización CURSOS GENERALES contiene un audio en su segundo paso; no sustituirla por otra rama inventada para ocultar ese bloqueo.

## 7. Dónde viven las reglas y la IA

Los textos y ramas editados desde CRM se guardan en Supabase, no solamente en archivos `.ts`:

| Tabla | Contenido |
|---|---|
| `automations` | Nombre, activación, condición que inicia cada automatización |
| `automation_steps` | Mensajes, esperas, condiciones y posiciones de sus pasos |
| `automation_folders` | Carpetas y organización |
| `flows`, `flow_nodes` | Definiciones del editor Flows |
| `ai_configs` | Proveedor, modelo, instrucciones y claves privadas; las claves no se exportan |
| `conversations`, `messages`, `contacts` | Conversación e identidad del contacto; no van en el paquete de referencia |
| `multichannel_whatsapp_session_lines` | Teléfono verificado, ejecutor, pausa y disponibilidad |
| `whatsapp_support_routes` | Orden de Soporte y habilitación del traslado |
| `whatsapp_management_state`, `whatsapp_management_commands` | Último estado del ejecutor y acciones solicitadas por el propietario |
| `multichannel_campaigns`, `multichannel_jobs` | Campañas, permisos, fechas, tareas y resultados |

La exportación de referencia incluye **161 automatizaciones, 785 pasos, un registro Flow y cero nodos Flow, más una configuración IA sin sus claves**. Incluye reglas activas e inactivas. No asumir que las 161 se ejecutan, que todas tienen sentido o que el Flow vacío es un recorrido terminado.

Archivo de referencia del paquete: `configuracion/AUTOMATIZACIONES_Y_IA_SIN_CLAVES.json`. No es una orden de restauración ni un script para importarlo a producción. Sirve para que otra IA pueda leer los textos originales y proponer cambios pequeños manteniendo IDs.

## 8. Credenciales y datos que NO hay que pegar en ChatGPT

Ubicaciones que existen en esta laptop; aquí solo se indican sus nombres:

| Ubicación | Qué contiene | Tratamiento |
|---|---|---|
| `.env` | Configuración privada del servidor y claves de servicios | Conservar; no subir al chat ni al repositorio |
| `output/multichannel-private/whatsapp-session/worker-config.json` | Cuenta, puentes y credencial del ejecutor | Privado; no copiar su contenido al informe |
| `output/multichannel-private/whatsapp-session/accounts/<cuenta>/lines.json` | Identidades de líneas y archivo histórico | No editar mientras el administrador está abierto |
| `output/multichannel-private/whatsapp-session/accounts/<cuenta>/automation-control.json` | Pausas locales | Conservar; no levantar pausas ajenas al caso autorizado |
| `output/multichannel-private/whatsapp-session/<scope>/events.jsonl` | Diario con mensajes y resultados reales | Datos privados; no adjuntar como código de referencia |
| `output/multichannel-private/whatsapp-session/<scope>/history.jsonl` | Archivo consultable fuera de línea | Datos privados |
| `profiles/`, `auth/`, `panel-access.json` dentro de esa carpeta privada | Sesiones de WhatsApp y acceso al panel local | Equivalen a acceso privado; no exportar a una IA |

`<scope>` es el nombre largo generado para separar cuenta y línea. La función que lo calcula es `sessionScope` en `store.mjs`. No renombrar carpetas a mano ni intercambiar perfiles entre números.

La copia de código compartible **no respalda** estas sesiones ni la base de datos. Para conservar la instalación completa, guardar una copia privada de la carpeta de trabajo y respaldos de base con el servicio detenido correctamente; eso es una tarea distinta a subir código a ChatGPT.

## 9. Cómo manejarlo sin programar

### Abrir el bot

1. Mantener la laptop encendida y conectada.
2. Ir al Escritorio → `wacrm` → doble clic en `ABRIR_BOT.cmd`.
3. Volver al CRM → Bot multicanal → Mis WhatsApps.
4. Revisar el número y el estado real. Si las líneas secundarias están detenidas, conectarlas desde sus tarjetas.
5. Las asesoras contestan desde Inbox; no necesitan copiar un token ni entrar a Supabase.

### Añadir otro WhatsApp

1. En Mis WhatsApps, pulsar **Vincular otro WhatsApp**.
2. Se reutiliza primero un espacio libre; aparece la tarjeta que pide escaneo. Si ya no hay espacios preparados, el formulario permite crear otra línea hasta el límite de sesiones activas.
3. En el celular: WhatsApp → Dispositivos vinculados → Vincular dispositivo.
4. Escanear solo el QR de la tarjeta elegida. No pulsar Cambiar número repetidamente.
5. Esperar a que aparezcan su teléfono y **Conectado**. «Conectando», un número guardado o un socket conectado por sí solos no prueban que esté listo.
6. Habilitar sus automatizaciones si aparece Bot en pausa. Añadirlo al orden de respaldo si corresponde.

### Reemplazar un número

En la tarjeta actual del número antiguo usar **Cambiar número con QR nuevo**, confirmar y escanear la tarjeta nueva. El número anterior queda en el apartado cerrado **Números anteriores · historial conservado**, sin QR ni botones de reconexión. No volver a cambiarlo desde el historial.

### Detener, desvincular o recuperar

- **Detener sin desvincular:** apaga esa sesión de trabajo, conservando perfil e historial.
- **Desvincular:** revoca el vínculo de ese teléfono; no equivale a detener. Para cambiar de número se debe usar la operación de reemplazo, conservando identidades separadas.
- **Pausar automatizaciones:** detiene la automatización de esa línea, no borra conversaciones ni cierra WhatsApp.
- **Revisar y recuperar:** revisa una línea trabada; conserva pausas y no debe reenviar resultados inciertos.
- Si aparece perfil ocupado o bloqueo, no borrar carpetas. Primero comprobar que no esté abierta otra copia del mismo ejecutor.

### Campañas

Usar el bloque **Envíos reales · WhatsApp y respaldo SMS**. El bloque de simulación no envía mensajes reales. Revisar lista, números normalizados, texto, línea principal, respaldos, hora de Lima, vencimiento, separación entre mensajes, cantidad por bloque, pausa entre bloques y autorización. Guardar y revisar antes de activar.

Hoy las pruebas reales son de texto. No planificar audio/video como si el transporte estuviera cerrado. SMS requiere su equipo real. Una tarea Aceptada no equivale a Entregada; Por revisar no debe reenviarse a ciegas.

## 10. Consultas de diagnóstico para una IA con acceso a Supabase

Estas consultas son de lectura. El propietario entra al proyecto correcto y al SQL Editor. No ejecutar un SQL de otro chat que borre filas o cambie permisos sin revisar su objetivo.

```sql
-- A. Teléfonos registrados, pausas y último latido de soporte/campañas.
select line_key, linked_phone, paused, support_ready_at, campaign_ready_at
from public.multichannel_whatsapp_session_lines
where account_id = '4d761b3c-4c6c-4986-bcd8-d95f1754fe35';

-- B. Orden de soporte configurado.
select enabled, line_order, updated_at
from public.whatsapp_support_routes
where account_id = '4d761b3c-4c6c-4986-bcd8-d95f1754fe35';

-- C. Estado comunicado por el ejecutor, sin extraer ningún QR.
select s.seen_at, x->>'label' as linea, x->>'linkedPhone' as telefono,
       x->>'status' as estado, x->>'archived' as historial
from public.whatsapp_management_state s
cross join lateral jsonb_array_elements(s.snapshot) x
where s.account_id = '4d761b3c-4c6c-4986-bcd8-d95f1754fe35';

-- D. Las cinco pruebas reales de este cierre.
select c.name, j.status, j.provider_id, j.line_key, j.routing_alert
from public.multichannel_campaigns c
join public.multichannel_jobs j on j.campaign_id=c.id and j.account_id=c.account_id
where c.account_id='4d761b3c-4c6c-4986-bcd8-d95f1754fe35'
  and c.name like 'PRUEBA PROPIETARIO %'
  and j.recipient='+51969383871'
order by c.name;

-- E. Errores recientes de automatización: revisar, no repetir automáticamente.
select automation_id, status, error_message, created_at
from public.automation_logs
where account_id='4d761b3c-4c6c-4986-bcd8-d95f1754fe35'
  and status='failed'
order by created_at desc limit 20;
```

Un teléfono en `multichannel_whatsapp_session_lines` es un registro, no una certificación permanente de conexión. Comparar con un latido reciente y la tarjeta real. Un HTTP 401 sin sesión demuestra que una ruta existe y exige autenticación; no demuestra que un mensaje se haya entregado.

## 11. Pruebas de código y recuperación técnica

Para el programador: abrir PowerShell en `C:\Users\lenovo\Desktop\wacrm`. No instalar dependencias si ya están presentes y funcionando.

```powershell
git status --short
node --test scripts/multichannel/whatsapp-session/adapter.test.mjs scripts/multichannel/whatsapp-session/navigation-client.test.mjs scripts/multichannel/whatsapp-session/campaign-client.test.mjs scripts/multichannel/live-campaign.integration.test.mjs
```

Resultado del corte: **76 pruebas aprobadas**. La prueba SQL usa PGlite, instalado en la carpeta local de verificación; no es una base productiva nueva. En otra computadora habrá que preparar la misma dependencia de pruebas antes de ejecutar esa suite.

Para cambios de CRM: usar los scripts reales `npm test`, `npm run lint`, `npm run typecheck`, `npm run build`, seleccionando primero las pruebas afectadas. El repositorio contiene trabajo local ajeno y archivos de salida que pueden afectar una comprobación global. No borrar ese trabajo para conseguir un build verde. Este incremento de cierre cambió el ejecutor JavaScript; no se afirma un nuevo build integral de todos los frentes.

Diagnóstico local de solo lectura:

```powershell
node output/multichannel-private/whatsapp-session/prepare-ten-lines.mjs --health
```

Ese ayudante está en la instalación privada; no forma parte del paquete compartible. No enviar la configuración privada para que otra IA lo ejecute fuera de esta laptop. Para una recuperación avanzada revisar primero `start.ps1`, `line-manager.mjs` y el diario real. No ejecutar los ayudantes privados de pruebas/reconciliación como si fueran botones habituales: algunos hacen envíos o cambios reales.

## 12. Esquema aplicado: no volver a ejecutar todo

Supabase mantiene migraciones ya aplicadas por nombre, entre ellas: `whatsapp_session_inbound_bridge`, `whatsapp_session_outbound_queue`, `multichannel_sms_dispatch`, `multichannel_live_campaigns`, `whatsapp_session_text_menus`, `whatsapp_cloud_support_handoff`, `whatsapp_session_outgoing_echo`, `phone_echo_preserve_reactivation`, `inbox_pending_contact_count`, `sticky_support_conversation`, `support_meta_wait`, `close_unstarted_whatsapp_reply`, `session_menu_reply_title`, `whatsapp_owner_management`, `meta_free_entry_quota_reconciliation`.

Las versiones horarias guardadas en Supabase no siempre coinciden con el prefijo del archivo local de una migración aplicada por la herramienta. Comparar historial y definición real antes de aplicar. No ejecutar a ciegas toda la carpeta ni reconstruir tablas productivas. No abrir permisos públicos para solucionar una consulta fallida.

La corrección del contador comercial usa la evidencia de facturación de Meta para excluir entradas gratuitas de publicidad; no basta con que un mensaje diga «gratis». La regla de esperar tres minutos y la regla de facturación son responsabilidades distintas.

## 13. Pendientes, en el orden en que conviene construir

### Prioridad 0 — dejar estable lo que ya envía

1. Cerrar la reconexión de 05 y verificar nuevamente 02/04 después del arranque. Conservar los cinco perfiles e identidades.
2. Confirmar continuidad entrante → automatización → salida → acuse desde cada respaldo. Las cinco pruebas de este informe fueron salientes de texto.
3. Vigilar que un eco automático no pause la conversación como si lo hubiera escrito una asesora. El arreglo está en `adapter.mjs`; las dos pruebas iniciales fueron conciliadas con sus acuses y diarios, sin borrar registros.
4. Revisar el historial visual de las dos primeras campañas: se conservaron los marcadores iniciales y los ecos recibidos. No se borraron filas para esconder la incidencia; falta comprobar que la vista no duplique esos registros históricos.
5. Confirmar llamadas de cron y procesamientos tardíos tras una caída. No dejar mensajes esperando horas por una clasificación ya resuelta.
6. Verificar mensajes rápidos con `/` y comandos de automatización sin demoras artificiales ni ejecuciones repetidas.

### Prioridad 1 — terminar el recorrido comercial y campañas

7. Implementar medios de sesión en la cola existente: imagen, audio, video y documento. Mantener archivo, identidad del destinatario, permisos, orden, acuse y revisión de resultados inciertos.
8. Reutilizar las 161 definiciones existentes; empezar por CURSOS GENERALES y farmacia, conservando títulos/IDs y los textos aprobados. No duplicar todas las automatizaciones para cada número.
9. Probar texto → audio → menú → respuesta numérica → siguiente rama → atención humana desde CRM.
10. Completar campañas con secuencias de medios, varios destinatarios y bloques configurables; SMS solo texto/emojis según el dispositivo y su codificación.
11. Hacer visible qué línea falló, motivo, siguiente ruta y qué quedó pendiente. Separar rechazo confirmado de resultado incierto.

### Prioridad 2 — grupos, adjuntos y soporte

12. Añadir Chats/Grupos en Inbox, por líneas autorizadas; iniciar por 933. Un mismo nombre no identifica un grupo: usar cuenta + línea + ID real del grupo.
13. Ver participantes, nombre/número/usuario cuando exista, exportar y después cubrir altas/bajas, descripción, imagen y permisos. Las acciones dependen de que la cuenta sea administradora.
14. No guardar por defecto el contenido de grupos en la base central; aplicar la política expresa del propietario. Mantener separadas reglas de grupo y reglas de estudiante.
15. Descargar y mostrar adjuntos recibidos; detectar vouchers anteriores por operación/evidencia y enlazar al pago validado. No generar una segunda validación del mismo comprobante.
16. Revisar permisos CEO/delegados de limpieza y las funciones de las asesoras. Limpiar el Inbox no borra toda la conversación del teléfono ajeno.

### Prioridad 3 — integrar los demás sistemas

17. Conectar fechas de hojas y aula a las campañas con ID estable, versión y deduplicación. Mantener programación manual mientras esos contratos se construyen.
18. Terminar la consulta académica de identidad, deuda, cuotas, acceso y derivación a asesora; pago siempre validado por persona autorizada.
19. Emitir/guardar documentos, boletas y certificados según el sistema y las plantillas existentes. No crear un segundo Drive ni una segunda fuente de deuda.
20. Resolver CONTACTADO y otros cambios de etiquetas/desplegables con la Base Comercial, conservando fórmulas y trabajo ajeno.
21. Configurar y probar SMS físico si se decide el equipo; correo quedó aplazado.

### Siguiente fase acordada — Contabo

22. Inventariar servicio, almacenamiento, perfiles y credenciales; respaldo privado y plan de regreso.
23. Llevar el ejecutor a un servicio persistente con reinicio y alertas, manteniendo accesos seguros. Acordar cómo transferir/revincular las sesiones; no prometer que copiar carpetas entre sistemas las conserva sin probarlo.
24. Probar conexión, recepción, respuesta, acuse, recuperación y disponibilidad continua con la laptop apagada. Después retirar la dependencia del ejecutor local.

## 14. Relación con el aula virtual y las hojas

Repositorio separado del aula: [insticrece-web](https://github.com/proinstitucionbyg-byte/insticrece-web), carpeta `C:\Users\lenovo\Desktop\insticrece-web`. Revisar sus propios `AGENTS.md` y documentos antes de tocarlo.

Referencias leídas en ese proyecto: `docs/PROJECT-STATUS.md`, `docs/DATA-OWNERSHIP.md`. Allí se documentan desarrollos locales y datos ficticios; no se deben presentar como una integración productiva completa con WACRM. Para detalle: `docs/ACADEMIC-AUTOMATION-MAP.md`, `docs/ENROLLMENT-BRIDGE-LAB.md` y `docs/CERTIFICATE-SOURCE-GATE.md`.

El panorama solicitado por el propietario incluye matrícula, usuario del alumno, Drive, pagos validados, boletas, cronograma, acceso al curso, deuda/retiro/reingreso, notas y evaluaciones, clases/Meet, reprogramaciones justificadas, certificados, encuestas, fidelización y recordatorios. El bot debe consultar y ejecutar contratos de esos sistemas; no inventar otra base paralela para resolverlos rápido. Las aprobaciones académicas/financieras y los permisos del docente deben mantenerse separados.

## 15. Cómo continuar con ChatGPT sin perder el contexto

En la carpeta de entrega hay un archivo **PEGAR_EN_CHATGPT.txt** y un ZIP de código. El paquete de configuración se entrega aparte dentro del mismo ZIP exterior.

1. Abrir una conversación nueva en ChatGPT y adjuntar primero este informe y el archivo de contexto.
2. Adjuntar la copia de código y el JSON de automatizaciones si el entorno puede leer archivos comprimidos. Si no puede, descomprimir y adjuntar solo los archivos del punto que se vaya a trabajar.
3. Pedir primero que identifique el próximo pendiente y los archivos afectados. No pedir «rehaz todo».
4. Antes de pegar un cambio en el equipo, pedir el archivo completo o un parche exacto, qué cambia y cómo comprobarlo.
5. Guardar una copia del archivo anterior. Aplicar un cambio por vez. Si falla, corregir ese fallo antes de seguir.
6. No ejecutar `git reset`, borrar perfiles, reinstalar todo, cambiar claves o volver a aplicar migraciones porque una IA lo sugiera sin evidencia.
7. Si ChatGPT no tiene acceso al equipo, a Supabase o a EasyPanel, debe decirlo: podrá preparar código, pero no puede afirmar que lo publicó ni que llegó un mensaje. La comprobación física se hace en el sistema real.
8. Para retomar con una herramienta que sí tenga acceso a esta laptop, conservar esta carpeta y sus archivos privados originales; el ZIP compartible no los sustituye.

## 16. Qué no volver a hacer

- No repetir una bienvenida o prueba ya entregada para tapar un error de acuse.
- No interpretar un LID de WhatsApp como teléfono por tener muchos dígitos.
- No confundir datos guardados con una conexión viva.
- No archivar o reemplazar el mismo número desde una tarjeta histórica.
- No borrar diarios, perfiles, conversaciones, fórmulas ni cambios de otro frente.
- No decir «bot al 100%» por ver un QR, un build verde o un mensaje de texto entregado.
- No mantener en el informe enlaces del panel local con token ni datos de sesión.
- No dar por gratuito el sistema entero: WhatsApp de sesión, IA, SMS y alojamiento tienen conceptos y configuraciones distintas.

El siguiente responsable debe actualizar este informe y el registro de verificación después de cada prueba real, indicando qué quedó pendiente. La continuidad depende de conservar evidencia y archivos, no de confiar en que otro chat recuerde toda esta conversación.

## Anexo A. Pedidos funcionales que también deben conservarse

Este inventario describe el destino solicitado, no funciones ya terminadas. Las hojas y el aula necesitan sus propios contratos y permisos.

### Seguimiento de ventas

- Incluir prospectos y seguimientos que dejaron de responder. Excluir no interesados y respetar la decisión del contacto.
- Primera reactivación aproximadamente 48 horas después; en el relato también aparecen ejemplos de tres días. El propietario debe cerrar la regla exacta antes de programarla.
- Tres o cuatro días después del WhatsApp, seguimiento por SMS si está configurado; después otro WhatsApp unos cinco días más tarde. Más adelante aparecen una espera de trece días y otra de diez días.
- Continuar algunos contactos hasta aproximadamente dos meses, descansar cerca de un mes y hacer una última comprobación de interés. Después, si corresponde y hay autorización, pasar a la cadena de cursos gratuitos.
- Estos plazos requieren una tabla editable por campaña y por evento inicial. No convertir fechas de ejemplo de octubre en fechas permanentes ni enviar simultáneamente todo el historial pendiente al activar el bot.
- Cuando el interesado responda, detener los recordatorios que ya no correspondan y continuar el recorrido de venta; pasar a asesora si lo solicita o el sistema no resuelve.

### Cursos gratuitos y modalidades

- Preparar enlaces/grupos de los módulos unos 25 días antes, con alarmas para las asesoras si la creación no puede automatizarse de forma fiable.
- Importar listas y facilitar el enlace de entrada; añadir directamente participantes solo cuando WhatsApp lo permita y existan permisos.
- Admitir cursos de una semana, uno, dos, tres, cuatro, cinco, seis meses y posibles ampliaciones. Duración, acceso, precio, certificado y plan de pagos son reglas distintas.
- El relato contempla una semana adicional en cursos cortos, acceso de un mes en gratuitos y accesos adicionales por pago/certificación. También contempla un mes adicional para estudiantes de un mes que pagaron. Hay detalles por aclarar: cerrar una matriz por modalidad antes de restringir accesos automáticamente.
- Si el alumno vuelve después del vencimiento, identificar su matrícula anterior y lo que pagó, aplicar el protocolo de recuperación y no cobrarle por error otra vez el mismo concepto.
- Estudiar varios módulos gratuitos o paquetes cortos no concede automáticamente el certificado de seis meses. Se pidió un examen de regularización y un certificado con condiciones y precio propios, todavía por definir.

### Matrícula, pagos y documentos

- Tras identidad y pago validados: carpeta existente del estudiante, boleta, ficha de matrícula, cronograma y registro; después usuario del aula, enlace y bienvenida.
- Avisar y resolver documentos/datos pendientes cuando no se terminaron de enviar dentro de la ventana inicial. Conservar la continuidad por WhatsApp de soporte.
- Dar un mensaje de acceso corto y práctico, un video de ingreso de hasta unos 30 segundos y tutoriales dentro del aula. No transmitir claves privadas de administración para resolver accesos de alumnos.
- Ordenar alumnos activos por curso/cohorte de ingreso, con identificación estable y fecha de pago. Mantener el número de operación y el concepto de cada cuota.
- Guardar comprobantes y boletas posteriores dentro de la carpeta del estudiante, por pago/concepto, con acceso de lectura adecuado y enlace desde su aula.
- Consultar deuda pendiente antes de responder cuánto debe. Validación humana del pago antes de generar efectos oficiales.
- No duplicar una operación, matrícula ni certificado porque se reenvía una imagen. Mostrar referencia clara al pago anterior y su ubicación.

### Cobranza, permanencia y reingreso

- Recordatorios antes del vencimiento, por WhatsApp/SMS según programación; encuestas de satisfacción antes o junto al proceso de fidelización.
- Pronto pago con promociones configurables. No inventar ni fijar descuentos sin aprobación del propietario.
- Prórrogas excepcionales registradas: se habló de hasta diez días en una primera ocasión y de otra prórroga con condiciones distintas. Montos de mora, límites y segunda excepción siguen por definir.
- Si no paga ni responde, después del margen aprobado —se mencionaron tres o cuatro días— pasar a retirado/restringir acceso según el protocolo oficial, conservando pagos, notas e historial.
- Para reingresar, informar deuda y condiciones; no conceder acceso únicamente por pedirlo en WhatsApp.
- Campañas mensuales de recuperación con promociones distintas, aproximadamente durante ocho meses; después posible cadena gratuita. El número de meses y los mensajes deben quedar aprobados y editables.
- Dividir bases de llamadas entre asesoras. Los masivos no sustituyen el registro de la llamada ni permiten afirmar que una llamada se realizó automáticamente.

### Clases y soporte académico

- Conectar cuadro de inicios, temario, módulo, clase y reprogramación. Enlaces de Meet renovados por semana y avisados antes de clases; el mismo enlace semanal puede servir a varias sesiones de esa semana.
- Programación desde la cuenta Workspace autorizada; títulos según temario, anfitrión/coanfitrión y opciones de grabación/notas según permisos reales del servicio. No afirmar disponibilidad de una API sin verificarla.
- Una suspensión justificada debe reflejarse en calendario, aula y avisos; desplazar la clase al siguiente horario válido, evitando perder contenidos. Conservar autorizaciones y justificación privada.
- Registro docente, evaluaciones, materiales previos, trabajos/dinámicas, notas, plazo de exámenes, recordatorios y publicación según permisos. Los docentes no modifican notas ya cerradas sin el proceso de autorización de Coordinación.
- Delegados y comunicación institucional docente–grupo, evitando exponer bases completas de estudiantes al docente cuando no corresponda.
- Reportes de asistencia/desempeño docente, quejas, razones de retiro, alumnos activos/nuevos/retirados y resultados de fidelización. No deducir sanciones o descuentos docentes sin la política aprobada.

### Aula, comunidad y beneficios

- Aula sencilla para personas de aproximadamente 29 a 55 años: pocos bloques principales, recursos accesibles, tutoriales y soporte visible.
- Notificaciones, chat de soporte y futuros chats individuales/grupales por curso. Presencia y retención de conversaciones deben tener una política definida, no un borrado automático improvisado.
- Pop-ups, encuestas cortas, imágenes y comunicaciones programadas por fechas. Elegir canal, segmento, línea, contenido, espera y bloques desde una configuración comprensible.
- Seminarios cada dos o tres meses, calendario proyectado y alarmas claras para asesoras.
- Reinscripción a otros cursos y promociones de continuidad; avisos del certificado final aproximadamente dos meses antes del cierre.
- Convenios/cupones con vigencia, bolsa de trabajo y posibles ceremonias/testimonios. Son beneficios por desarrollar, no una promesa de que ya están disponibles.
- Rol audiovisual y tareas de contenido/testimonios con acceso acotado; no dar permisos de administración total por pertenecer a esa área.

### Administración y continuidad

- Solo CEO o personas autorizadas por él pueden limpiar conversaciones del equipo. Distinguir borrar/ocultar en CRM de revocar un mensaje elegible en WhatsApp; no prometer borrar un chat completo del teléfono del destinatario.
- Programación de masivos por líneas, fecha, cantidad, intervalos y bloques, con archivos según canal. Mantener ritmo y alertas; no considerar un resultado incierto como autorización para duplicar el envío.
- Procedimiento manual comprensible para cada operación crítica cuando la automatización no funciona: pago, matrícula, documento, acceso, reprogramación y soporte.
- Manuales por rol y consulta IA para asesoras, docentes y alumnos, con alcance distinto y sin revelar información de otros usuarios.
- Política de archivo y respaldo de material antiguo, incluidos videos y carpetas; posibilidad de copia privada en disco externo. Definir conservación antes de borrar información por antigüedad.
