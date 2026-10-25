# Sincronización comercial · ahorro de escrituras

Se publicó en Apps Script WACRM - Base Comercial la optimización que estaba pendiente localmente. La versión instalada coincidía exactamente con la versión anterior de Git antes de editarla. Solo cambió la reconciliación del estado recordado: guarda SALES_MAIN_STATUS cuando cambia, conservando las comprobaciones previas de cambios pendientes, ediciones recientes y errores de API.

Comprobación local: 18 pruebas de workbook-sync pasaron. Una simula 300 contactos con el mismo estado y exige cero escrituras repetidas; otra conserva las primeras escrituras y los cambios reales. El resto cubre ediciones humanas, concurrencia y reintentos.

Se volvió a cargar el editor después de guardar y la huella de la fuente guardada coincidió con la local probada: 7da9260b611880b0b11ac3e1a9ffdc26016311138503d2cac9e8493d19c17767. Fuente anterior: 0388b6a64c01f0646cb0904f6f6d9d748e4cd33efb28380b6f30b1511641e6e1.

La sincronización sigue configurada cada diez minutos. Este ahorro no demuestra por sí solo una reducción concreta de duración; hay que medir varias ejecuciones. Antes de publicar se observaron completadas las pasadas de 15:29:32 (95,816 s), 15:39:32 (102,808 s) y 15:49:32 (102,549 s), hora de Lima.

Se corrigió además PANEL!B5 en la hoja real: se agregó SEGUIMIENTO DE VENTAS a los estados que suma el contador, conservando los otros términos. Lectura y pantalla nativa: once seguimientos. No se modificaron contactos, estados, notas ni permisos al corregir esa fórmula.

Primera ejecución comprobada con la versión nueva: SYNC_VENTAS_CRM desde el editor, 16:01:04 → 16:02:12 Lima, registro «Se completó la ejecución». Es una comprobación funcional y una muestra de duración, no una medición estadística de mejora. La muestra de 327 IDs anteriores tenía cero duplicados y cero retrocesos cronológicos.
