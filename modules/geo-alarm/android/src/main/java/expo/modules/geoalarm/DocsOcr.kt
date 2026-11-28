package expo.modules.geoalarm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
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

  /**
   * Google's scanner sometimes turns Hebrew pages upside down (it reads Hebrew as upside-down Latin).
   * Each page is read twice by our Hebrew reader, as it is and turned 180°, on a band across the middle
   * of the page; a page that reads clearly better turned is set right. Returns the new file's uri and how
   * many pages were turned, or null when nothing needed turning (or the check couldn't run).
   */
  fun upright(ctx: Context, uriStr: String): Map<String, Any?>? {
    val path = dataPath(ctx) ?: return null
    val tmp = File(ctx.cacheDir, "upr-${System.currentTimeMillis()}.pdf")
    val turn = ArrayList<Int>()
    try {
      ctx.contentResolver.openInputStream(Uri.parse(uriStr))?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } } ?: return null
      synchronized(lock) {
        val tess = TessBaseAPI()
        try {
          if (!tess.init(path, "heb")) return null
          ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
            PdfRenderer(pfd).use { r ->
              val rotations = ScanEnhancer.pageRotations(tmp, r.pageCount) ?: IntArray(r.pageCount)
              for (i in 0 until minOf(r.pageCount, 30)) {
                val band = r.openPage(i).use { p -> middleBand(p, rotations[i]) }
                val flipped = Bitmap.createBitmap(band, 0, 0, band.width, band.height, Matrix().apply { postRotate(180f) }, true)
                val asIs = confidence(tess, band)
                val turned = confidence(tess, flipped)
                band.recycle()
                flipped.recycle()
                turn.add(if (turned >= 45 && turned - asIs >= 15) 180 else 0)
              }
            }
          }
        } finally {
          tess.recycle()
        }
      }
    } catch (e: Throwable) {
      return null
    } finally {
      tmp.delete()
    }
    val count = turn.count { it != 0 }
    if (count == 0) return null
    val out = ScanEnhancer.rotatePages(ctx, uriStr, turn) ?: return null
    return mapOf("uri" to out, "turned" to count)
  }

  /** The page (with its /Rotate applied), about 1800px on the long side, gray, cut to the middle half. */
  private fun middleBand(p: PdfRenderer.Page, rotate: Int): Bitmap {
    val scale = 1800f / maxOf(p.width, p.height)
    val w = (p.width * scale).toInt().coerceAtLeast(1)
    val h = (p.height * scale).toInt().coerceAtLeast(1)
    val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
    bmp.eraseColor(Color.WHITE)
    p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
    val deg = ((rotate % 360) + 360) % 360
    val page = if (deg == 0) bmp else Bitmap.createBitmap(bmp, 0, 0, w, h, Matrix().apply { postRotate(deg.toFloat()) }, true)
    if (page !== bmp) bmp.recycle()
    val top = page.height / 4
    val cut = Bitmap.createBitmap(page, 0, top, page.width, (page.height / 2).coerceAtLeast(1))
    if (cut !== page) page.recycle()
    val g = gray(cut)
    cut.recycle()
    return g
  }

  private fun confidence(tess: TessBaseAPI, b: Bitmap): Int {
    tess.setImage(b)
    val text = tess.getUTF8Text() ?: ""
    val c = if (text.isBlank()) 0 else tess.meanConfidence()
    tess.clear()
    return c
  }
}
