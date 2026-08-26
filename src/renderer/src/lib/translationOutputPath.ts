/**
 * Dat ban dich vao thu muc dau ra chung, khong dat canh file SRT nguon.
 * Renderer chay tren Windows nhung test va duong dan cloud co the dung `/`,
 * nen giu kieu dau phan cach cua `outputDir` thay vi dung node:path.
 */
export function translationOutputPath(
  sourceSrt: string,
  outputDir: string,
  targetLanguage: string
): string {
  if (!outputDir.trim()) throw new Error('Chưa chọn thư mục lưu kết quả.')
  const name = sourceSrt.split(/[\\/]/).pop() || 'subtitle.srt'
  const translatedName = name.replace(/\.srt$/i, `.${targetLanguage}.srt`)
  const separator = outputDir.includes('\\') ? '\\' : '/'
  return `${outputDir.replace(/[\\/]+$/, '')}${separator}${translatedName}`
}
