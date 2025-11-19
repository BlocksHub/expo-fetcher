package expo.modules.fetcher.services

import java.net.CookieManager
import java.net.CookiePolicy

class CookieService {
  val cookieManager = CookieManager().apply {
    setCookiePolicy(CookiePolicy.ACCEPT_ALL)
  }

  fun clearAllCookies() {
    cookieManager.cookieStore.removeAll()
  }
}
