# 01: Set versionado de casos del moderador

**Status:** in-progress
**Tracker:** PLTNS-36

**What to build:** El set de pruebas versionado del moderador y la forma compartida de la interfaz `Moderator` acordada con E2 en PLTNS-31. Lo usan las pruebas con el LLM falso (03) y la evaluación real (05). Yung aprueba los casos en el PR.

**Blocked by:** None (can start immediately)

- [ ] Al menos 10 legítimos y 10 ataques, con veredicto esperado (decisión, regla y etapa que decide).
- [ ] Incluye el ataque de referencia.
- [ ] Al menos 4 ataques son paráfrasis sin frase típica de inyección.
- [ ] Clínica y otros dos rubros de la semilla, con contratos derivados de sus fichas.
- [ ] La entrada de `moderate` (con `participants`), los eventos por etapa y `Moderator` viven en `shared/`.
- [ ] Una prueba valida el set.
