package expo.modules.fetcher.utils

import okhttp3.Interceptor
import okhttp3.Response
import java.io.IOException

class CustomSchemeInterceptor : Interceptor {
  
  var lastCustomSchemeUrl: String? = null
  
  override fun intercept(chain: Interceptor.Chain): Response {
    val request = chain.request()
    val response = chain.proceed(request)
    
    if (response.isRedirect) {
      val location = response.header("Location")
      android.util.Log.d("ExpoFetcher", "Interceptor: Redirect detected to: $location")
      
      if (location != null && !location.startsWith("http://") && !location.startsWith("https://")) {
        android.util.Log.d("ExpoFetcher", "Interceptor: ⚠️ Custom scheme redirect detected: $location")
        lastCustomSchemeUrl = location
        throw CustomSchemeRedirectException(location)
      }
    }
    
    return response
  }
}

class CustomSchemeRedirectException(val customSchemeUrl: String) : IOException("Custom scheme redirect: $customSchemeUrl")
