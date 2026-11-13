import { describe, expect, it } from 'vitest'
import { autostartCameras } from '../app/utils/cameras'

const cam = (id: string, kind: 'doorbell' | 'camera' | 'display', live = true) => ({ id, kind, live })

describe('which cameras start live by themselves on the Security tab', () => {
  const all = [cam('door', 'doorbell'), cam('garden', 'camera'), cam('hub', 'display')]

  it('only the doorbell: it is the one you open the tab for', () => {
    expect(autostartCameras(all, null)).toEqual(['door'])
  })

  it('the camera a notification pointed to, instead of the doorbell', () => {
    expect(autostartCameras(all, 'garden')).toEqual(['garden'])
  })

  it('the first camera in a house without a doorbell', () => {
    expect(autostartCameras([cam('garden', 'camera'), cam('shed', 'camera')], null)).toEqual(['garden'])
  })

  it('never a camera that cannot stream here, and the doorbell when the notification names an unknown one', () => {
    expect(autostartCameras([cam('door', 'doorbell', false), cam('garden', 'camera')], null)).toEqual(['garden'])
    expect(autostartCameras(all, 'gone')).toEqual(['door'])
    expect(autostartCameras([cam('old', 'camera', false)], null)).toEqual([])
  })
})
