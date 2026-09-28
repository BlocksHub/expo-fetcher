import ExpoModulesCore

struct PinRecord: Record {
  @Field var host: String = ""
  @Field var hashes: [String] = []
}

struct NativeSessionConfig: Record {
  @Field var idleTimeout: Double = 60_000
  @Field var maxConnectionsPerHost: Int = 6
  @Field var cookies: Bool = true
  @Field var pins: [PinRecord] = []
  @Field var waitsForConnectivity: Bool = false
}

enum RedirectMode: String, Enumerable {
  case follow
  case error
  case manual
}

enum CredentialsMode: String, Enumerable {
  case include
  case omit
}

enum CacheMode: String, Enumerable {
  case `default`
  case noStore = "no-store"
  case reload
  case noCache = "no-cache"
  case forceCache = "force-cache"
  case onlyIfCached = "only-if-cached"
}

struct NativeRequestInit: Record {
  @Field var method: String = "GET"
  @Field var headers: [[String]] = []
  @Field var redirect: RedirectMode = .follow
  @Field var credentials: CredentialsMode = .include
  @Field var cache: CacheMode = .default
  @Field var reportUploadProgress: Bool = false
  @Field var reportDownloadProgress: Bool = false
}

enum BodyPart {
  case data(Data)
  case file(String)

  static func from(layout: [String], chunks: [Data]) -> [BodyPart] {
    var next = 0
    return layout.compactMap { entry in
      if !entry.isEmpty {
        return .file(entry)
      }
      guard next < chunks.count else {
        return nil
      }
      defer { next += 1 }
      return .data(chunks[next])
    }
  }
}
