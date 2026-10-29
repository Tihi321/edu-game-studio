// Which of Chiptune Studio's `compose_sfx` sounds a sound of the book is. The studio has a fixed list per kind, the book has free text
// ("a ship bell", "waves on the pier"), so the words are matched against stems, the key first (a key is shorter and says it better).

export type ChipSoundKind = 'sfx' | 'ambience'

/** Sound -> word stems, in the order they are tried (the specific before the general). Names are those of `compose_sfx`. */
const SFX: [string, string[]][] = [
  ['thunder', ['thunder', 'storm', 'rumbl']],
  ['explosion', ['explo', 'blast', 'boom', 'detonat', 'crash']],
  ['laser', ['laser', 'zap', 'beam', 'gunshot', 'shot', 'shoot']],
  ['coin', ['coin', 'money', 'cash']],
  ['powerup', ['powerup', 'power', 'upgrade']],
  ['heal', ['heal', 'cure', 'restor']],
  ['magic', ['magic', 'spell', 'sparkl', 'whoosh', 'enchant']],
  ['chime', ['chime', 'bell', 'ding', 'gong', 'ring']],
  ['alert', ['alert', 'alarm', 'siren', 'warn', 'phone']],
  ['footstep', ['footstep', 'step', 'walk', 'boots', 'stride']],
  ['door', ['door', 'knock', 'creak', 'latch', 'hinge', 'gate']],
  ['text', ['typing', 'typewrit', 'text', 'keyboard']],
  ['confirm', ['confirm', 'accept', 'select', 'success']],
  ['cancel', ['cancel', 'deny', 'denied', 'error', 'buzz', 'wrong']],
  ['jump', ['jump', 'leap', 'hop', 'bounc']],
  ['hit', ['hit', 'punch', 'slap', 'impact', 'thud', 'bang', 'slam', 'smack']],
  ['blip', ['blip', 'beep', 'click', 'tick', 'tap']]
]
const AMBIENCE: [string, string[]][] = [
  ['rain', ['rain', 'drizzl', 'downpour', 'shower']],
  ['wind', ['wind', 'gust', 'breez', 'gale']],
  ['waves', ['wave', 'sea', 'ocean', 'surf', 'shore', 'pier', 'harbo', 'beach', 'tide']],
  ['cave', ['cave', 'cavern', 'drip', 'echo', 'dungeon', 'tunnel']],
  ['night', ['night', 'cricket', 'owl', 'crickets', 'cicada', 'moonlit']],
  ['fire', ['fire', 'fireplace', 'crackl', 'campfire', 'flame', 'hearth', 'torch']],
  ['machine', ['machine', 'engine', 'factory', 'motor', 'hum', 'generator', 'clockwork', 'mechan']],
  ['drone', ['drone', 'dread', 'eerie', 'void']]
]
const FALLBACK: Record<ChipSoundKind, string> = { sfx: 'blip', ambience: 'drone' }

const tokens = (s: string): string[] => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/).filter(Boolean)

function find(table: [string, string[]][], words: string[]): string | null {
  for (const [sound, stems] of table) if (words.some((w) => stems.some((st) => w.startsWith(st)))) return sound
  return null
}

/**
 * The `compose_sfx` sound for a book sound: from its key words first, then from its description. `guessed` says nothing matched and the
 * fallback was used (the caller adds a warning, so the user knows to import a file).
 */
export function pickChipSound(kind: ChipSoundKind, key: string, description: string): { sound: string; guessed: boolean } {
  const table = kind === 'sfx' ? SFX : AMBIENCE
  const hit = find(table, tokens(key)) ?? find(table, tokens(description))
  return hit ? { sound: hit, guessed: false } : { sound: FALLBACK[kind], guessed: true }
}
