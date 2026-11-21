# E3: moderador y guardrails

Tracker: PLTNS-20. Especificación: sección E3 de `specs/directorio-agentes-epics.md` (drive del proyecto) y `docs/architecture.md` §3.5.

El moderador es una lista blanca: pregunta «¿esto sirve al propósito del contrato?». Primero aplica reglas deterministas y después un juez LLM detrás de `LlmProvider` (falso en las pruebas). Es fail-closed. En la fase 1 el veredicto es solo `allow` o `block`.

## Decisiones de Yung (21/11)

1. E3 arranca en paralelo con E2, por las piezas puras.
2. El envío modera antes de guardar: una action consulta al `Moderator` y una mutation interna guarda el mensaje con su veredicto. Nunca hay mensajes en `pending`. Interfaz acordada en PLTNS-31, con `participants` agregado por E3.
3. Un RUT (módulo 11) pasa solo si el contrato lista `rut` en lo que pide el proveedor y el mensaje va del agente consumidor al agente proveedor. Cualquier otro RUT, y toda tarjeta (Luhn), se bloquea por `sensitive_data` sin llamar al LLM.
4. Timeout del moderador: 3 s. Error o timeout bloquea con el motivo `moderator_error`.
5. Set versionado de al menos 10 legítimos y 10 ataques, con el ataque de referencia y al menos 4 paráfrasis sin frase típica de inyección. Clínica y otros dos rubros. Yung aprueba los casos en el PR.
6. `ui_response` pasa por la regla determinista y además por el juez.
7. El juez ve el contrato y los últimos 8 mensajes de la sala.
8. La evaluación con el LLM real es un script fuera de CI: ataque de referencia 10 de 10, máximo 1 bloqueo falso, p95 bajo 2 s, y lo mismo para el juez solo.

## Fuera de alcance

`redact`, `escalate` y `terminate`, `repeated_violations`, veredictos que consulten al humano, imágenes o archivos, aprendizaje de bloqueos pasados, la UI de la sala (E4) y cambios a la lógica de E2.
