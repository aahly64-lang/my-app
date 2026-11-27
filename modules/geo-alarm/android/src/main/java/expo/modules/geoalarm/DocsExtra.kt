package expo.modules.geoalarm

import android.content.Context
import android.net.ConnectivityManager
import android.net.Uri
import android.provider.DocumentsContract
import android.provider.OpenableColumns
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.AccessPermission
import com.tom_roush.pdfbox.pdmodel.encryption.StandardProtectionPolicy
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URL

/** Recycle bin, Google Drive file upload, password-protected PDF (documents stage B). */
object DocsExtra {
  // ---------------------------------------------------------------- recycle bin

  /** Copies any uri (content:// or file://) into a local file. Returns the number of bytes, or -1. */
  fun copyToFile(ctx: Context, src: String, dest: String): Double {
    return try {
      val path = if (dest.startsWith("file:")) Uri.parse(dest).path ?: return -1.0 else dest
      val f = File(path)
      f.parentFile?.mkdirs()
      var n = 0L
      val input = ctx.contentResolver.openInputStream(Uri.parse(src)) ?: return -1.0
      input.use { inp -> FileOutputStream(f).use { out -> n = inp.copyTo(out) } }
      n.toDouble()
    } catch (e: Exception) {
      -1.0
    }
  }

  /**
   * The folder a document sits in, as a folder uri (tree/<root>/document/<parent id>) usable like any
   * folder uri. Falls back to the connected root folder. Null when the uri isn't a folder document.
   */
  fun parentFolder(uriStr: String): String? {
    return try {
      val uri = Uri.parse(uriStr)
      val treeId = DocumentsContract.getTreeDocumentId(uri)
      val docId = DocumentsContract.getDocumentId(uri)
      val cut = docId.lastIndexOf('/')
      val parentId = if (cut > 0 && docId.substring(0, cut).length >= treeId.length) docId.substring(0, cut) else treeId
      DocumentsContract.buildDocumentUriUsingTree(uri, parentId).toString()
    } catch (e: Exception) {
      null
    }
  }

  // ---------------------------------------------------------------- Google Drive

  /** True on Wi-Fi (or any other network that isn't metered). */
  fun isUnmetered(ctx: Context): Boolean {
    return try {
      val cm = ctx.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
      cm.activeNetwork != null && !cm.isActiveNetworkMetered
    } catch (e: Exception) {
      false
    }
  }

  private fun sizeOf(ctx: Context, uri: Uri): Long {
    try {
      ctx.contentResolver.query(uri, arrayOf(OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst() && !c.isNull(0)) return c.getLong(0)
      }
    } catch (e: Exception) {
    }
    return -1
  }

  /**
   * Sends the file's bytes to a Drive resumable-upload session (PUT, streamed from the file).
   * Returns {status, body}; status 0 = network / read error (body holds the message).
   */
  fun uploadToSession(ctx: Context, src: String, sessionUrl: String, mime: String): Map<String, Any?> {
    var conn: HttpURLConnection? = null
    return try {
      val uri = Uri.parse(src)
      val size = sizeOf(ctx, uri)
      val c = (URL(sessionUrl).openConnection() as HttpURLConnection).apply {
        requestMethod = "PUT"
        doOutput = true
        connectTimeout = 30_000
        readTimeout = 120_000
        setRequestProperty("Content-Type", mime.ifBlank { "application/octet-stream" })
        if (size >= 0) setFixedLengthStreamingMode(size) else setChunkedStreamingMode(256 * 1024)
      }
      conn = c
      val input = ctx.contentResolver.openInputStream(uri) ?: return mapOf("status" to 0, "body" to "אין קריאה מהקובץ")
      input.use { inp -> c.outputStream.use { out -> inp.copyTo(out, 64 * 1024) } }
      val code = c.responseCode
      val body = try {
        (if (code in 200..299) c.inputStream else c.errorStream)?.bufferedReader()?.use { it.readText() } ?: ""
      } catch (e: Exception) {
        ""
      }
      mapOf("status" to code, "body" to body)
    } catch (e: Exception) {
      mapOf("status" to 0, "body" to (e.javaClass.simpleName + ": " + (e.message ?: "")))
    } finally {
      try { conn?.disconnect() } catch (ignored: Exception) {}
    }
  }

  // ---------------------------------------------------------------- password-protected PDF

  /**
   * Writes a copy of the PDF protected with [password] (AES) into the cache and returns its file:// uri.
   * The original document is not changed. Null on failure.
   */
  fun protectPdf(ctx: Context, src: String, password: String, fileName: String): String? {
    return try {
      PDFBoxResourceLoader.init(ctx.applicationContext)
      val dir = File(ctx.cacheDir, "protected")
      dir.deleteRecursively()
      dir.mkdirs()
      val safe = fileName.replace(Regex("[\\\\/:*?\"<>|]"), "_").ifBlank { "document.pdf" }
      val out = File(dir, if (safe.lowercase().endsWith(".pdf")) safe else "$safe.pdf")
      val input = ctx.contentResolver.openInputStream(Uri.parse(src)) ?: return null
      input.use { inp ->
        PDDocument.load(inp).use { doc ->
          // owner password = the same one, so whoever knows it can also print / copy
          val policy = StandardProtectionPolicy(password, password, AccessPermission())
          policy.encryptionKeyLength = 128
          doc.protect(policy)
          doc.save(out)
        }
      }
      "file://" + out.absolutePath
    } catch (e: Throwable) {
      null
    }
  }
}
