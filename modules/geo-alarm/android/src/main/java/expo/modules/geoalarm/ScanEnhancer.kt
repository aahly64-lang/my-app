package expo.modules.geoalarm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.ColorMatrix
import android.graphics.ColorMatrixColorFilter
import android.graphics.Matrix
import android.graphics.Paint
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.FileOutputStream
import java.io.OutputStream

/**
 * Scanned pages: every page is cleaned the same way (levels stretch so the paper is white and the ink dark),
 * turned upright from its EXIF orientation, and stored as a JPEG inside a small hand-written PDF
 * (DCTDecode), so a page weighs a few hundred KB instead of several MB.
 */
object ScanEnhancer {
  /** maxSide px, JPEG quality */
  private fun preset(quality: String): Pair<Int, Int> = when (quality) {
    "small" -> 1300 to 60
    "high" -> 2300 to 85
    else -> 1700 to 72
  }

  /** Returns a file uri of the new PDF, or null if anything failed (the caller keeps the original). */
  fun enhance(ctx: Context, pages: List<Uri>, quality: String): String? {
    if (pages.isEmpty()) return null
    val (maxSide, q) = preset(quality)
    return try {
      val jpegs = ArrayList<Triple<ByteArray, Int, Int>>()
      for (uri in pages) {
        val src = decode(ctx, uri, maxSide) ?: return null
        val clean = levels(src)
        if (clean !== src) src.recycle()
        jpegs.add(Triple(toJpeg(clean, q), clean.width, clean.height))
        clean.recycle()
      }
      val out = File(ctx.cacheDir, "scan-${System.currentTimeMillis()}.pdf")
      FileOutputStream(out).use { writePdf(it, jpegs) }
      Uri.fromFile(out).toString()
    } catch (e: Throwable) {
      null
    }
  }

