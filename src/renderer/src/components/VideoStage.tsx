import type { ComponentPropsWithoutRef, JSX, ReactNode, RefObject } from 'react'
import { useEffect, useRef, useState } from 'react'
import type { MediaProbe } from '../../../shared/types'
import { containDimensions } from '../../../shared/videoOrientation'
import { mediaUrl } from '../lib/mediaUrl'

export interface VideoStageSize {
  boxW: number
  boxH: number
}

interface VideoStageProps {
  path: string
  media: MediaProbe
  videoRef: RefObject<HTMLVideoElement | null>
  videoProps?: Omit<ComponentPropsWithoutRef<'video'>, 'src' | 'ref'>
  children?: (size: VideoStageSize) => ReactNode
}

export default function VideoStage({
  path,
  media,
  videoRef,
  videoProps,
  children
}: VideoStageProps): JSX.Element {
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [size, setSize] = useState<VideoStageSize>({ boxW: 0, boxH: 0 })

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const measure = (): void => {
      const contained = containDimensions(
        media.width,
        media.height,
        Math.max(0, stage.clientWidth - 20),
        Math.max(0, stage.clientHeight - 20)
      )
      setSize({ boxW: contained.width, boxH: contained.height })
    }
    const observer = new ResizeObserver(measure)
    observer.observe(stage)
    measure()
    return () => observer.disconnect()
  }, [media.height, media.width])

  return (
    <div className="ocr-sanh" ref={stageRef}>
      <div className="ocr-video" style={{ width: size.boxW, height: size.boxH }}>
        <video ref={videoRef} src={mediaUrl(path)} {...videoProps} />
        {size.boxW > 0 && size.boxH > 0 ? children?.(size) : null}
      </div>
    </div>
  )
}
