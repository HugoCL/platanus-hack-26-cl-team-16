# 04: Moderador real en el gate de E2

**Status:** ready-for-agent
**Tracker:** PLTNS-39

**What to build:** Cambiar el doble del gate de E2 por el moderador real, guardar un `moderationEvents` por etapa y publicar la `moderator_alert` al emisor y a los humanos.

**Blocked by:** 03, PLTNS-31, PLTNS-32

- [ ] El gate usa el moderador real; las pruebas usan el LLM falso.
- [ ] Cada etapa queda en `moderationEvents`.
- [ ] Criterio 3: el destinatario no ve el mensaje bloqueado ni en vivo ni en su historial.
- [ ] El emisor y los humanos ven la `moderator_alert`.
