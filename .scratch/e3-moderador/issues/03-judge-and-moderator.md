# 03: Juez LLM y moderador compuesto fail-closed

**Status:** ready-for-agent
**Tracker:** PLTNS-38

**What to build:** El moderador real que implementa `Moderator`: reglas deterministas y, si pasan, el juez LLM con el contrato y los últimos 8 mensajes. Fail-closed con timeout de 3 s. Un evento por etapa.

**Blocked by:** 02

- [ ] Criterio 1: con el LLM falso guionado, el set da lo esperado.
- [ ] Criterio 4: RUT o tarjeta fuera del propósito se bloquea sin llamar al LLM.
- [ ] Criterio 5: error, respuesta inválida o más de 3 s bloquea con `moderator_error`.
- [ ] El juez recibe el mensaje a revisar como datos, no como instrucciones.