  /**
   * Rotates every page of a PDF (90 / 180 / 270) by rendering it and rebuilding the file.
   * Writes over the original document; returns true on success.
   */
  fun rotatePdf(ctx: Context, uriStr: String, degrees: Int): Boolean {
    val uri = Uri.parse(uriStr)
    val tmp = File(ctx.cacheDir, "rot-${System.currentTimeMillis()}.pdf")
    try {
      ctx.contentResolver.openInputStream(uri)?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } } ?: return false
      val jpegs = ArrayList<Triple<ByteArray, Int, Int>>()
      val pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY)
      val renderer = PdfRenderer(pfd)
      try {
        for (i in 0 until renderer.pageCount) {
          val page = renderer.openPage(i)
          try {
            val scale = 1700f / maxOf(page.width, page.height)
            val w = (page.width * scale).toInt().coerceAtLeast(1)
            val h = (page.height * scale).toInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(Color.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
            val m = Matrix().apply { postRotate(degrees.toFloat()) }
            val rot = Bitmap.createBitmap(bmp, 0, 0, w, h, m, true)
            if (rot !== bmp) bmp.recycle()
            jpegs.add(Triple(toJpeg(rot, 78), rot.width, rot.height))
            rot.recycle()
          } finally {
            page.close()
          }
        }
      } finally {
        renderer.close()
        pfd.close()
      }
      val out = ctx.contentResolver.openOutputStream(uri, "wt") ?: return false
      out.use { writePdf(it, jpegs) }
      return true
    } catch (e: Throwable) {
      return false
    } finally {
      tmp.delete()
    }
  }

  // ---------------------------------------------------------------- PDF writer

  private fun writePdf(os: OutputStream, pages: List<Triple<ByteArray, Int, Int>>) {
    val out = CountingStream(os)
    val offsets = ArrayList<Long>()
    fun obj(body: () -> Unit) {
      offsets.add(out.count)
      out.text("${offsets.size} 0 obj\n")
      body()
      out.text("\nendobj\n")
    }
    out.text("%PDF-1.4\n%âãÏÓ\n")
    // object numbers: 1 catalog, 2 pages, then per page: page, content, image
    val n = pages.size
    val pageIds = (0 until n).map { 3 + it * 3 }
    obj { out.text("<< /Type /Catalog /Pages 2 0 R >>") }
    obj { out.text("<< /Type /Pages /Count $n /Kids [${pageIds.joinToString(" ") { "$it 0 R" }}] >>") }
    pages.forEachIndexed { i, (jpg, w, h) ->
      val wPt = 595f
      val hPt = h.toFloat() / w * wPt
      val pid = pageIds[i]
      obj {
        out.text(
          "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${fmt(wPt)} ${fmt(hPt)}] " +
            "/Resources << /XObject << /Im$i ${pid + 2} 0 R >> >> /Contents ${pid + 1} 0 R >>"
        )
      }
      val content = "q ${fmt(wPt)} 0 0 ${fmt(hPt)} 0 0 cm /Im$i Do Q"
      obj {
        out.text("<< /Length ${content.length} >>\nstream\n$content\nendstream")
      }
      obj {
        out.text(
          "<< /Type /XObject /Subtype /Image /Width $w /Height $h /ColorSpace /DeviceRGB " +
            "/BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.size} >>\nstream\n"
        )
        out.write(jpg)
        out.text("\nendstream")
      }
    }
    val xref = out.count
    out.text("xref\n0 ${offsets.size + 1}\n0000000000 65535 f \n")
    for (o in offsets) out.text(String.format("%010d 00000 n \n", o))
    out.text("trailer\n<< /Size ${offsets.size + 1} /Root 1 0 R >>\nstartxref\n$xref\n%%EOF\n")
    out.flush()
  }

  private fun fmt(f: Float) = String.format(java.util.Locale.US, "%.2f", f)

  private class CountingStream(private val os: OutputStream) : OutputStream() {
    var count = 0L
    override fun write(b: Int) { os.write(b); count++ }
    override fun write(b: ByteArray, off: Int, len: Int) { os.write(b, off, len); count += len }
    override fun flush() = os.flush()
    fun text(s: String) = write(s.toByteArray(Charsets.ISO_8859_1))
  }

  // ---------------------------------------------------------------- images

  private fun toJpeg(b: Bitmap, q: Int): ByteArray {
    val bos = ByteArrayOutputStream()
    b.compress(Bitmap.CompressFormat.JPEG, q, bos)
    return bos.toByteArray()
  }

  private fun orientation(ctx: Context, uri: Uri): Int = try {
    ctx.contentResolver.openInputStream(uri)?.use {
      when (ExifInterface(it).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90
        ExifInterface.ORIENTATION_ROTATE_180 -> 180
        ExifInterface.ORIENTATION_ROTATE_270 -> 270
        else -> 0
      }
    } ?: 0
  } catch (e: Throwable) {
    0
  }

  private fun decode(ctx: Context, uri: Uri, maxSide: Int): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val opts = BitmapFactory.Options().apply {
      inSampleSize = sample
      inPreferredConfig = Bitmap.Config.ARGB_8888
    }
    var bmp = ctx.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, opts) } ?: return null
    val side = maxOf(bmp.width, bmp.height)
    val scale = if (side > maxSide) maxSide.toFloat() / side else 1f
    val deg = orientation(ctx, uri)
    if (scale < 1f || deg != 0) {
      val m = Matrix().apply {
        postScale(scale, scale)
        if (deg != 0) postRotate(deg.toFloat())
      }
      val t = Bitmap.createBitmap(bmp, 0, 0, bmp.width, bmp.height, m, true)
      if (t !== bmp) bmp.recycle()
      bmp = t
    }
    return bmp
  }

  /** Levels stretch by luminance percentiles (1% dark, 92% light = the paper). */
  private fun levels(src: Bitmap): Bitmap {
    val hist = IntArray(256)
    val w = src.width
    val step = maxOf(1, (src.width * src.height / 60000))
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
    if (count == 0) return src
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
    if (lo <= 4 && hi >= 250) return src
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
    cm.postConcat(ColorMatrix().apply { setSaturation(1.1f) })
    val out = Bitmap.createBitmap(src.width, src.height, Bitmap.Config.ARGB_8888)
    Canvas(out).drawBitmap(src, 0f, 0f, Paint().apply { colorFilter = ColorMatrixColorFilter(cm) })
    return out
  }
}
