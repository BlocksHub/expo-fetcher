package expo.modules.fetcher

import android.content.Context
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.sharedobjects.SharedObject
import okhttp3.Cache
import okhttp3.CertificatePinner
import okhttp3.ConnectionPool
import okhttp3.CookieJar
import okhttp3.Dispatcher
import okhttp3.OkHttpClient
import okhttp3.brotli.BrotliInterceptor
import java.io.File
import java.util.concurrent.ExecutorService
import java.util.concurrent.SynchronousQueue
import java.util.concurrent.ThreadFactory
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

internal object SharedNetworking {
  val connectionPool = ConnectionPool(10, 5, TimeUnit.MINUTES)

  val executor: ExecutorService by lazy {
    val counter = AtomicInteger()
    ThreadPoolExecutor(
      0, Int.MAX_VALUE, 60, TimeUnit.SECONDS, SynchronousQueue(),
      ThreadFactory { runnable -> Thread(runnable, "expo-fetcher-${counter.incrementAndGet()}").apply { isDaemon = true } }
    )
  }

  @Volatile private var cache: Cache? = null

  fun cache(context: Context): Cache {
    return cache ?: synchronized(this) {
      cache ?: Cache(File(context.cacheDir, "expo-fetcher-http"), 50L * 1024 * 1024).also { cache = it }
    }
  }
}

class NativeSession(appContext: AppContext, val config: NativeSessionConfig) : SharedObject(appContext) {
  private val baseClient: OkHttpClient by lazy {
    val idle = config.idleTimeout.toLong().coerceAtLeast(1)
    val dispatcher = Dispatcher(SharedNetworking.executor).apply {
      maxRequests = 64
      maxRequestsPerHost = config.maxConnectionsPerHost.coerceAtLeast(1)
    }
    val builder = OkHttpClient.Builder()
      .connectionPool(SharedNetworking.connectionPool)
      .dispatcher(dispatcher)
      .connectTimeout(idle, TimeUnit.MILLISECONDS)
      .readTimeout(idle, TimeUnit.MILLISECONDS)
      .writeTimeout(idle, TimeUnit.MILLISECONDS)
      .cookieJar(if (config.cookies) WebkitCookieJar else CookieJar.NO_COOKIES)
      .addInterceptor(BrotliInterceptor)

    appContext.reactContext?.let { builder.cache(SharedNetworking.cache(it)) }

    if (config.pins.isNotEmpty()) {
      val pinner = CertificatePinner.Builder()
      for (pin in config.pins) {
        pinner.add(pin.host, *pin.hashes.toTypedArray())
      }
      builder.certificatePinner(pinner.build())
    }
    builder.build()
  }

  private val clients = HashMap<Pair<Boolean, Boolean>, OkHttpClient>()

  @Synchronized
  fun client(followRedirects: Boolean, cookies: Boolean): OkHttpClient {
    val key = followRedirects to (cookies && config.cookies)
    return clients.getOrPut(key) {
      baseClient.newBuilder()
        .followRedirects(followRedirects)
        .followSslRedirects(followRedirects)
        .apply { if (!key.second) cookieJar(CookieJar.NO_COOKIES) }
        .build()
    }
  }
}
