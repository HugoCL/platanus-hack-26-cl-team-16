# 06: Pantalla del plan para quien no sabe de agentes

**Status:** ready-for-agent
**Tracker:** PLTNS-68

**What to build:** Una persona que nunca usó un agente puede crear un plan, invitar a sus amigos y decidir, desde su teléfono, sin leer el hilo de la conversación. Escribe una frase, comparte un link y toca un horario.

**Blocked by:** 02, 03

- [ ] El inicio tiene un solo campo para la petición; al enviarla se abre el plan.
- [ ] El plan muestra arriba, fijo, su estado en una frase: buscando horario, falta alguien, listo para confirmar, reservado.
- [ ] Un botón Invitar abre el menú de compartir del teléfono y muestra un QR.
- [ ] Se ve quién está en el plan y quién falta por elegir.
- [ ] El hilo entre asistentes se puede abrir, pero no hace falta para completar el plan.
- [ ] La pantalla no usa las palabras «agente», «sala», «contrato» ni «moderador».
- [ ] Un bloqueo se explica en una línea sin términos técnicos.
- [ ] Funciona a 375 px sin desplazamiento horizontal y cada acción principal se alcanza con un toque.
- [ ] Los controles usan primitivas de UI SDK y los tokens de `app/tokens.css`.
