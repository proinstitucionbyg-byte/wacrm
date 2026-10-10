# LECTURA DE IMAGENES — 08/10/2026

## Preparado y comprobado

- Lectura de la imagen original recibida por WhatsApp mediante el proveedor de IA configurado en la cuenta.
- Extraccion de datos visibles de DNI y comprobantes: monto, moneda, fecha, operacion, pagador y destinatario.
- Nombre de referencia corregido: **LUIS BRAYAN PALACIOS CARHUAPOMA**.
- Comparacion determinista del nombre completo; abreviaturas, diferencias y nombre ilegible requieren revision.
- El resultado permanece pendiente de revision humana; nunca aprueba un pago.
- Panel de lectura interno en el mensaje del CRM y evidencia no verificada para el contexto de IA.
- Registro de consumo de la lectura junto al consumo existente de IA.
- Migracion aplicada y verificada en Supabase: `messages.image_analysis` y modo `image_analysis` en el registro de consumo. RLS sigue activo en ambas tablas.
- Comprobaciones: 753/753 pruebas; `tsc --noEmit`; `next build`; `git diff --check`.

## Pruebas corregidas

Se actualizaron los datos simulados al contrato actual: campos nuevos del resultado de IA, metodo `text()` de las respuestas de medios, canal y relaciones de contacto, selector `in()` del contexto y fechas locales. Las pruebas de derivacion describen el comportamiento actual (aviso al cliente y pausa mediante `ai_enabled`); no prueban que el protocolo futuro de atencion humana este terminado.

## Pendiente de comprobacion en produccion

- Commit y push autorizados y completados: `cb5c6d6`, rama `main`, repositorio `proinstitucionbyg-byte/wacrm`.
- EasyPanel `personal/wacrm` indicaba el commit anterior `bb2527d` y `autoDeploy: true`.
- La llamada `deployAppService` fallo por conexion al panel; las lecturas posteriores tambien fallaron y el navegador devolvio `ERR_CONNECTION_REFUSED` para el panel. No hay confirmacion de que el despliegue haya iniciado.
- El CRM sigue accesible. Tras recargar y abrir el perfil, aun no aparece el campo Apodo de esta actualizacion; la publicacion queda pendiente.
- Envio de un comprobante desde el WhatsApp personal del usuario y verificacion de su lectura en el CRM.
- El proveedor puede fallar por clave, saldo, modelo, formato o calidad de imagen. En ese caso se conserva un estado explicito de revision manual.

## Pendientes del sistema completo

La lectura no implementa por si sola: aprobacion financiera, comparacion con movimientos bancarios, registro automatico en matriculas, carga de originales a Drive ni envio de PDFs al estudiante. La pausa prolongada de atencion humana y otros pendientes siguen detallados en `AUDITORIA-MATRICULAS-CRM-2026-10-08.md`.
