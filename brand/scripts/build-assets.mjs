import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const brandDir = resolve(scriptDir, "..");
const assetsDir = join(brandDir, "assets");
const iconDir = join(brandDir, "app-icon");
const iconsetDir = join(iconDir, "Panes.iconset");

mkdirSync(assetsDir, { recursive: true });
mkdirSync(iconDir, { recursive: true });

const fontCandidates = [
  join(homedir(), "Library/Fonts/Proxima Nova Alt Bold.otf"),
  join(homedir(), "Library/Fonts/Proxima Nova Bold.otf")
];
const fontPath = fontCandidates.find(existsSync);

if (!fontPath) {
  throw new Error("Proxima Nova Alt Bold was not found in ~/Library/Fonts");
}

const markSvg = ({ ink, accent }) => `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="8" width="48" height="48" rx="12" stroke="${ink}" stroke-width="4"/>
  <path d="M26 10V54M28 27H54" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>
  <rect x="34" y="34" width="14" height="14" rx="5" fill="${accent}"/>
</svg>
`;

const marks = {
  "panes-mark-on-dark.svg": { ink: "#F3F3F5", accent: "#61D596" },
  "panes-mark-on-light.svg": { ink: "#18181C", accent: "#02955A" },
  "panes-mark-mono-light.svg": { ink: "#FFFFFF", accent: "#FFFFFF" },
  "panes-mark-mono-dark.svg": { ink: "#000000", accent: "#000000" }
};

for (const [fileName, colors] of Object.entries(marks)) {
  writeFileSync(join(assetsDir, fileName), markSvg(colors));
}

writeFileSync(join(assetsDir, "panes-symbolic.svg"), `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect x="8" y="8" width="48" height="48" rx="12" stroke="currentColor" stroke-width="4"/>
  <path d="M26 10V54M28 27H54" stroke="currentColor" stroke-width="4" stroke-linecap="round"/>
  <rect x="34" y="34" width="14" height="14" rx="5" fill="currentColor"/>
</svg>
`);

const wordmarkVariants = [
  ["panes-wordmark-on-dark.svg", "F3F3F5"],
  ["panes-wordmark-on-light.svg", "18181C"]
];

for (const [fileName, foreground] of wordmarkVariants) {
  execFileSync("hb-view", [
    "--output-format=svg",
    `--output-file=${join(assetsDir, fileName)}`,
    "--background=none",
    `--foreground=${foreground}`,
    "--font-size=256",
    "--margin=0",
    fontPath,
    "panes"
  ]);
}

const lockupSvg = ({ markFile, wordmarkFile }) => {
  const mark = readFileSync(join(assetsDir, markFile), "utf8");
  const wordmark = readFileSync(join(assetsDir, wordmarkFile), "utf8");
  const svgBody = (source) => {
    const svgStart = source.indexOf("<svg");
    const openTagEnd = source.indexOf(">", svgStart);
    return source.slice(openTagEnd + 1, source.lastIndexOf("</svg>"));
  };
  const markBody = svgBody(mark);
  const wordmarkBody = svgBody(wordmark);

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg viewBox="0 0 276 64" fill="none" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">
  <svg x="0" y="0" width="64" height="64" viewBox="0 0 64 64">${markBody}</svg>
  <svg x="84" y="-8" width="182" height="80" viewBox="0 0 711 311.796875">${wordmarkBody}</svg>
</svg>
`;
};

writeFileSync(join(assetsDir, "panes-lockup-on-dark.svg"), lockupSvg({
  markFile: "panes-mark-on-dark.svg",
  wordmarkFile: "panes-wordmark-on-dark.svg"
}));
writeFileSync(join(assetsDir, "panes-lockup-on-light.svg"), lockupSvg({
  markFile: "panes-mark-on-light.svg",
  wordmarkFile: "panes-wordmark-on-light.svg"
}));

const sourceIcon = join(assetsDir, "app-icon-source.svg");
const renderPng = (size, output) => execFileSync("rsvg-convert", [
  "-w", String(size), "-h", String(size), sourceIcon, "-o", output
]);

for (const size of [16, 32, 48, 64, 128, 256, 512, 1024]) {
  renderPng(size, join(iconDir, `panes-${size}.png`));
}

rmSync(iconsetDir, { recursive: true, force: true });
mkdirSync(iconsetDir, { recursive: true });
const iconsetFiles = {
  "icon_16x16.png": 16,
  "icon_16x16@2x.png": 32,
  "icon_32x32.png": 32,
  "icon_32x32@2x.png": 64,
  "icon_128x128.png": 128,
  "icon_128x128@2x.png": 256,
  "icon_256x256.png": 256,
  "icon_256x256@2x.png": 512,
  "icon_512x512.png": 512,
  "icon_512x512@2x.png": 1024
};

for (const [fileName, size] of Object.entries(iconsetFiles)) {
  renderPng(size, join(iconsetDir, fileName));
}

execFileSync("iconutil", ["-c", "icns", iconsetDir, "-o", join(iconDir, "panes.icns")]);
execFileSync("magick", [
  join(iconDir, "panes-16.png"),
  join(iconDir, "panes-32.png"),
  join(iconDir, "panes-48.png"),
  join(iconDir, "panes-64.png"),
  join(iconDir, "panes-128.png"),
  join(iconDir, "panes-256.png"),
  join(iconDir, "panes.ico")
]);

console.log(`Built Panes brand assets in ${brandDir}`);
