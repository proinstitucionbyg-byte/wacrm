# Continuidad de consultas de pauta — 18/10/2026

## Causas comprobadas

- Meta rechazó videos de clase por tamaño: Inicial 30 797 620 bytes y Administración 43 382 668 bytes, error 131053, límite 16 777 216 bytes. También se detectó un video de Farmacia por encima del límite al revisar el catálogo.
- El contexto de IA excluía las respuestas interactivas, por lo que no conservaba elecciones como «Cero en Inicial».
- La selección por palabras mezclaba cursos anteriores y palabras genéricas; el seguimiento podía escoger otra oferta después de un fallo.
- El saludo combinado de los anuncios («¡Hola! Quiero más información») no coincidía con las palabras completas del saludo configurado.
- Había una pregunta de Recursos Humanos dentro de la secuencia de Administración. Se corrigió únicamente ese texto.

## Corrección

- Contexto con botones y pies de video; los mensajes salientes fallidos no se consideran información entregada.
- Prioridad al último curso elegido por el estudiante; reconocimiento de Inicial, Admin y RRHH.
- Sin regreso automático al menú general cuando el curso está identificado. Ante un bloque fallido sin alternativa válida, se deriva a ventas con resumen del punto de continuidad.
- Reconocimiento del saludo genérico combinado de pauta, sin consumir peticiones de un curso específico.
- Videos originales conservados; nuevas copias H.264/AAC en el almacenamiento existente. Administración: 14 486 585 bytes; Inicial: 14 237 815 bytes; Farmacia: 14 679 645 bytes. Validación de decodificación completa antes de actualizar enlaces.
- Recuperación de los casos interrumpidos desde su bloque guardado, conservando las esperas y sin repetir el inicio. No se reactiva a quienes rechazaron información ni se interrumpen secuencias correctas.

## Comprobación

- 278 pruebas de IA, motor de automatizaciones y medios de WhatsApp aprobadas.
- Compilación de producción aprobada.
- Evidencia operativa y reporte de conversión en `output/video-repair/` (no versionado).
