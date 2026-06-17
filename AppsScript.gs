// =====================================================================
// SCRIPT DE ASISTENCIA v3 — Google Apps Script
// =====================================================================
// Cada empleado tiene su propia hoja en la planilla.
// Los registros incluyen: servicio, dirección, hora, GPS y link de mapa.
//
// Las contraseñas NUNCA se guardan ni viajan en texto plano: el cliente
// calcula un hash SHA-256 de la contraseña y este script lo compara
// contra el hash guardado acá. Todo pedido (login, registrar, historial)
// se valida contra este hash antes de hacer cualquier cosa.
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

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function checkAuth(empleado, hash) {
  return !!empleado && !!hash && EMPLEADOS_HASH[empleado] === hash;
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

function doGet(e) {
  const p = e.parameter || {};

  // ---- LOGIN: solo valida credenciales, no escribe nada ----
  if (p.action === "login") {
    if (checkAuth(p.empleado, p.hash)) {
      return jsonOut({ status: "ok" });
    }
    return jsonOut({ status: "error", message: "Usuario o contraseña incorrectos" });
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

  return jsonOut({ status: "ok", message: "Script de asistencia v3 activo ✅" });
}
