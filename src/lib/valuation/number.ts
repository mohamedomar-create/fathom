/** Arabic-Indic digits and separators to plain ones ("١٢٫٥" → "12.5"); thousands commas removed. */
export function plainNumber(raw: string): string {
  return raw.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, ".").replace(/[٬,\s]/g, "").replace(/[−–]/g, "-");
}
