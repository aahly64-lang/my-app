package expo.modules.geoalarm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.googlecode.tesseract.android.TessBaseAPI
import java.io.File
import java.io.FileOutputStream

/**
 * Reading the text of a scan on the phone itself (Tesseract, Hebrew + English, nothing leaves the phone).
 * The language files ship in the APK (assets/tessdata) and are copied once to the app's files.
 */
object DocsOcr {
  private val lock = Any()

  private fun dataPath(ctx: Context): String? {
    val root = File(ctx.filesDir, "tesseract")
    val dir = File(root, "tessdata").apply { mkdirs() }
    for (lang in listOf("heb", "eng")) {
      val f = File(dir, "$lang.traineddata")
      if (f.exists() && f.length() > 0) continue
      try {
        val tmp = File(dir, "$lang.tmp")
        ctx.assets.open("tessdata/$lang.traineddata").use { input -> FileOutputStream(tmp).use { input.copyTo(it) } }
        tmp.renameTo(f)
      } catch (e: Exception) {
        return null
      }
    }
    return root.absolutePath
  }

  private fun gray(b: Bitmap): Bitmap {
    val out = Bitmap.createBitmap(b.width, b.height, Bitmap.Config.ARGB_8888)
    out.eraseColor(Color.WHITE)
    val p = Paint().apply { colorFilter = ColorMatrixColorFilter(ColorMatrix().apply { setSaturation(0f) }) }
    Canvas(out).drawBitmap(b, 0f, 0f, p)
    return out
  }

  /** The pages to read, as bitmaps about 2000px on the long side. */
  private fun pages(ctx: Context, uriStr: String, mime: String, maxPages: Int): List<Bitmap> {
    val uri = Uri.parse(uriStr)
    if (mime.startsWith("image/")) return listOfNotNull(ScanEnhancer.loadImage(ctx, uri, 2200))
    if (!mime.contains("pdf")) return emptyList()
    val tmp = File(ctx.cacheDir, "ocr-${System.currentTimeMillis()}.pdf")
    val out = ArrayList<Bitmap>()
    try {
      ctx.contentResolver.openInputStream(uri)?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } } ?: return out
      ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
        PdfRenderer(pfd).use { r ->
          for (i in 0 until minOf(maxPages, r.pageCount)) {
            r.openPage(i).use { p ->
              val scale = 2200f / maxOf(p.width, p.height)
              val bmp = Bitmap.createBitmap((p.width * scale).toInt().coerceAtLeast(1), (p.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
              bmp.eraseColor(Color.WHITE)
              p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
              out.add(bmp)
            }
          }
        }
      }
    } catch (e: Exception) {
      // unreadable / password protected
    } finally {
      tmp.delete()
    }
    return out
  }

  /** Text of the first [maxPages] pages of a PDF or a picture; null when it can't be read. */
  fun read(ctx: Context, uriStr: String, mime: String, maxPages: Int): String? {
    val path = dataPath(ctx) ?: return null
    val bitmaps = pages(ctx, uriStr, mime, maxPages.coerceIn(1, 10))
    if (bitmaps.isEmpty()) return null
    synchronized(lock) {
      val tess = TessBaseAPI()
      try {
        if (!tess.init(path, "heb+eng")) return null
        val sb = StringBuilder()
        for (b in bitmaps) {
          val g = gray(b)
          b.recycle()
          tess.setImage(g)
          sb.append(tess.getUTF8Text() ?: "").append("\n")
          tess.clear()
          g.recycle()
        }
        return sb.toString()
      } catch (e: Throwable) {
        return null
      } finally {
        tess.recycle()
      }
    }
  }
}
