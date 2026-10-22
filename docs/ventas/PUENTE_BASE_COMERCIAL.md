# Puente de solo lectura: Base Comercial ↔ WACRM

La hoja nativa está en:
https://docs.google.com/spreadsheets/d/1qtO6wN-jbbZppcM7qWjoJ2Bv9HVYCrX-jIEH5nGRZGs/edit

El endpoint `GET /api/v1/sales/leads` usa una llave de API WACRM con el permiso `contacts:read` y limita cada consulta a la cuenta asociada a esa llave. No recibe datos ni modifica contactos, etiquetas, asignaciones, pagos o matrículas.

El Apps Script de `output/sales-workbook-2026-10/VENTAS_BASE_CRM_SYNC.gs` agrega contactos nuevos por el ID estable de CRM y actualiza solamente columnas que vienen del CRM. La columna A recibe un consecutivo permanente guardado por el script; al borrar una fila no renumera las demás ni reutiliza el último consecutivo. El ID de CRM queda en Q, una columna técnica oculta. Conserva Estado comercial, N° de operación y Observaciones. No borra filas si un contacto sale del área de ventas.

Orden de captura: A consecutivo, B nombre, C teléfono/usuario/ID externo, D curso, E fecha, F hora, G instituto, H estado, I asesora, J canal, K etiquetas, L fecha de asignación, M última interacción, N número de operación, O observaciones, P campaña/anuncio y Q ID CRM oculto. La hoja valida que el número de operación de N no se repita.

## Activación

1. El endpoint `/api/v1/sales/leads` ya está publicado. Se verificó en producción: sin llave devuelve `401 Missing or invalid API key`, como debe.
2. En WACRM, crear una llave API restringida al permiso `contacts:read`. No usar una llave con permisos de escritura, pagos o mensajes.
3. En la hoja, abrir **Extensiones → Apps Script** y pegar el contenido de `VENTAS_BASE_CRM_SYNC.gs`.
4. En Apps Script, abrir **Configuración del proyecto → Propiedades de secuencia de comandos** y guardar:
   - `CRM_BASE_URL` = `https://personal-wacrm.exjald.easypanel.host`
   - `CRM_API_KEY` = la llave recién creada. Mantenerla solo en las propiedades, nunca en celdas.
5. Guardar y volver a cargar la hoja. El menú **CRM → Sincronizar contactos de ventas** importa una vez; después usar **CRM → Instalar sincronización cada 10 minutos** y autorizar Apps Script.
6. Verificar que la ejecución termine sin error. En BASE GENERAL, verificar consecutivo en A, nombre en B, teléfono/usuario en C, curso en D, fecha y hora en E:F, asesora en I, canal en J y etiquetas CRM en K.

## Límites verificados

- La sincronización es CRM → hoja y solo lectura. Cambiar la columna Estado comercial no cambia etiquetas del CRM todavía. La carga recurrente aún no está activa: faltan la llave `contacts:read` y la autorización del Apps Script.
- El curso se marca por coincidencia con palabras y botones entre los últimos 10 mensajes guardados. Si queda vacío, confirmar en el chat; no se inventa el curso.
- El panel muestra volumen, estados, ventas y conversión por asesora. La lista de perfiles y rotación se debe revisar antes de repartir leads. En la consulta actual, Ashly Agente y Luis Palacios aparecen en Ventas, pero el reparto estaba apagado y ambos tenían 0 %.
- Las comisiones siguen vacías hasta contrastar las reglas actuales con el tarifario vigente. Las hojas antiguas de 29.90/39.90 son históricas y no se copian como reglas actuales.
