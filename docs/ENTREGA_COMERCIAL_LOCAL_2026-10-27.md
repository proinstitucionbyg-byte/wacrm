# Correcciones comerciales — entrega local del 27/10/2026

Estado: implementación local comprobada. No publicada. No se modificó Supabase ni ninguna automatización activa de producción. No hubo mensajes reales, cambios de pago, reactivaciones, commits ni push.

## Qué cambia

1. Una respuesta después de activar la promoción cancela el recordatorio redundante, pero recupera la posición exacta del curso guardado. No recupera otro curso, un flujo desactivado, una atención humana ni un caso con pago pendiente o validado. Una solicitud de baja sigue usando la pausa existente.
2. Las respuestas secundarias preparadas responden el material solicitado y vuelven al mismo cursor; no arrancan otra copia del resto del curso. Se conservaron los límites de cadenas y las comprobaciones de retornos acotados.
3. La versión nueva `2026-10-27-complete-v1` incluye los 55 pasos originales de cada uno de los cinco cursos activos. Mantiene identificadores, precios, keywords y archivos. No adopta ni cambia de versión un trabajo antiguo al reanudarlo.
4. Horarios deterministas en `America/Lima`, sin llamadas a un modelo para programarlos: introducción y audio inmediatos; dos minutos para la primera opción; reanudaciones de madrugada a las 6, 7 y 8; continuación desde las 11; intervalos de 20–25 minutos; descanso de 14:30 a 16:00; franja de tarde; cierre cercano a las 23 horas. Los envíos nocturnos posteriores a las 22 son excepcionales cuando esperar hasta la mañana impediría continuar a tiempo.
5. Se relee el último mensaje del cliente. Si el tiempo resulta insuficiente, se priorizan malla, certificación, beneficios, medios de pago y cierre. Lo omitido y lo pendiente quedan identificados y con motivo; no se vacía una cola completa de golpe ni se fuerza un envío fuera de plazo.
6. Un mensaje nuevo puede recuperar únicamente una espera marcada por vencimiento de ventana, después de comprobar pausas, pagos y otros recorridos activos. Las pausas manuales o humanas no se reactivan por ese mecanismo.
7. El botón `commercial_human` aparece en el bloque técnico 50, solo después de evidencia de diez grupos informativos entregados. Título compatible: **💬 Atención personal**, 20 caracteres según el validador existente. «💬 Atención personalizada» supera ese límite. Las solicitudes humanas directas siguen disponibles desde el principio; se reconocen también «Asesora», «Asesor por favor» y «Una asesora».
8. Se distingue cobertura económica publicitaria de permiso de atención: los envíos automáticos de contenido libre se bloquean al vencer las 24 horas, incluso si queda cobertura publicitaria. Las plantillas mantienen sus comprobaciones separadas. No se ampliaron cupos ni permisos de gasto.
9. La identidad del mensaje entrante se reclama en el registro de ejecución **antes** de cancelar o capturar un recorrido existente. La restricción única preparada evita que un mismo evento ejecute una automatización dos veces. No se garantiza repetir un envío incierto del proveedor; estos casos no se reintentan a ciegas.
10. Administrativo e Inicial tienen pies de imagen originales de más de 1.024 caracteres. El motor conserva cada carácter: divide el texto en un pie permitido y una continuación, espera la entrega y luego sigue con el audio. El catálogo sigue teniendo 55 pasos; la división de transporte puede agregar un mensaje de texto. Se evitan duplicados exactos de archivo y pie; se conservan pies distintos cuando aportan otro texto.

## Registro y medición

Se reutilizan `automation_logs`, sus pasos ejecutados y las esperas existentes. Se conservan versión, zona horaria, fecha prevista, límite de ventana, motivo de aplazamiento e identificadores omitidos/pendientes. Las compras y matrículas se pueden contrastar con los registros ya existentes; los estados económicos confirmados siguen viniendo de Meta y no se sustituyen por estimaciones.

No se puede afirmar todavía una mejora en conversión: esta versión no se ha publicado. Cinco matrículas diarias es la meta comercial, no un resultado prometido. Entrega de un audio no significa que el estudiante lo escuchó; los horarios se basan en reglas y en la auditoría, no en una medición de escucha individual.

## Comprobaciones

