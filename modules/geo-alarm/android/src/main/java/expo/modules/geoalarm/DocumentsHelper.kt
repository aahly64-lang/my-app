package expo.modules.geoalarm

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.provider.DocumentsContract

/** Lists and opens files inside folders the user granted through the system folder picker. */
object DocumentsHelper {
  private fun rootDocId(ctx: Context, uri: Uri): String {
    return if (DocumentsContract.isDocumentUri(ctx, uri)) DocumentsContract.getDocumentId(uri)
    else DocumentsContract.getTreeDocumentId(uri)
  }

  fun list(ctx: Context, uriStr: String): List<Map<String, Any?>> {
    val uri = Uri.parse(uriStr)
    val parentId = rootDocId(ctx, uri)
    val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(uri, parentId)
    val cols = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    val out = ArrayList<Map<String, Any?>>()
    ctx.contentResolver.query(childrenUri, cols, null, null, null)?.use { c ->
      while (c.moveToNext()) {
        val id = c.getString(0) ?: continue
        val mime = c.getString(2) ?: "application/octet-stream"
        out.add(
          mapOf(
            "uri" to DocumentsContract.buildDocumentUriUsingTree(uri, id).toString(),
            "name" to (c.getString(1) ?: id),
            "mime" to mime,
            "isDir" to (mime == DocumentsContract.Document.MIME_TYPE_DIR),
            "size" to (if (c.isNull(3)) 0.0 else c.getLong(3).toDouble()),
            "modified" to (if (c.isNull(4)) 0.0 else c.getLong(4).toDouble())
          )
        )
      }
    }
    return out
  }

  fun name(ctx: Context, uriStr: String): String {
    val uri = Uri.parse(uriStr)
    val docUri = DocumentsContract.buildDocumentUriUsingTree(uri, rootDocId(ctx, uri))
    ctx.contentResolver.query(docUri, arrayOf(DocumentsContract.Document.COLUMN_DISPLAY_NAME), null, null, null)?.use { c ->
      if (c.moveToFirst()) return c.getString(0) ?: "תיקייה"
    }
    return "תיקייה"
  }

  fun open(ctx: Context, uriStr: String, mime: String): Boolean {
    return try {
      val intent = Intent(Intent.ACTION_VIEW).apply {
        setDataAndType(Uri.parse(uriStr), mime)
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
      }
      ctx.startActivity(Intent.createChooser(intent, "פתח באמצעות").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      false
    }
  }

  fun share(ctx: Context, uriStr: String, mime: String): Boolean {
    return try {
      val intent = Intent(Intent.ACTION_SEND).apply {
        type = mime
        putExtra(Intent.EXTRA_STREAM, Uri.parse(uriStr))
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      ctx.startActivity(Intent.createChooser(intent, "שיתוף").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      false
    }
  }

  fun release(ctx: Context, uriStr: String) {
    try {
      ctx.contentResolver.releasePersistableUriPermission(
        Uri.parse(uriStr),
        Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
      )
    } catch (e: Exception) {
    }
  }
}
