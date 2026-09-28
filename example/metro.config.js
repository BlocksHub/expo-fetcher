const { getDefaultConfig } = require('expo/metro-config');
const path = require('path');

const root = path.resolve(__dirname, '..');
const config = getDefaultConfig(__dirname);

config.watchFolders = [root];
config.resolver.nodeModulesPaths = [path.resolve(__dirname, 'node_modules')];
config.resolver.extraNodeModules = { 'expo-fetcher': path.join(root, 'src') };
config.resolver.blockList = [new RegExp(`${path.join(root, 'node_modules').replace(/[/\\]/g, '[/\\\\]')}[/\\\\].*`)];

module.exports = config;
