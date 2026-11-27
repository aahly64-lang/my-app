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

  /**
   * Builds the cleaned PDF from the scanner's own PDF (rendered page by page), so every page keeps exactly
   * the orientation the scanner showed (and any rotation done there). Returns a file uri, or null.
   */
  fun enhance(ctx: Context, pdfUri: Uri, quality: String): String? {
    val (maxSide, q) = preset(quality)
    val tmp = File(ctx.cacheDir, "src-${System.currentTimeMillis()}.pdf")
    return try {
      ctx.contentResolver.openInputStream(pdfUri)?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } } ?: return null
      val jpegs = ArrayList<Triple<ByteArray, Int, Int>>()
      val pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY)
      val renderer = PdfRenderer(pfd)
      // The scanner may store a page sideways with a "/Rotate" note that viewers apply; Android's renderer
      // does not, so the page came out upside down. Apply it ourselves; if it can't be read, keep the original.
      val rotations = pageRotations(tmp, renderer.pageCount)
      if (rotations == null) {
        renderer.close()
        pfd.close()
        return null
      }
      try {
        for (i in 0 until renderer.pageCount) {
          val page = renderer.openPage(i)
          try {
            val scale = maxSide.toFloat() / maxOf(page.width, page.height)
            val w = (page.width * scale).toInt().coerceAtLeast(1)
            val h = (page.height * scale).toInt().coerceAtLeast(1)
            val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
            bmp.eraseColor(Color.WHITE)
            page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
            val deg = ((rotations[i] % 360) + 360) % 360
            val upright = if (deg == 0) bmp else {
              val r = Bitmap.createBitmap(bmp, 0, 0, w, h, Matrix().apply { postRotate(deg.toFloat()) }, true)
              if (r !== bmp) bmp.recycle()
              r
            }
            val clean = levels(upright)
            if (clean !== upright) upright.recycle()
            jpegs.add(Triple(toJpeg(clean, q), clean.width, clean.height))
            clean.recycle()
          } finally {
            page.close()
          }
        }
      } finally {
        renderer.close()
        pfd.close()
      }
      if (jpegs.isEmpty()) return null
      val out = File(ctx.cacheDir, "scan-${System.currentTimeMillis()}.pdf")
      FileOutputStream(out).use { writePdf(it, jpegs) }
      Uri.fromFile(out).toString()
    } catch (e: Throwable) {
      null
    } finally {
      tmp.delete()
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
      val rotations = pageRotations(tmp, renderer.pageCount) ?: IntArray(renderer.pageCount)
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
            val m = Matrix().apply { postRotate((degrees + rotations[i]).toFloat()) }
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

  /**
   * Builds one PDF from PDFs and images, in order (merge, "add pages", photos to PDF). PDF pages are rendered
   * page by page (keeping their /Rotate), images are turned upright from EXIF. Writes over [overwrite] when given
   * (returns it), otherwise into the cache (returns a file uri). Null on failure.
   */
  fun combine(ctx: Context, uris: List<String>, mimes: List<String>, quality: String, overwrite: String?): String? {
    val (maxSide, q) = preset(quality)
    val jpegs = ArrayList<Triple<ByteArray, Int, Int>>()
    try {
      for ((idx, u) in uris.withIndex()) {
        val mime = mimes.getOrElse(idx) { "" }
        val uri = Uri.parse(u)
        if (mime.contains("pdf")) {
          val tmp = File(ctx.cacheDir, "cmb-${System.currentTimeMillis()}-$idx.pdf")
          try {
            ctx.contentResolver.openInputStream(uri)?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } } ?: return null
            val pfd = ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY)
            val renderer = PdfRenderer(pfd)
            val rotations = pageRotations(tmp, renderer.pageCount) ?: IntArray(renderer.pageCount)
            try {
              for (i in 0 until renderer.pageCount) {
                val page = renderer.openPage(i)
                try {
                  val scale = maxSide.toFloat() / maxOf(page.width, page.height)
                  val w = (page.width * scale).toInt().coerceAtLeast(1)
                  val h = (page.height * scale).toInt().coerceAtLeast(1)
                  val bmp = Bitmap.createBitmap(w, h, Bitmap.Config.ARGB_8888)
                  bmp.eraseColor(Color.WHITE)
                  page.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
                  val deg = ((rotations[i] % 360) + 360) % 360
                  val upright = if (deg == 0) bmp else {
                    val r = Bitmap.createBitmap(bmp, 0, 0, w, h, Matrix().apply { postRotate(deg.toFloat()) }, true)
                    if (r !== bmp) bmp.recycle()
                    r
                  }
                  jpegs.add(Triple(toJpeg(upright, q), upright.width, upright.height))
                  upright.recycle()
                } finally {
                  page.close()
                }
              }
            } finally {
              renderer.close()
              pfd.close()
            }
          } finally {
            tmp.delete()
          }
        } else {
          val img = loadImage(ctx, uri, maxSide) ?: return null
          jpegs.add(Triple(toJpeg(img, q), img.width, img.height))
          img.recycle()
        }
      }
      if (jpegs.isEmpty()) return null
      if (!overwrite.isNullOrBlank()) {
        val dest = Uri.parse(overwrite)
        val out = ctx.contentResolver.openOutputStream(dest, "wt") ?: return null
        out.use { writePdf(it, jpegs) }
        return overwrite
      }
      val file = File(ctx.cacheDir, "pdf-${System.currentTimeMillis()}.pdf")
      FileOutputStream(file).use { writePdf(it, jpegs) }
      return Uri.fromFile(file).toString()
    } catch (e: Throwable) {
      return null
    }
  }

  /** Decodes an image no bigger than maxSide, turned upright from its EXIF orientation, on a white background. */
  internal fun loadImage(ctx: Context, uri: Uri, maxSide: Int): Bitmap? {
    val cr = ctx.contentResolver
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    val opened = cr.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds); true } ?: false
    if (!opened) return null
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= maxSide) sample *= 2
    val raw = cr.openInputStream(uri)?.use {
      BitmapFactory.decodeStream(it, null, BitmapFactory.Options().apply { inSampleSize = sample })
    } ?: return null
    val orientation = try {
      cr.openInputStream(uri)?.use {
        android.media.ExifInterface(it).getAttributeInt(android.media.ExifInterface.TAG_ORIENTATION, android.media.ExifInterface.ORIENTATION_NORMAL)
      } ?: android.media.ExifInterface.ORIENTATION_NORMAL
    } catch (e: Throwable) {
      android.media.ExifInterface.ORIENTATION_NORMAL
    }
    val m = Matrix()
    when (orientation) {
      android.media.ExifInterface.ORIENTATION_ROTATE_90 -> m.postRotate(90f)
      android.media.ExifInterface.ORIENTATION_ROTATE_180 -> m.postRotate(180f)
      android.media.ExifInterface.ORIENTATION_ROTATE_270 -> m.postRotate(270f)
      android.media.ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> m.postScale(-1f, 1f)
      android.media.ExifInterface.ORIENTATION_FLIP_VERTICAL -> m.postScale(1f, -1f)
      android.media.ExifInterface.ORIENTATION_TRANSPOSE -> { m.postRotate(90f); m.postScale(-1f, 1f) }
      android.media.ExifInterface.ORIENTATION_TRANSVERSE -> { m.postRotate(270f); m.postScale(-1f, 1f) }
    }
    val scale = minOf(1f, maxSide.toFloat() / maxOf(raw.width, raw.height))
    if (scale < 1f) m.postScale(scale, scale)
    val turned = if (m.isIdentity) raw else Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, m, true).also { if (it !== raw) raw.recycle() }
    // transparent PNGs: flatten on white so the JPEG isn't black
    val flat = Bitmap.createBitmap(turned.width, turned.height, Bitmap.Config.ARGB_8888)
    flat.eraseColor(Color.WHITE)
    Canvas(flat).drawBitmap(turned, 0f, 0f, null)
    turned.recycle()
    return flat
  }

  /**
   * /Rotate of every page, in page order. Returns null when it can't be determined safely
   * (compressed object streams, or a count that doesn't match), so the caller keeps the original file.
   */
  private fun pageRotations(file: File, pageCount: Int): IntArray? {
    val text = String(file.readBytes(), Charsets.ISO_8859_1)
    val pages = Regex("/Type\\s*/Page(?![a-zA-Z])").findAll(text).toList()
    val rotateRe = Regex("/Rotate\\s+(-?\\d+)")
    if (pages.size != pageCount) {
      // page objects hidden in compressed streams: only safe if nothing is rotated anywhere we can see
      return if (text.contains("/ObjStm") || rotateRe.containsMatchIn(text)) null else IntArray(pageCount)
    }
    // inherited from the /Pages node: applies to pages without their own value
    var inherited = 0
    Regex("/Type\\s*/Pages").find(text)?.let { m ->
      val start = text.lastIndexOf(" obj", m.range.first)
      val end = text.indexOf("endobj", m.range.first)
      if (start >= 0 && end > 0) rotateRe.find(text.substring(start, end))?.let { inherited = it.groupValues[1].toInt() }
    }
    val out = IntArray(pageCount)
    for ((i, m) in pages.withIndex()) {
      val start = text.lastIndexOf(" obj", m.range.first)
      val end = text.indexOf("endobj", m.range.first)
      if (start < 0 || end < 0) return null
      out[i] = rotateRe.find(text.substring(start, end))?.groupValues?.get(1)?.toInt() ?: inherited
    }
    return out
  }

  // ---------------------------------------------------------------- PDF writer

  internal fun writePdf(os: OutputStream, pages: List<Triple<ByteArray, Int, Int>>) {
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

  internal fun toJpeg(b: Bitmap, q: Int): ByteArray {
    val bos = ByteArrayOutputStream()
    b.compress(Bitmap.CompressFormat.JPEG, q, bos)
    return bos.toByteArray()
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
