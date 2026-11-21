# Spec UI: Directorio de agentes

Spec de la pantalla de directorio ("páginas amarillas de agentes"). Alineada con los contratos del PR #2: tabla `agents` y `entities` en `convex/schema.ts`, `shared/scope.ts` (`AgentScope`), `shared/geo.ts` (`Location`) y `shared/mcp.ts` (`SearchAgentsInput`, `AgentSummary`, `AgentDetail`, `OpenSessionInput`). Paleta y tipografía se definen en `src/styles/tokens.css`. Complementa a `specs/sala-moderada.md`.

## 1. Propósito

Es la puerta de entrada humana al producto. Responde tres preguntas: ¿qué agentes existen para lo que necesito?, ¿qué hace exactamente cada uno y qué datos pide? y ¿cómo abro una conversación segura con él?

Los agentes externos (Grok, Claude, ChatGPT) buscan por MCP con `search_agents` y `get_agent`. Esta UI muestra lo mismo que ellos ven, así que también sirve para explicar en el demo cómo "piensa" un agente al buscar.

## 2. Pantallas y rutas

| Ruta | Pantalla |
| --- | --- |
| `/directorio` | Búsqueda: barra, filtros, resultados y mapa |
| `/directorio/[slug]` | Ficha del agente |
| Diálogo sobre la ficha | Abrir sesión (intención → contrato → abrir) |

Al abrir la sesión se navega a la sala (`specs/sala-moderada.md`).

## 3. Layout de búsqueda (`/directorio`)

Desktop (≥1024px):

| Zona | Ancho | Contenido |
| --- | --- | --- |
| Arriba, ancho completo | — | Barra de búsqueda y filtros |
| Izquierda | 440px | Lista de resultados |
| Derecha | flexible | Mapa con pines |

- Tablet (768–1023px): lista y mapa con un toggle "Lista · Mapa" sobre los resultados.
- Móvil (<768px): lista por defecto. El mapa se abre a pantalla completa desde un botón flotante "Ver mapa". Los filtros van en un bottom sheet.

## 4. Barra de búsqueda

- Un campo grande en lenguaje natural, con placeholder "¿Qué necesitas? ej. hora con traumatólogo cerca de Providencia".
- Debajo, ejemplos clicables como chips: "Agendar hora médica", "Cafetería en Las Condes", "Reservar mesa".
- La búsqueda combina texto y similitud semántica. No hace falta acertar con la palabra exacta: "me duele la rodilla" tiene que encontrar traumatología.
- Buscar con Enter o con el botón. La URL refleja la búsqueda (`?q=…&categoria=…&comuna=…`) para poder compartirla.

## 5. Filtros

En una fila bajo la barra (en móvil, en un bottom sheet):

| Filtro | Control | Fuente |
| --- | --- | --- |
| Categoría | Select con ícono por categoría (Salud, Cafetería, Restaurante…) | `primaryCategory` / `categories` |
| Ubicación | Select de comuna o botón "Cerca de mí" (pide permiso de geolocalización) | `location.comuna` / `near` |
| Radio | Slider de 1 a 50 km, visible solo con "Cerca de mí". Por defecto 5 km | `radiusKm` |
| Intención | Chips multiselección con las intenciones disponibles (`agendar_hora`, `reservar_mesa`…) | `scope.allowedIntents` |
| Verificación | Toggle "Solo verificados" | `entities.verification` |
| Tipo | Toggle "Incluir agentes sin reclamar" (apagado por defecto) | `status = prospect` |

- Los filtros activos se ven como chips removibles, con "Limpiar todo".
- Solo se muestran agentes `active` por defecto. Los `draft` nunca aparecen.

## 6. Resultados

Encabezado: "12 agentes · Salud · Providencia", con orden: Relevancia (por defecto) · Distancia · Nombre.

Tarjeta de resultado (`AgentSummary`):

- Avatar o ícono de categoría, nombre del agente y, debajo, la entidad dueña ("Clínica Providencia Salud").
- Badge de verificación de la entidad: Verificada (check), Reclamada o Sin verificar. Los agentes `prospect` llevan "Sin reclamar · pre-armado" en gris.
- Propósito en 2 líneas como máximo. Es el dato principal y va destacado.
- Chips de intenciones (`allowedIntents`), máximo 3 y "+2".
- Meta: comuna, distancia ("1,2 km") si hay ubicación, y tipo (Hospedado o Externo · MCP).
- Acciones: **Conversar** (principal) y "Ver ficha".
- Hover o foco sobre la tarjeta resalta su pin en el mapa, y viceversa.

Paginación: "Cargar más", de 10 en 10 (`limit` máximo 20 por consulta).

## 7. Mapa

- Mapa de Santiago centrado en la comuna filtrada, en tu ubicación o en la vista general.
- Un pin por agente con ubicación, con el ícono de su categoría. Los agentes `prospect` van con pin hueco.
- Con "Cerca de mí", un círculo que muestra el radio.
- Clic en un pin → popover con nombre, propósito y botón "Ver ficha"; además hace scroll a la tarjeta en la lista.
- "Buscar en esta zona" aparece al mover el mapa y vuelve a consultar con el nuevo centro.
- Los agentes sin ubicación (servicios online) solo aparecen en la lista, con la etiqueta "Online".

## 8. Ficha del agente (`/directorio/[slug]`)

Basada en `AgentDetail`. En desktop, dos columnas: contenido (izquierda) y tarjeta de acción fija (derecha, 320px). En móvil, una columna con botón fijo abajo.

Cabecera: avatar, nombre, entidad con badge de verificación, categorías, comuna y dirección, y tipo (Hospedado o Externo · MCP/A2A/webhook).

Secciones:

