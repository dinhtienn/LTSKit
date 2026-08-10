export interface SelectableQueueItem {
  selected: boolean
  status: string
}

export type QueueSelectionState = 'none' | 'some' | 'all'

export function queueSelectionState(items: SelectableQueueItem[], lockedStatuses: ReadonlySet<string>): QueueSelectionState {
  const mutable = items.filter((item) => !lockedStatuses.has(item.status))
  if (mutable.length === 0) return 'none'
  const selected = mutable.filter((item) => item.selected).length
  return selected === 0 ? 'none' : selected === mutable.length ? 'all' : 'some'
}

export function toggleAllQueueItems<T extends SelectableQueueItem>(items: T[], selected: boolean, lockedStatuses: ReadonlySet<string>): T[] {
  return items.map((item) => lockedStatuses.has(item.status) ? item : { ...item, selected })
}

export function selectedQueueItems<T extends SelectableQueueItem>(items: T[], runnableStatuses: ReadonlySet<string>): T[] {
  return items.filter((item) => item.selected && runnableStatuses.has(item.status))
}
