package expo.modules.geoalarm

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Rect
import android.graphics.pdf.PdfRenderer
import android.net.Uri
import android.os.ParcelFileDescriptor
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.PDPageContentStream
import com.tom_roush.pdfbox.pdmodel.graphics.image.LosslessFactory
import java.io.File
import java.io.FileOutputStream

/** Shrink before sending, two-sided card on one page, signing a PDF (documents, later items). */
object DocsTools {
  private fun outDir(ctx: Context, name: String) = File(ctx.cacheDir, name).apply { mkdirs() }

  private fun safeName(name: String, ext: String): String {
    val base = name.replace(Regex("[\\\\/:*?\"<>|]"), "_").replace(Regex("\\.[^.]+$"), "").ifBlank { "document" }
    return "$base.$ext"
  }

  /**
   * A smaller copy for sending: pictures → JPEG up to 1600px, PDFs → pages re-drawn as light JPEGs.
   * Returns {uri, size, mime} of the copy in the cache, or null.
   */
  fun compress(ctx: Context, uriStr: String, mime: String, name: String): Map<String, Any?>? {
    return try {
      val dir = outDir(ctx, "compressed")
      dir.listFiles()?.forEach { if (System.currentTimeMillis() - it.lastModified() > 3_600_000) it.delete() }
      if (mime.startsWith("image/")) {
        val bmp = ScanEnhancer.loadImage(ctx, Uri.parse(uriStr), 1600) ?: return null
        val out = File(dir, safeName(name, "jpg"))
        FileOutputStream(out).use { bmp.compress(Bitmap.CompressFormat.JPEG, 70, it) }
        bmp.recycle()
        mapOf("uri" to "file://" + out.absolutePath, "size" to out.length().toDouble(), "mime" to "image/jpeg")
      } else if (mime.contains("pdf")) {
        val tmp = ScanEnhancer.combine(ctx, listOf(uriStr), listOf(mime), "small", null) ?: return null
        val src = File(Uri.parse(tmp).path ?: return null)
        val out = File(dir, safeName(name, "pdf"))
        out.delete()
        if (!src.renameTo(out)) {
          src.copyTo(out, true)
          src.delete()
        }
        mapOf("uri" to "file://" + out.absolutePath, "size" to out.length().toDouble(), "mime" to "application/pdf")
      } else null
    } catch (e: Throwable) {
      null
    }
  }

  /**
   * Front and back of a card (the first two pages of a scan) on one A4 page, at their real size
   * (85.6 mm long side, like an ID card or a license), one above the other. Returns a file uri or null.
   */
  fun cardOnePage(ctx: Context, pdfUri: String): String? {
    val tmp = File(ctx.cacheDir, "card-src-${System.currentTimeMillis()}.pdf")
    return try {
      ctx.contentResolver.openInputStream(Uri.parse(pdfUri))?.use { input -> FileOutputStream(tmp).use { input.copyTo(it) } } ?: return null
      val sides = ArrayList<Bitmap>()
      ParcelFileDescriptor.open(tmp, ParcelFileDescriptor.MODE_READ_ONLY).use { pfd ->
        PdfRenderer(pfd).use { r ->
          for (i in 0 until minOf(2, r.pageCount)) {
            r.openPage(i).use { p ->
              val scale = 1400f / maxOf(p.width, p.height)
              val bmp = Bitmap.createBitmap((p.width * scale).toInt().coerceAtLeast(1), (p.height * scale).toInt().coerceAtLeast(1), Bitmap.Config.ARGB_8888)
              bmp.eraseColor(Color.WHITE)
              p.render(bmp, null, null, PdfRenderer.Page.RENDER_MODE_FOR_PRINT)
              sides.add(bmp)
            }
          }
        }
      }
      if (sides.isEmpty()) return null
      // A4 at 200 dpi
      val pageW = 1654
      val pageH = 2339
      val pxPerMm = pageW / 210f
      val cardLong = 85.6f * pxPerMm
      val page = Bitmap.createBitmap(pageW, pageH, Bitmap.Config.ARGB_8888)
      page.eraseColor(Color.WHITE)
      val canvas = Canvas(page)
      val paint = Paint(Paint.FILTER_BITMAP_FLAG or Paint.ANTI_ALIAS_FLAG)
      val border = Paint().apply { color = Color.rgb(200, 200, 200); style = Paint.Style.STROKE; strokeWidth = 2f }
      var top = 30f * pxPerMm
      for (b in sides) {
        val s = cardLong / maxOf(b.width, b.height)
        val w = b.width * s
        val h = b.height * s
        val left = (pageW - w) / 2
        val dst = android.graphics.RectF(left, top, left + w, top + h)
        canvas.drawBitmap(b, Rect(0, 0, b.width, b.height), dst, paint)
        canvas.drawRect(dst, border)
        top += h + 20f * pxPerMm
        b.recycle()
      }
      val out = File(ctx.cacheDir, "card-${System.currentTimeMillis()}.pdf")
      FileOutputStream(out).use { ScanEnhancer.writePdf(it, listOf(Triple(ScanEnhancer.toJpeg(page, 85), pageW, pageH))) }
      page.recycle()
      Uri.fromFile(out).toString()
    } catch (e: Throwable) {
      null
    } finally {
      tmp.delete()
    }
  }

  /**
   * Draws a signature picture (PNG, transparent) on one page of a PDF. x, y, w are fractions of the page
   * (from the top-left, as the page is shown). Writes a new PDF in the cache and returns its uri, or null.
   */
  fun signPdf(ctx: Context, src: String, page: Int, png: String, x: Double, y: Double, w: Double): String? {
    return try {
      PDFBoxResourceLoader.init(ctx.applicationContext)
      val sig = BitmapFactory.decodeFile(Uri.parse(png).path ?: png) ?: return null
      val out = File(outDir(ctx, "signed"), "signed-${System.currentTimeMillis()}.pdf")
      val input = ctx.contentResolver.openInputStream(Uri.parse(src)) ?: return null
      input.use { inp ->
        PDDocument.load(inp).use { doc ->
          if (doc.isEncrypted) return null
          if (page < 0 || page >= doc.numberOfPages) return null
          val p = doc.getPage(page)
          val box = p.cropBox
          val img = LosslessFactory.createFromImage(doc, sig)
          val wPt = (w * box.width).toFloat()
          val hPt = wPt * sig.height / sig.width
          val xPt = box.lowerLeftX + (x * box.width).toFloat()
          val yPt = box.upperRightY - (y * box.height).toFloat() - hPt
          PDPageContentStream(doc, p, PDPageContentStream.AppendMode.APPEND, true, true).use { cs ->
            cs.drawImage(img, xPt, yPt, wPt, hPt)
          }
          doc.save(out)
        }
      }
      sig.recycle()
      "file://" + out.absolutePath
    } catch (e: Throwable) {
      null
    }
  }
}
