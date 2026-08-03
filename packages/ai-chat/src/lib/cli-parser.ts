export function parseCliOutput(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed) return null;

  const brace = trimmed.indexOf("{");
  const bracket = trimmed.indexOf("[");
  let start: number;
  if (brace === -1 && bracket === -1) {
    throw new Error(`no JSON found in CLI output: ${trimmed.slice(0, 200)}`);
  } else if (brace === -1) {
    start = bracket;
  } else if (bracket === -1) {
    start = brace;
  } else {
    start = Math.min(brace, bracket);
  }
  return JSON.parse(trimmed.slice(start));
}