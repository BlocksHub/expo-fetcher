package expo.modules.fetcher.services

import android.util.Base64
import expo.modules.fetcher.types.FetchInit
import expo.modules.fetcher.utils.RequestBodyHelper
import expo.modules.fetcher.utils.StatusTextHelper
import expo.modules.fetcher.utils.CustomSchemeInterceptor
import expo.modules.fetcher.utils.CustomSchemeRedirectException
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.HttpCookie
import java.util.concurrent.TimeUnit

class FetchService(private val cookieService: CookieService) {

  private val customSchemeInterceptor = CustomSchemeInterceptor()
  
  // Custom CookieJar implementation that bridges to Java's CookieManager
  private val customCookieJar = object : CookieJar {
    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
      val uri = url.toUri()
      cookies.forEach { cookie ->
        // Convert OkHttp cookie to HttpCookie format
        val cookieString = "${cookie.name}=${cookie.value}; " +
          "Domain=${cookie.domain}; " +
          "Path=${cookie.path}" +
          (if (cookie.expiresAt > 0) "; Max-Age=${(cookie.expiresAt - System.currentTimeMillis()) / 1000}" else "") +
          (if (cookie.secure) "; Secure" else "") +
          (if (cookie.httpOnly) "; HttpOnly" else "")
        
        try {
          val httpCookie = HttpCookie.parse(cookieString).firstOrNull()
          if (httpCookie != null) {
            cookieService.cookieManager.cookieStore.add(uri, httpCookie)
          }
        } catch (e: Exception) {
          android.util.Log.w("ExpoFetcher", "Failed to save cookie: ${e.message}")
        }
      }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
      val uri = url.toUri()
      val cookies = cookieService.cookieManager.cookieStore.get(uri)
      
      return cookies.mapNotNull { httpCookie ->
        Cookie.Builder()
          .name(httpCookie.name)
          .value(httpCookie.value)
          .domain(httpCookie.domain ?: url.host)
          .path(httpCookie.path ?: "/")
          .apply {
            if (httpCookie.secure) secure()
            if (httpCookie.isHttpOnly) httpOnly()
          }
          .build()
      }
    }
  }
  
  private val client = OkHttpClient.Builder()
    .cookieJar(customCookieJar)
    .addInterceptor(customSchemeInterceptor)
    .followRedirects(false)
    .followSslRedirects(false)
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .writeTimeout(30, TimeUnit.SECONDS)
    .build()

  fun performFetch(url: String, init: FetchInit?): Map<String, Any?> {
    val method = init?.method ?: "GET"
    val followRedirects = init?.redirect != "manual" && init?.redirect != "error"

    android.util.Log.d("ExpoFetcher", "performFetch START: $method $url followRedirects=$followRedirects")

    val requestBuilder = Request.Builder().url(url)

    val requestBody = RequestBodyHelper.createRequestBody(init?.body)

    when (method.uppercase()) {
      "GET" -> requestBuilder.get()
      "POST" -> requestBuilder.post(requestBody ?: ByteArray(0).toRequestBody())
      "PUT" -> requestBuilder.put(requestBody ?: ByteArray(0).toRequestBody())
      "DELETE" -> requestBuilder.delete(requestBody)
      "PATCH" -> requestBuilder.patch(requestBody ?: ByteArray(0).toRequestBody())
      "HEAD" -> requestBuilder.head()
      else -> requestBuilder.method(method, requestBody)
    }

    init?.headers?.forEach { (key, value) ->
      requestBuilder.addHeader(key, value)
    }

    if (requestBody != null && init?.headers?.keys?.none { it.equals("Content-Length", ignoreCase = true) } == true) {
      requestBuilder.addHeader("Content-Length", requestBody.contentLength().toString())
    }

    val request = requestBuilder.build()

    val clientToUse = if (followRedirects) {
      client.newBuilder()
        .followRedirects(true)
        .followSslRedirects(true)
        .build()
    } else {
      client
    }

    try {
      val response = clientToUse.newCall(request).execute()

      android.util.Log.d("ExpoFetcher", "performFetch RESPONSE: ${response.code} ${response.request.url}")
      android.util.Log.d("ExpoFetcher", "Cookies in store: ${cookieService.cookieManager.cookieStore.cookies.size}")

      val headersArray = mutableListOf<String>()
      response.headers.forEach { (name, value) ->
        headersArray.add(name)
        headersArray.add(value)
        if (name.equals("Set-Cookie", ignoreCase = true)) {
          android.util.Log.d("ExpoFetcher", "Set-Cookie: $value")
        }
      }

      val bodyBytes = response.body?.bytes() ?: ByteArray(0)
      val bodyBase64 = Base64.encodeToString(bodyBytes, Base64.NO_WRAP)

      val isRedirect = response.code in 300..399
      val wasRedirected = !followRedirects && isRedirect

      val statusText = StatusTextHelper.getStatusText(response.code, response.message)

      response.close()

      mapOf(
        "status" to response.code,
        "statusText" to statusText,
        "headers" to headersArray,
        "bodyBase64" to bodyBase64,
        "url" to response.request.url.toString(),
        "ok" to (response.code in 200..299),
        "redirected" to wasRedirected,
        "type" to "basic"
      )
    } catch (e: CustomSchemeRedirectException) {
      android.util.Log.d("ExpoFetcher", "performFetch: ✅ Successfully captured custom scheme redirect")
      android.util.Log.d("ExpoFetcher", "performFetch: Custom scheme URL: ${e.customSchemeUrl}")
      
      mapOf(
        "status" to 302,
        "statusText" to "Found",
        "headers" to listOf("Location", e.customSchemeUrl, "X-Redirect-Type", "custom-scheme"),
        "bodyBase64" to "",
        "url" to e.customSchemeUrl,
        "ok" to false,
        "redirected" to true,
        "type" to "opaqueredirect"
      )
    } catch (e: IOException) {
      android.util.Log.e("ExpoFetcher", "performFetch ERROR: ${e.message}", e)
      throw Exception("Network request failed: ${e.message}")
    }
  }
}
