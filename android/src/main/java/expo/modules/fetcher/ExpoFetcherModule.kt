package expo.modules.fetcher

import expo.modules.fetcher.services.CookieService
import expo.modules.fetcher.services.FetchService
import expo.modules.fetcher.types.FetchInit
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class ExpoFetcherModule : Module() {
  
  private val cookieService = CookieService()
  private val fetchService = FetchService(cookieService)

  override fun definition() = ModuleDefinition {
    Name("ExpoFetcher")

    AsyncFunction("fetch") { url: String, init: FetchInit? ->
      fetchService.performFetch(url, init)
    }

    AsyncFunction("clearCookies") {
      cookieService.clearAllCookies()
    }
  }
}
