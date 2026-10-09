# PERMISOS Y ORDEN DEL CRM

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
- Compilación y publicación de este lote: confirmar antes de presentarlo como instalado.

## INCIDENCIA DE CONECTIVIDAD RESUELTA

- El servidor standalone usaba el HOSTNAME del contenedor y escuchaba en una sola red.
- Desde el contenedor: 10.0.1.86:80 devolvía 200; 10.11.0.95:80 y 127.0.0.1:80 rechazaban conexión.
- Dockerfile fija HOSTNAME=0.0.0.0. Commit 507017c publicado.
- CRM volvió a abrir. La ficha de prueba muestra automáticamente nombre, DNI, nacimiento, teléfonos, dirección, curso, promoción escrita y pago real de 20.00.
- Aún falta inicio oficial y confirmar oferta/identidad para enviar esa ficha a registro. No afirmar matrícula ni entrega de documentos completadas.

## TRABAJO QUE SIGUE PENDIENTE

- Controles de área/cargo/porcentaje, reparto ponderado y derivación exacta después del cuarto contacto.
- Etiquetado múltiple/contextual, restricciones por etiqueta y etiquetas de agente/área.
- Atajos MANDAR(...) y selector de bloques preparados.
- Traspaso con alcance de historial y presentación pendiente de envío.
- Supervisión/archivo/recuperación del chat interno y acceso por conversación.
- Revisar el resto de módulos existentes: disponer de un interruptor en el catálogo no acredita que todas las rutas y tablas históricas lo apliquen.
- Entrega de PDF por WhatsApp y bienvenida con imagen/audio: pendiente; el usuario aplazó enviar esos recursos.
