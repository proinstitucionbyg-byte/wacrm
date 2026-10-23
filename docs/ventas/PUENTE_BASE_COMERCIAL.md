# Estado de Base Comercial ↔ WACRM

Hoja nativa: https://docs.google.com/spreadsheets/d/1qtO6wN-jbbZppcM7qWjoJ2Bv9HVYCrX-jIEH5nGRZGs/edit

## Comprobado en vivo el 22 de octubre de 2026

- La hoja tiene `PANEL`, `BASE GENERAL`, `ASESORAS`, `COMISIONES` y `LEEME`.
- `BASE GENERAL` conserva el consecutivo, datos de contacto/canal/curso, el número de operación único en N y el ID del CRM en Q. La columna H ya tiene la lista de estados comerciales pedida.
- Hay 104 contactos con ID estable del CRM. El panel calcula periodos, estados, ventas y conversión; en la última lectura mostró 104 sin asesora y cero ventas registradas.
- Apps Script tiene un activador de `SYNC_VENTAS_CRM` cada 10 minutos. Las diez ejecuciones más recientes observadas concluyeron correctamente (8–13 s). La llave actual tiene solo `contacts:read`; el flujo CRM → hoja funciona y no asigna ni reparte leads.
- `ASESORAS` tiene a ASHLY AGENTE y LUIS PALACIOS como `Inactivo`, por lo que el sistema no distribuye sus datos a bases personales. Todavía no existen enlaces de hojas individuales.
- `COMISIONES` sigue vacía. Las reglas antiguas de S/29.90 y S/39.90 son históricas, no sirven para calcular el tarifario vigente.

## Flujo de estado comercial que se está incorporando

La columna H se enviará a WACRM como etiqueta de proceso comercial. La ruta nueva recibe únicamente uno de los estados permitidos, reemplaza solo etiquetas de esa lista y conserva las etiquetas de área, asesora, pago y fidelización. No valida pagos ni cambia la asignación de área.

La ruta requiere una llave independiente con alcance `sales:write`, y Apps Script necesita guardarla en `CRM_WRITE_API_KEY` como propiedad del proyecto. La llave actual de lectura no se amplía. La escritura queda pendiente hasta que esa llave exista; este documento no afirma que ya está operando en producción.

## Columnas y protecciones

Orden actual: A consecutivo, B nombre, C teléfono/usuario/ID externo, D curso, E fecha Lima, F hora Lima, G instituto, H estado comercial, I asesora actual, J canal, K etiquetas CRM, L fecha de última asignación, M última interacción, N número de operación, O observaciones, P campaña/anuncio y Q ID CRM.

El número de operación tiene validación para impedir duplicados. El consecutivo no se debe recalcular por número de fila. El sincronizador actual refresca los datos que vienen del CRM y conserva el estado comercial, el número de operación y las observaciones escritas en la hoja.

## Pendiente para cerrar el punto 6

1. Desplegar la ruta nueva y aplicar su migración en Supabase.
2. Crear una llave `sales:write` separada y guardarla en Apps Script; después instalar el activador de edición que acaba de incorporarse al script.
3. Confirmar asesoras activas antes de crear o compartir sus bases individuales. No activar personas ni repartir contactos automáticamente.
4. Confirmar el tarifario de comisiones vigente antes de calcular montos o rankings pagables.
