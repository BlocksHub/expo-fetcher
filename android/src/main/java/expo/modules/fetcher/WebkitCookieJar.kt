package expo.modules.fetcher

import android.os.Handler
import android.os.Looper
import android.util.Log
import android.webkit.CookieManager
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl
import okhttp3.JavaNetCookieJar
import java.net.CookiePolicy

object WebkitCookieJar : CookieJar {
  private const val TAG = "ExpoFetcher"

  private val fallbackStore by lazy {
    java.net.CookieManager().apply { setCookiePolicy(CookiePolicy.ACCEPT_ALL) }
  }
  private val fallback by lazy { JavaNetCookieJar(fallbackStore) }

  private val manager: CookieManager?
    get() = try {
      CookieManager.getInstance()
    } catch (e: Throwable) {
      Log.w(TAG, "WebView CookieManager unavailable, using in-memory cookies", e)
      null
    }

  override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
    val manager = manager ?: return fallback.saveFromResponse(url, cookies)
    val target = url.toString()
    for (cookie in cookies) {
      manager.setCookie(target, cookie.toString())
    }
    if (cookies.isNotEmpty()) {
      manager.flush()
    }
  }

  override fun loadForRequest(url: HttpUrl): List<Cookie> {
    val manager = manager ?: return fallback.loadForRequest(url)
    val header = manager.getCookie(url.toString()) ?: return emptyList()
    return parseCookieHeader(url, header)
  }

  fun parseCookieHeader(url: HttpUrl, header: String): List<Cookie> {
    return header.split(";").mapNotNull { pair ->
      val index = pair.indexOf('=')
      if (index <= 0) {
        return@mapNotNull null
      }
      try {
        Cookie.Builder()
          .name(pair.substring(0, index).trim())
          .value(pair.substring(index + 1).trim())
          .domain(url.host)
          .build()
      } catch (e: IllegalArgumentException) {
        null
      }
    }
  }

  fun setCookie(url: HttpUrl, header: String) {
    val manager = manager
    if (manager == null) {
      Cookie.parse(url, header)?.let { fallback.saveFromResponse(url, listOf(it)) }
      return
    }
    manager.setCookie(url.toString(), header)
    manager.flush()
  }

  fun getCookies(url: HttpUrl): List<Cookie> = loadForRequest(url)

  fun clear(onDone: () -> Unit) {
    val manager = manager
    if (manager == null) {
      fallbackStore.cookieStore.removeAll()
      onDone()
      return
    }
    Handler(Looper.getMainLooper()).post {
      manager.removeAllCookies {
        manager.flush()
        onDone()
      }
    }
  }
}