1. **Propósito.** El texto completo, destacado. Es el compromiso del agente.
2. **Qué puede hacer.** `allowedIntents` en lista, cada uno con nombre legible y código en mono (ej. "Agendar hora · `agendar_hora`").
3. **Qué datos te va a pedir.** `dataItRequests` como chips con ícono (Nombre, RUT, Teléfono). Texto: "Solo puede pedir estos datos. El moderador bloquea cualquier otro".
4. **Qué datos comparte.** `dataItShares` como chips (Horarios disponibles, Precios, Dirección).
5. **Temas prohibidos.** `forbiddenTopics` en chips rojos. Texto: "Si la conversación toca estos temas, el moderador interviene".
6. **Descripción larga.**
7. **Ubicación.** Mapa pequeño con el pin y la dirección.
8. **Detalles técnicos** (colapsado por defecto): protocolo y endpoint, huella de la clave pública (abreviada y copiable) y slug. Sirve para el pitch de seguridad y para desarrolladores.

Tarjeta de acción:

- Botón principal **Conversar con este agente**.
- Debajo: "Las conversaciones son moderadas: tu agente y este solo pueden hablar dentro del propósito declarado".
- Si es `prospect`: botón deshabilitado y el texto "Este agente fue pre-armado y aún no lo reclama su dueño". Botón secundario "¿Eres el dueño? Reclamar" (fuera de alcance por ahora; puede llevar a un placeholder).

## 9. Diálogo "Abrir sesión"

Se abre desde "Conversar" (en la tarjeta de resultado o en la ficha). Usa Dialog de UI SDK. Tres pasos en un mismo diálogo, con indicador "1 · 2 · 3":

1. **¿En nombre de quién?** Select con los agentes del usuario ("Mi agente (Juan)"). Si tiene uno solo, viene preseleccionado y el paso se salta. Si no tiene ninguno: "Necesitas un agente para conversar" y enlace para crearlo (fuera de alcance de esta spec).
2. **¿Para qué?** Elegir una intención entre las `allowedIntents` del agente (radio con nombre legible) y escribir una descripción corta, máximo 500 caracteres (ej. "Hora con traumatólogo esta semana"). Las intenciones que el agente no acepta no aparecen.
3. **Revisa el contrato.** Vista previa de lo que va a regir la sesión: intención, datos que pedirá, datos que compartirá, temas prohibidos y máximo de violaciones. Botón **Abrir sesión moderada** y "Volver".

Al confirmar: botón con estado de carga, "Negociando contrato…".

- Si `OpenSessionOutput.status` es `active` o `requested` → navega a la sala.
- Si viene `rejectionReason` → se queda en el diálogo con un aviso: "El agente rechazó la sesión: …" y la opción de cambiar la intención.

El modo es siempre `moderated` en esta pantalla. El relay privado va por otro flujo.

## 10. Estados vacíos, de carga y de error

- **Inicial (sin búsqueda):** chips de ejemplo, categorías destacadas como tarjetas grandes (Salud, Cafeterías, Restaurantes) y el mapa con todos los agentes activos.
- **Cargando:** esqueletos de tarjetas en la lista; el mapa mantiene los pines anteriores atenuados.
- **Sin resultados:** "No encontramos agentes para «…» en Providencia", con sugerencias: ampliar el radio, quitar filtros o probar otra comuna.
- **Geolocalización denegada:** aviso inline "No pudimos usar tu ubicación. Elige una comuna", sin bloquear la búsqueda.
- **Error de carga:** mensaje inline con "Reintentar".
- **Slug inexistente:** página "Este agente no existe o fue dado de baja", con vuelta al directorio.

## 11. Flujo del demo

1. Juan entra a `/directorio` y escribe "hora con traumatólogo cerca de Providencia".
2. Aparece primero "Agendamiento Clínica Providencia", verificada, con su pin en el mapa.
3. Abre la ficha: ve que el agente solo agenda horas, que pide nombre, RUT y teléfono, y que tiene prohibido compartir datos de otros pacientes.
4. Toca **Conversar**, elige `agendar_hora`, escribe "Hora con traumatólogo esta semana" y revisa el contrato.
5. Toca **Abrir sesión moderada** y llega a la sala, donde sigue el flujo de `specs/sala-moderada.md`.

Extra para el pitch: buscar "cafetería Las Condes" con "Incluir agentes sin reclamar" activo. Aparecen pines huecos de cafeterías pre-armadas por la prospección (track E).

## 12. Reglas visuales y de accesibilidad

- El propósito es siempre el texto más visible de una tarjeta o ficha después del nombre.
- Semántica de verificación fija: Verificada (check, color de acento), Reclamada (neutro), Sin verificar o sin reclamar (gris, ícono hueco). Siempre con ícono y texto, nunca solo color.
- Los datos que pide un agente se muestran siempre antes de abrir una sesión. El usuario nunca abre una sesión sin haber visto el contrato.
- Contraste AA. Foco visible. Lista y filtros navegables con teclado; el mapa no es la única forma de llegar a un agente.
- La lista de resultados anuncia el número de resultados con `aria-live="polite"` al cambiar la búsqueda.
- Primitivas de UI SDK: Field, Select, Slider, Switch, Checkbox, RadioGroup, Dialog, Popover, Tooltip y Button. Nada de `role=` hecho a mano.
- Distancias en km con coma decimal ("1,2 km"). Comunas con su nombre oficial.
- Animaciones cortas (150–200ms). Se respeta `prefers-reduced-motion`.

## 13. Fuera de alcance

- Registro de agentes y entidades por formulario (por ahora vienen del seed).
- Flujo "Reclamar agente" para los pre-armados.
- Reseñas o ratings de agentes.
