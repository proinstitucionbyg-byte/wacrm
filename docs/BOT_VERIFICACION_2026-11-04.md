# Bot: cierre de envío y continuidad — 04/11/2026

Este corte complementa `BOT_ALCANCE_VIGENTE.md` y prevalece sobre sus estados antiguos de publicación. No declara terminado todo el bot.

## Comprobado en producción

- `285251a` publicado: compilación EasyPanel correcta, controlador de soporte responde 401 sin sesión. Migraciones de soporte inicial, eco de mensajes y conservación de reactivaciones aplicadas.
- Soporte 933691668 y WhatsApp 04 947370506 se restauraron `ready`/CONNECTED sin QR. Principal 987020644 sigue detenido y pausado. WhatsApp 03 conserva perfil, detenido tras no completar conexión.
- El mensaje manual pendiente de Mariluz «Me confirma si tiene alguna otra duda?» fue enviado el 04/11 a las 12:58 Lima y confirmado entregado con ID real. Dos horarios antiguos duplicados quedaron cancelados sin enviarlos. El horario escrito por el propietario en el teléfono a las 12:17 se incorporó al CRM; no se reenvió.
- Prueba Luis «PRUEBA SOPORTE 1300»: entrada real por Cloud a las 13:02; una bienvenida salió desde 933691668. El propietario mostró la recepción en WhatsApp. La cola la conserva aceptada; el acuse automático todavía requería conciliación. No repetir esa bienvenida.
- Incidencia descubierta por la prueba: una respuesta manual posterior volvió a Cloud. Se prepara fijación explícita de la línea de soporte, sin inventar recibos entrantes.
- Instrucciones activas de IA actualizadas para grabaciones, PPT, acceso vigente 24 horas, no desaprobar por inasistencias y evaluación tras ocho clases. Cuatro consultas reales al proveedor de IA pasaron; no se enviaron por WhatsApp. Se conserva el resto del contexto institucional. Ubicación para el propietario: AI Agents → Setup → contexto del negocio.

## Corrección del protocolo comercial

- No interpretar falta de referral como prueba de que deba trasladarse un embudo comercial. Pauta confirmada conserva su canal y restricciones. Una conversación comercial con botones, oferta reciente o consulta comercial y ventana de envío habilitada debe conservar la continuidad en Cloud.
- El 04/11 se detectaron derivaciones erróneas de Jcoralt y César. Sus dos bienvenidas seguían en cola, sin inicio ni ID de proveedor: se cancelaron, se retiró la fijación de soporte y se restauró AREA VENTAS; se quitaron las dos etiquetas añadidas por esa derivación. No se borraron conversaciones, pagos ni historial.
- **Derivaciones nuevas desactivadas temporalmente** en `whatsapp_support_routes.enabled`, para evitar otros casos mientras se publica/verifica el guardado de continuidad comercial. El vínculo y los mensajes de WhatsApp Web permanecen operativos.
- La continuidad de un caso transferido debe incluir respuestas manuales y automáticas por el WhatsApp correspondiente. No regresar silenciosamente a API porque haya cupo. Una línea caída debe producir bloqueo/alerta o respaldo previamente autorizado; un resultado incierto no se reenvía por otra línea.
- No reenviar ni simular una entrada de cliente para retomar los botones de Jcoralt/César. Revisar estado y contexto originales antes de recuperar sus ramas.

## Incremento siguiente preparado

- Contador `(N) WACRM` de contactos pendientes de respuesta, independiente de abrir el chat. Un contacto con cien mensajes suma uno; un envío pendiente o fallido no reduce el contador. SQL probado con RLS y datos ficticios. Consulta del propietario: 149 en ese corte, cifra variable. Migración del contador aplicada; interfaz pendiente de publicación de este incremento.
- Fijación explícita de soporte en conversación; respuestas manuales con origen Cloud real y miembro autorizado; sin crear entrada falsa ni consumir reserva API. Prueba SQL de primer contacto → respuesta manual → bloqueo de línea caída aprobada.
- Teléfono verificado debajo de mensajes enviados y recibidos. Reconciliación de acuses perdidos mediante lectura del ID real del proveedor, sin reenviar.
- Dos checks verde fosforescente, más visibles; selector de emojis junto al compositor. Los stickers requieren transporte de medios, aún pendiente.

## Pendientes añadidos por el propietario

1. Mostrar archivos recibidos por WhatsApp Web, especialmente comprobantes; hoy hay imágenes con «archivo aún no sincronizado».
2. Extraer comprobante y número de operación como evidencia no validada. Comparar contra pagos anteriores; ante coincidencia verificada, mostrar **PAGO ANTERIOR DE MATRÍCULA**, enlace al pago original y evitar otro expediente de Finanzas. Si imagen/datos/coincidencia no son verificables, revisión humana; no validar ni rechazar automáticamente. No borrar evidencias repetidas.
3. Continuación física completa desde Luis: menú numerado → respuesta → misma rama CRM → misma línea de soporte, con acuse real y texto manual desde CRM.
4. Publicar/verificar el contador y los controles visuales nuevos, conservando permisos CEO/delegados para limpieza.
5. Secuencias de medios, stickers, campañas reales habilitadas/verificadas, respaldo de líneas en recorrido completo, SMS físico bidireccional y conexión web/aula siguen pendientes. No prometer SMS gratuito ni configurado por tener código. Los SMS no reemplazan respuestas normales de WhatsApp: son respaldo/programación expresa.
6. Nuevo requisito de grupos: pestañas Chats | Grupos para Fidelización, selector de una línea por defecto y otras habilitadas expresamente por Dirección. Separar grupos homónimos por cuenta/línea/ID. Gestionar nombre, descripción, foto, participantes, invitaciones y permisos solo cuando WhatsApp confirme facultades de administrador. No hay portada independiente comprobada. NO archivar mensajes grupales en nuestra base ni copias locales sin autorización expresa; conservar lo ya guardado y añadir control separado por grupo/línea. Mantener el historial propio de WhatsApp. Lectura/participantes/envío manual locales existentes no equivalen a toda esa interfaz en CRM. Contabo es una migración aparte.

## Verificaciones locales del incremento

- 21 pruebas SQL de cola/soporte/menús/eco; 55 pruebas adaptador/salida; 21 Vitest de origen, transporte y protección comercial; contador SQL con cien mensajes, lectura, fallo y RLS. Se amplían solo cuando el cambio lo requiere.
- Build aislado del núcleo: compila, TypeScript y generación de 100 páginas; comprobar exit 0 al finalizar. Cambios posteriores de emojis/protección comercial requieren al menos comprobación de tipos y lint del índice final antes de publicar.
- Todos los archivos privados, tokens, sesiones y pruebas reales siguen en `output/multichannel-private`, excluido de Git. No añadir cambios ajenos de matrículas, hojas, coexistencia ni sus documentos al commit del bot.
