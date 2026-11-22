package expo.modules.geoalarm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.pdf.PdfDocument
import android.net.Uri
import java.io.File
import java.io.FileOutputStream

/**
 * Cleans every scanned page the same way (the scanner's own filter is easy to apply to one page only):
 * stretches the levels so the paper turns white and the ink dark, with a little extra contrast,
 * then builds a new PDF from the cleaned pages.
 */
object ScanEnhancer {
  private const val MAX_SIDE = 1800

  /** Returns a file uri of the new PDF, or null if anything failed (the caller keeps the original). */
  fun enhance(ctx: Context, pages: List<Uri>): String? {
    if (pages.isEmpty()) return null
    val doc = PdfDocument()
    try {
      pages.forEachIndexed { i, uri ->
        val src = decode(ctx, uri) ?: return null
        val clean = levels(src)
        if (clean !== src) src.recycle()
        // Page size in points: keep the aspect, A4-ish width.
        val wPt = 595
        val hPt = (clean.height.toFloat() / clean.width * wPt).toInt().coerceAtLeast(1)
        val page = doc.startPage(PdfDocument.PageInfo.Builder(wPt, hPt, i + 1).create())
        val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
        page.canvas.drawBitmap(clean, null, Rect(0, 0, wPt, hPt), paint)
        doc.finishPage(page)
        clean.recycle()
      }
      val out = File(ctx.cacheDir, "scan-${System.currentTimeMillis()}.pdf")
      FileOutputStream(out).use { doc.writeTo(it) }
      return Uri.fromFile(out).toString()
    } catch (e: Throwable) {
      return null
    } finally {
      doc.close()
    }
  }

  private fun decode(ctx: Context, uri: Uri): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2
    val opts = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    val bmp = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
    val side = maxOf(bmp.width, bmp.height)
    if (side <= MAX_SIDE) return bmp
    val scale = MAX_SIDE.toFloat() / side
    val scaled = Bitmap.createScaledBitmap(bmp, (bmp.width * scale).toInt(), (bmp.height * scale).toInt(), true)
    if (scaled !== bmp) bmp.recycle()
    return scaled
  }

  /** Levels stretch by luminance percentiles (1% dark, 92% light = the paper). */
  private fun levels(src: Bitmap): Bitmap {
    val hist = IntArray(256)
    val step = maxOf(1, (src.width * src.height / 60000))
    val w = src.width
    val total = src.width * src.height
    val row = IntArray(w)
    var count = 0
    var y = 0
    while (y < src.height) {
      src.getPixels(row, 0, w, 0, y, w, 1)
      var x = (y * 7) % step
      while (x < w) {
        val p = row[x]
        val l = (((p shr 16) and 0xFF) * 299 + ((p shr 8) and 0xFF) * 587 + (p and 0xFF) * 114) / 1000
        hist[l]++
        count++
        x += step
      }
      y += maxOf(1, step / 4 + 1)
    }
    if (count == 0 || total == 0) return src
    fun pct(p: Double): Int {
      val target = (count * p).toInt()
      var acc = 0
      for (i in 0..255) {
        acc += hist[i]
        if (acc >= target) return i
      }
      return 255
    }
    val lo = pct(0.01).coerceAtMost(110)
    val hi = pct(0.92).coerceAtLeast(lo + 60)
    if (lo <= 4 && hi >= 250) return src // already clean
    val scale = 255f / (hi - lo)
    val offset = -lo * scale
    val cm = ColorMatrix(
      floatArrayOf(
        scale, 0f, 0f, 0f, offset,
        0f, scale, 0f, 0f, offset,
        0f, 0f, scale, 0f, offset,
        0f, 0f, 0f, 1f, 0f
      )
    )
    // A touch more saturation so stamps and signatures keep their color after the stretch.
    val sat = ColorMatrix().apply { setSaturation(1.1f) }
    cm.postConcat(sat)
    val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    val paint = Paint().apply { colorFilter = ColorMatrixColorFilter(cm) }
    Canvas(out).drawBitmap(src, 0f, 0f, paint)
    return out
  }
}
