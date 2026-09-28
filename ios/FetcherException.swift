import ExpoModulesCore

enum FetcherErrorCode: String {
  case network = "ERR_FETCHER_NETWORK"
  case timeout = "ERR_FETCHER_TIMEOUT"
  case canceled = "ERR_FETCHER_CANCELED"
  case pinning = "ERR_FETCHER_PINNING"
  case tls = "ERR_FETCHER_TLS"
  case redirect = "ERR_FETCHER_REDIRECT"
  case invalidUrl = "ERR_FETCHER_INVALID_URL"
  case file = "ERR_FETCHER_FILE"
}

final class FetcherException: Exception, @unchecked Sendable {
  let errorCode: FetcherErrorCode
  let message: String

  init(_ errorCode: FetcherErrorCode, _ message: String, cause: Error? = nil) {
    self.errorCode = errorCode
    self.message = message
    super.init()
    self.cause = cause
  }

  override var code: String {
    errorCode.rawValue
  }

  override var reason: String {
    message
  }

  static func from(_ error: Error) -> FetcherException {
    if let fetcherError = error as? FetcherException {
      return fetcherError
    }
    guard let urlError = error as? URLError else {
      return FetcherException(.network, error.localizedDescription, cause: error)
    }
    let code: FetcherErrorCode
    switch urlError.code {
    case .timedOut:
      code = .timeout
    case .cancelled:
      code = .canceled
    case .serverCertificateUntrusted, .serverCertificateHasBadDate, .serverCertificateNotYetValid,
      .serverCertificateHasUnknownRoot, .secureConnectionFailed, .clientCertificateRejected,
      .clientCertificateRequired, .appTransportSecurityRequiresSecureConnection:
      code = .tls
    case .badURL, .unsupportedURL:
      code = .invalidUrl
    case .fileDoesNotExist, .noPermissionsToReadFile, .cannotOpenFile:
      code = .file
    case .httpTooManyRedirects, .redirectToNonExistentLocation:
      code = .redirect
    default:
      code = .network
    }
    return FetcherException(code, urlError.localizedDescription, cause: urlError)
  }
}
