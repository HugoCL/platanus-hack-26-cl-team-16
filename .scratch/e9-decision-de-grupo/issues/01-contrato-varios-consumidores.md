# 01: Contrato: un plan con varios consumidores

**Status:** ready-for-agent
**Tracker:** PLTNS-63

**What to build:** Una sala puede tener varias personas del lado consumidor, cada una con su asistente, frente a un solo proveedor. Una de ellas es el organizador. El contrato de la sala dice cuántas personas tienen que decidir. Las salas de E8, con un solo consumidor, siguen funcionando igual.

**Blocked by:** E8 integrado a `main` (PLTNS-22)

- [ ] El contrato de sala acepta de 1 a 6 consumidores y exactamente un proveedor, y distingue al organizador.
- [ ] Cada humano del lado consumidor queda asociado a su propio asistente.
- [ ] Hay ejemplos válidos e inválidos del contrato nuevo en los ejemplos compartidos, y la validación los distingue.
- [ ] Los datos semilla y las pruebas de E2, E3 y E8 pasan sin cambios de comportamiento.
- [ ] El cambio va en un PR propio que solo toca contratos, schema, ejemplos y migración si hace falta.
- [ ] `docs/architecture.md` describe la sala con varios consumidores.
