package expo.modules.fetcher

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import expo.modules.kotlin.types.Enumerable

class PinRecord : Record {
  @Field var host: String = ""
  @Field var hashes: List<String> = emptyList()
}

class NativeSessionConfig : Record {
  @Field var idleTimeout: Double = 60_000.0
  @Field var maxConnectionsPerHost: Int = 6
  @Field var cookies: Boolean = true
  @Field var pins: List<PinRecord> = emptyList()
  @Field var waitsForConnectivity: Boolean = false
}

enum class RedirectMode(val value: String) : Enumerable {
  FOLLOW("follow"),
  ERROR("error"),
  MANUAL("manual")
}

enum class CredentialsMode(val value: String) : Enumerable {
  INCLUDE("include"),
  OMIT("omit")
}

enum class CacheMode(val value: String) : Enumerable {
  DEFAULT("default"),
  NO_STORE("no-store"),
  RELOAD("reload"),
  NO_CACHE("no-cache"),
  FORCE_CACHE("force-cache"),
  ONLY_IF_CACHED("only-if-cached")
}

class NativeRequestInit : Record {
  @Field var method: String = "GET"
  @Field var headers: List<List<String>> = emptyList()
  @Field var redirect: RedirectMode = RedirectMode.FOLLOW
  @Field var credentials: CredentialsMode = CredentialsMode.INCLUDE
  @Field var cache: CacheMode = CacheMode.DEFAULT
  @Field var reportUploadProgress: Boolean = false
  @Field var reportDownloadProgress: Boolean = false
}

sealed class BodyPart {
  class Data(val bytes: ByteArray) : BodyPart()
  class File(val uri: String) : BodyPart()

  companion object {
    fun from(layout: List<String>, chunks: List<ByteArray>): List<BodyPart> {
      val iterator = chunks.iterator()
      return layout.mapNotNull { entry ->
        when {
          entry.isNotEmpty() -> File(entry)
          iterator.hasNext() -> Data(iterator.next())
          else -> null
        }
      }
    }
  }
}
