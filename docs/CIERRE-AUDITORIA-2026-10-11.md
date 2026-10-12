# Estado consolidado — 11 octubre 2026

Revisión de los informes del 9, 10 y 11 de octubre y búsqueda del código actual. Las entradas antiguas de esos informes no sustituyen sus correcciones posteriores. Esta revisión no cambia funciones, permisos ni credenciales.

## Comprobado

- Lote docente publicado: 1.171 pruebas aprobadas, 126 archivos. Selección de ficha y clasificación de quejas: 1.182 pruebas, 127 archivos; Success el 11 de octubre a las 21:11:36 UTC. Bienvenida con datos pendientes: 1.196 pruebas, 128 archivos y build aprobado; 04f771f publicado Success a las 21:26:37 UTC. Captura y reporte de referencias Meta: 1.202 pruebas, 129 archivos y build aprobado; 3432644 publicado Success a las 23:19:29 UTC. Programador del contenedor comprobado visualmente: automations/cron y flows/cron OK después del arranque.
- WhatsApp: consulta/promoción originales, lectura de voucher y DNI, revisión humana, registro Google, carpeta con originales y tres PDF, envío y bienvenida de respaldo. La prueba documental fue una simulación autorizada y requirió aislar una ficha antigua incompatible; no demuestra cualquier caso posible.
- WhatsApp sin teléfono visible: corrección publicada y entrega confirmada después de publicar, según evidencia de esta sesión.
- Messenger: respuesta real de Nutrición con imagen, texto y audio registrada en CANALES-SOCIALES-2026-10-11.md. No equivale a un recorrido documental completo repetido por ese canal.
- Etiquetas, permisos, cumpleaños en perfil, cuentas supervisadas/restablecimiento, adjuntos, navegación/duplicación, chat interno, traspasos, informes de primeras frases y detalle amplio de alertas: implementaciones y comprobaciones descritas en los informes. Traspaso real con historial completo confirmado por el usuario; historial restringido probado en servidor, sin acreditar todavía dos sesiones visuales completas.
- Cuadro de inicios actual/siguiente, ocho clases, feriados, listas a cuatro días y control de clases: instalados y comprobados según el informe del 10. Las clases dictadas requieren confirmación administrativa.

## Pendientes que impiden afirmar que TODO está terminado

1. Retirada de mensajes para todos: no implementada; no hay endpoint oficial comprobado en esta revisión. Borrado/recuperación del Inbox y ocultación local sí están implementados. No prometer las capacidades de la aplicación móvil como si fueran capacidades de la API.
2. Verificaciones específicas por cerrar: recorrido visual de traspaso restringido entre dos cuentas y recorrido documental completo repetido en Messenger. Correlativos entre dos matrículas distintas y reintento tras fallo comprobados en simulación del código Google: distintos entre matrículas y conservados en reintentos. No se consumieron números reales para probar.
3. Bienvenida con datos pendientes publicada y programador OK: dos horas, seguimiento cuatro horas después, aviso antes de 24 horas y check humano que no cierra los datos pendientes. Pruebas de servidor, permisos y tiempos aprobadas. No se ha ejecutado un envío real de este nuevo bloque a un estudiante. Calendar sigue aplazado y no se ha añadido una fila de expediente incompleto en Google Sheets.
4. Captura y reporte de origen implementados y publicados: primera referencia suministrada por Meta, anuncio/post/referencia, canal, ID y título recibidos, pagos validados y matrículas registradas, CSV y consulta privada del CEO. Pruebas transaccionales revertidas de conteos y permisos aprobadas. Nombres de campañas, conjuntos e inversión de Marketing API siguen sujetos a su acceso; no se infieren ni se reconstruyen anuncios históricos.

## Repetición de pruebas de traspaso

Se repitieron contra las funciones reales las solicitudes y aceptaciones entre la cuenta actualmente en VENTAS y LUIS actualmente en FIDELIZACION, usando contactos y grupo ficticios en una transacción revertida. Historial completo disponible, restringido oculta lo previo, el remitente pierde acceso y la IA y automatización siguen activas. No quedaron contactos ni asignaciones ficticias. La prueba visual con dos sesiones sigue pendiente: el navegador conserva la sesión limitada de Luis, sin sesión CEO disponible al comprobarlo.

## Cierres del lote posterior

