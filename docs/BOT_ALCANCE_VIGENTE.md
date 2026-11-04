# Alcance vigente del bot — 04/11/2026

Orden del propietario: concentrarse en el bot; las hojas de cálculo quedan en espera. Reutilizar las colas y automatizaciones existentes. No presentar simulaciones como envíos reales.

## Corte nuevo: pausa, recuperación e historial independiente — 04/11, mañana

- En ejecución local: botones «Pausar todos los bots», pausa por línea y «Revisar y recuperar esta línea». La pausa es persistente, no quita los vínculos, conserva envío manual y retiene nuevas entradas localmente hasta reanudar. Recuperar no levanta pausas ni repite envíos inciertos. Verificación física: pausa reconocida por el adaptador, recuperación ready respetando la pausa y restauración del estado anterior. Hay cinco intentos históricos inciertos; NO reenviar automáticamente.
- Historial separado por cuenta/línea (`history.jsonl`), sin borrar mensajes al desconectar, detener o desvincular. Captura modelos ya cargados y nuevas entradas del diario; une mensajes por ID sin quitar los antiguos. Lectura fuera de línea y descarga JSON autenticada. Verificación física: 471 chats / 495 mensajes, 286639 bytes en ese corte. Se detuvo solo Principal, la API siguió mostrando 471 chats sin conexión y volvió a ready sin QR. Los archivos de adjuntos NO se respaldan todavía; tampoco se promete recuperar mensajes antiguos que WhatsApp nunca cargó. Los chats bloqueados no se muestran ni exportan.
- Código CRM local: importar Excel .xlsx/CSV/texto y pegar listas, límite 1000 teléfonos/2 MB; país con metadatos reales y formato E.164, normalización Perú, deduplicación, registro explícito de nuevos contactos por coincidencia exacta conservando nombres/datos existentes. No inventar permisos. Dependencias necesarias fijadas: exceljs 4.4.0 y libphonenumber-js 1.13.15. 24 pruebas de campaña/importación aprobadas.
- Código CRM local: botones/listas de las mismas automatizaciones se pueden presentar como menú numerado. La respuesta numérica devuelve el ID original de la rama únicamente si el menú fue aceptado por WhatsApp, corresponde a la cuenta/línea y no venció ni fue consumido por otro mensaje. No adivinar ramas. Requiere migración CLI `20261104111054_whatsapp_session_text_menus.sql`, NO aplicada. 26 Vitest de entrada/menús/transporte y 11 SQL de cola/menús aprobados.
- Suite local del ejecutor: 132/132. Build CRM posterior a las funciones de importación/menús: exit 0, 97 páginas. Los cambios posteriores de pruebas no modificaron código de producto Next.js.
- Pendientes reales: publicación del incremento CRM y migraciones revisadas; campañas del worker aún apagadas; SMS bidireccional físico; archivos adjuntos/secuencias de medios; participantes/exportación de grupos; integración web/aula y otras líneas físicas. La automatización antigua de farmacia que empieza con medios todavía no tiene transporte de adjuntos Web; no prometer que toda su rama ya funciona por haber implementado los menús.

Este corte prevalece sobre los contadores y pendientes históricos de los apartados siguientes.

## Publicación autorizada y pruebas con varios teléfonos

