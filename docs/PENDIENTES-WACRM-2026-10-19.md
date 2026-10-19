# WACRM: trabajo pendiente y comprobaciones, 19 de octubre de 2026

Esta lista reúne los pedidos vigentes. «Hecho en datos» significa que se comprobó en Supabase; «local» requiere publicación del código. Ningún punto se marca terminado solo por haberlo pedido.

## Urgente: ventas y matrículas

- [x] Audio de explicación de Office cargado e insertado entre imagen y botón en los cinco cursos activos de S/49.90; enlaces externos a Office siguen el bloque y las posiciones se ajustaron en Supabase. Pendiente comprobar una interacción real de extremo a extremo. Las versiones inactivas de S/79.90 ofrecen Office desde el tercer módulo, por lo que ese audio del segundo mes todavía no corresponde allí.
- [x] Expediente de Nancy: cuota posterior corregida en Supabase de S/99.90 a S/49.90, conforme al texto y audio enviados. No había documentos emitidos.
- [x] Retirado de la bienvenida provisional el audio de requisitos enviado por equivocación. Las bienvenidas finales de los días 15 y 30 conservan sus audios correspondientes.
- [ ] Publicar la protección contra reenviar Yape/Plin después de recibir un comprobante y contra interrumpir durante cinco minutos una respuesta humana. Código local y comprobaciones unitarias en curso.
- [ ] Completar y revisar los expedientes de Nancy e Ing. Lugones antes de emitir boleta, cronograma y ficha. Nancy tiene datos escritos y dos fotos de identidad, pero falta cotejar la identidad; Lugones aún carece de domicilio completo y de cotejo de identidad. Mantener la oferta realmente recibida por cada una.
- [ ] Garantizar que la solicitud de identidad siempre diga «DNI o carné de extranjería» y que los medios de pago solo muestren Yape/Plin 937467119 y las cuentas verificadas.
- [ ] Mantener las conversaciones de quienes aún no están matriculados en Ventas, salvo una consulta académica de un alumno ya inscrito. Revisar etiquetas que reaparecen tras retiro manual y el resumen de traspaso: curso, oferta, fecha y pendiente concreto.
- [ ] Verificar por lote los errores recientes de interacción y automatización, sin reiniciar cursos ni adelantar esperas; respetar las respuestas humanas y la preferencia de no seguir a bots.

## Inbox y operación

- [ ] Ordenar primero pagos urgentes no resueltos; después mensajes entrantes recientes. Los envíos automáticos no deben subir conversaciones. Mostrar conteo solo de mensajes recibidos del estudiante.
- [ ] Distinguir ejecución de automatización activa y finalizada mediante indicadores claros para todos los asesores.
- [ ] Botón conjunto para desactivar IA y automatización indefinidamente y reactivarlas de forma manual. Implementado localmente, falta publicación y comprobación en CRM.
- [ ] Mejorar acceso a archivo de chats sin perder pagos o documentos. Existe «MÁS → Eliminar chat del Inbox» y «RECUPERAR CHATS», pero hay que comprobar que un envío automático no reabra lo retirado.
- [ ] Hacer más fácil retirar etiquetas desde la lista y respetar la decisión manual del CEO/administración.
- [ ] Permitir editar recordatorios o notificaciones según permisos; reproducción de audio mientras se cambia de chat, con control para cerrarla.

## Registros, calendario y campañas

- [ ] Revisar numeración en Cuadro de Inicios si se borran filas de prueba; conservar números de matrícula ya emitidos, sin renumerar registros históricos ni reutilizar un número ambiguo.
- [ ] Añadir botones «Activar promoción» tras respuestas de precio; respuestas de fechas con formato claro y emojis, solo con fecha académica verificada.
- [ ] Comprobar si la web pública y su suscripción intervienen en los mensajes, webhooks o disponibilidad del CRM antes de que venza.
- [ ] Campaña Meta de interacción y comparación con ventas: el usuario pidió aplazarla hasta cerrar las automatizaciones. No cambiar anuncios ni presupuesto aún.
- [ ] TikTok/Instagram: revisar aprobaciones e integración propia cuando se retome esa línea; no usar servicios externos de terceros.
- [ ] Revisión de puntos históricos abiertos: ubicaciones de contactos, automatizaciones/saludos, derivaciones, matrícula manual, hojas de cálculo de inicios y documentos. Revalidar estado real antes de marcar cualquiera como terminado.

## Lista detallada conservada de esta conversación

El orden de esta lista es de ejecución, no indica que algo ya funcione. Cuando un punto se haya publicado y comprobado se marcará arriba con evidencia.

### Atención y ventas

