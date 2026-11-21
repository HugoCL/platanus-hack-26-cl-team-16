# 02: Entrar a un plan por link, sin cuenta

**Status:** ready-for-agent
**Tracker:** PLTNS-64

**What to build:** El organizador genera un link de invitación para su plan. Otra persona lo abre en su teléfono, escribe su nombre y queda dentro de la sala como participante humano, con un asistente propio creado por detrás. No crea cuenta ni inicia sesión.

**Blocked by:** 01

- [ ] Solo el organizador puede generar el link de su plan.
- [ ] Se guarda el hash del token, nunca el token en claro.
- [ ] Abrir el link y poner un nombre agrega al humano y a su asistente a esa sala, y los demás lo ven entrar en vivo.
- [ ] El invitado lee y escribe solo en esa sala: con su identidad no puede leer ni escribir en otra.
- [ ] Un token inválido, de un plan cerrado o de un plan lleno se rechaza con un mensaje claro.
- [ ] Volver a abrir el link en el mismo teléfono retoma al mismo participante en vez de crear otro.
- [ ] La forma de identidad del invitado y por qué es segura quedan anotadas en `docs/architecture.md`.
- [ ] Las pruebas de autorización de sala siguen pasando y hay pruebas nuevas para el invitado.
