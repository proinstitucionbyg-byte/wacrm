# Estados comerciales: corte de publicación pendiente

Se añadieron CONTACTADO y PROSPECTO A COMPRAR al catálogo del código y a una migración separada. El indicador urgente compara la fecha de la solicitud con el último estado manual: un contacto anterior no cancela una nueva solicitud urgente; una gestión posterior sí la resuelve. La hoja usa H para estado/prospecto y K para urgencia; las etiquetas completas permanecen en CRM. Las notas manuales O no se tocan.

51 pruebas focales pasaron, incluida la API real de exportación, los límites de visibilidad por ID y la conservación de ediciones manuales. ESLint sin errores. Compilación aislada desde el índice Git terminó con exit0 y 102 páginas; TypeScript aprobado. Otros cambios ajenos de la hoja se conservan sin publicar automáticamente.

La conexión SQL de Supabase agotó el tiempo en tres consultas. apply_migration también falló al inicializar su historial. El proyecto informa ACTIVE_HEALTHY, pero el editor SQL oficial confirmó el mismo timeout en una consulta de solo lectura. No se confirma aplicada 20261106023000_commercial_contacted_prospect_statuses.sql. No publicar la nueva edición de Sheets ni declarar terminado CONTACTADO hasta aplicar y verificar esa migración y desplegar el código correspondiente. No se cambió la configuración ni la seguridad de la base.

La boleta de Paul se confirmó leída en el corte anterior; ver BOT_PUENTE_MATRICULAS_2026-11-05.md. Contabo continúa fuera de ejecución hasta orden expresa.
