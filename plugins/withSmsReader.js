// Config plugin: restaura la lectura de SMS desde la bandeja de entrada.
// expo prebuild elimina el módulo nativo SmsReader y el permiso READ_SMS
// (higiene de prebuild: solo mantiene lo que autolinkean las librerías npm).
// Este plugin re-inyecta ambos en cada prebuild:
//   1. READ_SMS en el manifest (permiso restringido en Android 14+, el
//      sistema exige activación manual si la app no viene de Play Store).
//   2. SmsReader.kt con el módulo nativo que lee el inbox vía ContentResolver.
//   3. Registro de SmsReaderPackage en MainApplication.kt.
const { withAndroidManifest, withDangerousMod } = require("@expo/config-plugins");
const fs = require("fs");
const path = require("path");

// El módulo se registra como ReactPackage clásico: con New Architecture el
// interop layer de RN mantiene el puente legacy, así NativeModules.SmsReader
// sigue resolviéndose sin escribir un TurboModule.
const SMS_READER_KT = `package com.anonymous.kiora

import android.content.ContentResolver
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.provider.Telephony
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.facebook.react.uimanager.ViewManager

class SmsReaderModule(reactContext: ReactApplicationContext) :
  ReactContextBaseJavaModule(reactContext) {

  override fun getName() = "SmsReader"

  // Lee los ultimos N SMS del inbox (solo bandeja de entrada, no lee
  // enviados/borradores). Retorna [{ address, body, date }] en orden
  // descendente. El permiso READ_SMS ya lo solicita el JS antes de llamar.
  @ReactMethod
  fun readInbox(limit: Int, promise: Promise) {
    try {
      val resolver: ContentResolver = reactApplicationContext.contentResolver
      val uri: Uri = Telephony.Sms.Inbox.CONTENT_URI
      val projection = arrayOf(
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE
      )
      val list = Arguments.createArray()
      resolver.query(uri, projection, null, null, Telephony.Sms.DATE + " DESC")
        ?.use { cursor ->
          var count = 0
          while (cursor.moveToNext() && count < limit) {
            list.pushMap(Arguments.createMap().apply {
              putString("address", cursor.getString(0) ?: "")
              putString("body", cursor.getString(1) ?: "")
              putDouble("date", cursor.getLong(2).toDouble())
            })
            count++
          }
        }
      promise.resolve(list)
    } catch (e: Exception) {
      promise.reject("SMS_READ_ERROR", e.message ?: "Error al leer SMS")
    }
  }

  // Android 14+ bloquea READ_SMS en apps instaladas fuera de Play Store
  // ("App was denied access to SMS") y no hay API publica para concederlo.
  // Abre directo la pantalla "Ajustes restringidos" de la app; en versiones
  // viejas cae a los detalles de la aplicacion.
  @ReactMethod
  fun openRestrictedSettings() {
    val context = reactApplicationContext
    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
        // Constantes literales de AOSP: la API publica Settings.* no existe
        // en el stub jar, pero el action/extra son estables desde Android 14.
        val intent = Intent("android.settings.MANAGE_APP_RESTRICTED_SETTINGS")
          .putExtra("android.provider.extra.APP_PACKAGE", context.packageName)
          .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (intent.resolveActivity(context.packageManager) != null) {
          context.startActivity(intent)
          return
        }
      }
      val fallback = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
        .setData(Uri.parse("package:\${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(fallback)
    } catch (_: Exception) {
      // Sin activity disponible: se queda en la app.
    }
  }
}

class SmsReaderPackage : com.facebook.react.ReactPackage {
  override fun createNativeModules(reactContext: ReactApplicationContext) =
    listOf<SmsReaderModule>(SmsReaderModule(reactContext))

  override fun createViewManagers(reactContext: ReactApplicationContext) =
    emptyList<ViewManager<*, *>>()
}
`;

const MAIN_APPLICATION_PATH = [
  "app", "src", "main", "java", "com", "anonymous", "kiora", "MainApplication.kt",
];
const SMS_READER_PATH = [
  "app", "src", "main", "java", "com", "anonymous", "kiora", "SmsReader.kt",
];

module.exports = function withSmsReader(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const androidManifest = manifestConfig.modResults.manifest;
    const permissions = androidManifest["uses-permission"] ?? [];
    if (!permissions.some((p) => p.$?.["android:name"] === "android.permission.READ_SMS")) {
      permissions.push({ $: { "android:name": "android.permission.READ_SMS" } });
      androidManifest["uses-permission"] = permissions;
    }
    return manifestConfig;
  });

  config = withDangerousMod(config, ["android", (modConfig) => {
    const projectRoot = modConfig.modRequest.platformProjectRoot;

    fs.mkdirSync(path.join(projectRoot, ...SMS_READER_PATH.slice(0, -1)), { recursive: true });
    fs.writeFileSync(path.join(projectRoot, ...SMS_READER_PATH), SMS_READER_KT);

    const mainAppPath = path.join(projectRoot, ...MAIN_APPLICATION_PATH);
    let mainApp = fs.readFileSync(mainAppPath, "utf8");
    if (!mainApp.includes("SmsReaderPackage")) {
      mainApp = mainApp.replace(
        "              // add(MyReactNativePackage())",
        "              add(SmsReaderPackage())"
      );
      fs.writeFileSync(mainAppPath, mainApp);
    }

    return modConfig;
  }]);

  return config;
};