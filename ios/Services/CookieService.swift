import Foundation

class CookieService {
  
  func clearAllCookies() {
    if let cookieStorage = HTTPCookieStorage.shared.cookies {
      for cookie in cookieStorage {
        HTTPCookieStorage.shared.deleteCookie(cookie)
      }
    }
    HTTPCookieStorage.shared.removeCookies(since: Date.distantPast)
    URLCache.shared.removeAllCachedResponses()
  }
}
