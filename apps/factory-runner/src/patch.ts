export function extractUnifiedDiff(text: string): string | null {
  const fenced = text.match(/```diff\s*([\s\S]*?)```/i);
  if (fenced?.[1]) {
    const diff = fenced[1].trim();
    return diff ? `${diff}\n` : null;
  }

  const inlineStart = text.indexOf("diff --git ");
  if (inlineStart >= 0) {
    const diff = text.slice(inlineStart).trim();
    return diff ? `${diff}\n` : null;
  }

  return null;
}