- 295 pruebas en 15 archivos: motor, recorridos completos, 65 conexiones secundarias, menús generales reales, pago con/sin respuesta, solicitudes humanas, cron simulado, horarios, entrega, duplicados y límites de ventana.
- Las pruebas de recorrido usan el catálogo recuperado de la auditoría, una base en memoria con filtros y una restricción única simulada y un proveedor simulado. Los escenarios incluyen los quince casos solicitados. No son envíos a personas ni una prueba de carga de Meta.
- `npm run build`: correcto, incluida la comprobación TypeScript de la aplicación.
- `git diff --check`: correcto para los cambios de esta entrega.
- La comprobación general adicional `npm run typecheck -- --incremental false` sigue detectando errores anteriores en pruebas de `output/minedu`, `output/promo-49-90`, `scripts/audits/paid-intake-repair.test.ts`, `course-detour.test.ts`, `paid-intake-handoff.test.ts` y `workbook-sync.test.ts`. No detectó errores en los archivos nuevos de esta entrega. No se alteraron esas pruebas ajenas para esconder el resultado.
- El aislamiento de Windows bloqueó archivos temporales de Vitest y algunas lecturas de TypeScript. La tanda final de pruebas y la comprobación general se repitieron fuera del aislamiento.

## Archivos de esta entrega

| Archivo | Finalidad |
|---|---|
| `src/lib/automations/engine.ts` | Continuidad, retornos, calendario, pausas, contenido completo, botón humano y reclamación de eventos. |
| `src/lib/automations/commercial-cadence.ts` | Versión completa y conservación del catálogo; división de pies largos sin pérdida. |
| `src/lib/automations/commercial-schedule.ts` | Cálculo puro de fechas y ventana. |
| `src/lib/automations/commercial-window-resume.ts` | Recuperación limitada a esperas de ventana tras un mensaje nuevo. |
| `src/lib/ai/explicit-human-request.ts` | Solicitudes humanas breves. |
| `src/lib/whatsapp/billing-runtime.ts` | Permiso de 24 horas independiente de la gratuidad. |
| `src/app/api/whatsapp/webhook/route.ts` | Propaga la identidad del evento real. |
| `src/lib/whatsapp/deferred-keyword-openings.ts` | Conserva la identidad del mismo evento al abrirse desde la cola existente. |
| `src/lib/automations/engine.test.ts` | Casos de recuperación y condiciones de detención. |
| `src/lib/automations/commercial-journey.test.ts` | Recorridos completos y enlaces reales con dependencias simuladas. |
| `src/lib/automations/commercial-schedule.test.ts` | Horas, descanso, cierre y plazos. |
| `src/lib/ai/explicit-human-request.test.ts` | Nuevas frases humanas. |
| `src/lib/whatsapp/billing-window.test.ts` | Ventana de atención frente a cobertura económica. |
| `src/lib/automations/__fixtures__/commercial-courses-2026-10-27.json` | Catálogo de prueba sin datos de alumnos ni credenciales. |
| `scripts/audits/prepare-complete-commercial-local.mjs` | Genera el plan sin red ni conexión a una base. |
| `supabase/migrations/20261027131603_commercial_inbound_execution_key.sql` | Columna nullable e índice único. Aplicada tras la autorización posterior de publicación; índice válido y único comprobado. |
| `output/commercial-complete-2026-10-27/plan-local.json` | Propuesta exacta: cinco políticas completas y 65 configuraciones secundarias, con valores anteriores y precondiciones. |

## Qué falta antes de ponerlo en el CRM

Hace falta autorización expresa para producción. No basta con subir código: primero hay que verificar/aplicar la migración y luego publicar y comprobar las configuraciones preparadas contra su estado real, sin sobrescribir cambios posteriores. El índice SQL no se ha probado sobre una instancia PostgreSQL local: no había una disponible y no se usó producción como laboratorio.

Las configuraciones activas y los trabajos actuales **siguen intactos**. El plan prepara la versión nueva para lanzamientos nuevos; no migra masivamente contactos antiguos ni revive trabajos cancelados o pausados. Cualquier traslado de trabajos en marcha requiere una selección comprobada de posiciones y entregas.

Para revertir una publicación futura, conservar primero las posiciones/versiones de las ejecuciones afectadas. Restaurar configuraciones anteriores solo para nuevos lanzamientos; no sustituir el motor por una versión incapaz de leer esperas nuevas que todavía estén en marcha. La columna nullable y su historial pueden mantenerse sin borrar información.
