const PROXY_BASE_URL = import.meta.env.VITE_PROXY_BASE_URL
const PROXY_API_KEY = import.meta.env.VITE_PROXY_API_KEY

function streamUrl(targetUrl) {
  const params = new URLSearchParams({ url: targetUrl })
  return `${PROXY_BASE_URL}/stream?${params.toString()}`
}

function parseContentDisposition(value) {
  if (!value) return null
  const match = /filename\*?=(?:UTF-8''|")?([^;"]+)"?/i.exec(value)
  return match ? decodeURIComponent(match[1].trim()) : null
}

function filenameFromUrl(targetUrl) {
  try {
    const { pathname } = new URL(targetUrl)
    const last = pathname.split('/').filter(Boolean).pop()
    return last ? decodeURIComponent(last) : 'download'
  } catch {
    return 'download'
  }
}

export async function probeFile(targetUrl) {
  const response = await fetch(streamUrl(targetUrl), {
    method: 'HEAD',
    headers: { 'x-api-key': PROXY_API_KEY },
  })

  if (!response.ok) {
    throw new Error(`Probe failed: upstream returned ${response.status}`)
  }

  const contentLength = response.headers.get('content-length')
  const acceptRanges = response.headers.get('accept-ranges')
  const contentDisposition = response.headers.get('content-disposition')

  return {
    size: contentLength ? Number(contentLength) : null,
    supportsRanges: acceptRanges === 'bytes',
    filename: parseContentDisposition(contentDisposition) || filenameFromUrl(targetUrl),
    contentType: response.headers.get('content-type') || 'application/octet-stream',
  }
}

export async function fetchChunk(targetUrl, start, end, { signal } = {}) {
  const response = await fetch(streamUrl(targetUrl), {
    method: 'GET',
    headers: {
      'x-api-key': PROXY_API_KEY,
      Range: `bytes=${start}-${end}`,
    },
    signal,
  })

  if (!response.ok && response.status !== 206) {
    throw new Error(`Chunk fetch failed: upstream returned ${response.status}`)
  }

  return response
}

export async function fetchWhole(targetUrl, { signal } = {}) {
  const response = await fetch(streamUrl(targetUrl), {
    method: 'GET',
    headers: { 'x-api-key': PROXY_API_KEY },
    signal,
  })

  if (!response.ok) {
    throw new Error(`Download failed: upstream returned ${response.status}`)
  }

  return response
}
