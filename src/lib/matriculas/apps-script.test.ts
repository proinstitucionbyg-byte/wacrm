import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createContext, runInContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

const script = readFileSync(join(process.cwd(), "docs/apps-script/MATRICULAS.gs"), "utf8");
const headers = ["N°", "FECHA DE HOY", "HORA", "INSTITUTO", "ASESORA DE INGRESO", "ASESORA DE VTAS.", "NOMBRE COMPLETO", "DNI", "F. NACIMIENTO", "EDAD", "CELULAR 1", "CELULAR 2", "DIRECCION", "DEPARTAMENTO", "DISTRITO", "CORREO ELECTRONICO", "LINK DE CARPETA DEL ESTUDIANTE", "CURSO", "FECHA DE INICIO", "AGREGADOS AL WHATSAPP", "PRIORIDAD", "ESTADO", "PROMO", "OBSERVACIONES", "OBSERVACION PARA FIDELIZACIÓN", "OBSERVACION PARA VENTAS"];

function harness(initialRows: unknown[][] = []) {
  // Legacy test fixtures omit HORA; insert it in C, like the verified workbook.
  const rows = [headers.slice(), ...initialRows.map((row) => {
    const values = row.length === 26 ? row : [...row.slice(0, 2), "", ...row.slice(2)];
    return Array.from({ length: 26 }, (_, i) => values[i] ?? "");
  })];
  const formulas = new Map<string, string>();
  const formats = new Map<string, string>();
  let timezone = "America/Lima";
  const toast = vi.fn();
  const flush = vi.fn();
  const lock = { waitLock: vi.fn(), hasLock: () => true, releaseLock: vi.fn() };
  const spreadsheet = {
    getId: () => "16jhqgiYLh_GCkuxPL2fpljf04-Pj2HAqNY_0ePT0z7w",
    getSpreadsheetTimeZone: () => timezone,
    setSpreadsheetTimeZone: (value: string) => { timezone = value; },
    getSheetByName: () => sheet,
    toast,
  };
  const sheet = {
    getName: () => "MATRICULAS",
    getLastRow: () => rows.length,
    getMaxRows: () => rows.length,
    setFrozenRows: vi.fn(),
    getRange: (startRow: number, startColumn: number, rowCount = 1, columnCount = 1) => {
      const range = {
        getSheet: () => sheet,
        getRow: () => startRow,
        getColumn: () => startColumn,
        getLastRow: () => startRow + rowCount - 1,
        getLastColumn: () => startColumn + columnCount - 1,
        getValues: () => Array.from({ length: rowCount }, (_, i) => Array.from({ length: columnCount }, (_, j) => rows[startRow + i - 1]?.[startColumn + j - 1] ?? "")),
        getFormulas: () => Array.from({ length: rowCount }, (_, i) => Array.from({ length: columnCount }, (_, j) => formulas.get(`${startRow + i}:${startColumn + j}`) ?? "")),
        setValue: (value: unknown) => {
          rows[startRow - 1] ??= Array(26).fill("");
          rows[startRow - 1][startColumn - 1] = value as string;
          return range;
        },
        setValues: (values: unknown[][]) => {
          values.forEach((row, i) => row.forEach((value, j) => { rows[startRow + i - 1][startColumn + j - 1] = value as string; }));
          return range;
        },
        setNumberFormat: (format: string) => { formats.set(`${startRow}:${startColumn}`, format); return range; },
        setHorizontalAlignment: () => range,
        setFontFamily: () => range,
        setFontSize: () => range,
      };
      return range;
    },
  };
  const context = createContext({ Date, SpreadsheetApp: { flush, getActiveSpreadsheet: () => spreadsheet, openById: () => spreadsheet }, LockService: { getScriptLock: () => lock } });
  runInContext(script, context);
  return {
    rows, formulas, formats, spreadsheet, lock, toast, flush,
    setTimezone: (value: string) => { timezone = value; },
    configure: () => runInContext("CONFIGURAR_MATRICULAS()", context),
    edit: (row = 2, column = 7, count = 1, width = 1) => {
      context.event = { source: spreadsheet, range: sheet.getRange(row, column, count, width) };
      runInContext("onEdit(event)", context);
    },
    automatic: (row = 2) => { context.automaticRow = row; return runInContext("PROCESAR_REGISTRO_AUTOMATICO(automaticRow)", context); },
    evaluate: (expression: string) => runInContext(expression, context),
  };
}