- El propietario autorizó explícitamente commit/push del bot, migraciones SMS/campañas/menús y publicación en el CRM. Preparación selectiva: se excluyen matrículas/hojas, la integración previa de coexistencia y credenciales. La copia aislada del índice compiló con exit 0 (96 páginas); Vitest de alcance 139/139, SQL SMS 17/17, menús/cola 11/11. Después se añadió el contexto asíncrono por entrada/línea, protección de bucles entre teléfonos propios y prueba de tipos; 27 regresiones del bloque de ingreso/transporte pasaron.
- Las tres migraciones autorizadas ya fueron aplicadas con éxito al proyecto existente: `multichannel_sms_dispatch`, `multichannel_live_campaigns`, `whatsapp_session_text_menus`. Se comprobó que `authenticated` no puede ejecutar sus transiciones directamente. El CRM aún espera el commit/despliegue de este corte y el worker sigue sin campañas habilitadas.
- Principal y Soporte se comprobaron `ready` simultáneamente. Soporte fue escaneado por el propietario, terminó en el número de prueba 933691668 y cargó 342 chats. WhatsApp 02 falló al vincular: el logout automático de LocalAuth intentó borrar un perfil bloqueado y produjo EBUSY sin manejar, apagando el proceso. Se corrigió con una subclase que conserva los archivos: el logout explícito de Client sigue revocando la sesión WhatsApp y cerrando su navegador. Suite local nueva 135/135; no se borran perfiles. Se recuperaron exclusivamente bloqueos viejos de líneas detenidas, verificando cuenta, edad y ausencia del navegador.
- El perfil fallido WhatsApp 02 permanece con su historial. Principal y Soporte se restauraron sin QR. Se abrió WhatsApp 03 con QR nuevo para otro teléfono; pendiente confirmación del escaneo. No reiniciar las sesiones durante esos escaneos.
- Grupos: lectura de participantes cargados y descarga CSV autenticada, con copia guardada para consulta sin conexión. Un mismo nombre de grupo no es una identidad: clave por cuenta/línea + ID WhatsApp. Verificado un grupo real con 14 participantes cargados y exportación disponible; no se declara lista completa. Los LID solo se convierten a teléfono si el caché oficial de WhatsApp devuelve el PN emparejado. No se agregan participantes a campañas al exportar.
- Las consultas entrantes fijan cuenta, conversación, línea y recibo original en contexto asíncrono; una consulta concurrente por otro número no cambia su origen. La protección SQL vigente también rechaza respuestas que quedaron obsoletas; no prometer todavía casos de automatización totalmente independientes para dos temas simultáneos de una misma persona.
- Borrado local CRM: se verificaron `inbox_management.conversations`, `inbox_management.messages`, `set_inbox_cleared`, `inbox_hidden_messages` y la ruta de ocultación que devuelve `scope: only_me`. No llamar borrado Meta ni borrar registros por prueba. La limpieza de conversación es del Inbox CRM y tiene recuperación; ocultar mensajes es personal. Solo el propietario puede delegar estos permisos según las funciones existentes.

## Requisitos de aceptación

- Diez sesiones propias de WhatsApp normal/Business aisladas (ampliación expresa del propietario el 04/11), con estado visible, y una bandeja CRM con origen por número y cambios de línea visibles en el historial. Conservar conversaciones; no borrarlas para resolver duplicidades.
- Respuestas de sesión mediante las automatizaciones, Flows e IA existentes, sin bloqueo por filtros de campañas Meta ni salida accidental por Cloud API. Mantener separadas las restricciones comerciales de Cloud.
- Envíos manuales y programados por fecha/hora de Lima, audiencia, línea preferida, orden de respaldo, bloques, intervalos y contenido; revisión, pausa y cancelación desde el panel.
- Respaldo antes de iniciar: siguiente WhatsApp autorizado disponible → SMS configurado/autorizado → alerta. Un resultado incierto requiere conciliación y no habilita otro intento por otra línea.
- Contrato de integración con web/aula, independiente del avance de las hojas. Derivación humana y reanudación expresa; grupos visibles. Llamadas quedan para evaluación después del texto y la programación.
- Cada dispositivo/SIM requiere vinculación/configuración y prueba física; no prometer diez teléfonos probados ni gratuidad absoluta solo por tener código.

## Estado vigente: panel de diez líneas, 04/11

