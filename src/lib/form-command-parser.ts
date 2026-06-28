export interface ParsedField {
  name: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  placeholder?: string;
}

export interface ParsedFormCommand {
  name: string;
  description: string;
  fields: ParsedField[];
  category?: string;
}

const VALID_TYPES = new Set([
  "text",
  "textarea",
  "email",
  "number",
  "date",
  "checkbox",
  "select",
  "user",
  "image",
]);

const REQUIRED_SYNONYMS = new Set(["required", "mandatory", "compulsory", "must", "necessary"]);

// Matches: "create [a] form [called|named] <name> [with fields: ...]"
const COMMAND_RE =
  /^create\s+(?:a\s+)?form\s+(?:called\s+|named\s+)?(.+?)(?:\s+with\s+fields?\s*[:\-]?\s*(.+))?$/i;

function parseField(raw: string, usedNames: Set<string>): ParsedField | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // Split into label part and parens part: "employee name (text, mandatory)"
  const parenIdx = trimmed.lastIndexOf("(");
  const label = (parenIdx === -1 ? trimmed : trimmed.slice(0, parenIdx)).trim();
  const inside = parenIdx !== -1 && trimmed.endsWith(")") ? trimmed.slice(parenIdx + 1, -1) : "";

  if (!label) return null;

  // Derive a unique snake_case name
  let base = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  let fieldName = base;
  let suffix = 2;
  while (usedNames.has(fieldName)) {
    fieldName = `${base}_${suffix++}`;
  }
  usedNames.add(fieldName);

  let type = "text";
  let required = false;
  let options: string[] | undefined;

  if (inside) {
    const parts = inside.split(",").map((p) => p.trim());
    for (const part of parts) {
      const lower = part.toLowerCase();

      if (REQUIRED_SYNONYMS.has(lower)) {
        required = true;
        continue;
      }
      if (lower === "optional") {
        required = false;
        continue;
      }

      // "select: opt1/opt2/opt3" or "select"
      if (lower.startsWith("select")) {
        type = "select";
        const colonIdx = part.indexOf(":");
        if (colonIdx !== -1) {
          options = part
            .slice(colonIdx + 1)
            .split("/")
            .map((o) => o.trim())
            .filter(Boolean);
        }
        continue;
      }

      if (VALID_TYPES.has(lower)) {
        type = lower;
      }
    }
  }

  // select with no options → fall back to text
  if (type === "select" && (!options || options.length === 0)) {
    type = "text";
  }

  const field: ParsedField = { name: fieldName, label, type, required };
  if (options) field.options = options;
  return field;
}

export function parseFormCommand(text: string): ParsedFormCommand | null {
  const match = text.trim().match(COMMAND_RE);
  if (!match) return null;

  const formName = match[1]?.trim();
  if (!formName) return null;

  const fieldsRaw = match[2] ?? "";
  const usedNames = new Set<string>();
  const fields: ParsedField[] = [];

  if (fieldsRaw) {
    // Split on commas that are OUTSIDE parentheses
    const tokens: string[] = [];
    let depth = 0;
    let current = "";
    for (const ch of fieldsRaw) {
      if (ch === "(") {
        depth++;
        current += ch;
      } else if (ch === ")") {
        depth--;
        current += ch;
      } else if (ch === "," && depth === 0) {
        tokens.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) tokens.push(current);

    for (const raw of tokens) {
      const f = parseField(raw, usedNames);
      if (f) fields.push(f);
    }
  }

  return {
    name: formName,
    description: `${formName} form`,
    fields,
  };
}
