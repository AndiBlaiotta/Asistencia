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
  "Precisión (m)"
];

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
  'Detergente limón "Starbel" 5 lts'
];

const HIST_PEDIDOS_HEADERS = ["Fecha", "Hora", "Empleado", "Servicio", "Producto", "Acción"];

// Hash SHA-256 (hex) de la contraseña de cada empleado.
// Generado a partir de las contraseñas originales con shasum -a 256.
const EMPLEADOS_HASH = {
  "Maria Decimas":           "626e3c805e77eeb472c42c6be607be2af7ac5c08fd7050f278e0330fe81abf57",
  "Celeste Freire":          "22a9067d9bbd2104e0be07c6cc05be1de74d583ff4c2143248d2b67ca8c9f52f",
  "Rocio Medina":            "2131c65bf715f3f1af43a56f798b5c2722b69aa25b0471a86b8b71501e458d47",
  "Brisa Medina":            "63fb746a9789963a9f31559a34ba63475eb096e6c4c08399c107f7bba18eb847",
  "Sabrina Scarampo":        "8958b734a4f493cf3f7183d30975ac96fac11cab265cd6bbf49acc51888c726f",
  "Sabrina Yanel Dichito":   "ef9cf1f4ce31597bc00952a8b7d5839c2f8e96f302005ee2f0f188a16368877e",
  "Alejandro Jelvez":        "9224bad05c7df15aa6deba13ff6e66172d0834604362ca34872d8e0d29d1768f",
  "Rebeca Ayala":            "49442a8bccaa5b9c6ce95da7c7c16362c2cba5a7154ade43569894f8eaad3f69"
};

// Hash SHA-256 (hex) de la contraseña de cada dueño/administrador.
// Los admins NO fichan ni piden materiales: solo pueden consultar las
// fichadas de cualquier empleado (acción "adminHistorial").
const ADMINS_HASH = {
  "Andres Blaiotta":   "81cd05e8571da7b0e1e3ff4ec60923852c3d387b2c28e84c0dd749de6f2fbd36",
  "Martín Fiorentino": "81cd05e8571da7b0e1e3ff4ec60923852c3d387b2c28e84c0dd749de6f2fbd36"
};

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkAuth(empleado, hash) {
  return !!empleado && !!hash && EMPLEADOS_HASH[empleado] === hash;
}

function checkAdmin(admin, hash) {
  return !!admin && !!hash && ADMINS_HASH[admin] === hash;
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
  }
  return sheet;
}

function logPedido(empleado, servicio, producto, accion) {
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
}

function doGet(e) {
  const p = e.parameter || {};

  // ---- LOGIN: solo valida credenciales, no escribe nada ----
  // Devuelve el rol para que el cliente sepa qué pantalla mostrar.
  if (p.action === "login") {
    if (checkAdmin(p.empleado, p.hash)) {
      return jsonOut({ status: "ok", role: "admin" });
    }
    if (checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "ok", role: "empleado" });
    }
    return jsonOut({ status: "error", message: "Usuario o contraseña incorrectos" });
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
      const records = data.slice(1).reverse().map(row => {
        const lat = row[5], lon = row[6];
        const tieneGPS = lat && lon && lat !== "No disponible" && lon !== "No disponible";
        return {
          fecha:     fmtCell(row[0]),
          servicio:  row[1],
          direccion: row[2],
          tipo:      row[3],
          hora:      fmtCell(row[4]),
          lat:       lat,
          lon:       lon,
          linkGPS:   tieneGPS ? `https://www.google.com/maps?q=${lat},${lon}` : "No disponible"
        };
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
        linkGPS:  typeof row[7] === "string" ? row[7] : (row[5] && row[6] ? `https://www.google.com/maps?q=${row[5]},${row[6]}` : "No disponible")
      }));

      return jsonOut({ status: "ok", records });

    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- MATERIALES: lista de productos con su estado para un servicio ----
  if (p.action === "materiales" && p.servicio) {
    if (!checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "error", message: "No autorizado" });
    }
    try {
      const sheet = getMaterialesSheet();
      const col   = getServicioCol(sheet, p.servicio);
      const productos = PRODUCTOS.map(nombre => {
        const row   = getProductoRow(sheet, nombre);
        const texto = (sheet.getRange(row, col).getValue() || "").toString();
        const pedido = texto.indexOf("PEDIDO") === 0;
        return { nombre, estado: pedido ? "pedido" : "disponible", fecha: pedido ? texto.replace("PEDIDO ", "") : "" };
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
      const actual = (cell.getValue() || "").toString();

      if (actual.indexOf("PEDIDO") === 0) {
        return jsonOut({ status: "error", message: "Ese producto ya está pedido para este servicio" });
      }

      const fecha = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "dd/MM/yyyy");
      cell.setNumberFormat("@").setValue("PEDIDO " + fecha);
      logPedido(p.empleado, p.servicio, p.producto, "Pedido");
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- RECIBIDO: libera un producto bloqueado para volver a pedirlo ----
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
      const actual = (cell.getValue() || "").toString();

      if (actual.indexOf("PEDIDO") !== 0) {
        return jsonOut({ status: "error", message: "No hay un pedido pendiente para este producto" });
      }

      cell.setValue("");
      logPedido(p.empleado, p.servicio, p.producto, "Recibido");
      return jsonOut({ status: "ok" });
    } catch (err) {
      return jsonOut({ status: "error", message: err.toString() });
    }
  }

  // ---- HISTORIAL DE PEDIDOS de un servicio ----
  if (p.action === "historialPedidos" && p.servicio) {
    if (!checkAuth(p.empleado, p.hash)) {
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
          accion:   row[5]
        }));
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

      const linkGPS = (lat && lon)
        ? `https://www.google.com/maps?q=${lat},${lon}`
        : "No disponible";

      const ss = SpreadsheetApp.getActiveSpreadsheet();

      // El empleado ya está validado contra EMPLEADOS_HASH, así que la
      // hoja solo se crea para empleados reales (no se puede inyectar
      // un nombre arbitrario para generar hojas nuevas).
      let sheet = ss.getSheetByName(empleado);
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
