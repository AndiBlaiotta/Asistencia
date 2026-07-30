// =====================================================================
// SCRIPT DE ASISTENCIA v4 — Google Apps Script
// =====================================================================
// Cada empleado tiene su propia hoja en la planilla con sus fichadas.
// Además hay una hoja "Materiales y productos" (grilla servicio x
// producto, vacío = disponible / "PEDIDO fecha" = bloqueado) y una hoja
// "Historial Pedidos" (log de cada pedido y cada recepción).
//
// Las contraseñas NUNCA se guardan ni viajan en texto plano: el cliente
// calcula un hash SHA-256 de la contraseña y este script lo compara
// contra el hash guardado acá. Todo pedido (login, registrar, historial,
// materiales, pedir, recibido, historialPedidos) se valida contra este
// hash antes de hacer cualquier cosa.
//
// INSTRUCCIONES:
// 1. Abrí el Apps Script (Extensiones → Apps Script en tu Google Sheet)
// 2. Reemplazá TODO el código con este
// 3. Guardá (Ctrl+S)
// 4. Implementar → Nueva implementación → Aplicación web
//    - Ejecutar como: Yo
//    - Acceso: Cualquier persona
// 5. Copiá la nueva URL y pegala en index.html (APPS_SCRIPT_URL)
// =====================================================================

const HEADERS = [
  "Fecha",
  "Servicio",
  "Dirección",
  "Tipo",
  "Hora",
  "Latitud",
  "Longitud",
  "Link GPS",
  "Precisión (m)",
  "Estado",
  "Motivo tardanza"
];

// Hojas que NO son de empleados (no llevan fichadas): se saltean al recorrer
// todas las hojas como si fueran de empleados (adminResumen, adminTardanzas).
const HOJAS_NO_EMPLEADO = ["Materiales y productos", "Historial Pedidos", "Auth",
                           "Vacaciones", "Coberturas"];

// ---- Vacaciones / Coberturas ----
// "Vacaciones": una solicitud por fila (Pendiente/Aceptada/Rechazada).
// "Coberturas": qué servicio cubre qué suplente durante el período de una
// licencia aceptada (le habilita fichar ese servicio solo en esas fechas).
const VACAS_SHEET   = "Vacaciones";
const VACAS_HEADERS = ["ID", "Empleado", "Desde", "Hasta", "Días", "Estado", "Solicitado", "Resuelto"];
const COBERTURAS_SHEET   = "Coberturas";
const COBERTURAS_HEADERS = ["ID", "VacacionID", "Servicio", "Titular", "Suplente", "Desde", "Hasta", "Asignado"];

// Lista maestra de productos/materiales (filas de "Materiales y productos").
const PRODUCTOS = [
  'Guantes "Steff"',
  'Escobillón grande "Fede"',
  'Secador reforzado blanco "SG" N 40',
  'Balde plástico reforzado 13 lts',
  'Trapo piso consorcio gris "Fibran Sur"',
  'Pano microfibra "Sina"',
  'Rejilla "Fibran Sur" semipesada',
  'Desodorante para piso "Starbel" 5 lts',
  'Lavandina "Starbel" 5 lts',
  'Limpia vidrios "QM" 5 lts',
  'Desengrasante multiuso "QM" 5 lts',
  'Blem para muebles',
  'Prod. ascensor/metales "Venus" 425ml',
  'Desodorante de ambiente "Odorite"',
  'Bolsa de consorcio 90x120 50 unidades',
  'Detergente limón "Starbel" 5 lts',
  'Guantes institucionales negros super reforzados "Jorgito"',
  'Desinfectante amonio cuaternario Antibactervid19 x 5 lt',
  'Desengrasante Cocina Cif ultra rapido x 5 lts'
];

const HIST_PEDIDOS_HEADERS = ["Fecha", "Hora", "Empleado", "Servicio", "Producto", "Acción", "Cantidad"];

// ============================================================
// AUTENTICACIÓN (self-service, con caducidad)
// ============================================================
// Los NOMBRES no son secretos (ya están en el frontend). Las CREDENCIALES sí:
// viven en la hoja "Auth" (privada) como HMAC-SHA256(pepper, hashDelCliente),
// con el pepper guardado en Script Properties (fuera del repo público). El
// cliente manda SHA-256(password); el server nunca ve la contraseña en claro.
// Cada usuario elige/cambia su propia contraseña; caduca a los 90 días.

const EMPLEADOS = [
  "Maria Decimas", "Celeste Freire", "Rocio Medina", "Brisa Medina",
  "Sabrina Scarampo", "Rebeca Ayala", "Alejandro Jelvez", "Milagros Acuña"
];
const ADMINS = ["Andrés Blaiotta", "Martín Fiorentino"];

// Servicios "libres": sin horario fijo, con dirección variable escrita al
// fichar, EXENTOS de la regla de una fichada por día (Regla D) y disponibles
// para TODOS los empleados por encima de sus servicios. Duplicado a propósito
// en index.html (front, como HORAS_EXTRAS/SUPLENCIAS). Cambiar = tocar ambos.
const SERVICIOS_LIBRES = ["Horas Extras", "Suplencias"];

// La contraseña caduca a los 90 días: en el próximo login el sistema obliga
// a elegir una nueva.
const PASSWORD_MAX_AGE_DAYS = 90;

const AUTH_SHEET   = "Auth";
const AUTH_HEADERS = ["Usuario", "Credencial", "FechaCambio", "CambioObligatorio"];

// Hashes viejos (SHA-256) SOLO para la migración: sirven para sembrar la hoja
// Auth (setupAuth) y como fallback hasta que cada usuario cambie su clave. Ya
// están en la historia pública de git; se vuelven inútiles apenas cada uno
// rota su contraseña. Se pueden borrar cuando todos hayan migrado.
const LEGACY_HASH = {
  "Maria Decimas":     "626e3c805e77eeb472c42c6be607be2af7ac5c08fd7050f278e0330fe81abf57",
  "Celeste Freire":    "22a9067d9bbd2104e0be07c6cc05be1de74d583ff4c2143248d2b67ca8c9f52f",
  "Rocio Medina":      "2131c65bf715f3f1af43a56f798b5c2722b69aa25b0471a86b8b71501e458d47",
  "Brisa Medina":      "63fb746a9789963a9f31559a34ba63475eb096e6c4c08399c107f7bba18eb847",
  "Sabrina Scarampo":  "8958b734a4f493cf3f7183d30975ac96fac11cab265cd6bbf49acc51888c726f",
  "Rebeca Ayala":      "49442a8bccaa5b9c6ce95da7c7c16362c2cba5a7154ade43569894f8eaad3f69",
  "Alejandro Jelvez":  "9224bad05c7df15aa6deba13ff6e66172d0834604362ca34872d8e0d29d1768f",
  "Andrés Blaiotta":   "6487cd4b9c7bef8e1b25608d4b833726299c8e4fb59713ee9d21ead1e1958865",
  "Martín Fiorentino": "81cd05e8571da7b0e1e3ff4ec60923852c3d387b2c28e84c0dd749de6f2fbd36",
  // Milagros Acuña: contraseña inicial "milagros123" (la cambia sí o sí en su
  // primer login, porque setupAuth la siembra con "cambio obligatorio").
  "Milagros Acuña":    "092af857f5f8db337c4b44375ea6672c1e80399fe86dda8708d5f58d16ce03f3"
};

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Pepper secreto (Script Properties). setupAuth() lo crea si no existe.
function getPepper() {
  return PropertiesService.getScriptProperties().getProperty("AUTH_PEPPER");
}

// Credencial que se guarda/compara: HMAC-SHA256(pepper, hashDelCliente) en
// base64. Devuelve null si todavía no hay pepper configurado.
function credencial(clientHash) {
  const pepper = getPepper();
  if (!pepper) return null;
  return Utilities.base64Encode(
    Utilities.computeHmacSha256Signature(clientHash, pepper)
  );
}

// Comparación en tiempo constante (no filtra info por timing).
function tiempoConstanteIgual(a, b) {
  a = (a || "").toString();
  b = (b || "").toString();
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return dif === 0;
}

function getAuthSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(AUTH_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(AUTH_SHEET);
    sheet.appendRow(AUTH_HEADERS);
    sheet.getRange(1, 1, 1, AUTH_HEADERS.length)
      .setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(2, 320);
  }
  return sheet;
}

// Lee la hoja Auth a un mapa usuario -> {cred, fecha, obligatorio, row}.
function leerAuth() {
  const sheet = getAuthSheet();
  const map = {};
  const last = sheet.getLastRow();
  if (last <= 1) return { sheet, map };
  const data = sheet.getRange(2, 1, last - 1, AUTH_HEADERS.length).getValues();
  data.forEach((r, i) => {
    const usuario = (r[0] || "").toString();
    if (!usuario) return;
    map[usuario] = {
      cred:        (r[1] || "").toString(),
      fecha:       (r[2] || "").toString(),
      obligatorio: r[3] === true || (r[3] || "").toString().toLowerCase() === "true",
      row:         i + 2
    };
  });
  return { sheet, map };
}

function passwordVencida(fechaStr) {
  const m = (fechaStr || "").toString().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return true; // sin fecha válida -> tratar como vencida
  const fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dias = (new Date() - fecha) / (1000 * 60 * 60 * 24);
  return dias > PASSWORD_MAX_AGE_DAYS;
}

// Verifica la credencial de un usuario. Devuelve { ok, mustChange }.
function verificarUsuario(usuario, clientHash) {
  if (!usuario || !clientHash) return { ok: false };
  const { map } = leerAuth();
  const entry = map[usuario];

  if (entry && entry.cred) {
    const cred = credencial(clientHash);
    if (cred && tiempoConstanteIgual(cred, entry.cred)) {
      return { ok: true, mustChange: entry.obligatorio || passwordVencida(entry.fecha) };
    }
    return { ok: false };
  }

  // Fallback de migración: usuario todavía no sembrado en Auth.
  const legacy = LEGACY_HASH[usuario];
  if (legacy && tiempoConstanteIgual(legacy, clientHash)) {
    return { ok: true, mustChange: true };
  }
  return { ok: false };
}

function esEmpleado(u)     { return EMPLEADOS.indexOf(u) !== -1; }
function esAdminNombre(u)  { return ADMINS.indexOf(u) !== -1; }

// Usadas por los endpoints (post-login). Solo validan que la credencial
// matchee; la caducidad se aplica en el login, no en cada request.
function checkAuth(empleado, hash) {
  return esEmpleado(empleado) && verificarUsuario(empleado, hash).ok;
}
function checkAdmin(admin, hash) {
  return esAdminNombre(admin) && verificarUsuario(admin, hash).ok;
}

// Guarda/actualiza la credencial de un usuario y resetea la fecha de cambio.
function guardarCredencial(usuario, cred) {
  const { sheet, map } = leerAuth();
  const hoy   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd");
  const entry = map[usuario];
  const row   = entry ? entry.row : sheet.getLastRow() + 1;
  sheet.getRange(row, 1).setValue(usuario);
  sheet.getRange(row, 2).setNumberFormat("@").setValue(cred);
  sheet.getRange(row, 3).setNumberFormat("@").setValue(hoy);
  sheet.getRange(row, 4).setValue(false);
}

// EJECUTAR A MANO UNA VEZ desde el editor (Run) para inicializar la auth:
//   1. Crea el pepper secreto en Script Properties si no existe.
//   2. Crea la hoja "Auth" y siembra cada usuario con la credencial de su
//      contraseña actual, marcada como "cambio obligatorio", para forzar que
//      en su próximo login elija una contraseña nueva (así se rota lo viejo).
// Idempotente: NO pisa a usuarios que ya tienen fila (los que ya cambiaron).
function setupAuth() {
  const props = PropertiesService.getScriptProperties();
  if (!props.getProperty("AUTH_PEPPER")) {
    props.setProperty("AUTH_PEPPER", Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(Utilities.getUuid(), Utilities.getUuid())
    ));
  }
  const pepper = props.getProperty("AUTH_PEPPER");
  const { sheet, map } = leerAuth();
  Object.keys(LEGACY_HASH).forEach(usuario => {
    if (map[usuario]) return; // ya sembrado / ya cambió -> no tocar
    const cred = Utilities.base64Encode(
      Utilities.computeHmacSha256Signature(LEGACY_HASH[usuario], pepper)
    );
    const row = sheet.getLastRow() + 1;
    sheet.getRange(row, 1).setValue(usuario);
    sheet.getRange(row, 2).setNumberFormat("@").setValue(cred);
    sheet.getRange(row, 3).setNumberFormat("@").setValue("2000-01-01"); // vieja -> vencida
    sheet.getRange(row, 4).setValue(true);                              // cambio obligatorio
  });
}

// Sheets auto-convierte texto tipo fecha/hora a su propio tipo Date.
// Esto lo vuelve a texto legible al leer filas viejas que ya quedaron
// guardadas como Date (de antes de forzar formato de texto al escribir).
function fmtCell(val) {
  if (Object.prototype.toString.call(val) !== "[object Date]") return val;
  const tz = Session.getScriptTimeZone();
  return val.getFullYear() <= 1899
    ? Utilities.formatDate(val, tz, "HH:mm:ss")
    : Utilities.formatDate(val, tz, "dd/MM/yyyy");
}

// ---- "Materiales y productos": grilla servicio (columna) x producto (fila) ----
// Cada celda: vacía = disponible, "PEDIDO dd/MM/yyyy" = pedido y bloqueado.
function getMaterialesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Materiales y productos");
  if (!sheet) {
    sheet = ss.insertSheet("Materiales y productos");
    sheet.getRange(1, 1).setValue("Producto")
      .setFontWeight("bold").setBackground("#4f46e5").setFontColor("white");
    PRODUCTOS.forEach((p, i) => sheet.getRange(i + 2, 1).setValue(p));
    sheet.setFrozenRows(1);
    sheet.setFrozenColumns(1);
    sheet.setColumnWidth(1, 280);
  }
  return sheet;
}

function getProductoRow(sheet, producto) {
  const lastRow = Math.max(sheet.getLastRow(), 1);
  const col = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat() : [];
  const idx = col.indexOf(producto);
  if (idx !== -1) return idx + 2;
  const newRow = lastRow + 1;
  sheet.getRange(newRow, 1).setValue(producto);
  return newRow;
}

function getServicioCol(sheet, servicio) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const row = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const idx = row.indexOf(servicio);
  if (idx !== -1) return idx + 1;
  const newCol = lastCol + 1;
  sheet.getRange(1, newCol).setValue(servicio)
    .setFontWeight("bold").setBackground("#4f46e5").setFontColor("white");
  sheet.setColumnWidth(newCol, 160);
  return newCol;
}

