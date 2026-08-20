const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

// expo-sqlite en web compila contra wa-sqlite: su worker importa un .wasm
// que Metro debe tratar como asset (el .wasm no se puede empaquetar como JS).
config.resolver.assetExts.push("wasm");

module.exports = config;