import { useRef, useState } from 'react'
import { startDownload } from './lib/downloadManager'
import { planChunks } from './lib/chunkPlanner'
import { supportsFileSystemAccess } from './lib/outputSink'
import './App.css'

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024
    unitIndex += 1
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatSpeed(bytesPerSecond) {
  if (!Number.isFinite(bytesPerSecond) || bytesPerSecond <= 0) return '—'
  return `${formatBytes(bytesPerSecond)}/s`
}

function formatEta(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '—'
  if (seconds < 60) return `${Math.ceil(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const secs = Math.ceil(seconds % 60)
  return `${minutes}m ${secs}s`
}

const STATE_LABELS = {
  idle: 'Idle',
  probing: 'Checking file…',
  downloading: 'Downloading…',
  done: 'Done',
  error: 'Error',
  cancelled: 'Cancelled',
}

function App() {
  const [url, setUrl] = useState('')
  const [threadCount, setThreadCount] = useState(6)
  const [state, setState] = useState('idle')
  const [info, setInfo] = useState(null)
  const [chunkProgress, setChunkProgress] = useState({})
  const [overall, setOverall] = useState({ received: 0, total: 0 })
  const [speed, setSpeed] = useState(0)
  const [errorMessage, setErrorMessage] = useState(null)
  const [chunkSizes, setChunkSizes] = useState({})

  const abortControllerRef = useRef(null)
  const speedSamplesRef = useRef([])

  const isBusy = state === 'probing' || state === 'downloading'

  function resetProgress() {
    setChunkProgress({})
    setChunkSizes({})
    setOverall({ received: 0, total: 0 })
    setSpeed(0)
    speedSamplesRef.current = []
    setErrorMessage(null)
  }

  function trackSpeed(received) {
    const now = performance.now()
    const samples = speedSamplesRef.current
    samples.push({ time: now, received })
    while (samples.length > 1 && now - samples[0].time > 3000) {
      samples.shift()
    }
    if (samples.length >= 2) {
      const first = samples[0]
      const last = samples[samples.length - 1]
      const deltaBytes = last.received - first.received
      const deltaTime = (last.time - first.time) / 1000
      setSpeed(deltaTime > 0 ? deltaBytes / deltaTime : 0)
    }
  }

  async function handleStart() {
    if (!url.trim()) return

    resetProgress()
    setState('probing')
    setInfo(null)

    const controller = new AbortController()
    abortControllerRef.current = controller

    try {
      await startDownload({
        url: url.trim(),
        threadCount,
        signal: controller.signal,
        onProbe: (probeInfo) => {
          setInfo(probeInfo)
          if (probeInfo.supportsRanges && Number.isFinite(probeInfo.size)) {
            const sizes = {}
            for (const chunk of planChunks(probeInfo.size, threadCount)) {
              sizes[chunk.index] = chunk.end - chunk.start + 1
            }
            setChunkSizes(sizes)
          }
        },
        onStateChange: (next) => setState(next),
        onProgress: ({ received, total, chunkIndex, delta }) => {
          setOverall({ received, total })
          setChunkProgress((prev) => ({
            ...prev,
            [chunkIndex]: (prev[chunkIndex] || 0) + delta,
          }))
          trackSpeed(received)
        },
      })
    } catch (err) {
      if (!controller.signal.aborted) {
        setErrorMessage(err.message || 'Download failed')
      }
    } finally {
      abortControllerRef.current = null
    }
  }

  function handleCancel() {
    abortControllerRef.current?.abort()
  }

  const percent = overall.total ? Math.min(100, (overall.received / overall.total) * 100) : 0
  const remainingBytes = overall.total ? overall.total - overall.received : 0
  const eta = speed > 0 ? remainingBytes / speed : null

  return (
    <div className="downloader">
      <h1>Chunked Parallel Downloader</h1>
      <p className="subtitle">
        Paste a direct file URL. The file is split into byte ranges and fetched in parallel,
        then merged into one file right in your browser.
      </p>

      {!supportsFileSystemAccess && (
        <p className="warning">
          Your browser doesn't support saving files directly to disk while downloading. Files
          will be held in memory and saved at the end — large files may use a lot of RAM.
        </p>
      )}

      <div className="controls">
        <input
          type="url"
          placeholder="https://example.com/large-file.zip"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          disabled={isBusy}
        />

        <label className="thread-control">
          Threads
          <input
            type="number"
            min={1}
            max={16}
            value={threadCount}
            onChange={(e) => setThreadCount(Number(e.target.value))}
            disabled={isBusy}
          />
        </label>

        {!isBusy ? (
          <button type="button" onClick={handleStart} disabled={!url.trim()}>
            Start Download
          </button>
        ) : (
          <button type="button" className="cancel" onClick={handleCancel}>
            Cancel
          </button>
        )}
      </div>

      <p className="status">Status: {STATE_LABELS[state] ?? state}</p>

      {errorMessage && <p className="error">{errorMessage}</p>}

      {info && (
        <div className="file-info">
          <div>
            <strong>{info.filename}</strong>
          </div>
          <div>
            {formatBytes(info.size)} · {info.supportsRanges ? 'parallel mode' : 'single-stream fallback'}
          </div>
        </div>
      )}

      {(state === 'downloading' || state === 'done') && (
        <div className="progress-section">
          <div className="overall-bar">
            <div className="overall-bar-fill" style={{ width: `${percent}%` }} />
          </div>
          <div className="overall-meta">
            <span>{percent.toFixed(1)}%</span>
            <span>{formatBytes(overall.received)} / {formatBytes(overall.total)}</span>
            <span>{formatSpeed(speed)}</span>
            <span>ETA {formatEta(eta)}</span>
          </div>

          {info?.supportsRanges && (
            <div className="chunk-grid">
              {Object.keys(chunkSizes)
                .map(Number)
                .sort((a, b) => a - b)
                .map((chunkIndex) => (
                  <div key={chunkIndex} className="chunk-row">
                    <span className="chunk-label">#{chunkIndex}</span>
                    <div className="chunk-bar">
                      <div
                        className="chunk-bar-fill"
                        style={{
                          width: `${Math.min(
                            100,
                            ((chunkProgress[chunkIndex] || 0) / chunkSizes[chunkIndex]) * 100
                          )}%`,
                        }}
                      />
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
