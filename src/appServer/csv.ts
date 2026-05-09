function csvEscape(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const text = typeof value === "object" ? JSON.stringify(value) : String(value);

  if (/[",\n\r]/.test(text)) {
    return `"${text.replaceAll('"', '""')}"`;
  }

  return text;
}

export function rowsToCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return "";
  }

  const columns = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [
    columns.map(csvEscape).join(","),
    ...rows.map((row) => columns.map((column) => csvEscape(row[column])).join(","))
  ];

  return `${lines.join("\r\n")}\r\n`;
}
