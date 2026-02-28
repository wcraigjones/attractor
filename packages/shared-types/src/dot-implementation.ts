const DOT_IMPLEMENTATION_PATTERNS: RegExp[] = [
  /(?:^|[\s\[,;])implementation_mode\s*=\s*["']?dot["']?(?:[\s,;\]]|$)/i,
  /(?:^|[\s\[,;])implementation_dot\s*=\s*["']?(?:true|1|yes|on)["']?(?:[\s,;\]]|$)/i,
  /(?:^|[\s\[,;])implementation_patch_node\s*=\s*["']?[A-Za-z_][A-Za-z0-9_]*["']?(?:[\s,;\]]|$)/i,
  /(?:^|[\s\[,;])implementationPatchNode\s*=\s*["']?[A-Za-z_][A-Za-z0-9_]*["']?(?:[\s,;\]]|$)/i
];

function stripComments(input: string): string {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");
}

export function attractorUsesDotImplementation(source: string): boolean {
  const normalized = stripComments(source);
  return DOT_IMPLEMENTATION_PATTERNS.some((pattern) => pattern.test(normalized));
}
