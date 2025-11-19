package expo.modules.fetcher.types

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class FetchInit : Record {
  @Field
  val body: Any? = null

  @Field
  val headers: Map<String, String>? = null

  @Field
  val method: String? = null

  @Field
  val redirect: String? = null

  @Field
  val timeout: Double? = null
}
