package expo.modules.fetcher.types

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class FetchResponse : Record {
  @Field
  val status: Int = 0

  @Field
  val statusText: String = ""

  @Field
  val headers: List<String> = emptyList()

  @Field
  val bodyBase64: String = ""

  @Field
  val url: String = ""

  @Field
  val ok: Boolean = false

  @Field
  val redirected: Boolean = false

  @Field
  val type: String = "basic"
}
