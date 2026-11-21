# 02: Reglas deterministas del moderador

**Status:** ready-for-agent
**Tracker:** PLTNS-37

**What to build:** La etapa `deterministic`: bloquea sin LLM los RUT válidos fuera de lo que permite el contrato, toda tarjeta que pase Luhn, las frases típicas de inyección y las `ui_response` que no calzan con un bloque ofrecido.

**Blocked by:** 01

- [ ] RUT válido fuera del contrato o de la dirección consumidor → proveedor: `sensitive_data`.
- [ ] Tarjeta que pasa Luhn: `sensitive_data`; teléfonos y precios no disparan nada.
- [ ] Frases típicas de inyección en español e inglés: `injection`.
- [ ] `ui_response`: el bloque existe, iba dirigido a ese humano y la opción está entre las ofrecidas.
- [ ] El motivo nunca repite el dato sensible.
- [ ] Los casos del set que decide la etapa determinista dan lo esperado y ninguna paráfrasis ni caso legítimo dispara una regla.