- Selección explícita de matrícula: botón por ficha/comprobante; exige curso guardado y versión vigente. Recoge únicamente esa ficha, con comprobante validado y ámbito de cuenta. Sin selección, conserva el bloqueo seguro si hay varias pendientes. Pruebas de permisos, ficha ajena, versión vieja, curso desconocido y fallo de base de datos aprobadas.
- Quejas y soluciones: clasificación manual estructurada en la ficha lateral del chat; motivo, solución y estado. No permite marcar resuelto sin solución ni sobrescribir una edición más reciente. Reportes exclusivos del CEO, semanales los sábados a las 07:00 Lima y acumulados mensuales. Migración aplicada. Pruebas reales de permisos, historial restringido, reportes privados, edición concurrente y generación exclusiva del servidor aprobadas en una transacción revertida. No se enviaron mensajes a estudiantes ni quedaron fixtures guardados.
- Identificación escrita sin foto: ya existe respaldo mediante mensajes con nombre/documento/correo consistentes y captura de evidencia. Si falta el número de documento o hay contradicción, no inventarlo. Esto no equivale a automatizar ingreso provisional sin identificación completa.

## Cierre de la conexión docente

Conexión docente → urgencia → recálculo instalada y publicada en fc98ca0. Directorio privado de cinco docentes sincronizado, activador cada minuto, identidad/teléfono/horario comprobados en servidor con pruebas reversibles. Desplazamiento de ocho clases y reintentos comprobados en simulación Google; no se cambió una clase real para probar. Avisos confirmados de tres días, cinco checks incluida coordinadora y actualización de CONTROL DE CLASES. Detalle en DIRECTORIO-DOCENTES-2026-10-11.md. Este punto queda cerrado en implementación; no equivale a acreditar una cancelación real de un docente.

## Aplazados o sujetos a decisión externa

- Instagram: solicitud 1063999973309825 enviada, estado Revisión en curso confirmado. Evidencia output/META-ENVIO-CONFIRMADO-2026-10-11.txt. Pruebas propias de envío/recepción realizadas; acceso público no aprobado todavía.
- TikTok: ticket 4487581 Processing. Business Messaging no habilitado y transporte no implementado; una aprobación futura requiere implementación y pruebas, no lo activa automáticamente.
- Calendar/Meet, enlaces de clases, análisis docente, plataforma del estudiante, cobranza completa y cursos gratuitos/certificados: aplazados o fases posteriores según las instrucciones del usuario. No presentarlos como entregados.

Las preferencias y asignaciones definitivas del equipo siguen bajo control del CEO. Se conservan los cambios existentes de src/lib/supabase/client.ts y los archivos ajenos a esta revisión.

## Última publicación comprobada

b295cda publicado con Success el 11 de octubre de 2026 a las 23:23:45 UTC (18:23:45 Lima). Protección para que referencias publicitarias excesivas no bloqueen el mensaje entrante. Resultado local final: 1.203 pruebas en 129 archivos, compilación aprobada. Evidencia visual: output/PUBLICACION-FINAL-2026-10-11.png. Las pruebas transaccionales no dejaron contactos ni grupos ficticios (conteo final cero).

Para cerrar visualmente traspasos y el recorrido documental real en Messenger se solicitó iniciar sesión como CEO; el navegador seguía como LUIS PALACIOS con tres chats y ninguno de Messenger. No se sustituyeron sus credenciales ni se ampliaron permisos para eludir esta limitación. Retirada para todos y datos de Marketing API siguen sin cierre; no confundir el reporte de referencia de Meta con acceso a nombres de campaña/inversión.

## Protección adicional de bienvenida

68b072d publicado con Success el 11 de octubre de 2026 a las 23:47:52 UTC (18:47:52 Lima). El bloque excepcional de datos pendientes exige ejecución completa; resultado parcial no marca bienvenida enviada y queda para revisión, sin reintento automático. Criterio anterior conservado para las demás automatizaciones. 1.207 pruebas en 129 archivos y compilación aprobadas. Evidencia: output/BIENVENIDA-ENVIO-COMPLETO-2026-10-11.png.

Al retomar se comprobó nuevamente la sesión del navegador: seguía abierta como LUIS PALACIOS, AGENT, solo tres chats y ninguno de Messenger. Las pruebas visuales pendientes siguen requiriendo sesión CEO; no están acreditadas por esta publicación.

## Avance posterior con sesión CEO y Messenger real

