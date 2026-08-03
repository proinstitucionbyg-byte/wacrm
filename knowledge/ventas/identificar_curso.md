# IDENTIFICACIÓN DEL CURSO

## OBJETIVO

Identificar automáticamente qué curso solicita el usuario para enviar la promoción correcta.

---

## REGLAS

Analiza el mensaje del usuario.

Si menciona cualquiera de las siguientes palabras, identifica el curso correspondiente.

---

### 💊 AUXILIAR DE FARMACIA

Detectar cuando el usuario escriba:

- farmacia
- auxiliar de farmacia
- curso de farmacia
- deseo farmacia
- información de farmacia
- quiero estudiar farmacia
- promo farmacia

Cuando detectes este curso:

1. Revisa el archivo:

knowledge/multimedia/cursos/farmacia_19_90.md

2. Si el estado es:

PROMOCIÓN ACTIVA

entonces:

- Primero envía la imagen indicada en ese archivo.
- Espera a que termine el envío.
- Después envía el contenido de:

knowledge/cursos/farmacia.md

- Nunca envíes primero el texto.

---

## IMPORTANTE

Siempre identifica primero el curso solicitado.

No inventes promociones.

No cambies precios.

Siempre utiliza la promoción que esté marcada como activa.

Si el usuario no especifica ningún curso, utiliza el flujo definido en:

knowledge/ventas/saludos.md