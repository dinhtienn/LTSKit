export const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
  '.ts': 'video/mp2t',
  '.flv': 'video/x-flv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.wav': 'audio/wav',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg; codecs=opus',
  '.aac': 'audio/aac',
  '.wma': 'audio/x-ms-wma'
}

export function mediaTypeForExtension(extension: string): string {
  return MEDIA_TYPES[extension.toLowerCase()] ?? 'application/octet-stream'
}
