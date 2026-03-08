const REQUIRED_PLACEHOLDERS = ["__VERSION__", "__SHA256__", "__URL__"];

export function resolveMacOsDmgAsset(assets) {
  const dmgAssets = (assets || []).filter((asset) => {
    const name = asset?.name || "";
    return name.endsWith(".dmg");
  });

  if (dmgAssets.length === 0) {
    throw new Error("Expected exactly one macOS DMG asset, found none.");
  }

  if (dmgAssets.length > 1) {
    const names = dmgAssets.map((asset) => asset.name).join(", ");
    throw new Error(`Expected exactly one macOS DMG asset, found ${dmgAssets.length}: ${names}`);
  }

  return dmgAssets[0];
}

export function renderHomebrewCask(template, { version, sha256, url }) {
  for (const placeholder of REQUIRED_PLACEHOLDERS) {
    if (!template.includes(placeholder)) {
      throw new Error(`Template is missing placeholder ${placeholder}`);
    }
  }

  return template
    .replaceAll("__VERSION__", version)
    .replaceAll("__SHA256__", sha256)
    .replaceAll("__URL__", url);
}
