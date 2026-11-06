import { probeFile, fetchChunk, fetchWhole } from './proxyClient'
import { planChunks } from './chunkPlanner'
import { createOutputSink } from './outputSink'

async function readStreamInto(response, onBytes) {
  const reader = response.body.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    onBytes(value)
  }
}

async function readChunkToSink(sink, chunk, targetUrl, signal, onProgress) {
  const response = await fetchChunk(targetUrl, chunk.start, chunk.end, { signal })
  let position = chunk.start
  await readStreamInto(response, (bytes) => {
    sink.writeAt(position, bytes)
    position += bytes.length
    onProgress(bytes.length)
  })
}

async function runChunkPool(chunks, concurrency, worker) {
  let cursor = 0
  const errors = []

  async function lane() {
    for (;;) {
      const myIndex = cursor++
      if (myIndex >= chunks.length) return
      try {
        await worker(chunks[myIndex])
      } catch (err) {
        errors.push(err)
        throw err
      }
    }
  }

  const lanes = Array.from({ length: Math.min(concurrency, chunks.length) }, () => lane())
  await Promise.all(lanes)

  if (errors.length) throw errors[0]
}

export async function startDownload({
  url,
  threadCount,
  onProbe,
  onProgress,
  onStateChange,
  signal,
}) {
  onStateChange?.('probing')
  const info = await probeFile(url)
  onProbe?.(info)

  const canParallelize = info.supportsRanges && Number.isFinite(info.size) && info.size > 0

  const sink = await createOutputSink({
    filename: info.filename,
    totalSize: canParallelize ? info.size : undefined,
  })

  let received = 0
  const total = info.size || 0
  const reportProgress = (chunkIndex, delta) => {
    received += delta
    onProgress?.({ received, total, chunkIndex, delta })
  }

  try {
    onStateChange?.('downloading')

    if (!canParallelize) {
      const response = await fetchWhole(url, { signal })
      await readStreamInto(response, (bytes) => {
        sink.writeAt(received, bytes)
        reportProgress(0, bytes.length)
      })
    } else {
      const chunks = planChunks(info.size, threadCount)
      await runChunkPool(chunks, threadCount, (chunk) =>
        readChunkToSink(sink, chunk, url, signal, (delta) => reportProgress(chunk.index, delta))
      )
    }

    await sink.finalize()
    onStateChange?.('done')
  } catch (err) {
    await sink.abort()
    if (signal?.aborted) {
      onStateChange?.('cancelled')
    } else {
      onStateChange?.('error')
    }
    throw err
  }
}
