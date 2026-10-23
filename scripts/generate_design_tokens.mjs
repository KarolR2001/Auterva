import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const sourcePath = path.join(root, "design/tokens/auterva.tokens.json");
const cssPath = path.join(root, "design/tokens/auterva.tokens.css");
const source = JSON.parse(await readFile(sourcePath, "utf8"));

const all = source.sets.flatMap((set) => set.tokens.map((token) => ({ ...token, set: set.name })));
const names = new Set();
const errors = [];
const allowedHex = new Set(["#151515", "#424242", "#737373", "#a5a5a5", "#f2f2f2"]);
const allowedRgba = /rgba\((21, 21, 21|66, 66, 66|115, 115, 115), 0\.(04|08|12|16|24|35|40|60)\)/;

for (const token of all) {
  if (names.has(token.name)) errors.push(`Duplicate token: ${token.name}`);
  names.add(token.name);
  if (token.type === "color" && !token.value.startsWith("{") && !allowedHex.has(token.value) && !allowedRgba.test(token.value)) {
    errors.push(`Color outside allowed palette: ${token.name}=${token.value}`);
  }
  if (["spacing", "sizing", "dimension", "borderRadius", "borderWidth", "fontSizes", "fontWeights", "number"].includes(token.type)) {
    if (!/^-?\d+(?:\.\d+)?$/.test(token.value)) errors.push(`Invalid numeric token: ${token.name}=${token.value}`);
  }
}

const byName = new Map(all.map((token) => [token.name, token]));
for (const token of all) {
  const match = token.value.match(/^\{([^}]+)\}$/);
  if (match && !byName.has(match[1])) errors.push(`Unresolved alias: ${token.name} -> ${match[1]}`);
}

const resolving = new Set();
const resolved = new Map();
function resolve(name) {
  if (resolved.has(name)) return resolved.get(name);
  if (resolving.has(name)) throw new Error(`Alias cycle at ${name}`);
  resolving.add(name);
  const token = byName.get(name);
  if (!token) throw new Error(`Missing token ${name}`);
  const match = token.value.match(/^\{([^}]+)\}$/);
  const value = match ? resolve(match[1]) : token.value;
  resolving.delete(name);
  resolved.set(name, value);
  return value;
}

for (const name of names) {
  try {
    resolve(name);
  } catch (error) {
    errors.push(error.message);
  }
}

if (errors.length) throw new Error(errors.join("\n"));

const cssName = (name) => `--${name.replaceAll(".", "-")}`;
const cssValue = (token) => {
  const alias = token.value.match(/^\{([^}]+)\}$/);
  if (alias) return `var(${cssName(alias[1])})`;
  if (["spacing", "sizing", "dimension", "borderRadius", "borderWidth", "fontSizes"].includes(token.type)) return `${token.value}px`;
  if (token.name.startsWith("motion.") && token.name.endsWith(".ms")) return `${token.value}ms`;
  return token.value;
};

const lines = [
  "/* Generated from auterva.tokens.json. Do not edit directly. */",
  ":root {",
  ...all.map((token) => `  ${cssName(token.name)}: ${cssValue(token)};`),
  "  --motion-standard: cubic-bezier(var(--motion-standard-x1), var(--motion-standard-y1), var(--motion-standard-x2), var(--motion-standard-y2));",
  "  --motion-exit: cubic-bezier(var(--motion-exit-x1), var(--motion-exit-y1), var(--motion-exit-x2), var(--motion-exit-y2));",
  "}",
  "",
  "@media (prefers-reduced-motion: reduce) {",
  "  :root {",
  "    --motion-fast-ms: 1ms;",
  "    --motion-base-ms: 1ms;",
  "    --motion-slow-ms: 1ms;",
  "  }",
  "}",
  "",
];

const generated = lines.join("\n");
if (process.argv.includes("--check")) {
  const existing = await readFile(cssPath, "utf8");
  if (existing !== generated) {
    throw new Error("Token CSS is stale. Run node scripts/generate_design_tokens.mjs");
  }
} else {
  await writeFile(cssPath, generated, "utf8");
}
process.stdout.write(`${JSON.stringify({ tokenCount: all.length, setCount: source.sets.length, cssPath: path.relative(root, cssPath) })}\n`);
