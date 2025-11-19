package expo.modules.fetcher.services

import android.util.Base64
import expo.modules.fetcher.types.FetchInit
import expo.modules.fetcher.utils.RequestBodyHelper
import expo.modules.fetcher.utils.StatusTextHelper
import expo.modules.fetcher.utils.CustomSchemeInterceptor
import expo.modules.fetcher.utils.CustomSchemeRedirectException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.JavaNetCookieJar
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

class FetchService(private val cookieService: CookieService) {

  private val customSchemeInterceptor = CustomSchemeInterceptor()
  
  private val client = OkHttpClient.Builder()
    .cookieJar(JavaNetCookieJar(cookieService.cookieManager))
    .addInterceptor(customSchemeInterceptor)
    .followRedirects(false)
    .followSslRedirects(false)
    .connectTimeout(30, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .writeTimeout(30, TimeUnit.SECONDS)
    .build()

  suspend fun performFetch(url: String, init: FetchInit?): Map<String, Any?> = withContext(Dispatchers.IO) {
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