- [ ] Comprobar que el inicio, los botones, los desvíos, los audios, las pausas y el último bloque de los cinco cursos activos de S/49.90 funcionen en el orden configurado. Una espera programada prevalece sobre el seguimiento de inactividad; una consulta nueva responde la pregunta y vuelve al curso y posición correctos. No confundir curso elegido, precio o promoción. No relanzar cursos generales a quien ya eligió uno.
- [ ] Conservar los cinco flujos inactivos de S/79.90, sus carpetas y derivaciones. Asegurar que los cambios de posición de bloques actualicen las referencias de otras automatizaciones solo después de mostrar con claridad el impacto y la confirmación del editor.
- [ ] Vigilar que nadie quede sin respuesta: saludo y continuidad según el intervalo configurado; al pulsar «Continuar», leer las últimas cinco interacciones; ante falta de información, aclarar o derivar con una observación útil; evitar bucles con bots o frases repetidas; respetar rechazo de información y atención humana.
- [ ] Seguir ventas al quedar inactivas después del intervalo definido y reanudar el mismo curso; no adelantar esperas configuradas. Seguimientos de pago a 15, 90 y 120 minutos, con botones y desvíos «Estoy en proceso», «Ya generé el abono» y «Necesito ayuda»; no repetir medios de pago tras un comprobante. Comprobar que las respuestas y automatizaciones enlazadas no queden sin salida.
- [ ] Revisar el último contacto de ventas antes del cierre de la ventana de WhatsApp, solo para prospectos sin inscripción ni pago confirmado, evitando duplicados o mensajes fuera de ventana.
- [ ] Precio, fecha de inicio y promoción deben salir de la oferta vigente y del curso concreto; contrastar textos y audios. Tras responder precio, ofrecer el botón para activar la promoción. No inventar la fecha ni la escasez.
- [ ] Cobros: único Yape/Plin 937467119; cuentas verificadas según imagen aprobada. Distinguir pensiones existentes de ventas nuevas y exigir validación humana del comprobante.
- [ ] Inscripciones Nancy e Ing. Lugones: completar identidad/datos pendientes, cotejo humano, boleta, cronograma, ficha, carpeta, cuadro de inicios y bienvenida correcta cuando corresponda. No afirmar que se enviaron documentos hasta comprobarlo.
- [ ] Área Ventas para prospectos sin matrícula; Fidelización para alumnos/consultas que correspondan. Derivación con asesor especializado, vía llamada o mensaje, y nota relevante para el equipo. Manualmente quitar etiqueta debe prevalecer sobre la asignación automática.

### Automatizaciones y materiales

- [ ] Audio Minedu y bloque de imagen, texto aprobado, audio, botones de continuar/activar promoción; retorno al punto guardado si no contesta. Comprobar si quedó publicado en los flujos activos.
- [ ] Audio de certificación tras el bloque de certificación en las diez versiones de cursos y sus referencias externas; usar el archivo correcto y preservar posiciones y esperas. Verificar si el audio adjunto sigue disponible.
- [ ] Audio Office en los cinco cursos activos y las referencias externas: dato insertado en Supabase; falta una interacción real que confirme entrega al contacto en el orden imagen, texto, audio y botón.
- [ ] Automatizaciones de medios de pago y sus respuestas con palabras exactas, botones y retornos A8–A9: volver a comprobar secuencia y suspensión cuando el estudiante responde.
- [ ] TikTok e Instagram con integración propia: revisar el estado real de aprobación, permisos y recepción de mensajes; no contratar ni enlazar plataformas alternativas.

### Inbox, equipo y registros

- [ ] Botón único adicional «Desactivar ambas indefinidamente» para IA y automatización, y reactivación manual; el cron no debe revertir la pausa. Cambios locales compilados, pendiente comprobar en producción.
- [ ] Indicador de automatización activa/finalizada y números de mensajes entrantes no leídos; orden del inbox por mensajes de estudiantes, con pagos urgentes pendientes arriba. Los mensajes del bot no deben subir el chat.
- [ ] Archivo recuperable de conversaciones que no deben ocupar la lista; envíos automáticos no deben hacerlas reaparecer. Mejorar tamaño de X de etiquetas y respetar retiro manual.
- [ ] Recordatorios/notificaciones editables y dirigibles por permisos; eliminar notificaciones según rol; escuchar audio mientras se navega entre chats y cerrar el reproductor manualmente.
- [ ] Matrícula manual desde CRM con DNI anverso/reverso y voucher, ficha, cronograma, boleta, carpeta y cuadro de inicios; interfaz ordenada y visible. Mantener numeración emitida aunque se eliminen filas de prueba.
- [ ] Cuadro de inicios: mantener formato de fecha y celdas, cambios con motivo obligatorio, fecha anterior cuando corresponda y enlaces que abran la pestaña exacta.
- [ ] Áreas Audiovisual, Docentes y Coordinador de Docentes, con permisos y destinatarios pertinentes. Revisar acceso de agentes para derivar chats entre áreas.
- [ ] Revisar dependencia entre la suscripción de la web pública y el CRM/WhatsApp antes del vencimiento.
- [ ] Análisis de abandono de leads y pagos por curso, bloque, promoción y campaña, usando mensajes y eventos reales; no concluir causalidad del precio solo por ausencia de pago.

## Comprobaciones antes de publicar

- Revisar `git status` y conservar cambios ajenos.
- Probar cambios de lógica, compilar y verificar en Supabase el resultado concreto.
- Agrupar las correcciones relacionadas en una publicación; no afirmar entrega por WhatsApp cuando solo figura `sent`.
