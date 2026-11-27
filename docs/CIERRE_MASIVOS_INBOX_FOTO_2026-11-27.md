# Bloque de masivos, Inbox y foto pública — 27/11/2026

## Alcance autorizado

- Plantilla Excel con 1000 filas y columnas Orden, Prefijo, Telefono, Nombre.
- Botón visible para aplicar variables por rango; insertar variables desde el mensaje.
- Reparto por posiciones con cuatro líneas elegidas; conservar horario y pausas separados.
- Ante desconexión técnica, repartir los pendientes entre los respaldos elegidos disponibles. Una restricción del proveedor pausa la campaña; un intento incierto no se repite.
- Filtro visible No leídos y búsqueda global por contacto, teléfono e historial.
- Pausa indefinida canónica DESACTIVADO AMBOS; impedir que los manejadores entrantes la conviertan en temporal.
- Foto pública SOLO del WhatsApp Cloud API +51 937467119, phone_number_id 1123799470826528. No cambiar las fotos de los WhatsApps vinculados.

## Cambios y comprobaciones

- 56e387d: controles de masivos y plantilla Excel; 23d3862: búsqueda, pausa, foto y reparto técnico equilibrado.
- 7c831e7: mensajes claros ante una respuesta de carga no válida.
- 0a1c7ce: reutilizar uploadResumableMedia existente, autorización OAuth para los bytes y sesión firmada sin alterar su URL; resolver la aplicación del propio token cuando META_APP_ID no está configurado.
- 34011e6 y a279c05: búsqueda con permisos y límites de historial explícitos, escaneo de mensajes una sola vez, prefiltro numérico y carga del Inbox en páginas pequeñas.
- 45 pruebas Vitest y 31 pruebas de integración pasaron. TypeScript pasó antes de la compilación final.
- Prueba con cuatro líneas: la principal sin conexión repartió seis destinatarios 2–2–2 entre las otras tres; se conservó Detener.
- Pruebas de búsqueda: otra cuenta no aparece; historial anterior al permiso no aparece; mensajes ocultos de otro usuario no ocultan los del actual; anónimo rechazado.
- Validación real de la búsqueda optimizada en Contabo: teléfono 192,784 ms; nombre 180,209 ms. Se aplicó solamente después de una prueba transaccional revertida.
- Prueba de pausa sobre datos reales realizada en una transacción revertida. La migración protegió 33 pausas previas con la firma exacta del RPC anterior; no se dedujo la pausa a partir de etiquetas comerciales.
- Desde el navegador se descargó plantilla-destinatarios-insticrece.xlsx, se pegaron dos filas con nombres y fechas, se verificaron sus vistas previas y se abrió el reparto por posiciones. No se activó ninguna campaña de prueba.
- 934218296 figura como Jordan ⚽🏆; también aparece en otros mensajes. Otro contacto llamado Vladimir usa 924531706. No se modificaron estos contactos.

## Publicación y operación

- Producción: Contabo, Compose personal_supabase-migration-export, web personal_supabase-migration-export-web-1.
- No iniciar otro ejecutor de WhatsApp. La recuperación se hizo mediante el panel del ejecutor existente, conservando perfiles.
- 933691668, 922779439 y 947370506 volvieron a ready tras recuperarse de Startup timeout. 994174238 continuó detenido y pausado; no se activó por inferencia.
- Respaldo de esquema anterior al bloque: /etc/easypanel/projects/personal/supabase-migration-export/campaign-controls-20261127/before-23d3862-schema.sql.
- Migraciones iniciales aplicadas de forma transaccional; migración optimizada 20261127163000 aplicada después de probarla y revertir la prueba. Se notificó recarga del esquema de PostgREST.
- Tareas temporales a retirar al cerrar: personal/campaign-controls-20261127 y personal/inbox-repair-20261127, además de sus marcadores campaign_controls_diag e inbox_repair_diag. No retirar whatsapp-health-supervisor.

## Ruta para la foto

Configuración → WhatsApp → Foto pública de WhatsApp API → seleccionar PNG/JPG → Publicar foto en WhatsApp API → Consultar foto publicada.

Enlace directo: https://personal-wacrm.exjald.easypanel.host/settings?tab=whatsapp#foto-publica-whatsapp-api

La API comprueba que el número consultado siga siendo el elegido antes de publicar. La foto interna de Perfil es independiente.

## Foto confirmada y última adaptación de sonido

- Web a279c05 compilada y publicada. Meta confirmó la foto nueva; el navegador cargó la imagen nueva de 640 px y se comprobó visualmente el emblema Black Friday. La imagen devuelta cambió de 534428325_1517453336255455_6717436115899596452_n.jpg a 931570713_2164804981063643_2263292816918785321_n.jpg.
- Ruta comprobada desde Configuración → WhatsApp. El control queda separado de Perfil, que solo guarda el avatar interno.
- 3cfbb8b corrige el silencio: el cambio ya no depende de AudioContext.ready; cierra el contexto sonoro al silenciar y verifica la elección actual antes de reproducir una notificación pendiente.
- Solo el propietario puede silenciar para su usuario y navegador. Las asesoras mantienen la preferencia activada aunque exista una preferencia antigua en off; su botón solo permite probar el sonido. El CRM no controla el volumen o los permisos externos del navegador/sistema operativo.
- Siete pruebas de sonido pasaron y TypeScript pasó.
- 52020a0: la lista normal también usa la consulta autorizada rápida, hidratando los resultados en lotes de 40 con los permisos del usuario. Se conserva el renderizado inicial de 60. Evita que la selección ordenada de todos los chats vuelva a agotar el tiempo antes de recibir la siguiente página.
- Se probó y revirtió la habilitación de páginas normales antes de aplicarla: primera página de IDs 164,344 ms y segunda 67,710 ms. Migración 20261127170000 aplicada con recarga de esquema.
- Publicación 52020a0 verificada en producción: imagen sha256:0ea158ed07061369c03a04fecdac526112cb3f3b7afffd4568936684f86024a8. Inbox con conversaciones visibles y sin error de carga. Silencio del propietario conservado después de recargar (aria-pressed=false). Las dos tareas temporales y sus marcadores fueron retirados; se conserva el supervisor permanente.

