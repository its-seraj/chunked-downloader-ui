export function planChunks(totalSize, threadCount) {
  const count = Math.max(1, Math.min(threadCount, totalSize))
  const baseSize = Math.floor(totalSize / count)

  const chunks = []
  let start = 0
  for (let index = 0; index < count; index++) {
    const isLast = index === count - 1
    const end = isLast ? totalSize - 1 : start + baseSize - 1
    chunks.push({ index, start, end })
    start = end + 1
  }

  return chunks
}
