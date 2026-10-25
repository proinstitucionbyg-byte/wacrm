# Documentos cuando WhatsApp está pausado o vencido

1. Completar los datos pendientes y verificar su respaldo. El pago debe estar validado por una persona.
2. Registrar la matrícula y generar boleta, cronograma y ficha en su carpeta. Esto continúa aunque el chat esté pausado o su ventana haya vencido.
3. Abrir **Descargar documentos** dentro de la conversación. El enlace de la carpeta queda disponible sin reactivar IA ni automatizaciones. Copiar ese enlace para entregarlo al propietario; no cambiar los permisos de Drive automáticamente.
4. El propietario descarga los PDF y los manda por el medio que haya elegido. Crear una carpeta o generar archivos no significa que ya se entregaron al estudiante.
5. Si un intento anterior figura **por revisar**, comprobar primero la conversación: un fallo de confirmación puede ocurrir después de que Meta aceptara el documento. No borrar la reserva ni reenviarlo automáticamente.

## Protección del puente

Antes de subir un PDF a WhatsApp y reservar su envío, el puente comprueba la pausa de automatización, la ventana de atención de 24 horas y la cobertura gratuita con los controles existentes. Si la pausa está activa, la ventana venció o la cobertura no se puede confirmar, responde **Entrega manual**, con la carpeta cuando está registrada. No marca el documento como enviado, no reactiva el chat y no modifica la matrícula.

La respuesta es HTTP 409: el sincronizador no debe interpretar este caso como entrega exitosa. Los reintentos vuelven a comprobar los bloqueos sin subir el PDF a Meta mientras sigan presentes. La cobertura se vuelve a validar al despachar mediante el control de envío existente.

La generación y el registro ocurren antes de este envío y permanecen separados. No cambiar manualmente una entrega a `sent` para desbloquear otras secuencias.
