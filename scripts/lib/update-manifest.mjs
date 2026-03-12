export const UPDATER_PLATFORM_DEFINITIONS = [
  {
    bundleMatch: /\.app\.tar\.gz$/,
    signatureMatch: /\.app\.tar\.gz\.sig$/,
    label: "macOS updater bundle",
    platforms: ["darwin-aarch64", "darwin-x86_64"],
  },
  {
    bundleMatch: /\.AppImage$/,
    signatureMatch: /\.AppImage\.sig$/,
    label: "Linux updater bundle",
    platforms: ["linux-x86_64"],
  },
  {
    bundleMatch: /-setup\.exe$/,
    signatureMatch: /-setup\.exe\.sig$/,
    label: "Windows updater bundle",
    platforms: ["windows-x86_64"],
  },
];

function findMatchingAssets(assets, pattern) {
  return (assets || []).filter((asset) => pattern.test(asset?.name || ""));
}

function describeMatches(matches) {
  return matches.map((asset) => asset.name).join(", ");
}

function resolveRequiredSingleAsset(matches, label) {
  if (matches.length === 0) {
    throw new Error(`Expected exactly one ${label}, found none.`);
  }

  if (matches.length > 1) {
    throw new Error(`Expected exactly one ${label}, found ${matches.length}: ${describeMatches(matches)}`);
  }

  return matches[0];
}

export function resolveUpdaterAssetPairs(assets) {
  return UPDATER_PLATFORM_DEFINITIONS.flatMap((definition) => {
    const bundles = findMatchingAssets(assets, definition.bundleMatch);
    const signatures = findMatchingAssets(assets, definition.signatureMatch);

    if (bundles.length === 0 && signatures.length === 0) {
      return [];
    }

    const bundle = resolveRequiredSingleAsset(bundles, `${definition.label} asset`);
    const signature = resolveRequiredSingleAsset(signatures, `${definition.label} signature asset`);

    return [{ ...definition, bundle, signature }];
  });
}

export function buildStaticReleasePlatforms(resolvedAssetPairs, signatureByAssetName) {
  const platforms = {};

  for (const assetPair of resolvedAssetPairs) {
    const signature = signatureByAssetName[assetPair.signature.name];
    if (!signature) {
      throw new Error(`Missing signature contents for asset ${assetPair.signature.name}`);
    }

    for (const platform of assetPair.platforms) {
      platforms[platform] = {
        signature,
        url: assetPair.bundle.browser_download_url,
      };
    }
  }

  return platforms;
}
