# Aviso comercial 30 minutos antes del cierre

Solicitud vigente: solo contactos de VENTAS sin compra, sin comprobante pendiente y sin pago validado. Conservar literalmente los pasos de la automatización `UNOS 30 MINUTOS ANTES` (`041a265f-a688-43df-bd13-c4c2730c9d14`): saludo de Lex, audio del propietario, espera de un minuto y texto final.

El programador anterior exigía la estructura antigua imagen/audio/botones y un curso terminado; por eso rechazaba la automatización editada. Ahora la reserva atómica de `sales_window_followups` crea una ejecución durable del motor existente desde su primer paso. No copia contenido ni reinicia el curso. Se habilita desde 23 h 30 min hasta antes de las 24 h del último mensaje real del cliente; el cron periódico puede introducir su intervalo de comprobación. No se afirma precisión al segundo.

El motor consulta `sales_window_followup_is_current` antes de cada paso y después de la espera mediante la misma continuación: una respuesta nueva, pago pendiente/validado, matrícula, cambio fuera de ventas o ventana vencida impide seguir enviando. Una reserva por conversación y mensaje evita duplicados. El cron no utiliza las horas de los mensajes salientes para extender las 24 horas.

La configuración marcada como interna y de último contacto ya no exige `schedule`; la migración retira la `S` y añade `window_before_minutes:30`. El editor muestra la explicación en lugar del campo cron. Los cuatro contenidos del propietario no se modifican.

Comprobaciones locales: 102 Vitest (incluye validación, límites de ventana, exclusiones y cancelación del motor) y prueba PostgreSQL temporal que compila la migración, comprueba la reserva única, el paso original y las exclusiones por pago/área/respuesta. No se enviaron pruebas a estudiantes. Publicación, aplicación de migración y resultado real deben confirmarse aparte.

## Resultado publicado

- Commit `778c666f606c514700a317829206c230ad3784d3`, compilación EasyPanel **Success 05/11/2026 22:29:42 UTC**, SHA confirmado. Migración `sales_last_call_30_minutes` aplicada. La automatización conserva sus cuatro pasos y sigue activa; `schedule: S` ya no existe.
- El cron normal reservó un contacto comercial elegible mediante `912a6fce-0471-44e6-b24d-4b2021d544d2`; no se fabricó una entrada ni se modificó su fecha para probar. Log `time_based:last_call_30_minutes`, ejecución única y terminada en `success`.
- Texto inicial 22:31:54 UTC, audio 22:32:00 UTC y texto final 22:33:24 UTC: **los tres entregados**, con acuse real de WhatsApp. Se respetó la espera durable de un minuto (el cron añade su intervalo de comprobación). Esta es operación comercial autorizada del programador, no envío manual de pruebas a estudiantes.
- La tabla de reservas mantiene su estado técnico `sending`; para auditar el resultado real consultar el log y los mensajes anteriores. Falta conciliar ese indicador final con los acuses, sin reenviar contenido.

## Otros requisitos del adjunto que siguen pendientes

- Base general y bases de asesoras: dos indicadores compactos para estado comercial y solicitud urgente. Activar promoción debe reconocer prospecto; contacto manual/no interesado/seguimiento debe actualizarse de forma coherente en CRM y Sheets.
- Al pasar a fidelización, retirar la clasificación comercial incompatible. Los registros fuera de ventas no deben seguir apareciendo como leads activos; conservar historial y permitir reconocer INCORRECTO.
- Observaciones: notas y resúmenes editables de lo realmente conversado, con sincronización y sin borrar notas manuales.
- Cronogramas: conservar fecha real del pago; inicio lejano usa la fecha de inicio como base del cronograma. Inicio inmediato o incorporación en tercera clase usa la fecha pagada. No modificar las demás reglas ni convertir la fecha de inicio en un pago ficticio.
- Próximo módulo: consultar calendario real al ofrecer la siguiente fecha, con respuesta breve y natural. El contacto mencionado 51986813393 no autoriza enviarle pruebas.
- Revisar las rutas «Cómo matricularme», «Tengo dudas», promoción y el orden de bloques originales; no reemplazar textos ni acumular botones inconexos.
- Permitir subir stickers propios desde el selector del compositor.

Contabo continúa pendiente de orden expresa. Los cambios previos de Sheets/matrícula y otros archivos ajenos se conservan sin incorporarlos automáticamente en la publicación del bot.
