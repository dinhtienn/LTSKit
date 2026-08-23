import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import test from 'node:test'
import { capcutCueFingerprint } from './capcutJob'
import {
  buildAtempoFilter,
  buildTrimSilenceArgs,
  planAudioFit,
  planAudioFitIfDurationKnown,
  trimAudioEdges
} from './audioFit'

test('chains safe atempo stages for rates outside the native range', () => {
  assert.equal(buildAtempoFilter(4), 'atempo=2.0,atempo=2.0000')
  assert.equal(buildAtempoFilter(0.25), 'atempo=0.5,atempo=0.5000')
})

test('keeps the requested tempo when the cue already fits its slot', () => {
  assert.deepEqual(planAudioFit(2, 1.25, 2, 0.15), {
    tempo: 1.25,
    outputLimit: null
  })
})

test('increases total tempo only enough to fit an overlong cue', () => {
  assert.deepEqual(planAudioFit(6, 1.25, 3, 0.15), {
    tempo: 2,
    outputLimit: 3
  })
})

test('normalizes invalid user tempo for an unlimited preview', () => {
  assert.deepEqual(planAudioFit(2, 0, null, 0.15), {
    tempo: 1,
    outputLimit: null
  })
})

test('rejects a source duration that cannot produce a reliable fit', () => {
  assert.throws(() => planAudioFit(0, 1, 2, 0.15), /thời lượng audio/)
})

test('builds a trim command that removes edge silence and keeps a short tail pad', () => {
  const args = buildTrimSilenceArgs('raw.wav', 'trimmed.wav')
  assert.deepEqual(args.slice(0, 3), ['-y', '-i', 'raw.wav'])
  assert.equal(args.at(-1), 'trimmed.wav')
  assert.match(args.join(' '), /silenceremove=start_periods=1:start_threshold=-40dB:start_silence=0\.02/)
  assert.doesNotMatch(args.join(' '), /start_duration=/)
  assert.match(args.join(' '), /areverse/)
  assert.match(args.join(' '), /apad=pad_dur=0\.05/)
  assert.match(args.join(' '), /-ar 48000 -ac 1/)
})

test('uses the trimmed file only when FFmpeg creates a valid result', async () => {
  const seen: string[][] = []
  const output = await trimAudioEdges('raw.wav', 'trimmed.wav', async (args) => {
    seen.push(args)
    return true
  })
  assert.equal(output, 'trimmed.wav')
  assert.equal(seen.length, 1)
  assert.deepEqual(seen[0], buildTrimSilenceArgs('raw.wav', 'trimmed.wav'))
})

test('falls back to the source file when silence trimming fails', async () => {
  const output = await trimAudioEdges('raw.wav', 'trimmed.wav', async () => false)
  assert.equal(output, 'raw.wav')
})

test('propagates cancellation instead of falling back and starting more work', async () => {
  await assert.rejects(
    trimAudioEdges('raw.wav', 'trimmed.wav', async () => false, () => true),
    /Đã hủy/
  )
})

test('lets VieNeu pass through a valid clip when duration probing fails', () => {
  assert.equal(planAudioFitIfDurationKnown(0, 1, 2, 0.15), null)
  assert.deepEqual(planAudioFitIfDurationKnown(3, 1, 2, 0.15), {
    tempo: 1.5,
    outputLimit: 2
  })
})

test('invalidates CapCut checkpoints produced before silence trimming', () => {
  const cue = { cueIndex: 0, start: 1, end: 2.5, text: 'Xin chào' }
  const legacy = createHash('sha256')
    .update(JSON.stringify({
      text: cue.text,
      start: cue.start,
      end: cue.end,
      voiceId: 'voice-a',
      speed: 1,
      audioProcessingVersion: 1
    }))
    .digest('hex')
  assert.notEqual(capcutCueFingerprint(cue, 'voice-a', 1), legacy)
})
