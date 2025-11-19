import ExpoModulesCore
import Foundation

public class ExpoFetcherModule: Module {
  
  private let fetchService = FetchService()
  private let legacyRequestService = LegacyRequestService()
  private let cookieService = CookieService()
  
  public func definition() -> ModuleDefinition {
    Name("ExpoFetcher")
    
    AsyncFunction("fetch") { (url: String, options: FetchInit?) -> FetchResponse in
      return try await self.fetchService.performFetch(url: url, options: options)
    }
    
    AsyncFunction("request") { (url: String, options: [String: Any]?) -> [String: Any] in
      return try await self.legacyRequestService.makeRequest(url: url, options: options ?? [:])
    }

    AsyncFunction("clearCookies") { () -> Void in
      self.cookieService.clearAllCookies()
    }
  }
}