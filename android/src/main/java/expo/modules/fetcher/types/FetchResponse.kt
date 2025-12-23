package expo.modules.fetcher.types

import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class FetchResponse : Record {
  @Field
  var status: Int = 0

  @Field
  var statusText: String = ""

  @Field
  var headers: List<String> = emptyList()

  @Field
  var bodyBase64: String = ""

  @Field
  var url: String = ""

  @Field
  var ok: Boolean = false

  @Field
  var redirected: Boolean = false

  @Field
  var type: String = "basic"
}
