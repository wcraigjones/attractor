export interface StylesheetRule {
  selector: string;
  props: Record<string, string>;
}

export function parseModelStylesheet(source: string): StylesheetRule[] {
  const input = source.trim();
  if (!input) {
    return [];
  }

  const rules: StylesheetRule[] = [];
  const pattern = /([^{}]+)\{([^{}]+)\}/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(input))) {
    const selector = (match[1] ?? "").trim();
    const body = (match[2] ?? "").trim();
    if (!selector || !body) {
      continue;
    }

    const props: Record<string, string> = {};
    for (const segment of body.split(";")) {
      const trimmed = segment.trim();
      if (!trimmed) {
        continue;
      }
      const colon = trimmed.indexOf(":");
      if (colon <= 0) {
        continue;
      }
      const key = trimmed.slice(0, colon).trim();
      const value = trimmed.slice(colon + 1).trim();
      if (key && value) {
        props[key] = value;
      }
    }

    rules.push({ selector, props });
  }

  return rules;
}
