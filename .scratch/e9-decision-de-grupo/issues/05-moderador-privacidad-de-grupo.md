# 05: El moderador protege los datos de cada persona frente al grupo

**Status:** ready-for-agent
**Tracker:** PLTNS-67

**What to build:** Lo que una persona le cuenta a su asistente no llega a las otras personas del plan. Si un asistente intenta mandar a la sala un dato privado de su humano, el moderador lo bloquea y solo esa persona ve la alerta.

**Blocked by:** 01

- [ ] Un dato sensible de un consumidor dirigido a otro consumidor o a todos se bloquea por `sensitive_data`.
- [ ] El mismo dato sigue pasando hacia el proveedor cuando el contrato lo pide.
- [ ] El juez recibe quién es cada participante y de qué lado está.
- [ ] El set versionado de moderación suma al menos 4 casos legítimos y 4 fugas entre consumidores, incluido el paso de fuga del escenario.
- [ ] `pnpm test` pasa con el LLM falso y `pnpm eval:moderator` reporta los casos nuevos.
