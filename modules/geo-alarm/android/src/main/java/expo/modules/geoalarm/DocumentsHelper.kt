package expo.modules.geoalarm

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Point
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.provider.DocumentsContract
import java.io.File
import java.io.FileOutputStream

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

  // ---------------------------------------------------------------- search

  /** Searches file names in all the connected folders and their sub-folders. */
  fun search(ctx: Context, roots: List<String>, query: String, limit: Int): List<Map<String, Any?>> {
    val q = query.trim().lowercase()
    val out = ArrayList<Map<String, Any?>>()
    if (q.isEmpty()) return out
    val cols = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    for (root in roots) {
      val tree = try { Uri.parse(root) } catch (e: Exception) { continue }
      val rootName = try { name(ctx, root) } catch (e: Exception) { "תיקייה" }
      // queue of (documentId, folder path for display, depth)
      val queue = ArrayDeque<Triple<String, String, Int>>()
      try { queue.add(Triple(rootDocId(ctx, tree), rootName, 0)) } catch (e: Exception) { continue }
      var visited = 0
      while (queue.isNotEmpty() && out.size < limit && visited < 4000) {
        val (docId, folderPath, depth) = queue.removeFirst()
        visited++
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId)
        try {
          ctx.contentResolver.query(childrenUri, cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
              val id = c.getString(0) ?: continue
              val nm = c.getString(1) ?: id
              if (nm.startsWith(".")) continue
              val mime = c.getString(2) ?: "application/octet-stream"
              val isDir = mime == DocumentsContract.Document.MIME_TYPE_DIR
              if (isDir && depth < 8) queue.add(Triple(id, "$folderPath › $nm", depth + 1))
              if (nm.lowercase().contains(q) && out.size < limit) {
                out.add(
                  mapOf(
                    "uri" to DocumentsContract.buildDocumentUriUsingTree(tree, id).toString(),
                    "name" to nm,
                    "mime" to mime,
                    "isDir" to isDir,
                    "size" to (if (c.isNull(3)) 0.0 else c.getLong(3).toDouble()),
                    "modified" to (if (c.isNull(4)) 0.0 else c.getLong(4).toDouble()),
                    "folder" to folderPath,
                    "treeUri" to root
                  )
                )
              }
            }
          }
        } catch (e: Exception) {
          // skip folders we can't read
        }
      }
    }
    return out
  }

  // ---------------------------------------------------------------- thumbnails

  /** Small preview picture for images and PDFs; returns a file:// path or null. */
  fun thumbnail(ctx: Context, uriStr: String, mime: String, sizePx: Int, stamp: Long): String? {
    val dir = File(ctx.cacheDir, "thumbs").apply { mkdirs() }
    val key = (uriStr + "|" + stamp + "|" + sizePx).hashCode().toUInt().toString(16)
    val out = File(dir, "$key.jpg")
    if (out.exists() && out.length() > 0) return "file://" + out.absolutePath
    val uri = Uri.parse(uriStr)
    val bmp: Bitmap? = try {
      when {
        mime.startsWith("image/") -> imageThumb(ctx, uri, sizePx)
        mime.contains("pdf") -> pdfThumb(ctx, uri, sizePx)
        else -> null
      }
    } catch (e: Exception) {
      null
    }
    if (bmp == null) return null
    FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 82, it) }
    bmp.recycle()
    return "file://" + out.absolutePath
  }

  private fun imageThumb(ctx: Context, uri: Uri, size: Int): Bitmap? {
    try {
      val t = DocumentsContract.getDocumentThumbnail(ctx.contentResolver, uri, Point(size, size), null)
      if (t != null) return t
    } catch (e: Exception) {
    }
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    var sample = 1
    while (bounds.outWidth / (sample * 2) >= size && bounds.outHeight / (sample * 2) >= size) sample *= 2
    val opts = BitmapFactory.Options().apply { inSampleSize = sample }
    return ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) }
  }

  private fun pdfThumb(ctx: Context, uri: Uri, size: Int): Bitmap? {
    val pfd = ctx.contentResolver.openFileDescriptor(uri, "r") ?: return null
    var renderer: PdfRenderer? = null
    var page: PdfRenderer.Page? = null
    try {
      renderer = PdfRenderer(pfd)
      if (renderer.pageCount == 0) return null
      page = renderer.openPage(0)
      val scale = size.toFloat() / maxOf(page.width, page.height)
      val w = maxOf(1, (page.width * scale).toInt())
      val h = maxOf(1, (page.height * scale).toInt())
      val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
      bmp.eraseColor(Color.WHITE)
      page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
      return bmp
    } finally {
      try { page?.close() } catch (_: Exception) {}
      try { renderer?.close() } catch (_: Exception) {}
      try { pfd.close() } catch (_: Exception) {}
    }
  }

  // ---------------------------------------------------------------- file actions

  fun rename(ctx: Context, uriStr: String, newName: String): String? {
    return try {
      DocumentsContract.renameDocument(ctx.contentResolver, Uri.parse(uriStr), newName)?.toString() ?: uriStr
    } catch (e: Exception) {
      null
    }
  }

  fun delete(ctx: Context, uriStr: String): Boolean {
    return try {
      DocumentsContract.deleteDocument(ctx.contentResolver, Uri.parse(uriStr))
    } catch (e: Exception) {
      false
    }
  }

  fun shareMany(ctx: Context, uris: List<String>, mimes: List<String>): Boolean {
    if (uris.isEmpty()) return false
    if (uris.size == 1) return share(ctx, uris[0], mimes.getOrElse(0) { "*/*" })
    return try {
      val list = ArrayList(uris.map { Uri.parse(it) })
      val type = mimes.distinct().let { if (it.size == 1) it[0] else "*/*" }
      val intent = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        this.type = type
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, list)
        val clip = ClipData.newRawUri("", list[0])
        for (i in 1 until list.size) clip.addItem(ClipData.Item(list[i]))
        clipData = clip
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      ctx.startActivity(Intent.createChooser(intent, "שיתוף").addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    } catch (e: Exception) {
      false
    }
  }

  /** Copies a file (e.g. a scanned PDF) into a connected folder. Returns the new document uri. */
  fun copyInto(ctx: Context, srcUri: String, treeUri: String, fileName: String, mime: String): String? {
    return try {
      val tree = Uri.parse(treeUri)
      val parent = DocumentsContract.buildDocumentUriUsingTree(tree, rootDocId(ctx, tree))
      val created = DocumentsContract.createDocument(ctx.contentResolver, parent, mime, fileName) ?: return null
      ctx.contentResolver.openOutputStream(created)?.use { out ->
        ctx.contentResolver.openInputStream(Uri.parse(srcUri))?.use { it.copyTo(out) }
      }
      created.toString()
    } catch (e: Exception) {
      null
    }
  }
}
