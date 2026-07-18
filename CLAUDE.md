# TRAPO — Sistema de Asistencia

App de fichada (entrada/salida con GPS) + pedido de materiales para los
empleados de una empresa de limpieza (TRAPO / Fiorentino Blaiotta).

## Arquitectura

- **`index.html`** — single-page app, sin build step. Se publica vía
  GitHub Pages con dominio custom (`CNAME` → asistencia.limpiezatrapo.com).
- **`AppsScript.gs`** — backend, vive en el editor de Google Apps Script
  *adentro* del Google Sheet que guarda los datos. **No se despliega
  solo**: es un archivo de referencia en este repo, pero Google no lo lee
  de acá.

### ⚠️ Paso manual obligatorio después de tocar `AppsScript.gs`

Cada cambio en `AppsScript.gs` requiere que el usuario (Andi, dueño de la
cuenta Google) lo redeploye a mano:
1. `github.com/AndiBlaiotta/Asistencia/blob/main/AppsScript.gs` → Copy raw contents
2. Pegarlo en el editor de Apps Script (Extensiones → Apps Script desde el Sheet), reemplazando todo
3. Ctrl+S
4. Implementar → Gestionar implementaciones → lápiz ✏️ → Nueva versión → Implementar
   (mantiene la misma URL de `APPS_SCRIPT_URL` en `index.html`)

Sin este paso, los cambios en el repo no tienen ningún efecto real. Avisar
esto siempre que se edite `AppsScript.gs`.

Yo (Claude) no tengo acceso a la cuenta de Google — no puedo hacer este
paso ni loguearme ahí. Sí puedo probar los endpoints después del redeploy
con `curl` contra la URL pública (login/historial son de solo lectura;
para "pedir"/"registrar" avisar antes de escribir datos reales, o hacer
el ciclo completo pedir→recibido para no dejar nada pendiente).

## Seguridad

- **El repo es público** (necesario para GitHub Pages en plan free), así
  que NADA secreto puede vivir en el código. Los hashes de contraseña
  **NO** van en `AppsScript.gs` (antes sí iban en `EMPLEADOS_HASH`/
  `ADMINS_HASH` — quedaron expuestos en la historia de git; por eso se
  fuerza rotación, ver abajo).
- **Auth self-service con caducidad** (implementado 2026-07-18):
  - El cliente calcula `SHA-256(password)` (`sha256Hex()`) y lo manda; el
    server nunca ve el texto plano.
  - Las credenciales viven en la hoja **"Auth"** (privada) como
    `HMAC-SHA256(pepper, hashDelCliente)`. El **pepper** es un secreto en
    **Script Properties** (`AUTH_PEPPER`), fuera del repo.
  - Guardar HMAC(pepper, …) hace que el valor at-rest no sea reversible ni
    replayable si se filtrara la hoja.
  - Cada usuario **elige y cambia su propia contraseña** (endpoint
    `cambiarPassword`); **caduca a los `PASSWORD_MAX_AGE_DAYS` (90) días**.
    En el login vencido/marcado, `login` responde `mustChangePassword` y el
    front obliga a elegir una nueva antes de entrar. Mínimo 6 caracteres
    (validado en el cliente; el server nunca ve el texto plano).
  - `setupAuth()` (run-once en el editor) crea el pepper y siembra la hoja
    Auth desde `LEGACY_HASH` con "cambio obligatorio" → la rotación la hace
    cada empleado solo en su próximo login. `LEGACY_HASH` es fallback de
    migración; borrar cuando todos hayan migrado.
- Todo `doGet` action valida `checkAuth`/`checkAdmin` (que consultan la
  hoja Auth) antes de hacer nada.
- `empleado`/`admin`/`producto` se validan contra listas conocidas
  server-side (`EMPLEADOS`, `ADMINS`, `PRODUCTOS`).
- Extras: comparación en tiempo constante (`tiempoConstanteIgual`).

## Estructura del Google Sheet

