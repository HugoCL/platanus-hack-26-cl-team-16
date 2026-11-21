# E9: decisión de grupo

Tracker: PLTNS-62. Viene después de E8 (PLTNS-22) y no cambia su escenario: la clínica con un solo humano sigue siendo la prueba de aceptación de la fase 1.

## Por qué

El track Multiplayer pide que el producto mejore cuando lo usa más de una persona. En el escenario de E8 hay un solo humano, así que un juez puede leerlo como una persona hablando con una máquina. E9 agrega un escenario que una persona sola no puede resolver: un grupo que tiene que ponerse de acuerdo para reservar algo, cada uno con su asistente, en la misma sala.

Tiene que servirle a alguien que no sabe qué es un agente.

## Escenario de referencia

Es la prueba de aceptación de E9 (ticket 07).

1. Juan escribe en el inicio: «Queremos reservar para 3 el sábado». Se le crea un asistente por detrás; no configura nada.
2. El asistente de Juan busca en el directorio, elige un proveedor que reserva y abre el plan.
3. Juan invita a Ana y a Pedro con un link. Cada uno lo abre en su teléfono, pone su nombre y entra, sin crear cuenta. Cada invitado recibe su propio asistente.
4. El proveedor ofrece horarios con un selector dirigido a todos. Cada persona marca en su pantalla el que le sirve. Todos ven cuántos faltan: «2 de 3 ya eligieron».
5. Paso de fuga, fijo en el escenario: el asistente de Ana intenta mandar a la sala un dato privado de Ana. El moderador lo bloquea, Ana ve la alerta y los demás no reciben el mensaje.
6. Cuando los tres coinciden en un horario, el proveedor manda la tarjeta de confirmación. Todos la ven y confirma Juan, que organizó.
7. El proveedor reserva 3 cupos de ese horario y el plan se cierra.

## Decisiones

1. **A sobre B (Hugo, 21/11).** E9 es una épica nueva encima de E8. No se rehacen los PRs abiertos de E2, E3 ni E8.
2. **Los contratos van primero y aparte.** El cambio en `shared/` y `convex/schema.ts` es el ticket 01, en su propio PR, como pide `plans/epicas-y-tracks.md`.
3. **Varios consumidores, un proveedor.** La sala admite de 2 a 6 personas del lado consumidor, cada una con su asistente, y un solo proveedor. Varios proveedores a la vez queda fuera.
4. **Quien abre el plan es el organizador.** Es el único que invita y el único que confirma la reserva final.
5. **La decisión se cierra cuando todos los humanos del lado consumidor eligieron el mismo horario.** Si no coinciden, el proveedor ofrece una nueva ronda. Las rondas cuentan para el límite de turnos.
6. **Entrada por link, sin cuenta.** El link lleva un token de un solo plan; se guarda solo su hash, igual que las API keys y el token de reclamo. Quien entra es un participante humano de esa sala y de ninguna otra.
7. **Lenguaje de la UI.** En pantalla no aparecen «agente», «sala», «contrato» ni «moderador». Son «tu asistente», «el plan», «las reglas del plan» y «protección». Los nombres del código no cambian.
8. **Cada asistente guarda lo de su humano.** Lo que un humano le dice a su asistente no llega a los otros consumidores. El moderador lo hace cumplir, igual que hoy hace cumplir el contrato con el proveedor.

## Qué hay que resolver antes de construir

- **Identidad del invitado.** El PR #32 exige un usuario de Clerk con membresía en la sala, y el login sigue bloqueado (PLTE-36). El ticket 02 tiene que dar al invitado una identidad que Convex acepte sin cuenta, y no puede abrir una vía para leer salas ajenas.
- **Proveedor para grupos.** En la semilla, los horarios de la clínica tienen capacidad 1 y el hotel reserva noches. Hace falta un proveedor con horarios de capacidad mayor que el grupo (ticket 07).

## Fuera de alcance

Varios proveedores compitiendo, pagos y división de la cuenta, chat privado entre dos personas del grupo, votar entre proveedores, reagendar o cancelar, notificaciones fuera de la app, y que el personal del proveedor apruebe o tome el control de su agente (es el candidato siguiente si sobra tiempo).

## Tickets

| N.º | Ticket | Bloqueado por |
| --- | --- | --- |
| 01 | Contrato: un plan con varios consumidores | E8 en `main` |
| 02 | Entrar a un plan por link, sin cuenta | 01 |
| 03 | Cada persona responde el selector y todos ven el avance | 01 |
| 04 | Cerrar la decisión y reservar para el grupo | 03 |
| 05 | El moderador protege los datos de cada persona frente al grupo | 01 |
| 06 | Pantalla del plan para quien no sabe de agentes | 02, 03 |
| 07 | Proveedor para grupos, escenario de punta a punta y guion | 04, 05, 06 |
