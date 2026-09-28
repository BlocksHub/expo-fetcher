package expo.modules.fetcher

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.sharedobjects.SharedObject
import okhttp3.CacheControl
import okhttp3.Headers
import okhttp3.HttpUrl.Companion.toHttpUrlOrNull
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import java.util.concurrent.TimeUnit

private val METHODS_REQUIRING_BODY = setOf("POST", "PUT", "PATCH", "PROPPATCH", "REPORT")

class NativeRequest(appContext: AppContext, val response: NativeResponse) : SharedObject(appContext) {
  private var canceled = false

  fun start(
    context: Context,
    session: NativeSession,
    url: String,
    init: NativeRequestInit,
    body: ByteArray?,
    parts: List<BodyPart>?
  ) {
    val httpUrl = url.toHttpUrlOrNull()
      ?: throw FetcherException(FetcherErrorCode.INVALID_URL, "Invalid URL: $url")

    val headersBuilder = Headers.Builder()
    for (pair in init.headers) {
      if (pair.size == 2) {
        headersBuilder.addUnsafeNonAscii(pair[0], pair[1])
      }
    }
    val headers = headersBuilder.build()
    val mediaType = headers["Content-Type"]?.toMediaTypeOrNull()

    var requestBody: RequestBody? = when {
      !parts.isNullOrEmpty() -> PartsRequestBody(context, parts, mediaType)
      body != null -> body.toRequestBody(mediaType)
      init.method in METHODS_REQUIRING_BODY -> ByteArray(0).toRequestBody(mediaType)
      else -> null
    }
    if (init.reportUploadProgress && requestBody != null) {
      requestBody = ProgressRequestBody(requestBody) { sent, total ->
        response.emit("uploadProgress", sent.toDouble(), total.toDouble())
      }
    }

    val builder = Request.Builder()
      .url(httpUrl)
      .headers(headers)
      .method(init.method, requestBody)

    when (init.cache) {
      CacheMode.DEFAULT -> Unit
      CacheMode.NO_STORE -> builder.cacheControl(CacheControl.Builder().noCache().noStore().build())
      CacheMode.RELOAD -> builder.cacheControl(CacheControl.FORCE_NETWORK)
      CacheMode.NO_CACHE -> builder.cacheControl(CacheControl.Builder().noCache().build())
      CacheMode.FORCE_CACHE -> builder.cacheControl(
        CacheControl.Builder().maxStale(Int.MAX_VALUE, TimeUnit.SECONDS).build()
      )
      CacheMode.ONLY_IF_CACHED -> builder.cacheControl(CacheControl.FORCE_CACHE)
    }

    response.redirectMode = init.redirect
    response.reportDownloadProgress = init.reportDownloadProgress
    response.markStarted()

    val client = session.client(
      followRedirects = init.redirect == RedirectMode.FOLLOW,
      cookies = init.credentials == CredentialsMode.INCLUDE
    )
    val call = client.newCall(builder.build())
    response.call = call
    if (canceled) {
      return
    }
    call.enqueue(response)
  }

  fun cancel() {
    canceled = true
    val exception = FetcherException(FetcherErrorCode.CANCELED, "The request was canceled.")
    response.pendingError = exception
    val call = response.call
    if (call != null) {
      call.cancel()
    } else {
      response.fail(exception)
    }
  }
}
