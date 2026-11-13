import { describe, expect, it } from 'vitest'
import { autostartCameras } from '../app/utils/cameras'

const cam = (id: string, kind: 'doorbell' | 'camera' | 'display', opts: { wired?: boolean; live?: boolean } = {}) => ({ id, kind, live: opts.live ?? true, extendable: opts.wired ?? true })

describe('which cameras start live by themselves on the Security tab', () => {
  it('every wired camera', () => {
    expect(autostartCameras([cam('door', 'doorbell'), cam('garden', 'camera')], null)).toEqual(['door', 'garden'])
  })

  it('not a battery camera beside wired ones, unless a notification pointed to it', () => {
    const all = [cam('door', 'doorbell'), cam('shed', 'camera', { wired: false })]
    expect(autostartCameras(all, null)).toEqual(['door'])
    expect(autostartCameras(all, 'shed')).toEqual(['door', 'shed'])
  })

  it('one camera in a house with only battery cameras: the doorbell, else the first, else the one asked for', () => {
    const all = [cam('shed', 'camera', { wired: false }), cam('door', 'doorbell', { wired: false })]
    expect(autostartCameras(all, null)).toEqual(['door'])
    expect(autostartCameras(all, 'shed')).toEqual(['shed'])
    expect(autostartCameras([cam('shed', 'camera', { wired: false }), cam('gate', 'camera', { wired: false })], null)).toEqual(['shed'])
  })

  it('never a camera that cannot stream here', () => {
    expect(autostartCameras([cam('old', 'camera', { live: false }), cam('garden', 'camera')], 'old')).toEqual(['garden'])
    expect(autostartCameras([cam('old', 'camera', { live: false })], null)).toEqual([])
  })
})