describe("Apps Script de matriculas", () => {
  it("normaliza encabezados sin eliminar las tildes de datos personales", () => {
    const h = harness();
    expect(h.evaluate("NORMALIZAR_CABECERA_('observacion para fidelización')")).toBe("OBSERVACION PARA FIDELIZACION");
    expect(h.evaluate("NORMALIZAR_TEXTO_('  María   José  ').toUpperCase()")).toBe("MARÍA JOSÉ");
  });

  it("calcula el siguiente numero usando el mayor entero existente", () => {
    expect(harness().evaluate("SIGUIENTE_NUMERO_([[1], [99], ['100'], [''], [-1], [2.5], ['texto']])")).toBe(101);
  });

  it("genera numero, fecha fija e instituto al ingresar un nombre", () => {
    const h = harness([["", "", "", "", "", "  maría   pérez  "]]);
    h.edit();
    expect(h.rows[1][0]).toBe(1);
    expect(h.rows[1][1]).toBeInstanceOf(Date);
    expect(h.rows[1][2]).toBe(h.rows[1][1]);
    expect(h.formats.get("2:3")).toBe("HH:mm:ss");
    expect(h.rows[1][3]).toBe("INSTICRECE");
    expect(h.rows[1][6]).toBe("MARÍA PÉREZ");
    expect(h.flush).toHaveBeenCalledOnce();
    expect(h.lock.releaseLock).toHaveBeenCalledOnce();
  });

  it("conserva el numero y la fecha al editar nuevamente", () => {
    const originalDate = new Date("2026-10-08T12:00:00Z");
    const h = harness([[17, originalDate, "OTRO INSTITUTO", "", "", "ashley"]]);
    h.edit();
    expect(h.rows[1].slice(0, 4)).toEqual([17, originalDate, "", "OTRO INSTITUTO"]);
  });

  it("no registra filas sin nombre", () => {
    const h = harness([["", "", "", "ashley"]]);
    h.edit(2, 5);
    expect(h.rows[1].slice(0, 3)).toEqual(["", "", ""]);
    expect(h.rows[1][4]).toBe("ASHLEY");
  });

  it("numera consecutivamente un pegado de varias filas despues de numeros manuales", () => {
    const h = harness([[99, "", "", "", "", "existente"], ["", "", "", "", "", "uno"], ["", "", "", "", "", "dos"]]);
    h.edit(3, 7, 2);
    expect(h.rows[2][0]).toBe(100);
    expect(h.rows[3][0]).toBe(101);
    expect(h.rows[1][0]).toBe(99);
  });

  it("preserva ceros y signo internacional, normaliza email y conserva el enlace", () => {
    const row = Array(25).fill("");
    row[6] = " 0012 34 "; row[9] = " +51 999 111 222 "; row[14] = " Alumno@Gmail.com "; row[15] = "https://drive.google.com/ABCdef";
    const h = harness([row]);
    h.edit(2, 8, 1, 10);
    expect(h.rows[1][7]).toBe("001234");
    expect(h.rows[1][10]).toBe("+51999111222");
    expect(h.rows[1][15]).toBe("alumno@gmail.com");
    expect(h.rows[1][16]).toBe(row[15]);
  });

  it("conserva formulas de texto y numeracion", () => {
    const h = harness([["", "", "", "", "", "nombre calculado"]]);
    h.formulas.set("2:1", "=ROW()-1");
    h.formulas.set("2:7", '=LOWER("NOMBRE CALCULADO")');
    h.edit(2, 1, 1, 7);
    expect(h.rows[1][0]).toBe("");
    expect(h.rows[1][6]).toBe("nombre calculado");
  });

  it("rechaza una estructura alterada antes de escribir", () => {
    const h = harness([["", "", "", "", "", "ashley"]]);
    h.rows[0][6] = "OTRA COLUMNA";
    expect(() => h.edit()).toThrow("NOMBRE COMPLETO");
    expect(h.rows[1][0]).toBe("");
    expect(h.toast).toHaveBeenCalledOnce();
    expect(h.lock.releaseLock).toHaveBeenCalledOnce();
  });

  it("requiere Lima y la configuracion inicial normaliza encabezados", () => {
    const h = harness([["", "", "", "", "", "ashley"]]);
    h.setTimezone("America/Los_Angeles");
    expect(() => h.edit()).toThrow("CONFIGURAR_MATRICULAS");
    h.configure();
    expect(h.spreadsheet.getSpreadsheetTimeZone()).toBe("America/Lima");
    expect(h.rows[0][9]).toBe("EDAD");
    expect(h.rows[0][24]).toBe("OBSERVACION PARA FIDELIZACION");
    h.edit();
    expect(h.rows[1][0]).toBe(1);
  });

  it("procesa una fila automatica con fecha y hora del mismo instante", () => {
    const h = harness([["", "", "", "ashley", "", "  maria  "]]);
    h.automatic();
    expect(h.rows[1][0]).toBe(1);
    expect(h.rows[1][1]).toBeInstanceOf(Date);
    expect(h.rows[1][2]).toBe(h.rows[1][1]);
    expect(h.formats.get("2:3")).toBe("HH:mm:ss");
    expect(h.rows[1][4]).toBe("ASHLEY");
    expect(h.rows[1][6]).toBe("MARIA");
  });

  it("conserva fecha y hora en reintentos automaticos y ediciones manuales", () => {
    const h = harness([["", "", "", "", "", "maria"]]);
    h.automatic();
    const timestamp = h.rows[1][1];
    h.automatic();
    h.edit();
    expect(h.rows[1][0]).toBe(1);
    expect(h.rows[1][1]).toBe(timestamp);
    expect(h.rows[1][2]).toBe(timestamp);
  });

  it("no inventa la hora faltante de un registro antiguo", () => {
    const oldDate = new Date("2025-12-13T05:00:00Z");
    const h = harness([[1, oldDate, "", "", "", "maria"]]);
    h.edit();
    expect(h.rows[1][1]).toBe(oldDate);
    expect(h.rows[1][2]).toBe("");
  });

  it("rechaza filas automaticas invalidas o sin nombre", () => {
    const h = harness([[]]);
    expect(() => h.automatic(1)).toThrow("fila valida");
    expect(() => h.automatic(3)).toThrow("debe existir");
    expect(() => h.automatic(2)).toThrow("NOMBRE COMPLETO");
    expect(h.rows[1].slice(0, 3)).toEqual(["", "", ""]);
  });

  it("mantiene el instante exacto al cruzar la medianoche en Lima", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-09T04:59:58Z"));
      const h = harness([["", "", "", "", "", "maria"], ["", "", "", "", "", "ana"]]);
      h.edit();
      const firstTimestamp = h.rows[1][2] as Date;
      const clock = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
      const calendar = new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit" });
      expect(clock.format(firstTimestamp)).toBe("23:59:58");
      expect(calendar.format(firstTimestamp)).toBe("08/10/2026");
      vi.setSystemTime(new Date("2026-10-09T05:00:01Z"));
      h.automatic(3);
      expect(clock.format(h.rows[2][2] as Date)).toBe("00:00:01");
      expect(calendar.format(h.rows[2][1] as Date)).toBe("09/10/2026");
      h.edit();
      expect(h.rows[1][2]).toBe(firstTimestamp);
    } finally {
      vi.useRealTimers();
    }
  });
});
