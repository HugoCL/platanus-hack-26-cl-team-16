# 04: Cerrar la decisión y reservar para el grupo

**Status:** ready-for-agent
**Tracker:** PLTNS-66

**What to build:** Cuando todas las personas eligieron el mismo horario, el proveedor manda la confirmación, el organizador confirma y se reservan los cupos del grupo. Si no coinciden, el proveedor ofrece otra ronda de horarios.

**Blocked by:** 03

- [ ] Con todos de acuerdo, el proveedor emite la tarjeta de confirmación y solo el organizador puede confirmarla.
- [ ] Confirmar reserva tantos cupos como personas hay en el grupo, en una sola transacción, y nunca por sobre la capacidad del horario.
- [ ] Si no hay coincidencia, el proveedor ofrece una nueva ronda y la sala lo avisa.
- [ ] Las rondas respetan el límite de turnos; al llegar al límite la sala avisa que no hubo acuerdo.
- [ ] Confirmar dos veces no reserva dos veces.
- [ ] Con el LLM falso, una prueba recorre acuerdo a la primera, acuerdo en la segunda ronda y sin acuerdo.
