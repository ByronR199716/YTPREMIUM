import 'ts-node/register'

import { ExpoConfig } from 'expo/config'
import { version, versionCode, buildNumber } from './package.json'

const intentFilters = [
  {
    autoVerify: false,
    action: 'VIEW',
    data: ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'www.youtube.com', 'youtu.be'].map((host) => ({
      scheme: 'https',
      host,
    })),
    category: ['BROWSABLE', 'DEFAULT'],
  },
]

module.exports = ({ config }: { config: ExpoConfig }) => {
  return {
    name: 'YTPremium',
    slug: 'ytpremium',
    version,
    icon: './assets/images/icon.png',
    scheme: 'ytpremium',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    ios: {
      supportsTablet: true,
      bundleIdentifier: 'ec.ytpremium.app',
      buildNumber,
      infoPlist: {
        // The player keeps going with the screen off and on the lock screen.
        UIBackgroundModes: ['audio'],
        NSMicrophoneUsageDescription: 'Voice search on YouTube uses the microphone.',
      },
    },
    android: {
      versionCode,
      permissions: ['RECORD_AUDIO', 'MODIFY_AUDIO_SETTINGS', 'POST_NOTIFICATIONS', 'WAKE_LOCK'],
      adaptiveIcon: {
        foregroundImage: './assets/images/adaptive-icon.png',
        monochromeImage: './assets/images/monochrome-icon.png',
        backgroundColor: '#d91e2e',
      },
      predictiveBackGestureEnabled: false,
      package: 'ec.ytpremium.app',
      intentFilters,
    },
    web: {
      bundler: 'metro',
      output: 'static',
      favicon: './assets/images/favicon.png',
    },
    plugins: [
      './plugins/withAndroidPlugin.ts',
      './plugins/withIosPlugin.ts',
      'expo-router',
      'expo-background-task',
      'expo-notifications',
      [
        'expo-splash-screen',
        {
          image: './assets/images/splash-icon.png',
          imageWidth: 200,
          resizeMode: 'contain',
          backgroundColor: '#f9fafb',
          dark: {
            image: './assets/images/splash-icon.png',
            backgroundColor: '#27272a',
          },
        },
      ],
      'expo-asset',
      'expo-font',
      'expo-status-bar',
      'expo-image',
      [
        'expo-localization',
        {
          supportedLocales: ['en', 'de', 'es', 'fr', 'id', 'ja', 'pl', 'pt', 'pt-BR', 'ru', 'tr', 'uk', 'vi', 'zh-Hans', 'zh-Hant'],
        },
      ],
      [
        'expo-sharing',
        {
          // No ios entry: the share extension needs the app group
          // group.ec.ytpremium.app registered with the Apple team before it
          // can be signed. Until then lib/incoming-share.ios.ts stands in.
          android: {
            enabled: true,
            singleShareMimeTypes: ['text/*'],
          },
        },
      ],
      'expo-web-browser',
    ],
    experiments: {
      typedRoutes: true,
    },
  }
}
