# CONEXION CRM - MATRICULAS

## Estado

El archivo PUENTE_CRM_MATRICULAS.gs se guardo en AUTOMATIZACION MATRICULAS el 09/10/2026. Todavia necesita credencial limitada y activador. No supone entrega de documentos.

## Instalacion

1. Publicar los endpoints del CRM y crear una clave exclusivamente con `enrollments:sync`.
2. Con autorizacion del propietario, guardar en propiedades privadas del proyecto:
   - `CRM_BASE_URL`: origen HTTPS del CRM, sin barra final.
   - `CRM_SYNC_KEY`: clave limitada. No pegarla en el codigo ni Git.
3. Ejecutar `INSTALAR_PUENTE_CRM_MATRICULAS` en el mismo proyecto que MATRICULAS_V2, para compartir el bloqueo de registros manuales y automaticos.
4. Incorporar la lectura de OFERTA CONFIRMADA JSON de DOCUMENTOS_MATRICULA.gs al proyecto de BOLETAS existente. Conserva su bloqueo compartido y contador B002.
5. Probar con un caso ficticio separado. El pago real requiere decision del CEO.

## Secuencia

VALIDACION HUMANA → FICHA → COMPARAR IDENTIDAD Y OFERTA → COLA → GOOGLE → NUMERO Y CARPETA.

El worker toma una ficha cada cinco minutos y descarga solamente su voucher y las fotos seleccionadas. Un ID oculto en AC evita otra fila en un reintento. Verifica que AC este vacia antes de instalar. Las carpetas conservan el orden acordado, reutilizando estudiante por tipo/documento y comprobando su nombre.

Los estados de registro, generacion PDF y entrega por WhatsApp son distintos. El resultado registrado solo acredita fila y archivos originales en Google. No acredita envio al estudiante.

La clave no puede aprobar pagos. Revocarla en el CRM detiene la conexion. No dar permisos de mensajes o contactos a esta clave.
