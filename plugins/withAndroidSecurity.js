// Config plugin: endurece el AndroidManifest generado por expo prebuild.
// 1. allowBackup=false — la base SQLite (transacciones, notas, metas) no se
//    respalda en claro en la nube de Google.
// 2. Elimina permisos heredados que la app no usa declarandolos con
//    tools:node="remove" para que el manifest merger los quite aunque los
//    declare una libreria (badges de ShortcutBadger, storage legacy):
//    - SYSTEM_ALERT_WINDOW
//    - READ/WRITE_EXTERNAL_STORAGE (el storage de la app es SQLite local)
//    - Permisos de badges de launcher (me.leolin ShortcutBadger, libreria
//      transitiva de expo-notifications)
const { withAndroidManifest } = require("@expo/config-plugins");

const BLOCKED_PERMISSIONS = [
  "android.permission.SYSTEM_ALERT_WINDOW",
  "android.permission.READ_EXTERNAL_STORAGE",
  "android.permission.WRITE_EXTERNAL_STORAGE",
  "com.sec.android.provider.badge.permission.READ",
  "com.sec.android.provider.badge.permission.WRITE",
  "com.htc.launcher.permission.READ_SETTINGS",
  "com.htc.launcher.permission.UPDATE_SHORTCUT",
  "com.sonyericsson.home.permission.BROADCAST_BADGE",
  "com.sonymobile.home.permission.PROVIDER_INSERT_BADGE",
  "com.anddoes.launcher.permission.UPDATE_COUNT",
  "com.majeur.launcher.permission.UPDATE_BADGE",
  "com.huawei.android.launcher.permission.CHANGE_BADGE",
  "com.huawei.android.launcher.permission.READ_SETTINGS",
  "com.huawei.android.launcher.permission.WRITE_SETTINGS",
  "android.permission.READ_APP_BADGE",
  "com.oppo.launcher.permission.READ_SETTINGS",
  "com.oppo.launcher.permission.WRITE_SETTINGS",
  "me.everything.badger.permission.BADGE_COUNT_READ",
  "me.everything.badger.permission.BADGE_COUNT_WRITE",
];

module.exports = function withAndroidSecurity(config) {
  return withAndroidManifest(config, (manifestConfig) => {
    const androidManifest = manifestConfig.modResults.manifest;

    const app = androidManifest.application?.[0];
    if (app?.$) {
      app.$["android:allowBackup"] = "false";
      delete app.$["android:fullBackupContent"];
      delete app.$["android:dataExtractionRules"];
    }

    // Quita del manifest principal los que la app declara directamente...
    const declaredPermissions = androidManifest["uses-permission"] ?? [];
    androidManifest["uses-permission"] = declaredPermissions.filter((perm) => {
      const name = perm.$?.["android:name"];
      return !name || !BLOCKED_PERMISSIONS.includes(name);
    });

    // ...y bloquea los que traen las librerias. tools:node="remove" hace que
    // el manifest merger de Gradle elimine el permiso aunque otra
    // dependencia lo declare en su propio manifest.
    if (!androidManifest.$["xmlns:tools"]) {
      androidManifest.$["xmlns:tools"] = "http://schemas.android.com/tools";
    }
    const removers = BLOCKED_PERMISSIONS.map((name) => ({
      $: {
        "android:name": name,
        "tools:node": "remove",
      },
    }));
    androidManifest["uses-permission"] = [
      ...(androidManifest["uses-permission"] ?? []),
      ...removers,
    ];

    return manifestConfig;
  });
};