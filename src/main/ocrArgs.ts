const edgePair = (a: number, b: number): [number, number] => {
  const first = Math.max(0, Math.round(a))
  const second = Math.max(0, Math.round(b))
  return first <= second ? [first, second] : [second, first]
}

export function buildOcrArgs(
  input: string,
  output: string,
  x0: number,
  x1: number,
  y0: number,
  y1: number,
  ffmpeg: string
): string[] {
  const [left, right] = edgePair(x0, x1)
  const [top, bottom] = edgePair(y0, y1)
  return [
    '--input', input,
    '--output', output,
    '--x0', String(left),
    '--x1', String(right),
    '--y0', String(top),
    '--y1', String(bottom),
    '--ffmpeg', ffmpeg
  ]
}
