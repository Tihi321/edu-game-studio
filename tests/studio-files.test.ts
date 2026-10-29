import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { fileUrlToPath } from '../src/main/files'

const data = path.resolve('some-data')
const themes = path.resolve('some-themes')
const url = (rel: string) => `edustudio-file://data/${rel}`

describe('fileUrlToPath for an Edu Studio course', () => {
  it('serves the source assets and the assets of the built game', () => {
    expect(fileUrlToPath(data, url('courses/solar/course/assets/map.svg'), themes)).toMatchObject({ type: 'image/svg+xml', root: data })
    expect(fileUrlToPath(data, url('courses/solar/course/assets/beeps.wav'), themes)?.type).toBe('audio/wav')
    expect(fileUrlToPath(data, url('courses/solar/build/assets/map.svg'), themes)?.type).toBe('image/svg+xml')
  })
  it('still refuses the rest of the course folder', () => {
    expect(fileUrlToPath(data, url('courses/solar/course/pack.json'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('courses/solar/build/game-data.js'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('courses/solar/course/assets/../pack.json'), themes)).toBeNull()
    expect(fileUrlToPath(data, url('courses/solar/course/assets/x.js'), themes)).toBeNull()
  })
})