// Configura la VISTA de la hoja "Materiales y productos" (no toca datos de
// pedidos, salvo la migración puntual del punto 3).
// EJECUTAR A MANO UNA VEZ desde el editor de Apps Script (elegir esta
// función en el selector y darle Run). No hace falta redeploy web.
//   1. Congela la fila de servicios (fila 1) y las columnas Producto (A) y
//      Total (B), así la lista de productos y su total quedan siempre a la
//      vista mientras te movés a la derecha entre servicios.
//   2. Inserta/mantiene la columna "Total" (B) que SUMA las unidades
//      pendientes de ese producto (celdas "PEDIDO n ..." y "COMPRADO n ..."
//      de la col C en adelante). Es una fórmula viva: se actualiza sola.
//   3. Migra pedidos viejos sin cantidad ("PEDIDO dd/mm" -> "PEDIDO 1 dd/mm")
//      para que la suma de unidades sea correcta.
// Es idempotente: se puede volver a correr sin duplicar la columna ni la
// migración. Crea las filas faltantes de PRODUCTOS, así que cada vez que
// agregás un producto nuevo (editar PRODUCTOS + redeploy) alcanza con volver
// a correrla para que la fila nueva se cree y reciba su fórmula de Total.
function setupMaterialesVista() {
  const sheet = getMaterialesSheet();
  const TOTAL_HEADER = "Total";

  // ¿Ya existe la columna Total en B? Si no, la inserto empujando los
  // servicios una posición a la derecha (getServicioCol los ubica por
  // nombre, así que el corrimiento no rompe nada).
  const b1 = (sheet.getRange(1, 2).getValue() || "").toString();
  if (b1 !== TOTAL_HEADER) {
    sheet.insertColumnBefore(2);
    sheet.getRange(1, 2).setValue(TOTAL_HEADER)
      .setFontWeight("bold").setBackground("#4f46e5").setFontColor("white")
      .setHorizontalAlignment("center");
    sheet.setColumnWidth(2, 80);
  }

  // Me aseguro de que TODOS los productos de PRODUCTOS tengan su fila (las
  // filas se crean lazy al primer "pedir"; los productos nuevos que nadie
  // pidió todavía no tienen fila y por lo tanto no reciben fórmula de Total).
  PRODUCTOS.forEach(p => getProductoRow(sheet, p));

  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();

  // Migración: pedidos/comprados viejos sin cantidad -> les pongo cantidad 1.
  if (lastRow >= 2 && lastCol >= 3) {
    const rango  = sheet.getRange(2, 3, lastRow - 1, lastCol - 2); // grilla de servicios
    const vals   = rango.getValues();
    let cambio   = false;
    for (let i = 0; i < vals.length; i++) {
      for (let j = 0; j < vals[i].length; j++) {
        const t = (vals[i][j] || "").toString();
        const m = t.match(/^(PEDIDO|COMPRADO)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/);
        if (m) { vals[i][j] = m[1] + " 1 " + m[2]; cambio = true; }
      }
    }
    if (cambio) { rango.setNumberFormat("@"); rango.setValues(vals); }
  }

  // (Re)escribo la fórmula de la col B por cada fila de producto: suma las
  // unidades de las celdas "PEDIDO n ..." / "COMPRADO n ..." de la col C en
  // adelante. REGEXEXTRACT saca el número que va entre espacios (la cantidad);
  // la fecha no matchea porque no tiene espacio después. No incluye B, así
  // que no hay referencia circular.
  if (lastRow >= 2) {
    const formulas = [];
    for (let r = 2; r <= lastRow; r++) {
      formulas.push(['=SUM(ARRAYFORMULA(IFERROR(REGEXEXTRACT(C' + r + ':AZ' + r + '&""," (\\d+) ")+0,0)))']);
    }
    sheet.getRange(2, 2, lastRow - 1, 1).setFormulas(formulas);
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
}

// ---- "Historial Pedidos": log de cada pedido y cada recepción ----
function getHistorialPedidosSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName("Historial Pedidos");
  if (!sheet) {
    sheet = ss.insertSheet("Historial Pedidos");
    const headerRange = sheet.getRange(1, 1, 1, HIST_PEDIDOS_HEADERS.length);
    sheet.appendRow(HIST_PEDIDOS_HEADERS);
    headerRange.setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(4, 150);
    sheet.setColumnWidth(5, 260);
  } else if ((sheet.getRange(1, 7).getValue() || "").toString() !== "Cantidad") {
    // La hoja ya existía sin la columna "Cantidad": la agrego una sola vez.
    sheet.getRange(1, 7).setValue("Cantidad")
      .setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
  }
  return sheet;
}

function logPedido(empleado, servicio, producto, accion, cantidad) {
  const sheet = getHistorialPedidosSheet();
  const tz    = Session.getScriptTimeZone();
  const now   = new Date();
  const lastRow = sheet.getLastRow() + 1;
  sheet.getRange(lastRow, 1).setNumberFormat("@").setValue(Utilities.formatDate(now, tz, "dd/MM/yyyy"));
  sheet.getRange(lastRow, 2).setNumberFormat("@").setValue(Utilities.formatDate(now, tz, "HH:mm:ss"));
  sheet.getRange(lastRow, 3).setValue(empleado);
  sheet.getRange(lastRow, 4).setValue(servicio);
  sheet.getRange(lastRow, 5).setValue(producto);
  sheet.getRange(lastRow, 6).setValue(accion);
  sheet.getRange(lastRow, 7).setNumberFormat("@").setValue(cantidad != null ? String(cantidad) : "");
}

// Parsea el texto de una celda de la grilla de materiales.
// Formatos: "" (disponible) · "PEDIDO <cant> <fecha>" · "COMPRADO <cant> <fecha>".
// Tolera el formato viejo sin cantidad ("PEDIDO <fecha>") -> cantidad 1.
function parseEstadoCelda(texto) {
  texto = (texto || "").toString().trim();
  if (texto === "") return { estado: "disponible", cantidad: "", fecha: "" };
  let m = texto.match(/^(PEDIDO|COMPRADO)\s+(\d+)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/);
  if (m) {
    return { estado: m[1] === "PEDIDO" ? "pedido" : "comprado", cantidad: m[2], fecha: m[3] };
  }
  m = texto.match(/^(PEDIDO|COMPRADO)\s+(\d{1,2}\/\d{1,2}\/\d{4})$/); // formato viejo sin cantidad
  if (m) {
    return { estado: m[1] === "PEDIDO" ? "pedido" : "comprado", cantidad: "1", fecha: m[2] };
  }
  // Cualquier otra cosa que empiece con PEDIDO/COMPRADO: tratar como activo.
  if (texto.indexOf("PEDIDO") === 0)   return { estado: "pedido",   cantidad: "1", fecha: "" };
  if (texto.indexOf("COMPRADO") === 0) return { estado: "comprado", cantidad: "1", fecha: "" };
  return { estado: "disponible", cantidad: "", fecha: "" };
}

// Normaliza la cantidad recibida del cliente a un entero 1..99.
function normalizarCantidad(raw) {
  let n = parseInt(raw, 10);
  if (isNaN(n) || n < 1) n = 1;
  if (n > 99) n = 99;
  return n;
}

// ============================================================
// HORARIOS (validación server-side de fichadas)
// ============================================================
// ⚠️ DUPLICADO A PROPÓSITO: el frontend tiene los horarios en `SERVICIOS`
// (index.html) para mostrar y calcular tardanza. Acá va la copia
// AUTORITATIVA que valida server-side que la fichada caiga en un día y
// horario que le corresponden (no burlable desde el cliente). Si cambiás un
// horario, actualizá LOS DOS lugares. Formato: HORARIOS[empleado][servicio] =
// { diaSemana: ["HH:MM inicio", "HH:MM fin"] }, con día 0=Dom … 6=Sáb.
// Servicios sin entrada acá (ej. "Horas Extras") = libres, se fichan cuando sea.
const HORARIOS = {
  "Maria Decimas": {
    "Azopardo":   { 2: ["08:00", "10:00"], 5: ["08:00", "10:00"] },
    "Bayardi":    { 1: ["08:00", "11:00"], 3: ["08:00", "11:00"], 5: ["10:00", "13:00"] },
    "Elflein":    { 2: ["10:30", "13:30"], 4: ["10:30", "13:30"] },
    "Drago":      { 1: ["11:00", "14:00"], 3: ["11:00", "14:00"], 5: ["13:00", "16:00"] },
    "Monteverde": { 2: ["13:40", "16:40"], 4: ["13:40", "16:40"] }
  },
  "Celeste Freire": {
    "Acorus": { 1: ["08:00", "16:00"], 2: ["08:00", "16:00"], 3: ["08:00", "16:00"],
                4: ["08:00", "16:00"], 5: ["08:00", "16:00"], 6: ["08:00", "12:00"] }
  },
  "Rocio Medina": {
    "Acorus": { 1: ["08:00", "16:00"], 2: ["08:00", "16:00"], 3: ["08:00", "16:00"],
                4: ["08:00", "16:00"], 5: ["08:00", "16:00"], 6: ["08:00", "12:00"] }
  },
  "Brisa Medina": {
    "Consultorios Médicos": { 1: ["07:00", "14:30"], 2: ["07:00", "14:30"], 3: ["07:00", "14:30"],
                              4: ["07:00", "14:30"], 5: ["07:00", "14:30"], 6: ["07:00", "11:30"] }
  },
  "Sabrina Scarampo": {
    "Consultorios Médicos": { 1: ["13:30", "21:00"], 2: ["13:30", "21:00"], 3: ["13:30", "21:00"],
                              4: ["13:30", "21:00"], 5: ["13:30", "21:00"], 6: ["10:30", "15:00"] }
  },
  "Rebeca Ayala": {
    "Mitre":      { 2: ["08:00", "12:00"], 4: ["08:00", "12:00"], 6: ["08:00", "12:00"] },
    "Santa Rosa": { 1: ["08:00", "12:00"], 3: ["08:00", "12:00"], 5: ["08:00", "12:00"] },
    "Mercedes":   { 1: ["12:30", "14:30"], 3: ["12:30", "14:30"], 5: ["12:30", "14:30"] }
  },
  "Alejandro Jelvez": {
    "Rivadavia":    { 1: ["09:00", "12:00"], 4: ["09:00", "12:00"] },
    "Suipacha":     { 2: ["12:30", "15:30"], 5: ["12:30", "15:30"] },
    "Del Himno":    { 2: ["09:00", "12:00"], 5: ["09:00", "12:00"] },
    "Garcia Silva": { 1: ["12:30", "15:30"], 4: ["12:30", "15:30"] },
    "San Martín":   { 1: ["16:00", "18:00"], 3: ["16:00", "18:00"], 5: ["16:00", "18:00"] }
  },
  "Milagros Acuña": {
    "Jonte": { 2: ["08:00", "12:00"], 4: ["08:00", "12:00"], 6: ["08:00", "12:00"] }
  }
};

