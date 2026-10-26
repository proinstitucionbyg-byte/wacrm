# Corrección de continuidad comercial — 26/10/2026

## Alcance autorizado

El propietario aprobó corregir los fallos encontrados en el comparativo comercial antes de cambiar nuevamente la estrategia. No se cambian precios, keywords, materiales, botones ni tiempos de seguimiento. La comparación del momento de la invitación a malla (unos 29 segundos frente a dos minutos) queda separada de esta corrección para no mezclar sus efectos.

## Causas y cambio

- `src/lib/ai/followup-policy.ts`: el nombre real `ASISTENTE A 19.90 (49.90)` no era reconocido por la comprobación de curso terminado. Se reutilizan los alias existentes y, al consultar metadata, el indicador existente `sales_window_close` identifica la secuencia principal; una malla o clase modelo no la reemplaza.
- `src/lib/ai/followup.ts`: la protección de pago dependía del texto del último mensaje y dejaba de aplicar cuando el estudiante preguntaba después por horarios o días. Se conserva la etapa de pago registrada durante un máximo de 24 horas; una apertura real posterior de otro curso puede liberarla. Un retorno enlazado no cuenta como una apertura nueva. Esto impide el seguimiento genérico por silencio, no las respuestas a consultas entrantes ni los seguimientos de pago ya programados.
- La consulta de metadata se reutiliza para ambas comprobaciones. No se añaden llamadas a OpenAI.
- Se comprueba la hora del mensaje real, porque `last_message_at` de la conversación podía quedar atrasada. Se respetan también las ejecuciones guardadas en estado `paused`.
- Fidelización conserva su derivación antes de la protección comercial.

## Comprobaciones

Primero se añadieron regresiones: ocho fallaron con el código anterior. Después del cambio pasaron 124 pruebas focalizadas de política, despacho, motor, desvíos de curso y cadencia comercial, incluidas las nuevas regresiones y límites de 24 horas. ESLint de los cuatro archivos modificados terminó sin errores. `npm run build` terminó correctamente; conserva los avisos ya existentes de middleware y runtime edge.

Se consultaron los cuatro casos reales del diagnóstico sin enviar mensajes. Los dos casos silenciosos de Administrativo seguían con una sola entrada del cliente y conservaban cuatro esperas automáticas de la reentrada errónea, posteriores a una secuencia nueva terminada correctamente. A las 11:36:43 de Lima se cancelaron exclusivamente esas cuatro esperas aún `pending`, con condiciones sobre cuenta, conversación, log, ausencia de asesor/manual/matrícula y ausencia de nuevas entradas. Se marcó el silencio ya atendido en ambas conversaciones. La consulta posterior confirmó cero esperas activas en esos dos casos y mantuvo sus controles de IA y automatización. No se tocaron pausas, pagos ni identidades.

## Límites y siguiente medición

El resultado de las pruebas demuestra que se bloquean esas rutas erróneas, no que ya aumentaron las ventas. El corte comparativo anterior fue el 26/10 a las 09:55 de Lima: 26/163 activaciones antiguas frente a 2/18 nuevas con seis horas completas y mensualidad de S/49,90 comprobada. La muestra nueva es pequeña y no permite atribuir causalidad. Las próximas observaciones deben separar cohortes anteriores y posteriores a esta publicación, por curso, promoción y tiempo de exposición.

No se enviaron mensajes de prueba, no se ejecutaron llamadas a la IA para probar ni se activaron asesoras reales. Los recordatorios de Codex que el propietario apagó continúan apagados. Los datos privados de auditoría no forman parte de este documento ni del commit.
