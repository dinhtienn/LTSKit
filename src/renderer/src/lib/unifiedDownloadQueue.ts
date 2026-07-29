import type {
  DouyinRequest,
  DouyinResult,
  DownloadProgress,
  DownloadRequest,
  DownloadResult,
  DyMode,
  VideoInfo
} from '../../../shared/types'

export type UnifiedItemStatus = 'fetching' | 'ready' | 'blocked' | 'downloading' | 'done' | 'error'

export interface GenericQueueItem {
  id: string
  engine: 'generic'
  url: string
  title: string
  info: VideoInfo | null
  status: UnifiedItemStatus
  progress: DownloadProgress | null
  result: DownloadResult | null
  error: string | null
  formatId: string | null
  formatLabel: string | null
  subfolder: string | null
}

export interface DouyinQueueItem {
  id: string
  engine: 'douyin'
  url: string
  title: string
  status: UnifiedItemStatus
  success: number
  lastFile: string | null
  result: DouyinResult | null
  error: string | null
  request: Omit<DouyinRequest, 'outputDir'>
}

export type UnifiedQueueItem = GenericQueueItem | DouyinQueueItem

export type DouyinOptions = Pick<
  DouyinRequest,
  'music' | 'cover' | 'avatar' | 'metaJson' | 'proxy' | 'useCookies'
> & {
  mode: DyMode
  batchSize: number
}

export interface UnifiedDownloadApi {
  download(id: string, req: DownloadRequest): Promise<DownloadResult>
  dyDownload(id: string, req: DouyinRequest): Promise<DouyinResult>
}

export function createDouyinQueueItem(
  id: string,
  url: string,
  isChannel: boolean,
  options: DouyinOptions
): DouyinQueueItem {
  return {
    id,
    engine: 'douyin',
    url,
    title: url,
    status: 'ready',
    success: 0,
    lastFile: null,
    result: null,
    error: null,
    request: {
      url,
      isChannel,
      mode: isChannel ? options.mode : 'all',
      batchSize: options.batchSize,
      music: options.music,
      cover: options.cover,
      avatar: options.avatar,
      metaJson: options.metaJson,
      proxy: options.proxy,
      useCookies: options.useCookies
    }
  }
}

export function replaceQueuePlaceholder(
  items: UnifiedQueueItem[],
  placeholderId: string,
  replacements: UnifiedQueueItem[]
): UnifiedQueueItem[] {
  return items.flatMap((item) => (item.id === placeholderId ? replacements : [item]))
}

export function runnableQueueItems(
  items: UnifiedQueueItem[],
  hasDouyinEngine: boolean
): UnifiedQueueItem[] {
  return items.filter(
    (item) =>
      (item.status === 'ready' || item.status === 'error' || item.status === 'blocked') &&
      (item.engine === 'generic' || hasDouyinEngine)
  )
}

export function dispatchQueueItem(
  item: UnifiedQueueItem,
  genericRequest: DownloadRequest | null,
  outputDir: string,
  api: UnifiedDownloadApi
): Promise<DownloadResult | DouyinResult> {
  if (item.engine === 'generic') {
    if (!genericRequest) throw new Error('Thiếu cấu hình tải xuống.')
    return api.download(item.id, genericRequest)
  }
  return api.dyDownload(item.id, { ...item.request, outputDir })
}
