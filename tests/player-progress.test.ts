import { describe, expect, it } from 'vitest'
import {
  ProgressStore,
  allMastered,
  dequeue,
  enqueueMiss,
  exportProgress,
  hasProgress,
  isUnlocked,
  masteryMap,
  newProgress,
  newlyUnlocked,
  parseProgress,
  recordRound,
  starsFor,
  storageKey,
  type StorageLike
} from '../src/player/progress'
import { loadFixture } from './edu-fixtures'

describe('stars', () => {
  it('stars: thresholds and the best round kept', () => {
  // 1 star from 50 %, 2 from 70 %, 3 from 90 %
  {
    expect([0, 0.49, 0.5, 0.69, 0.7, 0.89, 0.9, 1].map(starsFor)).toEqual([0, 0, 1, 1, 2, 2, 3, 3])
  }
  // recordRound keeps the best stars and counts rounds
  {
    let p = newProgress('c')
    p = recordRound(p, { unitId: 'u1' }, 0.95)
    p = recordRound(p, { unitId: 'u1' }, 0.2)
    expect(p.units.u1).toMatchObject({ stars: 3, rounds: 2 })
    expect(p.units.u1?.best).toBeCloseTo(0.95)
    p = recordRound(p, { boss: true }, 0.6)
    expect(p.boss.stars).toBe(1)
  }
  })
})

describe('unlocking', () => {
  it('a unit opens when everything it requires has 2 stars', async () => {
    const f = await loadFixture('solar-system')
    const [a, b, c] = f.pack.units.map((u) => u.id) as [string, string, string]
    let p = newProgress(f.pack.id)
    expect(isUnlocked(f.pack, p, a)).toBe(true)
    expect(isUnlocked(f.pack, p, b)).toBe(false)
    const before = p
    p = recordRound(p, { unitId: a }, 0.6) // 1 star: not enough
    expect(isUnlocked(f.pack, p, b)).toBe(false)
    p = recordRound(p, { unitId: a }, 0.75)
    expect(isUnlocked(f.pack, p, b)).toBe(true)
    expect(newlyUnlocked(f.pack, before, p)).toEqual([b])
    expect(isUnlocked(f.pack, p, c)).toBe(false)
    expect(allMastered(f.pack, p)).toBe(false)
    p = recordRound(recordRound(p, { unitId: b }, 1), { unitId: c }, 1)
    expect(allMastered(f.pack, p)).toBe(true)
    expect(masteryMap(f.pack, p)).toEqual({ [a]: 2, [b]: 3, [c]: 3 })
  })
})

describe('review queue', () => {
  it('enqueue is once, dequeue removes', () => {
    expect(enqueueMiss(enqueueMiss([], 'a'), 'a')).toEqual(['a'])
    expect(dequeue(['a', 'b'], 'a')).toEqual(['b'])
  })
})

describe('export and import', () => {
  it('export and import: round trip, junk refused, unknown ids dropped and numbers clamped', async () => {
  // round-trips
  {
    const f = await loadFixture('solar-system')
    let p = newProgress(f.pack.id)
    p = recordRound(p, { unitId: f.pack.units[0]!.id }, 0.8)
    p = { ...p, score: 420, queue: [f.pack.items[0]!.id], settings: { lang: 'hr', timer: true, sound: false, reduceAudio: true, speak: false } }
    const res = parseProgress(exportProgress(p), f.pack)
    expect(res.ok).toBe(true)
    if (res.ok) expect(res.progress).toEqual(p)
    expect(hasProgress(p)).toBe(true)
    expect(hasProgress(newProgress('x'))).toBe(false)
  }

  // refuses junk, another course, another version and a wrong format
  {
    const f = await loadFixture('solar-system')
    const bad = (t: string): string => {
      const r = parseProgress(t, f.pack)
      return r.ok ? 'ok' : r.error
    }
    expect(bad('not json')).toBe('not JSON')
    expect(bad('[1]')).toBe('not an object')
    expect(bad(JSON.stringify({ format: 'something', progress: {} }))).toBe('wrong file format')
    expect(bad(JSON.stringify({ format: 'edu-progress', progress: { version: 9, pack: f.pack.id } }))).toContain('version')
    expect(bad(JSON.stringify({ format: 'edu-progress', progress: { version: 1, pack: 'other' } }))).toContain('other')
  }

  // drops unknown units, items and cards, and clamps numbers
  {
    const f = await loadFixture('solar-system')
    const unit = f.pack.units[0]!.id
    const item = f.pack.items[0]!.id
    const raw = {
      version: 1,
      pack: f.pack.id,
      units: { [unit]: { stars: 99, best: 7, rounds: -3 }, ghost: { stars: 3 } },
      cards: { [item]: { ease: 0.1, interval: -5, reps: 2.6, lapses: 'x', due: 'soon', last: 5 }, ghost: {} },
      queue: [item, item, 'ghost', 4],
      score: -10,
      answered: 5,
      right: 50,
      settings: { timer: 'yes' }
    }
    const r = parseProgress(JSON.stringify(raw), f.pack)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const p = r.progress
    expect(Object.keys(p.units)).toEqual([unit])
    expect(p.units[unit]).toEqual({ stars: 3, best: 1, rounds: 0 })
    expect(Object.keys(p.cards)).toEqual([item])
    expect(p.cards[item]).toMatchObject({ ease: 1.3, interval: 0, reps: 3, lapses: 0, due: 0, last: 5 })
    expect(p.queue).toEqual([item])
    expect(p.score).toBe(0)
    expect(p.right).toBe(5)
    expect(p.settings.timer).toBe(false)
  }
  })
})

describe('ProgressStore', () => {
  const pack = { id: 'c', units: [], items: [], objectives: [] }
  const memory = (): StorageLike & { data: Record<string, string> } => {
    const data: Record<string, string> = {}
    return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v), removeItem: (k) => void delete data[k] }
  }

  it('ProgressStore: namespaced key, storage that throws, write failure, corrupt value', () => {
  // saves under a key namespaced by the pack id and loads it back
  {
    const s = memory()
    const store = new ProgressStore(pack, s)
    store.save({ ...newProgress('c'), score: 5 })
    expect(Object.keys(s.data)).toEqual([storageKey('c')])
    expect(storageKey('c')).toContain('c')
    expect(new ProgressStore(pack, s).load().score).toBe(5)
    store.clear()
    expect(new ProgressStore(pack, s).load().score).toBe(0)
  }

  // never throws when the storage does, and says it is not persistent
  {
    const boom: StorageLike = {
      getItem: () => {
        throw new Error('denied')
      },
      setItem: () => {
        throw new Error('quota')
      },
      removeItem: () => {
        throw new Error('denied')
      }
    }
    const store = new ProgressStore(pack, boom)
    expect(() => store.save({ ...newProgress('c'), score: 3 })).not.toThrow()
    expect(store.persistent).toBe(false)
    expect(store.load().score).toBe(3) // the read is denied, the session copy in memory is used
    expect(() => store.clear()).not.toThrow()
    expect(new ProgressStore(pack, null).persistent).toBe(false)
  }

  // keeps the progress in memory when only writing fails
  {
    const s = memory()
    s.setItem = () => {
      throw new Error('quota')
    }
    const store = new ProgressStore(pack, s)
    store.save({ ...newProgress('c'), score: 3 })
    expect(store.persistent).toBe(false)
  }

  // ignores a corrupt stored value
  {
    const s = memory()
    s.setItem(storageKey('c'), '{broken')
    expect(new ProgressStore(pack, s).load()).toEqual(newProgress('c'))
  }
  })
})
