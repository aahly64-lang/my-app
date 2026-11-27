package expo.modules.geoalarm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Color
import android.graphics.Matrix
import android.graphics.pdf.PdfRenderer
import android.media.ExifInterface
import android.net.Uri
import android.provider.DocumentsContract
import java.io.File
import java.io.FileOutputStream
import java.security.MessageDigest

/** In-app preview (PDF pages, large images) and duplicate-file detection (documents stage C). */
object DocsPreview {
  private fun previewDir(ctx: Context) = File(ctx.cacheDir, "preview").apply { mkdirs() }

  /** Last-modified time + size of a document, so a cached preview is redrawn after the file changes (rotate, add pages). */
  private fun fileStamp(ctx: Context, uriStr: String): String = try {
    ctx.contentResolver.query(
      Uri.parse(uriStr),
      arrayOf(DocumentsContract.Document.COLUMN_LAST_MODIFIED, DocumentsContract.Document.COLUMN_SIZE),
      null, null, null
    )?.use { c -> if (c.moveToFirst()) "${if (c.isNull(0)) 0 else c.getLong(0)}_${if (c.isNull(1)) 0 else c.getLong(1)}" else "" } ?: ""
  } catch (e: Exception) {
    ""
  }

  /** Number of pages in a PDF, or -1 when it can't be opened (e.g. password protected). */
  fun pdfPageCount(ctx: Context, uriStr: String): Int {
    return try {
      ctx.contentResolver.openFileDescriptor(Uri.parse(uriStr), "r")?.use { pfd ->
        PdfRenderer(pfd).use { it.pageCount }
      } ?: -1
    } catch (e: Exception) {
      -1
    }
  }