- Una hoja por empleado (fichadas: Fecha, Servicio, Dirección, Tipo,
  Hora, Lat, Lon, Link GPS, Precisión). Fecha/hora se guardan con
  `setNumberFormat("@")` para que Sheets no las autoconvierta a su tipo
  Date interno (rompía el historial — bug ya resuelto).
- **"Materiales y productos"** — grilla servicio (columna) × producto
  (fila). Estados de celda:
  - vacía = disponible
  - `"PEDIDO <cant> dd/mm/yyyy"` = pedido por el empleado, esperando compra
  - `"COMPRADO <cant> dd/mm/yyyy"` = el admin lo compró, esperando que el
    empleado marque recibido
  Bloqueado mientras no esté disponible (no se puede volver a pedir).
  `parseEstadoCelda()` parsea estos formatos (tolera el viejo sin cantidad).
  Se automantiene: columnas/filas nuevas se crean solas. Columna **B "Total"**
  (fórmula viva) suma las **unidades** pendientes por producto; la crea/mantiene
  `setupMaterialesVista()` (correr a mano una vez tras cada cambio estructural).
- **"Historial Pedidos"** — log append-only de cada Pedido/Comprado/Recibido
  (fecha, hora, empleado, servicio, producto, acción, **cantidad**).
- **"Auth"** — credenciales (ver sección Seguridad). Privada, no en el repo.

## Config hardcodeada (no vive en el Sheet)

`SERVICIOS` (servicios por empleado) vive en `index.html`; las listas de
**nombres** `EMPLEADOS`/`ADMINS` en `AppsScript.gs` (los nombres no son
secretos). Las **credenciales** ya NO viven en código (van en la hoja Auth +
pepper, ver Seguridad). `PRODUCTOS` (19 ítems de limpieza) vive en
`AppsScript.gs`. Decisión deliberada del usuario:
prefiere editar código antes que depender de una estructura de Sheet
editable a mano. Agregar/sacar un empleado, servicio o producto = editar
estas listas en ambos archivos según corresponda y redeployar.

## Entorno de testing

Este sandbox no tiene Playwright/chromium-cli instalados y se evitó
instalar paquetes nuevos solo para probar. La verificación real se hizo
con `curl` directo contra la URL de Apps Script (login, historial,
materiales, pedir, recibido) más chequeo de sintaxis JS con
`node --check`. No se hizo prueba de UI en navegador real.

## Decisiones de diseño a recordar

- **Ciclo de vida de un pedido (3 estados):** `disponible → PEDIDO`
  (empleado pide, elige cantidad) `→ COMPRADO` (admin marca comprado; el
  empleado ve el seguimiento) `→ recibido` (empleado confirma → celda se
  libera y el ciclo queda en el log "Historial Pedidos"). El botón
  "Comprado" es solo del admin y vive únicamente en la lista nueva
  "🛒 Pedidos para comprar" (endpoint `adminPedidosActivos`, lee el estado
  actual de la grilla). El "Recibido" del empleado aparece recién cuando
  está COMPRADO, pero el backend acepta recibido también desde PEDIDO por
  si el admin no llegó a marcarlo.
- **El pedido SÍ lleva cantidad** (entero 1–99, elegida por el empleado al
  pedir). Nota: originalmente era un estado binario sin cantidad; el usuario
  pidió agregar unidades (2026-07-18). La "lista general" de completados es
  el mismo "Historial de pedidos por lugar" que ya existía (se reusó).
- El bloqueo (no poder pedir dos veces lo mismo mientras está pendiente)
  fue idea del usuario; "recibido" es la única acción que libera el ítem.
- El historial de pedidos se filtra por **servicio**, no por empleado —
  varios empleados pueden compartir un mismo servicio/ubicación
  (ej. "Acorus" lo atienden Celeste Freire y Rocio Medina) y a todos les
  interesa ver qué se pidió ahí, no solo lo que pidieron ellos mismos.