La limitación de sesión anterior quedó superada: se verificó visualmente INSTICRECESEO, pro.institucionbyg@gmail.com. En el chat propio de prueba de Messenger 40281d66-daac-4b8d-a697-427a0bdc2741, la solicitud de Yape/Plin de las 18:54 Lima recibió el bloque original de la automatización, con texto, imagen y texto final; recepción comprobada en Facebook personal.

Se adjuntaron desde el Inbox tres PDF ficticios, marcados SIN VALIDEZ: boleta, cronograma y ficha de matrícula. Los tres archivos llegaron al Messenger personal (19:05–19:06 Lima), con enlaces de descarga visibles y tamaños 1,81 / 1,82 / 1,83 KB. Evidencia: output/MESSENGER-TRES-PDF-RECIBIDOS-2026-10-11.png. Esta prueba acredita entrega de adjuntos por Messenger; no acredita por sí sola el recorrido automático de validación, registro y generación de documentos. No se validó un pago ficticio ni se consumieron correlativos financieros.

Con autorización expresa del usuario se traspasó únicamente ese chat a LUIS PALACIOS, fidelización, seleccionando ULTIMO MENSAJE DEL ESTUDIANTE Y LOS QUE SIGAN. El CRM confirmó Traspaso realizado y mostró LUIS PALACIOS como destinatario, manteniendo IA activa y Automatización activa. Evidencia: output/TRASPASO-LUIS-RESTRINGIDO-2026-10-11.png. Falta entrar como Luis para comprobar visualmente su historial efectivo y después repetir con historial completo; se solicitó al usuario ese cambio de sesión.

### Verificación autónoma posterior de permisos efectivos

El usuario indicó que no estaba disponible para cambiar de sesión. Se comprobó el chat real de prueba desde el servidor con rol authenticated y el identificador real de Luis, aplicando las políticas de acceso de la base de datos (sin contraseña, sin cambiar su sesión ni ampliar permisos generales). Historial restringido: 10 mensajes visibles desde 2026-10-11 23:54:32.074 UTC; el saludo antiguo de las 00:17 Lima no era visible. Etiquetas visibles: ASESOR LUIS PALACIOS y AREA FIDELIZACION. Asignación a Luis, IA y automatización activas.

Después se aplicó el historial completo mediante transfer_inbox_conversation, con autoridad del CEO y la autorización previa limitada a este chat. Al consultar nuevamente como Luis: 21 mensajes visibles, incluido el saludo antiguo, límite -infinity y ambas etiquetas conservadas; IA y automatización siguieron activas. Se dejó el chat de prueba asignado a Luis con historial completo. La comprobación efectiva de acceso e historial queda acreditada en servidor; no se afirma haber iniciado sesión visualmente como Luis. No se necesita que el usuario cambie de sesión para acreditar estas políticas.

## Cierre adicional de continuación documental

Se detectó y corrigió un error que solo se registraba técnicamente: si la continuación final fallaba después de enviar los documentos, no generaba aviso visible. Ahora se notifica al CEO, administración y fidelización con enlace al chat y deduplicación por matrícula. El PDF enviado conserva su estado, no se repite ni se marca incierto por un fallo de la alerta. No se avisa cuando simplemente faltan los otros documentos. La misma protección se aplica cuando el motor devuelve false y cuando lanza una excepción.

Archivos: src/lib/matriculas/sequence.ts y la ruta de recepción de documentos. Pruebas nuevas: destinatarios correctos, ausencia de alertas prematuras, fallo del motor, fallo al guardar alerta y entrega de los tres tipos de PDF por Messenger con pago validado. Suite general: 1.212 pruebas aprobadas en 129 archivos; después se añadieron dos variantes documentales de Messenger, aprobadas en la prueba focalizada (12 pruebas). Build y TypeScript aprobados. Publicación de este cierre: pendiente de confirmar antes de comunicarla como completada.

Estado operativo consultado sin modificar estudiantes: tres entregas documentales sent, cero expedientes incompletos abiertos; una matrícula registrada y una ficha antigua en error (aislada en la prueba previa). No se aprueban comprobantes automáticamente y no se altera la ficha antigua para simular éxito.

TikTok e Instagram quedan expresamente fuera del cierre solicitado en este turno. Calendar y las otras fases aplazadas conservan ese estado. Retirar mensajes para todos no está implementado y no se encontró un endpoint oficial verificable; ocultar localmente no equivale a retirar al destinatario. Marketing API (nombres de campañas, conjuntos e inversión) tampoco está conectado. Estas limitaciones no deben describirse como funciones entregadas.
