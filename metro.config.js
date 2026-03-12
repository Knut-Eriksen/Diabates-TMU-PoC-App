const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const defaultConfig = getDefaultConfig(__dirname);
const assetExts = defaultConfig.resolver.assetExts.includes('csv')
  ? defaultConfig.resolver.assetExts
  : [...defaultConfig.resolver.assetExts, 'csv'];

const config = {
  resolver: {
    assetExts,
  },
};

module.exports = mergeConfig(defaultConfig, config);