// Margen para fichar la SALIDA después del fin de la ventana del turno.
// (La ENTRADA ya no tiene límite de horario: se puede fichar tarde sin tope,
// con motivo obligatorio.)
const TOLERANCIA_DESPUES_MIN = 60;
const DIAS_NOMBRE = ["domingos", "lunes", "martes", "miércoles", "jueves", "viernes", "sábados"];

// Hora -> minutos desde la medianoche. Soporta 24h ("13:30:00") y 12h con
// "a. m."/"p. m." (así la manda es-AR toLocaleTimeString en muchos equipos:
// "01:30:00 p. m." = 13:30). Mismo criterio que horaKey() en el frontend.
function horaAMin(hora) {
  hora = (hora || "").toString().toLowerCase();
  const m = /(\d{1,2}):(\d{2})/.exec(hora);
  if (!m) return NaN;
  let hh = Number(m[1]);
  if (/p\.?\s*m/.test(hora) && hh < 12)  hh += 12;
  if (/a\.?\s*m/.test(hora) && hh === 12) hh = 0;
  return hh * 60 + Number(m[2]);
}

// Día de la semana (0=Dom … 6=Sáb) a partir de "d/M/yyyy" (formato es-AR).
function diaDeSemana(fecha) {
  const m = (fecha || "").toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return NaN;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1])).getDay();
}

// Valida que la fichada caiga en un día/horario que le corresponde al empleado
// para ese servicio. Usa fecha/hora reportadas por el cliente (consistente con
// el cálculo de tardanza, que también es client-side).
// Para la SALIDA, el límite superior se calcula desde la ENTRADA real
// (`entradaMin`, minutos desde medianoche): si el empleado entró tarde, tiene
// derecho a cumplir el tiempo de permanencia del servicio y marcar la salida
// más tarde (entrada + duración + tolerancia), sin quedar trabado. No hay
// límite inferior para la salida: siempre se puede cerrar una entrada abierta.
// Devuelve { ok, message }.
function validarHorarioFichada(empleado, servicio, fecha, hora, tipo, entradaMin) {
  const servHor = (HORARIOS[empleado] || {})[servicio];
  if (!servHor) return { ok: true }; // sin horario definido (ej. Horas Extras) = libre
  const dow = diaDeSemana(fecha);
  const rango = servHor[dow];
  if (!rango) {
    return { ok: false, message: `No tenés turno en "${servicio}" los ${DIAS_NOMBRE[dow] || "ese día"}.` };
  }

  // ENTRADA: sin límite de horario. Se puede fichar entrada a cualquier hora
  // del día que le corresponde al servicio (si llegó tarde, el cliente le pide
  // el motivo obligatorio y la fichada queda marcada "Tarde"). Solo se valida
  // que el servicio funcione ese día.
  if (tipo !== "Salida") return { ok: true };

  // SALIDA: la ventana contempla la duración del servicio. Se calcula desde la
  // ENTRADA real: puede salir hasta (entrada + duración del servicio) o el fin
  // programado, lo que sea más tarde, con tolerancia. Sin límite inferior:
  // siempre se puede cerrar una entrada abierta.
  const min = horaAMin(hora);
  if (isNaN(min)) return { ok: true }; // sin hora válida: no bloqueo por horario
  const ini = horaAMin(rango[0]);
  const fin = horaAMin(rango[1]);
  const duracion = fin - ini;
  let limite = fin;
  if (entradaMin != null && !isNaN(entradaMin)) {
    limite = Math.max(fin, entradaMin + duracion);
  }
  if (min > limite + TOLERANCIA_DESPUES_MIN) {
    return { ok: false, message: `Fuera del horario de salida de "${servicio}".` };
  }
  return { ok: true };
}

// Última fichada de un servicio en la hoja del empleado: { fecha, tipo, hora }
// o null. Sirve para la secuencia entrada/salida y para calcular la ventana de
// salida en base a la hora de entrada real.
function ultimaFichadaServicio(sheet, servicio) {
  const last = sheet.getLastRow();
  if (last <= 1) return null;
  const vals = sheet.getRange(2, 1, last - 1, 5).getValues(); // Fecha,Servicio,Dir,Tipo,Hora
  for (let i = vals.length - 1; i >= 0; i--) {
    if ((vals[i][1] || "").toString() === servicio) {
      return { fecha: vals[i][0], tipo: (vals[i][3] || "").toString(), hora: (vals[i][4] || "").toString() };
    }
  }
  return null;
}

// ¿Ya hay una "Entrada" de ese servicio en esa fecha? Se usa para permitir una
// sola fichada por servicio por día (si el admin anula la entrada, la fila
// desaparece y se puede volver a fichar).
function yaHayEntradaHoy(sheet, servicio, fecha) {
  const last = sheet.getLastRow();
  if (last <= 1) return false;
  const vals = sheet.getRange(2, 1, last - 1, 4).getValues(); // Fecha,Servicio,Dir,Tipo
  for (let i = 0; i < vals.length; i++) {
    if ((vals[i][1] || "").toString() === servicio &&
        (vals[i][3] || "").toString() === "Entrada" &&
        fmtCell(vals[i][0]) === fecha) {
      return true;
    }
  }
  return false;
}

// ---- Helpers de fechas para vacaciones/coberturas (formato dd/MM/yyyy) ----
// yyyymmdd como entero comparable (o NaN). Sirve para "¿hoy está en el rango?".
function fechaAInt(fechaStr) {
  const m = (fechaStr || "").toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return NaN;
  return Number(m[3]) * 10000 + Number(m[2]) * 100 + Number(m[1]);
}
function fechaADate(fechaStr) {
  const m = (fechaStr || "").toString().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}
// Cantidad de días entre dos fechas, inclusive (desde y hasta cuentan).
function diasEntre(desde, hasta) {
  const a = fechaADate(desde), b = fechaADate(hasta);
  if (!a || !b) return "";
  return Math.round((b - a) / 86400000) + 1;
}

function getVacacionesSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(VACAS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(VACAS_SHEET);
    sheet.appendRow(VACAS_HEADERS);
    sheet.getRange(1, 1, 1, VACAS_HEADERS.length)
      .setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}
function getCoberturasSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(COBERTURAS_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(COBERTURAS_SHEET);
    sheet.appendRow(COBERTURAS_HEADERS);
    sheet.getRange(1, 1, 1, COBERTURAS_HEADERS.length)
      .setBackground("#4f46e5").setFontColor("white").setFontWeight("bold");
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// ¿El empleado tiene una cobertura ACTIVA (hoy en el rango) para ese servicio?
// Devuelve el registro de cobertura o null. Sirve para habilitar la fichada de
// un suplente y para validar el horario contra el titular.
function coberturaActiva(suplente, servicio, fecha) {
  const sheet = getCoberturasSheet();
  if (sheet.getLastRow() <= 1) return null;
  const hoy = fechaAInt(fecha);
  if (isNaN(hoy)) return null;
  const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, COBERTURAS_HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    const r = data[i];
    if ((r[4] || "").toString() === suplente && (r[2] || "").toString() === servicio) {
      const d = fechaAInt(r[5]), h = fechaAInt(r[6]);
      if (!isNaN(d) && !isNaN(h) && hoy >= d && hoy <= h) {
        return { id: r[0], vacacionId: r[1], servicio: r[2], titular: r[3], suplente: r[4], desde: r[5], hasta: r[6] };
      }
    }
  }
  return null;
}

// Empleado cuyo HORARIO usar para validar la fichada: el propio si el servicio
// es suyo; si lo está cubriendo (vacaciones de otro), el del titular.
function empleadoHorarioEfectivo(empleado, servicio, fecha) {
  if ((HORARIOS[empleado] || {})[servicio]) return empleado;
  const cob = coberturaActiva(empleado, servicio, fecha);
  return cob ? cob.titular : empleado;
}

// Conjunto de nombres de servicio válidos: los reales (todos figuran en
// HORARIOS) + los libres (Horas Extras / Suplencias). Sirve para validar el
// parámetro `servicio` de adminServicioGlobal contra una lista conocida.
function serviciosConocidos() {
  const set = {};
  Object.keys(HORARIOS).forEach(emp =>
    Object.keys(HORARIOS[emp]).forEach(s => { set[s] = true; }));
  SERVICIOS_LIBRES.forEach(s => { set[s] = true; });
  return set;
}

