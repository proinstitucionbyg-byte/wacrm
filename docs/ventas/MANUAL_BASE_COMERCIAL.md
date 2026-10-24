# Manual de uso · Base Comercial INSTICRECE

## 1. Por dónde empezar

Abre la [Base Comercial](https://docs.google.com/spreadsheets/d/1qtO6wN-jbbZppcM7qWjoJ2Bv9HVYCrX-jIEH5nGRZGs/edit). Es la hoja de seguimiento de ventas. El archivo **Matrículas y Control de Ingresos** conserva el registro académico; son dos registros con funciones distintas.

| Pestaña | Qué verás | Qué haces tú |
|---|---|---|
| PANEL | Contactos, seguimiento, responsables y entradas por día | Revisar el resumen |
| BASE GENERAL | Contactos comerciales, estado, curso, responsable, pago validado y carpeta | Elegir estado en H; escribir observaciones en O |
| RANKING | Puestos del mes, ventas, metas, avance, ratios y comisiones | Elegir el mes en B3; consultar los gráficos con el enlace de A5 |
| METAS | Objetivos individuales y del grupo por mes | Escribir los objetivos de ventas |
| ASESORAS | Miembros de Ventas, activos/inactivos y enlaces de sus bases | Abrir cada base; la activación se administra en el CRM |
| COMISIONES | Tarifas por curso, promoción, tramo y vigencia | Configurar importes y elegir PRUEBA, ACTIVA o INACTIVA |
| LEEME | Instrucciones rápidas y estado de las comprobaciones | Consultar antes de editar |

## 2. Cómo llegan los contactos

La sincronización consulta el CRM cada diez minutos. Incluye los contactos comerciales y conserva las matrículas con pago validado aunque el estudiante ya haya pasado a Fidelización. No vuelve a crear la misma fila: usa un identificador fijo del CRM, guardado en la columna Q.

No cambies ese identificador ni el consecutivo A. Un teléfono repetido no es suficiente para fusionar personas. Las filas antiguas sin identificador se conservan para revisión.

El sistema figura como **ASESOR INSTITUTO** cuando la IA o la automatización atienden y no existe una asesora de Ventas habilitada a cargo. Si ambas están desactivadas y no hay una asesora activa, el responsable puede quedar vacío: esto no significa que deba reactivarse la atención automática.

## 3. Cómo cambiar el estado

En **BASE GENERAL**, busca el contacto y abre el desplegable de H. Por ejemplo, elige **INTERESADO**, **ENVIAR INFORMACIÓN**, **VA A PAGAR**, **VENTA** o **NO INTERESADO**. La elección se envía al CRM como etiqueta comercial. Las etiquetas de área, pago y asesora se conservan.

También puedes cambiar la etiqueta comercial en el CRM. En la siguiente sincronización se refleja en la base general y en la base personal correspondiente. La base personal se revisa cada diez minutos; su cambio no es instantáneo.

Si una edición no puede enviarse, se conserva para reintentar. No la sustituyas repetidamente ni borres toda la fila. Si editas dos pantallas al mismo tiempo, espera la siguiente sincronización y revisa el estado final.

**Marcar VENTA no valida un pago, no crea una matrícula ni emite documentos.** Es un estado comercial. La validación del pago y el registro académico siguen sus procesos propios.

En una base personal, la asesora edita H y O. El resto se actualiza desde el CRM. Cambiar manualmente el nombre de la asesora en una celda no cambia la asignación real: para derivar una conversación, usa el CRM.

## 4. Cómo se cuenta una venta en el ranking

El ranking cuenta una vez cada contacto que tenga **VENTA**, **VENTA SOLO** o una matrícula con pago validado. Si tiene ambas cosas, no suma dos ventas.

Para una matrícula validada usa la fecha de validación y el responsable comercial guardado con el pago. Para una venta comercial sin matrícula validada usa la fecha de la etiqueta y el responsable que refleja el CRM. La última columna del ranking distingue cuántas ventas tienen pago validado.

El orden se recalcula automáticamente: más ventas primero; si empatan, se ordenan por nombre. Aparece **ASESOR INSTITUTO** junto con las asesoras activas y los responsables de ventas del mes. Un cambio de responsable posterior no debe reasignar una matrícula cuyo pago ya tiene la atribución guardada.

En B3 escribe una fecha del **primer día del mes** que deseas revisar. Verás:

- Ventas del mes y pagos validados.
- Meta mensual de cada responsable, porcentaje de avance y ventas que faltan.
- Meta del grupo y avance conjunto.
- Base de contactos e interesados por responsable.
- Ratio **Ventas/base**: ventas del mes divididas entre la base total de contactos de ese responsable. No es una tasa de conversión de una campaña concreta.
- Comisión en PRUEBA y comisión ACTIVA en columnas separadas.

En A5 pulsa **VER GRÁFICOS DE BARRAS Y TORTA**. Las barras comparan ventas y metas de los primeros puestos. La torta muestra su participación en las ventas del mes. Con cero ventas la torta puede aparecer vacía.

## 5. Cómo poner las metas

En **METAS** completa una fila por responsable y mes:

1. **Mes:** primer día del mes, por ejemplo 01/11/2026.
2. **Responsable:** el mismo nombre que muestra el directorio; para la meta conjunta usa GRUPO.
3. **Tipo:** INDIVIDUAL o GRUPO.
4. **Ventas objetivo:** cantidad que debe alcanzar.
5. **Nota:** explicación opcional.

Una meta en cero o sin completar aparece como **SIN META**. No se inventaron objetivos aprobados. Si repites una combinación de mes y responsable, sus importes se suman: usa una sola fila cuando no quieras sumar objetivos.

## 6. Cómo configurar las comisiones

En **COMISIONES** están las celdas editables y las instrucciones. El ejemplo autorizado es **S/3 por venta**, en modo **PRUEBA**. Los ejemplos de 1, 10 y 100 ventas muestran S/3, S/30 y S/300. No representan dinero pagado ni una tarifa definitiva.

Completa curso, mensualidad de la promoción, mínimo y máximo de ventas mensuales, comisión por venta y fecha desde la que corresponde. En **Modo**:

- **PRUEBA:** simula importes y permite revisar el cálculo.
- **ACTIVA:** usa la tarifa que tú has decidido aplicar.
- **INACTIVA:** deja de aplicar esa regla.

El tramo se elige según el total de matrículas validadas de ese responsable en el mes. La tarifa seleccionada se aplica a esas ventas; no calcula escalones marginales. El cálculo de comisiones toma matrículas con pago validado, aunque el ranking también muestre ventas comerciales pendientes de validar.

Si dos reglas coinciden con la misma venta aparece **REVISAR REGLAS**. No se suman las dos tarifas. Cuando actives una tarifa definitiva, revisa si debes inactivar el ejemplo de S/3 para evitar coincidencias. **SIN TARIFA** indica que falta una regla aplicable. Cambiar reglas puede recalcular importes históricos; revisa el mes antes de usar el resultado para liquidaciones.

## 7. Cómo agregar o desactivar asesoras

Entra al [CRM](https://personal-wacrm.exjald.easypanel.host/settings) y abre **Settings → Team members**. Busca el bloque **ASESORAS DE VENTAS · ACTIVACIÓN Y REPARTO**.

1. Crea la cuenta con **Crear asesora**.
2. Completa su nombre o apodo, área VENTAS y cargo.
3. Un porcentaje mayor que cero la habilita para Ventas. Con cero queda fuera de nuevas asignaciones.
4. Para repartir automáticamente, los porcentajes deben sumar 100% y debes activar el reparto y guardar.
5. La persona necesita permiso de chat y conexión activa para recibir una nueva asignación.

La hoja admite hasta cien asesoras. El directorio refleja la configuración del CRM. La sincronización prepara una base individual para cada asesora activa y guarda su enlace en **ASESORAS, columna H**. Cada base contiene únicamente sus contactos asignados y una copia del ranking agregado. La copia del ranking no incluye los teléfonos ni los expedientes de las otras personas.

Las bases nuevas quedan privadas para el propietario. Abre el enlace y comparte desde Drive únicamente con la asesora correspondiente. Desactivar a una asesora detiene nuevas asignaciones y actualizaciones de su base; conserva el archivo y el historial. Si también debe perder acceso al archivo, el propietario debe retirarlo en Compartir de Drive.

Mientras no haya asesoras, deja apagado el reparto. No necesitas crear personas ficticias: el seguimiento del sistema aparece como ASESOR INSTITUTO.

## 8. Matrículas, carpetas y documentos

En BASE GENERAL, S identifica una matrícula con pago validado; T muestra quién cerró esa venta, U su fecha y V el enlace de la carpeta del estudiante. Abrir una carpeta no envía documentos por WhatsApp.

La emisión de boleta, cronograma y ficha se gestiona en el expediente del CRM y debe quedar registrada también en **Matrículas y Control de Ingresos**, incluso cuando el envío se haga manualmente. Un pago de una cuota u otro concepto no debe contarse como una matrícula nueva.

Si el envío por API está bloqueado por costo o por la ventana de WhatsApp, utiliza el enlace de descarga del expediente para enviar los documentos por el medio que hayas elegido. No reactives IA o automatizaciones únicamente para descargar archivos.

## 9. Qué revisar si algo no aparece

| Lo que ves | Qué comprobar |
|---|---|
| Falta un contacto | Que el CRM lo identifique como comercial o tenga matrícula validada; espera la sincronización y busca su identificador |
| Falta el nombre del responsable | Si hay una asesora activa asignada o el sistema está atendiendo; no escribas un nombre ficticio |
| El estado no coincide | Espera la siguiente pasada, evita editar dos lados a la vez y revisa si quedó una edición pendiente |
| No hay hoja personal | Que la cuenta esté en VENTAS con porcentaje mayor que cero; consulta el enlace en ASESORAS |
| SIN META | Completa METAS para el mes seleccionado y ese responsable |
| SIN TARIFA | Falta una regla de comisión que coincida con curso, promoción, tramo y fecha |
| REVISAR REGLAS | Hay más de una regla aplicable o una configuración incompleta |
| No sale la carpeta | Revisa que el expediente esté registrado y tenga carpeta generada |

## 10. Uso diario recomendado

Al empezar, revisa PANEL y los pendientes de seguimiento. Actualiza el estado de cada contacto atendido. Cuando se valide una matrícula, comprueba su carpeta y el registro académico. Al cierre del día, revisa el ranking del mes y los pendientes. Las metas y tarifas se configuran cuando tú las apruebes; los ejemplos permanecen identificados como pruebas.

La continuidad con la misma asesora durante siete días sigue siendo una regla pendiente de implementación y comprobación; no debe confundirse con el plazo de dos horas de la asignación operativa existente.