- Límite real del administrador local: 10 perfiles activos, separados por cuenta/línea. La prueba abre diez runtimes y rechaza el undécimo antes de abrir otro navegador. El registro conserva hasta 20 líneas detenidas, sin borrar perfiles.
- Panel local preparado con diez pestañas, contador de sesiones abiertas, teléfono confirmado y estado por pestaña. Conectar, detener conservando vínculo y desvincular mediante logout explícito afectan solo a la línea elegida. La guía está en «Conectar o administrar mis WhatsApps».
- Verificación física de esta continuación: Principal `ready`, sin QR; Soporte `awaiting_qr` con imagen QR obtenida por el endpoint autenticado; ocho pestañas más detenidas. El navegador mostró ambas situaciones y el QR de Soporte. Esto NO acredita diez teléfonos vinculados.
- Compatibilidad de QR nativo: observa únicamente el canvas de inicio de sesión en el perfil aislado; el adaptador acepta PNG temporal y el panel conserva ETag para no recargar imágenes idénticas. La espera de escaneo no destruye el perfil por el límite de arranque. No guardar QR en el diario.
- Suite del ejecutor: 119/119 aprobadas. Integración SQL de campañas en PostgreSQL temporal: 11/11 aprobadas; Vitest campañas 16/16; typecheck acotado y ESLint aprobados. `npm run build` completo terminó con exit 0, 97 páginas generadas (incluye trabajo previo del checkout). No se enviaron mensajes masivos por estas comprobaciones.
- Registro de líneas para CRM: nueva interfaz local `session-line-manager.tsx`, dentro de Multicanal, reutiliza `/api/multichannel/whatsapp/control`. El panel permite copiar número confirmado + clave de línea; el propietario registra y habilita la línea expresamente. NO confundir el vínculo local con automatizaciones ya habilitadas. La interfaz CRM nueva aún requiere publicación; no se ha migrado ni desplegado por esta ampliación.
- Campañas: código local de borrador/revisión/activación, horarios Lima, bloques, respaldo WA/SMS con permisos separados, alertas e incertidumbre sin reenvío. Migración `20261104073046_multichannel_live_campaigns.sql` NO aplicada y `campaigns` del worker NO habilitado. Persisten pendientes: SMS bidireccional físico, importación Excel/contactos nuevos, secuencias de medios, menús compatibles de las ramas y web/aula. No marcar el bot completo.

Las notas de cuatro líneas que siguen son evidencia histórica previa a esta ampliación.

## Incremento comprobado

- Administrador ampliado a cuatro sesiones; prueba verifica que la quinta se rechaza. Pestañas con estado textual de conexión. Bloque de administrador/vista: 12/12 pruebas; la ejecución aislada inicial falló por permisos temporales de Windows y la repetición autorizada pasó.
- Compatibilidad del acuse saliente conserva el identificador original del proveedor cuando falta `_serialized`, sin modificar sus fuentes ni fabricar claves. Dos pruebas nuevas pasan; suite completa anterior al último ajuste visual: 103/103.
- Al retomar, el ejecutor estaba apagado. El arranque falló porque `WAWebSocketModel` era nulo. La espera del módulo no resolvió el acceso: inspección del perfil real mostró la pantalla de QR «Escanea para iniciar sesión». Se abrió el perfil aislado para que el propietario vuelva a vincularlo. No borrar la sesión ni importar historial como entradas nuevas.
- El intento anterior quedó incierto y debe conciliarse antes de repetir. Aún no se acredita campaña real, respaldo SMS operativo, cuatro teléfonos físicos ni entrega completa.

## Secuencia de cierre

Prueba física BOT04 cerrada: respuesta generada por CRM, un solo mensaje saliente y acuse WhatsApp 2 (entregado). El CRM y el diario se conciliaron con el identificador real, sin reenviar. Se corrigió la comparación de destinatario LID/PN verificado y su falsa atribución de eco humano; 37 pruebas del adaptador pasaron. Restan las campañas reales, los respaldos y la vinculación de las otras líneas.

Actualización: el propietario escaneó; conexión real restablecida, `ready` sin QR, 482 conversaciones, 12 entradas nuevas sincronizadas sin errores. Se corrigió localmente el bloqueo visual de Cloud en conversaciones de sesión y se probaron tres casos, incluyendo el retorno a Cloud. La publicación del CRM y las campañas reales permanecen pendientes; la solicitud de prueba `BOT04` queda abierta para verificar una respuesta nueva.

Vinculación y conciliación → texto real y recepción sin refrescar → programación real sobre cola existente → respaldo y alertas → web/aula → medios/llamadas. Mantener el último resultado y el siguiente paso en `CONTINUAR_WACRM.md`.
