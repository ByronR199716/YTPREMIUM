package expo.modules.noutubeview

import android.content.Context
import android.content.Intent
import android.content.pm.PackageInfo
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/** FileProvider propio para entregar el APK descargado al instalador del sistema. */
class NouUpdateFileProvider : FileProvider()

/**
 * YTPremium: aviso de nueva versión.
 * Descarga el APK publicado en el panel (Servicios > Actualizaciones de las apps),
 * comprueba que sea esta misma app y más nueva, y abre el instalador de Android.
 *
 * Ojo con los números: cada APK por arquitectura lleva versionCode = 100 * (100 + N) + abi
 * (ver plugins/withAndroidPlugin.ts), mientras que el panel guarda 100 + N.
 * Por eso aquí siempre se compara la "versión base" = versionCode / 100.
 */
object NouAppUpdate {
  private const val FILE_NAME = "update.apk"

  fun baseVersion(versionCode: Long): Long = if (versionCode >= 10_000) versionCode / 100 else versionCode

  @Suppress("DEPRECATION")
  private fun versionCodeOf(info: PackageInfo): Long =
    if (Build.VERSION.SDK_INT >= 28) info.longVersionCode else info.versionCode.toLong()

  fun installedVersionCode(context: Context): Long =
    versionCodeOf(context.packageManager.getPackageInfo(context.packageName, 0))

  fun primaryAbi(): String = Build.SUPPORTED_ABIS.firstOrNull().orEmpty()

  private fun updateFile(context: Context): File = File(File(context.cacheDir, "updates"), FILE_NAME)

  /** Descarga a cacheDir/updates/update.apk siguiendo redirecciones (GitHub manda a otro dominio). */
  fun download(context: Context, url: String, onProgress: (Double) -> Unit): Map<String, Any> {
    val dir = File(context.cacheDir, "updates").apply { mkdirs() }
    val tmp = File(dir, "$FILE_NAME.part")
    val target = updateFile(context)
    tmp.delete()
    target.delete()

    var current = URL(url)
    var connection: HttpURLConnection? = null
    for (i in 0 until 8) {
      val proxy = NouProxy.javaProxy()
      val c = (if (proxy != null) current.openConnection(proxy) else current.openConnection()) as HttpURLConnection
      c.instanceFollowRedirects = false
      c.connectTimeout = 15_000
      c.readTimeout = 30_000
      c.setRequestProperty("User-Agent", "YTPremium-updater")
      val code = c.responseCode
      if (code in 300..399) {
        val location = c.getHeaderField("Location") ?: throw Exception("Redirección sin destino")
        c.disconnect()
        current = URL(current, location)
        continue
      }
      if (code !in 200..299) {
        c.disconnect()
        throw Exception("HTTP $code")
      }
      connection = c
      break
    }
    val conn = connection ?: throw Exception("Demasiadas redirecciones")

    try {
      val total = conn.contentLengthLong
      var done = 0L
      var lastSent = -1
      conn.inputStream.use { input ->
        tmp.outputStream().use { output ->
          val buffer = ByteArray(64 * 1024)
          while (true) {
            val n = input.read(buffer)
            if (n < 0) break
            output.write(buffer, 0, n)
            done += n
            if (total > 0) {
              val pct = (done * 100 / total).toInt()
              if (pct != lastSent) {
                lastSent = pct
                onProgress(pct / 100.0)
              }
            }
          }
        }
      }
    } finally {
      conn.disconnect()
    }

    // Comprobar que el archivo es esta misma app y más nueva antes de ofrecer instalarla.
    val pm = context.packageManager
    val info = pm.getPackageArchiveInfo(tmp.absolutePath, 0)
    if (info == null) {
      tmp.delete()
      throw Exception("El archivo descargado no es un APK válido")
    }
    if (info.packageName != context.packageName) {
      tmp.delete()
      throw Exception("El APK no corresponde a esta app")
    }
    val newCode = versionCodeOf(info)
    val installed = installedVersionCode(context)
    if (baseVersion(newCode) <= baseVersion(installed)) {
      tmp.delete()
      throw Exception("El APK descargado no es más nuevo que el instalado")
    }
    if (!tmp.renameTo(target)) {
      tmp.delete()
      throw Exception("No se pudo guardar la actualización")
    }
    return mapOf("versionCode" to newCode, "size" to target.length())
  }

  fun canInstall(context: Context): Boolean =
    Build.VERSION.SDK_INT < 26 || context.packageManager.canRequestPackageInstalls()

  fun openInstallPermission(context: Context) {
    val intent = if (Build.VERSION.SDK_INT >= 26) {
      Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:${context.packageName}"))
    } else {
      Intent(Settings.ACTION_SECURITY_SETTINGS)
    }
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
  }

  fun install(context: Context) {
    val file = updateFile(context)
    if (!file.exists()) throw Exception("Primero hay que descargar la actualización")
    val uri = FileProvider.getUriForFile(context, "${context.packageName}.ytupdate", file)
    val intent = Intent(Intent.ACTION_VIEW).apply {
      setDataAndType(uri, "application/vnd.android.package-archive")
      addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
    }
    context.startActivity(intent)
  }

  /** Borra un APK viejo que haya quedado de una actualización ya instalada. */
  fun cleanup(context: Context) {
    File(context.cacheDir, "updates").listFiles()?.forEach { it.delete() }
  }

}