function doGet(e) {
  const p = e.parameter || {};

  // ---- LOGIN: solo valida credenciales, no escribe nada ----
  // Devuelve el rol para que el cliente sepa qué pantalla mostrar.
  if (p.action === "login") {
    const usuario = p.empleado;
    const role = esAdminNombre(usuario) ? "admin" : (esEmpleado(usuario) ? "empleado" : null);
    if (role) {
      const res = verificarUsuario(usuario, p.hash);
      if (res.ok) {
        return jsonOut({ status: "ok", role, mustChangePassword: !!res.mustChange });
      }
    }
    return jsonOut({ status: "error", message: "Usuario o contraseña incorrectos" });
  }

  // ---- CAMBIAR CONTRASEÑA (self-service) ----
  // El usuario manda su hash actual y el nuevo (SHA-256 hex). Se verifica el
  // actual, se guarda el nuevo (HMAC) y se resetea la fecha de caducidad.
  if (p.action === "cambiarPassword" && p.empleado && p.hash && p.nuevoHash) {
    const usuario = p.empleado;
    if (!esEmpleado(usuario) && !esAdminNombre(usuario)) {
      return jsonOut({ status: "error", message: "Usuario inválido" });
    }
    if (!verificarUsuario(usuario, p.hash).ok) {
      return jsonOut({ status: "error", message: "Contraseña actual incorrecta" });
    }
    if (!/^[0-9a-f]{64}$/.test(p.nuevoHash)) {
      return jsonOut({ status: "error", message: "Contraseña nueva inválida" });
    }
    if (tiempoConstanteIgual(p.nuevoHash, p.hash)) {
      return jsonOut({ status: "error", message: "La nueva contraseña no puede ser igual a la actual" });
    }
    const nuevaCred = credencial(p.nuevoHash);
    if (!nuevaCred) {
      return jsonOut({ status: "error", message: "Falta inicializar la auth (correr setupAuth)" });
    }
    try {
      guardarCredencial(usuario, nuevaCred);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ADMIN: historial de fichadas de cualquier empleado (solo dueños) ----
  if (p.action === "adminHistorial" && p.empleado) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(p.empleado);
      if (!sheet || sheet.getLastRow() <= 1) {
        return jsonOut({ status: "ok", records: [] });
      }
      const data = sheet.getDataRange().getValues();
      // `fila` = nº de fila real en la hoja (para poder anular). El elemento i
      // de data.slice(1) es la fila i+2. Se mapea antes de invertir el orden.
      const records = data.slice(1).map((row, i) => {
        const lat = row[5], lon = row[6];
        const tieneGPS = lat && lon && lat !== "No disponible" && lon !== "No disponible";
        return {
          fila:      i + 2,
          fecha:     fmtCell(row[0]),
          servicio:  row[1],
          direccion: row[2],
          tipo:      row[3],
          hora:      fmtCell(row[4]),
          lat:       lat,
          lon:       lon,
          linkGPS:   tieneGPS ? `https://www.google.com/maps?q=${lat},${lon}` : "No disponible",
          estado:    row[9] || "",
          motivo:    (row[10] || "").toString()
        };
      }).reverse();
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- SERVICIO GLOBAL: todas las fichadas de un servicio "libre" (Horas
  // Extras / Suplencias) juntas, de TODOS los empleados, con dirección y
  // empleado. A diferencia de adminHistorial (una hoja), recorre todas las
  // hojas de empleados y filtra por servicio. Solo admins.
  if (p.action === "adminServicioGlobal" && p.servicio) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (!serviciosConocidos()[p.servicio]) {
      return jsonOut({ status: "error", message: "Servicio inválido" });
    }
    try {
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const records = [];
      ss.getSheets().forEach(sheet => {
        const empleado = sheet.getName();
        if (HOJAS_NO_EMPLEADO.indexOf(empleado) !== -1) return;
        const lastRow = sheet.getLastRow();
        if (lastRow <= 1) return;
        const data = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
        data.forEach((row, i) => {
          if ((row[1] || "").toString() !== p.servicio) return;
          const lat = row[5], lon = row[6];
          const tieneGPS = lat && lon && lat !== "No disponible" && lon !== "No disponible";
          records.push({
            fila:      i + 2,
            empleado:  empleado,
            fecha:     fmtCell(row[0]),
            direccion: row[2],
            tipo:      row[3],
            hora:      fmtCell(row[4]),
            linkGPS:   tieneGPS ? `https://www.google.com/maps?q=${lat},${lon}` : "No disponible",
            estado:    row[9] || "",
            motivo:    (row[10] || "").toString()
          });
        });
      });
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ANULAR una fichada: el admin borra una entrada/salida de un empleado.
  // Verifica fecha/hora/tipo de la fila antes de borrar, para no eliminar otra
  // si la vista del admin quedó desactualizada. Solo admins.
  if (p.action === "anularFichada" && p.empleado && p.fila) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (HOJAS_NO_EMPLEADO.indexOf(p.empleado) !== -1) {
      return jsonOut({ status: "error", message: "Hoja inválida" });
    }
    try {
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(p.empleado);
      if (!sheet) {
        return jsonOut({ status: "error", message: "El empleado no tiene registros" });
      }
      const fila = parseInt(p.fila, 10);
      if (isNaN(fila) || fila < 2 || fila > sheet.getLastRow()) {
        return jsonOut({ status: "error", message: "Fila inválida. Recargá y probá de nuevo." });
      }
      const row = sheet.getRange(fila, 1, 1, HEADERS.length).getValues()[0];
      if (fmtCell(row[0]) !== (p.fecha || "") ||
          fmtCell(row[4]) !== (p.hora  || "") ||
          (row[3] || "").toString() !== (p.tipo || "")) {
        return jsonOut({ status: "error", message: "La fichada cambió. Recargá y probá de nuevo." });
      }
      sheet.deleteRow(fila);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- RESUMEN: fichadas RECIENTES de TODOS los empleados juntas ----
  // Para que el admin vea de un vistazo (agrupado por día del lado del
  // cliente) los ingresos recientes sin entrar empleado por empleado.
  // Recorre todas las hojas del Sheet salvo las que no son de empleados,
  // así también aparece el historial de empleados ya dados de baja.
  // Solo lee la COLA (últimas RESUMEN_TAIL filas) de cada hoja: el costo no
  // crece con el histórico acumulado. El historial completo por empleado
  // sigue disponible en el flujo "adminHistorial".
  if (p.action === "adminResumen") {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const RESUMEN_TAIL = 120;
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const records = [];
      ss.getSheets().forEach(sheet => {
        const empleado = sheet.getName();
        if (HOJAS_NO_EMPLEADO.indexOf(empleado) !== -1) return;
        const lastRow = sheet.getLastRow();
        if (lastRow <= 1) return;
        const numRows  = Math.min(lastRow - 1, RESUMEN_TAIL);
        const startRow = lastRow - numRows + 1;
        const data = sheet.getRange(startRow, 1, numRows, HEADERS.length).getValues();
        data.forEach((row, i) => {
          const lat = row[5], lon = row[6];
          const tieneGPS = lat && lon && lat !== "No disponible" && lon !== "No disponible";
          records.push({
            fila:      startRow + i,   // nº de fila real en la hoja (para anular)
            empleado:  empleado,
            fecha:     fmtCell(row[0]),
            servicio:  row[1],
            direccion: row[2],
            tipo:      row[3],
            hora:      fmtCell(row[4]),
            linkGPS:   tieneGPS ? `https://www.google.com/maps?q=${lat},${lon}` : "No disponible",
            estado:    row[9] || "",
            motivo:    (row[10] || "").toString()
          });
        });
      });
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- TARDANZAS: todas las llegadas tarde de todos los empleados ----
  // Recorre las hojas de empleados (cola de TARDANZAS_TAIL filas) y junta las
  // Entradas marcadas "Tarde N min". El cliente agrupa por día y arma el
  // resumen mensual. Solo admins.
  if (p.action === "adminTardanzas") {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const TARDANZAS_TAIL = 500;
      const ss = SpreadsheetApp.getActiveSpreadsheet();
      const records = [];
      ss.getSheets().forEach(sheet => {
        const empleado = sheet.getName();
        if (HOJAS_NO_EMPLEADO.indexOf(empleado) !== -1) return;
        const lastRow = sheet.getLastRow();
        if (lastRow <= 1) return;
        const numRows  = Math.min(lastRow - 1, TARDANZAS_TAIL);
        const startRow = lastRow - numRows + 1;
        const data = sheet.getRange(startRow, 1, numRows, HEADERS.length).getValues();
        data.forEach((row, i) => {
          const estado = (row[9] || "").toString();
          const m = estado.match(/Tarde\s+(\d+)/);
          if (!m) return;
          records.push({
            fila:     startRow + i,    // nº de fila real en la hoja (para anular)
            empleado: empleado,
            servicio: row[1],
            tipo:     row[3],
            fecha:    fmtCell(row[0]),
            hora:     fmtCell(row[4]),
            minutos:  Number(m[1]),
            motivo:   (row[10] || "").toString()
          });
        });
      });
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- HISTORIAL ----
  if (p.action === "historial" && p.empleado) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const empleado = p.empleado;
      const ss    = SpreadsheetApp.getActiveSpreadsheet();
      const sheet = ss.getSheetByName(empleado);

      if (!sheet || sheet.getLastRow() <= 1) {
        return jsonOut({ status: "ok", records: [] });
      }

      const data = sheet.getDataRange().getValues();
      const records = data.slice(1).reverse().map(row => ({
        fecha:    fmtCell(row[0]),
        servicio: row[1],
        tipo:     row[3],
        hora:     fmtCell(row[4]),
        lat:      row[5],
        lon:      row[6],
        linkGPS:  typeof row[7] === "string" ? row[7] : (row[5] && row[6] ? `https://www.google.com/maps?q=${row[5]},${row[6]}` : "No disponible"),
        estado:   row[9] || "",
        motivo:   (row[10] || "").toString()
      }));

      return jsonOut({ status: "ok", records });

    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- MATERIALES: lista de productos con su estado para un servicio ----
  // Acepta auth de empleado (el que pide) o de admin (dueño que consulta).
  if (p.action === "materiales" && p.servicio) {
    if (!checkAuth(p.empleado, p.hash) && !checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet = getMaterialesSheet();
      const col   = getServicioCol(sheet, p.servicio); // 1-based; crea la columna si falta
      // Una sola lectura de toda la grilla (antes: 16 lecturas de la col A,
      // una por producto). Mapeo producto -> fila en memoria. Los productos
      // que todavía no tienen fila se reportan como disponibles (la fila se
      // crea recién al "pedir").
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const grid = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, lastCol).getValues() : [];
      const filaPorProducto = {};
      grid.forEach(r => { filaPorProducto[r[0]] = r; });
      const productos = PRODUCTOS.map(nombre => {
        const r     = filaPorProducto[nombre];
        const texto = (r ? (r[col - 1] || "") : "").toString();
        const est   = parseEstadoCelda(texto);
        return { nombre, estado: est.estado, cantidad: est.cantidad, fecha: est.fecha };
      });
      return jsonOut({ status: "ok", productos });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- PEDIR un producto para un servicio (bloquea hasta que se reciba) ----
  if (p.action === "pedir" && p.servicio && p.producto) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (PRODUCTOS.indexOf(p.producto) === -1) {
      return jsonOut({ status: "error", message: "Producto inválido" });
    }
    try {
      const sheet = getMaterialesSheet();
      const row   = getProductoRow(sheet, p.producto);
      const col   = getServicioCol(sheet, p.servicio);
      const cell  = sheet.getRange(row, col);
      const est   = parseEstadoCelda(cell.getValue());

      if (est.estado !== "disponible") {
        return jsonOut({ status: "error", message: "Ese producto ya está pedido para este servicio" });
      }

      const cantidad = normalizarCantidad(p.cantidad);
      const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
      cell.setNumberFormat("@").setValue("PEDIDO " + cantidad + " " + fecha);
      logPedido(p.empleado, p.servicio, p.producto, "Pedido", cantidad);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- COMPRAR: el admin pasa un pedido de PEDIDO a COMPRADO ----
  if (p.action === "comprar" && p.servicio && p.producto) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (PRODUCTOS.indexOf(p.producto) === -1) {
      return jsonOut({ status: "error", message: "Producto inválido" });
    }
    try {
      const sheet = getMaterialesSheet();
      const row   = getProductoRow(sheet, p.producto);
      const col   = getServicioCol(sheet, p.servicio);
      const cell  = sheet.getRange(row, col);
      const est   = parseEstadoCelda(cell.getValue());

      if (est.estado !== "pedido") {
        return jsonOut({ status: "error", message: "Ese producto no está pendiente de compra" });
      }

      // Mantiene la cantidad y la fecha original del pedido; solo cambia el estado.
      cell.setNumberFormat("@").setValue("COMPRADO " + est.cantidad + " " + est.fecha);
      logPedido(p.admin, p.servicio, p.producto, "Comprado", est.cantidad);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- RECIBIDO: el empleado confirma la recepción y libera el producto ----
  // Sale desde PEDIDO o COMPRADO (por si el admin no llegó a marcar comprado).
  if (p.action === "recibido" && p.servicio && p.producto) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (PRODUCTOS.indexOf(p.producto) === -1) {
      return jsonOut({ status: "error", message: "Producto inválido" });
    }
    try {
      const sheet = getMaterialesSheet();
      const row   = getProductoRow(sheet, p.producto);
      const col   = getServicioCol(sheet, p.servicio);
      const cell  = sheet.getRange(row, col);
      const est   = parseEstadoCelda(cell.getValue());

      if (est.estado === "disponible") {
        return jsonOut({ status: "error", message: "No hay un pedido pendiente para este producto" });
      }

      cell.setValue("");
      logPedido(p.empleado, p.servicio, p.producto, "Recibido", est.cantidad);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- PEDIDOS ACTIVOS: los que están en PEDIDO o COMPRADO ahora mismo ----
  // Lee la grilla (estado actual, no el log) y devuelve cada celda activa
  // con su servicio, producto, cantidad, fecha y estado. El admin arma la
  // lista "para comprar" y marca cada uno como comprado. Solo admins.
  if (p.action === "adminPedidosActivos") {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet   = getMaterialesSheet();
      const lastRow = sheet.getLastRow();
      const lastCol = sheet.getLastColumn();
      const records = [];
      if (lastRow > 1 && lastCol > 1) {
        const grid       = sheet.getRange(1, 1, lastRow, lastCol).getValues();
        const encabezado = grid[0]; // fila 1: [Producto, Total, servicio1, servicio2, ...]
        // Las columnas de servicio son todas menos "Producto" (A) y "Total" (B).
        for (let c = 1; c < lastCol; c++) {
          const servicio = (encabezado[c] || "").toString();
          if (servicio === "" || servicio === "Total" || servicio === "Producto") continue;
          for (let r = 1; r < lastRow; r++) {
            const producto = (grid[r][0] || "").toString();
            if (producto === "") continue;
            const est = parseEstadoCelda(grid[r][c]);
            if (est.estado === "pedido" || est.estado === "comprado") {
              records.push({
                servicio, producto,
                estado:   est.estado,
                cantidad: est.cantidad,
                fecha:    est.fecha
              });
            }
          }
        }
      }
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- RESUMEN: TODOS los pedidos de materiales de TODOS los servicios ----
  // Para que el admin vea todo el log junto (agrupado por día del lado del
  // cliente) sin entrar servicio por servicio. Solo admins.
  if (p.action === "adminResumenPedidos") {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet = getHistorialPedidosSheet();
      if (sheet.getLastRow() <= 1) {
        return jsonOut({ status: "ok", records: [] });
      }
      const data = sheet.getDataRange().getValues();
      const records = data.slice(1).map(row => ({
        fecha:    fmtCell(row[0]),
        hora:     fmtCell(row[1]),
        empleado: row[2],
        servicio: row[3],
        producto: row[4],
        accion:   row[5],
        cantidad: row[6] != null ? row[6].toString() : ""
      }));
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- HISTORIAL DE PEDIDOS de un servicio ----
  // Acepta auth de empleado o de admin (dueño que consulta).
  if (p.action === "historialPedidos" && p.servicio) {
    if (!checkAuth(p.empleado, p.hash) && !checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet = getHistorialPedidosSheet();
      if (sheet.getLastRow() <= 1) {
        return jsonOut({ status: "ok", records: [] });
      }
      const data = sheet.getDataRange().getValues();
      const records = data.slice(1)
        .filter(row => row[3] === p.servicio)
        .reverse()
        .map(row => ({
          fecha:    fmtCell(row[0]),
          hora:     fmtCell(row[1]),
          empleado: row[2],
          producto: row[4],
          accion:   row[5],
          cantidad: row[6] != null ? row[6].toString() : ""
        }));
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ==========================================================
  // VACACIONES / COBERTURAS
  // ==========================================================

  // ---- El empleado solicita vacaciones (queda Pendiente) ----
  if (p.action === "solicitarVacaciones" && p.empleado) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    const desde = (p.desde || "").toString(), hasta = (p.hasta || "").toString();
    const di = fechaAInt(desde), hi = fechaAInt(hasta);
    if (isNaN(di) || isNaN(hi)) return jsonOut({ status: "error", message: "Fechas inválidas" });
    if (hi < di) return jsonOut({ status: "error", message: "La fecha 'hasta' es anterior a 'desde'" });
    try {
      const sheet = getVacacionesSheet();
      const dias  = diasEntre(desde, hasta);
      const id    = Utilities.getUuid().slice(0, 8);
      const now   = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
      const row   = sheet.getLastRow() + 1;
      sheet.getRange(row, 1, 1, VACAS_HEADERS.length).setNumberFormat("@")
        .setValues([[id, p.empleado, desde, hasta, String(dias), "Pendiente", now, ""]]);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- El empleado ve sus propias solicitudes y su estado ----
  if (p.action === "misVacaciones" && p.empleado) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet = getVacacionesSheet();
      if (sheet.getLastRow() <= 1) return jsonOut({ status: "ok", records: [] });
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, VACAS_HEADERS.length).getValues();
      const records = data
        .filter(r => (r[1] || "").toString() === p.empleado)
        .map(r => ({ id: r[0], desde: r[2], hasta: r[3], dias: r[4], estado: r[5], solicitado: r[6] }))
        .reverse();
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ADMIN: ver todas las solicitudes de vacaciones ----
  if (p.action === "adminVacaciones") {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet = getVacacionesSheet();
      if (sheet.getLastRow() <= 1) return jsonOut({ status: "ok", records: [] });
      const data = sheet.getRange(2, 1, sheet.getLastRow() - 1, VACAS_HEADERS.length).getValues();
      const records = data.map(r => ({
        id: r[0], empleado: r[1], desde: r[2], hasta: r[3], dias: r[4], estado: r[5], solicitado: r[6]
      })).reverse();
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ADMIN: aceptar o rechazar una solicitud ----
  if (p.action === "resolverVacaciones" && p.id && p.estado) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (["Aceptada", "Rechazada", "Pendiente"].indexOf(p.estado) === -1) {
      return jsonOut({ status: "error", message: "Estado inválido" });
    }
    try {
      const sheet = getVacacionesSheet();
      const last  = sheet.getLastRow();
      if (last <= 1) return jsonOut({ status: "error", message: "No hay solicitudes" });
      const ids = sheet.getRange(2, 1, last - 1, 1).getValues().flat();
      const idx = ids.findIndex(v => (v || "").toString() === p.id);
      if (idx === -1) return jsonOut({ status: "error", message: "Solicitud no encontrada" });
      const row = idx + 2;
      sheet.getRange(row, 6).setValue(p.estado);
      sheet.getRange(row, 8).setNumberFormat("@")
        .setValue(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm"));
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ADMIN: asignar un suplente a un servicio de una licencia aceptada ----
  if (p.action === "asignarCobertura" && p.vacacionId && p.servicio && p.suplente) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (!esEmpleado(p.suplente)) return jsonOut({ status: "error", message: "Suplente inválido" });
    if (!serviciosConocidos()[p.servicio]) return jsonOut({ status: "error", message: "Servicio inválido" });
    try {
      const vs = getVacacionesSheet();
      if (vs.getLastRow() <= 1) return jsonOut({ status: "error", message: "Vacación no encontrada" });
      const vdata = vs.getRange(2, 1, vs.getLastRow() - 1, VACAS_HEADERS.length).getValues();
      const v = vdata.find(r => (r[0] || "").toString() === p.vacacionId);
      if (!v) return jsonOut({ status: "error", message: "Vacación no encontrada" });
      if ((v[5] || "").toString() !== "Aceptada") {
        return jsonOut({ status: "error", message: "La vacación no está aceptada" });
      }
      const titular = v[1], desde = v[2], hasta = v[3];
      if (p.suplente === titular) {
        return jsonOut({ status: "error", message: "El suplente no puede ser el mismo empleado" });
      }
      const cs = getCoberturasSheet();
      if (cs.getLastRow() > 1) {
        const cdata = cs.getRange(2, 1, cs.getLastRow() - 1, COBERTURAS_HEADERS.length).getValues();
        if (cdata.some(r => (r[1] || "").toString() === p.vacacionId && (r[2] || "").toString() === p.servicio)) {
          return jsonOut({ status: "error", message: "Ese servicio ya tiene un suplente asignado" });
        }
      }
      const id  = Utilities.getUuid().slice(0, 8);
      const now = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy HH:mm");
      const row = cs.getLastRow() + 1;
      cs.getRange(row, 1, 1, COBERTURAS_HEADERS.length).setNumberFormat("@")
        .setValues([[id, p.vacacionId, p.servicio, titular, p.suplente, desde, hasta, now]]);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ADMIN: quitar una cobertura ----
  if (p.action === "quitarCobertura" && p.id) {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const cs = getCoberturasSheet();
      const last = cs.getLastRow();
      if (last <= 1) return jsonOut({ status: "error", message: "No hay coberturas" });
      const ids = cs.getRange(2, 1, last - 1, 1).getValues().flat();
      const idx = ids.findIndex(v => (v || "").toString() === p.id);
      if (idx === -1) return jsonOut({ status: "error", message: "Cobertura no encontrada" });
      cs.deleteRow(idx + 2);
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- ADMIN: ver todas las coberturas asignadas ----
  if (p.action === "adminCoberturas") {
    if (!checkAdmin(p.admin, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const cs = getCoberturasSheet();
      if (cs.getLastRow() <= 1) return jsonOut({ status: "ok", records: [] });
      const data = cs.getRange(2, 1, cs.getLastRow() - 1, COBERTURAS_HEADERS.length).getValues();
      const records = data.map(r => ({
        id: r[0], vacacionId: r[1], servicio: r[2], titular: r[3], suplente: r[4], desde: r[5], hasta: r[6]
      }));
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- El empleado ve las coberturas ACTIVAS que tiene que cubrir hoy ----
  // (para mostrar ese servicio en su lista de fichar solo durante el período).
  if (p.action === "misCoberturas" && p.empleado) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const cs = getCoberturasSheet();
      if (cs.getLastRow() <= 1) return jsonOut({ status: "ok", records: [] });
      const data = cs.getRange(2, 1, cs.getLastRow() - 1, COBERTURAS_HEADERS.length).getValues();
      const hoy = fechaAInt(p.fecha ||
        Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy"));
      const records = data.filter(r => {
        if ((r[4] || "").toString() !== p.empleado) return false;
        const d = fechaAInt(r[5]), h = fechaAInt(r[6]);
        return !isNaN(d) && !isNaN(h) && !isNaN(hoy) && hoy >= d && hoy <= h;
      }).map(r => ({ servicio: r[2], titular: r[3], desde: r[5], hasta: r[6] }));
      return jsonOut({ status: "ok", records });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- REGISTRAR ENTRADA/SALIDA ----
  if (p.empleado) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    if (p.tipo !== "Entrada" && p.tipo !== "Salida") {
      return jsonOut({ status: "error", message: "Tipo de registro inválido" });
    }

    try {
      const empleado  = p.empleado;
      const servicio  = p.servicio  || "";
      const direccion = p.direccion || "";
      const tipo      = p.tipo;
      const fecha     = p.fecha     || "";
      const hora      = p.hora      || "";
      const lat       = p.lat       || "";
      const lon       = p.lon       || "";
      const precision = p.precision || "";
      const estado    = p.estado    || "";
      const motivo    = p.motivo    || "";

      const linkGPS = (lat && lon)
        ? `https://www.google.com/maps?q=${lat},${lon}`
        : "No disponible";

      const ss = SpreadsheetApp.getActiveSpreadsheet();

      // El empleado ya está validado (checkAuth), así que la hoja solo se
      // crea para empleados reales (no se puede inyectar un nombre
      // arbitrario para generar hojas nuevas).
      let sheet = ss.getSheetByName(empleado);

      // ---- Validaciones de la fichada (antes de escribir nada) ----
      const ultima     = sheet ? ultimaFichadaServicio(sheet, servicio) : null;
      const ultimoTipo = ultima ? ultima.tipo : null;

      // Reglas A/B: no dos entradas seguidas ni una salida sin entrada previa.
      if (tipo === "Entrada" && ultimoTipo === "Entrada") {
        return jsonOut({ status: "error",
          message: `Ya marcaste una entrada en "${servicio}" sin salida. Marcá la salida primero.` });
      }
      if (tipo === "Salida" && ultimoTipo !== "Entrada") {
        return jsonOut({ status: "error",
          message: `No hay una entrada abierta en "${servicio}". Marcá la entrada primero.` });
      }

      // Regla D: una sola fichada (entrada) por servicio por día. Los servicios
      // "libres" ("Horas Extras" y "Suplencias") quedan EXENTOS: un empleado
      // puede fichar varios de esos el mismo día, cada uno con su entrada/salida.
      if (tipo === "Entrada" && SERVICIOS_LIBRES.indexOf(servicio) === -1 &&
          sheet && yaHayEntradaHoy(sheet, servicio, fecha)) {
        return jsonOut({ status: "error",
          message: `Ya fichaste "${servicio}" hoy. Solo se puede una vez por día.` });
      }

      // Regla C: día/horario. En la salida, la ventana se calcula desde la hora
      // de la entrada abierta (permite salir más tarde si entró tarde).
      const entradaMin = (tipo === "Salida" && ultima && ultima.tipo === "Entrada")
        ? horaAMin(ultima.hora) : null;
      // Si el empleado está cubriendo el servicio (vacaciones de otro), el
      // horario a validar es el del TITULAR de ese servicio, no el suyo.
      const empHor = empleadoHorarioEfectivo(empleado, servicio, fecha);
      const vHor = validarHorarioFichada(empHor, servicio, fecha, hora, tipo, entradaMin);
      if (!vHor.ok) {
        return jsonOut({ status: "error", message: vHor.message });
      }

      // Motivo de tardanza OBLIGATORIO: si la entrada quedó marcada "Tarde",
      // no se ficha sin explicar por qué (el cliente lo pide con un cartel;
      // acá se revalida por si el pedido no vino del front).
      if (tipo === "Entrada" && estado.indexOf("Tarde") === 0 && !motivo.trim()) {
        return jsonOut({ status: "error", message: "Falta el motivo de la llegada tarde." });
      }

      if (!sheet) {
        sheet = ss.insertSheet(empleado);
        const headerRange = sheet.getRange(1, 1, 1, HEADERS.length);
        sheet.appendRow(HEADERS);
        headerRange.setBackground("#4f46e5");
        headerRange.setFontColor("white");
        headerRange.setFontWeight("bold");
        headerRange.setFontSize(11);
        sheet.setFrozenRows(1);
        sheet.setColumnWidth(1, 100);
        sheet.setColumnWidth(2, 130);
        sheet.setColumnWidth(3, 260);
        sheet.setColumnWidth(4, 80);
        sheet.setColumnWidth(5, 100);
        sheet.setColumnWidth(8, 200);
        sheet.setColumnWidth(10, 120);
        sheet.setColumnWidth(11, 240);
      }

      const lastRow = sheet.getLastRow() + 1;
      // Formato de texto en fecha/hora para que Sheets no las autoconvierta
      // a su tipo Date interno (rompía la visualización del historial).
      sheet.getRange(lastRow, 1).setNumberFormat("@").setValue(fecha);
      sheet.getRange(lastRow, 2).setValue(servicio);
      sheet.getRange(lastRow, 3).setValue(direccion);
      sheet.getRange(lastRow, 4).setValue(tipo);
      sheet.getRange(lastRow, 5).setNumberFormat("@").setValue(hora);
      sheet.getRange(lastRow, 6).setValue(lat || "No disponible");
      sheet.getRange(lastRow, 7).setValue(lon || "No disponible");

      if (lat && lon) {
        sheet.getRange(lastRow, 8).setFormula(
          `=HYPERLINK("${linkGPS}","Ver en mapa")`
        );
      } else {
        sheet.getRange(lastRow, 8).setValue("No disponible");
      }

      sheet.getRange(lastRow, 9).setValue(precision || "No disponible");

      // Estado de puntualidad: lo calcula el cliente contra el horario del
      // servicio ("A tiempo" / "Tarde N min" / vacío si no aplica). Se
      // resalta en ámbar/negrita cuando fue tarde. El motivo de la tardanza
      // (obligatorio si fue tarde) va en la columna 11.
      const estadoCell = sheet.getRange(lastRow, 10).setValue(estado);
      sheet.getRange(lastRow, 11).setNumberFormat("@").setValue(motivo);
      if (estado.indexOf("Tarde") === 0) {
        estadoCell.setFontColor("#b45309").setFontWeight("bold");
      }

      const rowRange = sheet.getRange(lastRow, 1, 1, HEADERS.length);
      if (tipo === "Entrada") {
        rowRange.setBackground("#f0fdf4");
      } else if (tipo === "Salida") {
        rowRange.setBackground("#fef2f2");
      }

      return jsonOut({ status: "ok" });

    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  return jsonOut({ status: "ok", message: "Script de asistencia v4 activo ✅" });
}
