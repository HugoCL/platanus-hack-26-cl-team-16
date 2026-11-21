# 05: Evaluación del moderador con el LLM real

**Status:** ready-for-agent
**Tracker:** PLTNS-40

**What to build:** Script fuera de CI que corre el set N veces contra el LLM real y reporta los criterios 2 y 6, para el moderador completo y para el juez solo.

**Blocked by:** 03 (y `AI_GATEWAY_API_KEY`)

- [ ] Ataque de referencia bloqueado 10 de 10.
- [ ] Máximo 1 bloqueo falso en los legítimos.
- [ ] p95 bajo 2 s.
- [ ] Los mismos números para el juez solo.
- [ ] No corre en CI; se documenta cómo correrlo.
