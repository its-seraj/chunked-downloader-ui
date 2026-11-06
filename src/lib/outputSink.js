export const supportsFileSystemAccess = typeof window !== 'undefined' && 'showSaveFilePicker' in window

export async function createOutputSink({ filename, totalSize }) {
  if (supportsFileSystemAccess) {
    return createFileSystemSink({ filename, totalSize })
  }
  return createMemorySink({ filename, totalSize })
}

async function createFileSystemSink({ filename, totalSize }) {
  const handle = await window.showSaveFilePicker({ suggestedName: filename })
  const writable = await handle.createWritable()

  if (totalSize) {
    await writable.truncate(totalSize)
  }

  return {
    kind: 'filesystem',
    async writeAt(position, data) {
      await writable.write({ type: 'write', position, data })
    },
    async finalize() {
      await writable.close()
    },
    async abort() {
      try {
        await writable.abort()
      } catch {
        // already closed/aborted, nothing to clean up
      }
    },
  }
}

function createMemorySink({ filename }) {
  const buffers = []

  return {
    kind: 'memory',
    async writeAt(position, data) {
      buffers.push({ position, data })
    },
    async finalize() {
      buffers.sort((a, b) => a.position - b.position)
      const blob = new Blob(buffers.map((b) => b.data))
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(url)
    },
    async abort() {
      buffers.length = 0
    },
  }
}
