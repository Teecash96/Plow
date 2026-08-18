import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cssPath = path.join(root, "src", "app", "globals.css");
const css = fs.readFileSync(cssPath, "utf8");

const tokens = Object.fromEntries(
  [...css.matchAll(/--([a-z-]+):\s*(#[0-9a-f]{6})\s*;/gi)].map((match) => [match[1], match[2].toLowerCase()]),
);

function token(name) {
  const value = tokens[name];
  if (!value) throw new Error(`Missing design token --${name} in ${cssPath}`);
  return value;
}

function relativeLuminance(hex) {
  const channels = [0, 2, 4].map((offset) => parseInt(hex.slice(offset + 1, offset + 3), 16) / 255);
  const linear = channels.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return (0.2126 * linear[0]) + (0.7152 * linear[1]) + (0.0722 * linear[2]);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  return (Math.max(foregroundLuminance, backgroundLuminance) + 0.05) / (Math.min(foregroundLuminance, backgroundLuminance) + 0.05);
}

const checks = [
  { name: "Primary text on background", foreground: token("foreground"), background: token("background"), minimum: 4.5 },
  { name: "Muted text on surface", foreground: token("muted"), background: token("surface"), minimum: 4.5 },
  { name: "Brand text on background", foreground: token("brand"), background: token("background"), minimum: 4.5 },
  { name: "Brand text on surface", foreground: token("brand"), background: token("surface"), minimum: 4.5 },
  { name: "Positive text on success surface", foreground: token("positive"), background: "#10271f", minimum: 4.5 },
  { name: "Warning text on warning surface", foreground: token("warning"), background: "#211d0d", minimum: 4.5 },
  { name: "Negative text on error surface", foreground: token("negative"), background: "#281313", minimum: 4.5 },
  { name: "Surface border on surface", foreground: token("surface-border"), background: token("surface"), minimum: 3 },
  { name: "Surface border on raised surface", foreground: token("surface-border"), background: token("surface-raised"), minimum: 3 },
  { name: "Brand focus ring on surface", foreground: token("brand"), background: token("surface"), minimum: 3 },
  { name: "Positive status outline", foreground: "#5a9876", background: "#10271f", minimum: 3 },
  { name: "Warning status outline", foreground: "#9a843c", background: "#211d0d", minimum: 3 },
  { name: "Negative status outline", foreground: "#ad6565", background: "#281313", minimum: 3 },
  { name: "Homepage CTA outline", foreground: "#82660a", background: "#131209", minimum: 3 },
  { name: "Hero pre reveal text", foreground: "#767676", background: token("background"), minimum: 4.5 },
];

let failed = false;
console.log("WCAG 2.2 AA contrast checks");
console.log("Normal text minimum: 4.50:1. Large text and UI minimum: 3.00:1\n");

for (const check of checks) {
  const ratio = contrastRatio(check.foreground, check.background);
  const passed = ratio >= check.minimum;
  failed ||= !passed;
  console.log(`${passed ? "PASS" : "FAIL"} ${check.name}: ${ratio.toFixed(2)}:1 (minimum ${check.minimum.toFixed(2)}:1) ${check.foreground} on ${check.background}`);
}

if (failed) process.exitCode = 1;