  /** Renders one PDF page (0-based) to a cached JPEG, widthPx wide. Returns {uri, width, height} or null. */
  fun renderPdfPage(ctx: Context, uriStr: String, page: Int, widthPx: Int, stamp: Long): Map<String, Any?>? {
    val w = widthPx.coerceIn(200, 2600)
    val key = (uriStr + "|" + stamp + "|" + fileStamp(ctx, uriStr) + "|" + page + "|" + w).hashCode().toUInt().toString(16)
    val out = File(previewDir(ctx), "p_$key.jpg")
    if (out.exists() && out.length() > 0) {
      val b = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(out.absolutePath, b)
      return mapOf("uri" to "file://" + out.absolutePath, "width" to b.outWidth, "height" to b.outHeight)
    }
    return try {
      ctx.contentResolver.openFileDescriptor(Uri.parse(uriStr), "r")?.use { pfd ->
        PdfRenderer(pfd).use { renderer ->
          if (page < 0 || page >= renderer.pageCount) return null
          renderer.openPage(page).use { p ->
            val scale = w.toFloat() / p.width
            val h = maxOf(1, (p.height * scale).toInt())
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(Color.WHITE)
            p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_DISPLAY)
            FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 88, it) }
            bmp.recycle()
            mapOf("uri" to "file://" + out.absolutePath, "width" to w, "height" to h)
          }
        }
      }
    } catch (e: Exception) {
      out.delete()
      null
    }
  }

  /** A picture shrunk to at most maxPx on its long side and turned upright (camera photos). */
  fun previewImage(ctx: Context, uriStr: String, maxPx: Int, stamp: Long): Map<String, Any?>? {
    val uri = Uri.parse(uriStr)
    val key = (uriStr + "|" + stamp + "|" + fileStamp(ctx, uriStr) + "|" + maxPx).hashCode().toUInt().toString(16)
    val out = File(previewDir(ctx), "i_$key.jpg")
    if (out.exists() && out.length() > 0) {
      val b = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(out.absolutePath, b)
      return mapOf("uri" to "file://" + out.absolutePath, "width" to b.outWidth, "height" to b.outHeight)
    }
    return try {
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
      var sample = 1
      while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxPx) sample *= 2
      val opts = BitmapFactory.Options().apply { inSampleSize = sample }
      var bmp = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
      val rotate = try {
        ctx.contentResolver.openInputStream(uri)?.use {
          when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
            ExifInterface.ORIENTATION_ROTATE_90 -> 90f
            ExifInterface.ORIENTATION_ROTATE_180 -> 180f
            ExifInterface.ORIENTATION_ROTATE_270 -> 270f
            else -> 0f
          }
        } ?: 0f
      } catch (e: Exception) {
        0f
      }
      val long = maxOf(bmp.width, bmp.height)
      if (rotate != 0f || long > maxPx) {
        val m = Matrix()
        if (long > maxPx) m.postScale(maxPx.toFloat() / long, maxPx.toFloat() / long)
        if (rotate != 0f) m.postRotate(rotate)
        val r = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
        if (r != bmp) bmp.recycle()
        bmp = r
      }
      FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 90, it) }
      val res = mapOf("uri" to "file://" + out.absolutePath, "width" to bmp.width, "height" to bmp.height)
      bmp.recycle()
      res
    } catch (e: Exception) {
      out.delete()
      null
    }
  }

  // ---------------------------------------------------------------- duplicates

  private data class Found(
    val key: String, // authority + document id: the same file reached through two connected folders counts once
    val uri: String,
    val name: String,
    val mime: String,
    val size: Long,
    val modified: Long,
    val folder: String,
    val root: String
  )

  private fun md5(ctx: Context, uri: String): String? {
    return try {
      val md = MessageDigest.getInstance("MD5")
      val ins = ctx.contentResolver.openInputStream(Uri.parse(uri)) ?: return null
      ins.use {
        val buf = ByteArray(64 * 1024)
        while (true) {
          val n = it.read(buf)
          if (n < 0) break
          md.update(buf, 0, n)
        }
      }
      md.digest().joinToString("") { b -> "%02x".format(b) }
    } catch (e: Exception) {
      null
    }
  }

  /**
   * Walks all connected folders and returns groups of files with exactly the same content
   * (same size first, then the same MD5). Each group has 2 or more files.
   */
  fun findDuplicates(ctx: Context, roots: List<String>): List<List<Map<String, Any?>>> {
    val cols = arrayOf(
      DocumentsContract.Document.COLUMN_DOCUMENT_ID,
      DocumentsContract.Document.COLUMN_DISPLAY_NAME,
      DocumentsContract.Document.COLUMN_MIME_TYPE,
      DocumentsContract.Document.COLUMN_SIZE,
      DocumentsContract.Document.COLUMN_LAST_MODIFIED
    )
    val seen = HashSet<String>()
    val files = ArrayList<Found>()
    for (root in roots) {
      val tree = try { Uri.parse(root) } catch (e: Exception) { continue }
      val rootName = try { DocumentsHelper.name(ctx, root) } catch (e: Exception) { "תיקייה" }
      val startId = try {
        val seg = tree.pathSegments
        if (seg.size >= 4 && seg[0] == "tree" && seg[2] == "document") DocumentsContract.getDocumentId(tree)
        else DocumentsContract.getTreeDocumentId(tree)
      } catch (e: Exception) { continue }
      val queue = ArrayDeque<Triple<String, String, Int>>()
      queue.add(Triple(startId, rootName, 0))
      var visited = 0
      while (queue.isNotEmpty() && visited < 4000 && files.size < 20000) {
        val (docId, folderPath, depth) = queue.removeFirst()
        visited++
        try {
          ctx.contentResolver.query(DocumentsContract.buildChildDocumentsUriUsingTree(tree, docId), cols, null, null, null)?.use { c ->
            while (c.moveToNext()) {
              val id = c.getString(0) ?: continue
              val nm = c.getString(1) ?: id
              if (nm.startsWith(".")) continue
              val mime = c.getString(2) ?: "application/octet-stream"
              if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                if (depth < 8) queue.add(Triple(id, "$folderPath › $nm", depth + 1))
                continue
              }
              val size = if (c.isNull(3)) 0L else c.getLong(3)
              if (size <= 0) continue
              val key = (tree.authority ?: "") + "|" + id
              if (!seen.add(key)) continue
              files.add(
                Found(
                  key,
                  DocumentsContract.buildDocumentUriUsingTree(tree, id).toString(),
                  nm,
                  mime,
                  size,
                  if (c.isNull(4)) 0L else c.getLong(4),
                  folderPath,
                  root
                )
              )
            }
          }
        } catch (e: Exception) {
          // skip folders we can't read
        }
      }
    }
    val groups = ArrayList<List<Map<String, Any?>>>()
    for ((_, sameSize) in files.groupBy { it.size }) {
      if (sameSize.size < 2) continue
      val byHash = HashMap<String, ArrayList<Found>>()
      for (f in sameSize) {
        val h = md5(ctx, f.uri) ?: continue
        byHash.getOrPut(h) { ArrayList() }.add(f)
      }
      for ((_, g) in byHash) {
        if (g.size < 2) continue
        groups.add(
          g.sortedBy { it.modified }.map {
            mapOf(
              "uri" to it.uri,
              "name" to it.name,
              "mime" to it.mime,
              "isDir" to false,
              "size" to it.size.toDouble(),
              "modified" to it.modified.toDouble(),
              "folder" to it.folder,
              "treeUri" to it.root
            )
          }
        )
      }
    }
    return groups.sortedByDescending { (it.firstOrNull()?.get("size") as? Double ?: 0.0) * (it.size - 1) }
  }
}
