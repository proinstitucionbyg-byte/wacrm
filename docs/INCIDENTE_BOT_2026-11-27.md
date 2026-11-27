# Recuperación del bot — 27/11/2026

- Incidente verificado: el heartbeat de gestión dejó de actualizarse; una recuperación quedó running y el ejecutor entró en reinicios. El registro privado repetía open_session_store; Docker no indicó OOM.
- Causa de la imposibilidad de arrancar: bloqueos persistentes abandonados después del cierre del proceso. El supervisor anterior reiniciaba el contenedor sin recuperar esos bloqueos.
- crm-management.mjs mantiene el heartbeat mientras ejecuta una orden lenta. Conserva una sola orden en curso, validación de cuenta, confirmación del resultado y prohibición de repetir acciones inciertas.
- El supervisor detiene el único ejecutor existente y comprueba que no haya otro contenedor con escritura sobre el volumen. Solo entonces archiva worker.lock y enlaces Singleton de perfiles con dueño validado; conserva credenciales, historiales y pausas.
- La antigua tarea worker-five-plan-init estaba ociosa pero tenía el volumen en escritura. Se detuvo y quedó restart=no; el observador de solo lectura se conservó.
- La recuperación real archivó 16 bloqueos. No se ejecutó otro bot ni se borraron perfiles. Copia persistente del cambio de gestión en worker-runtime-final; el supervisor la instala mediante Docker antes del arranque. Se corrigió el intento inicial de copia desde el usuario sin permisos del contenedor.
- 12 pruebas específicas pasaron: heartbeat durante orden lenta, no repetición, desvinculación, identidad, watchdog, preservación de perfiles y rechazo de dueño incorrecto.
- Verificación en navegador: 922779439, 947370506 y 924413651 conectados; 933691668 solicitó QR. Heartbeat fresco de 0–2 segundos. 994174238 permaneció detenido y pausado.
- Pendiente del usuario: escanear el QR de Soporte desde el celular 933691668. No se afirmó entrega de mensajes ni se activaron campañas de prueba.
- Web e imagen del worker se conservaron; se aplicaron cambios puntuales al runtime y supervisor. No se tocaron automatizaciones comerciales ni matrículas.
- Cierre: plan de arranque conserva la nueva línea 924413651; se registró su tarjeta en pausa sin activar automatizaciones. Tarea temporal incident-20261127 y su marcador retirados; supervisor permanente activo. Última lectura: heartbeat de 2 segundos, tres ready y Soporte awaiting_qr.
- Revisión posterior al QR: 47a611b limita getState a 8 segundos y evita que el temporizador destruya una sesión ya verificada ready/CONNECTED aunque initialize siga pendiente. 65 pruebas de adapter y 14 de panel pasaron. Se añadió diagnóstico privado cached=1 sin refresco del navegador, manteniendo autenticación. Tras instalar y reiniciar conservando perfiles, Soporte 933 confirmó ready, socket CONNECTED, sin nuevo QR.
