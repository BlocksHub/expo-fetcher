package expo.modules.fetcher

import expo.modules.kotlin.AppContext
import expo.modules.kotlin.sharedobjects.SharedObject
import okhttp3.Call
import okhttp3.Callback
import okhttp3.Response
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.Executors

internal val fetcherExecutor = Executors.newSingleThreadExecutor { runnable ->
  Thread(runnable, "expo-fetcher-state").apply { isDaemon = true }
}

private const val CHUNK_SIZE = 64L * 1024

class NativeResponse(appContext: AppContext) : SharedObject(appContext), Callback {
  enum class State {
    INITIALIZED, STARTED, RESPONSE_RECEIVED, STREAMING, STREAMING_CANCELED, COMPLETED, FAILED
  }

  var state = State.INITIALIZED
    private set(value) {
      field = value
      val listeners = stateListeners.toList()
      stateListeners.clear()
      for (listener in listeners) {
        if (!listener(value)) {
          stateListeners.add(listener)
        }
      }
    }
  private val stateListeners = mutableListOf<(State) -> Boolean>()

  var status = -1
    private set
  var statusText = ""
    private set
  var url = ""
    private set
  var headers: List<List<String>> = emptyList()
    private set
  var redirected = false
    private set
  var error: FetcherException? = null
    private set

  var pendingError: FetcherException? = null
  var redirectMode = RedirectMode.FOLLOW
  var reportDownloadProgress = false
  var call: Call? = null

  private val buffer = ByteArrayOutputStream()
  private var received = 0L
  private var expected = -1L
  private var lastDownloadEmit = 0L

  fun waitFor(states: Set<State>, callback: (State) -> Unit) {
    if (state in states) {
      callback(state)
      return
    }
    stateListeners.add { newState ->
      if (newState in states) {
        callback(newState)
        true
      } else {
        false
      }
    }
  }

  fun markStarted() {
    if (state == State.INITIALIZED) {
      state = State.STARTED
    }
  }

  fun startStreaming(): ByteArray? {
    return when (state) {
      State.RESPONSE_RECEIVED -> {
        state = State.STREAMING
        val queued = drain()
        if (queued.isNotEmpty()) {
          emit("didReceiveResponseData", queued)
        }
        null
      }
      State.COMPLETED -> drain()
      State.FAILED -> throw error ?: FetcherException(FetcherErrorCode.NETWORK, "The request failed.")
      else -> null
    }
  }

  fun cancelStreaming() {
    if (state != State.RESPONSE_RECEIVED && state != State.STREAMING) {
      return
    }
    buffer.reset()
    state = State.STREAMING_CANCELED
    call?.cancel()
  }

  fun drain(): ByteArray {
    val bytes = buffer.toByteArray()
    buffer.reset()
    return bytes
  }

  fun fail(exception: FetcherException) {
    if (state == State.COMPLETED || state == State.FAILED) {
      return
    }
    error = exception
    if (state == State.STREAMING) {
      emit("didFailWithError", exception.message ?: "", exception.code)
    }
    buffer.reset()
    state = State.FAILED
    emit("readyForJSFinalization")
  }

  override fun onFailure(call: Call, e: IOException) {
    fetcherExecutor.execute {
      fail(pendingError ?: FetcherException.from(e))
    }
  }

  override fun onResponse(call: Call, response: Response) {
    if (response.isRedirect && redirectMode == RedirectMode.ERROR) {
      response.close()
      fetcherExecutor.execute {
        fail(FetcherException(FetcherErrorCode.REDIRECT, "Redirect is not allowed when redirect mode is 'error'."))
      }
      return
    }

    val pairs = response.headers.map { listOf(it.first, it.second) }
    val body = response.body
    fetcherExecutor.execute {
      if (state != State.STARTED) {
        return@execute
      }
      status = response.code
      statusText = response.message
      url = response.request.url.toString()
      headers = pairs
      redirected = response.priorResponse != null
      expected = body?.contentLength() ?: -1L
      state = State.RESPONSE_RECEIVED
    }

    if (body == null) {
      fetcherExecutor.execute { complete() }
      return
    }

    try {
      body.source().use { source ->
        while (true) {
          val chunk = okio.Buffer()
          val read = source.read(chunk, CHUNK_SIZE)
          if (read == -1L) {
            break
          }
          val bytes = chunk.readByteArray()
          fetcherExecutor.execute { onChunk(bytes) }
        }
      }
      fetcherExecutor.execute { complete() }
    } catch (e: IOException) {
      fetcherExecutor.execute {
        if (state == State.STREAMING_CANCELED) {
          state = State.FAILED
          emit("readyForJSFinalization")
        } else {
          fail(pendingError ?: FetcherException.from(e))
        }
      }
    } finally {
      response.close()
    }
  }

  private fun onChunk(bytes: ByteArray) {
    received += bytes.size
    when (state) {
      State.RESPONSE_RECEIVED -> buffer.write(bytes)
      State.STREAMING -> emit("didReceiveResponseData", bytes)
      else -> return
    }
    emitDownloadProgress(false)
  }

  private fun complete() {
    if (state != State.RESPONSE_RECEIVED && state != State.STREAMING && state != State.STREAMING_CANCELED) {
      return
    }
    if (state == State.STREAMING_CANCELED) {
      state = State.FAILED
      emit("readyForJSFinalization")
      return
    }
    emitDownloadProgress(true)
    if (state == State.STREAMING) {
      emit("didComplete")
    }
    state = State.COMPLETED
    emit("readyForJSFinalization")
  }

  private fun emitDownloadProgress(force: Boolean) {
    if (!reportDownloadProgress) {
      return
    }
    val now = System.nanoTime()
    if (!force && now - lastDownloadEmit < PROGRESS_INTERVAL_NS) {
      return
    }
    lastDownloadEmit = now
    emit("downloadProgress", received.toDouble(), expected.toDouble())
  }
}
