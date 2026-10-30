/**
 * The procedural sprites of the RPG shell (EGS-12): 16 x 16 pixel arrays, one letter per pixel. A letter names a theme colour
 * (`SPRITE_COLOURS` -> the `--pixel-<name>` variable of rpg.css, which is built from the theme's `--edu-*` slots), `.` is clear.
 * Data only (no DOM): the canvas code draws them, a test checks their shape. Phase 6 (Pixel Studio) replaces them with images when the
 * course section names sprite assets.
 */

export const SPRITE_SIZE = 16

/** Letter -> `--pixel-<name>`. */
export const SPRITE_COLOURS: Readonly<Record<string, string>> = {
  k: 'ink',
  w: 'white',
  g: 'gold',
  G: 'gold-dark',
  s: 'skin',
  S: 'skin-shade',
  h: 'hair',
  t: 'tunic',
  T: 'tunic-dark',
  c: 'cape',
  r: 'red',
  R: 'red-dark',
  C: 'cape-dark',
  n: 'green',
  N: 'green-dark',
  p: 'purple',
  P: 'purple-dark',
  o: 'orange',
  y: 'cyan',
  b: 'brown',
  m: 'stone',
  M: 'stone-dark'
}

export type Sprite = readonly string[]

export const HERO: Sprite = [
  '................',
  '.....kkkkkk.....',
  '....khhhhhhk....',
  '...khhhhhhhhk...',
  '...khhssssshk...',
  '...kssksskssk...',
  '...kssssssssk...',
  '....kssSSssk....',
  '...kttttttttk...',
  '..ksttttttttsk..',
  '..kstttggtttsk..',
  '..ksttttttttsk..',
  '...kttttttttk...',
  '...kttkkkkttk...',
  '...kbbk..kbbk...',
  '...kkkk..kkkk...'
]

/** The quest giver: a sage in a purple robe and a pointed hat, with a white beard. */
export const SAGE: Sprite = [
  '.......kk.......',
  '......kppk......',
  '.....kppppk.....',
  '....kppgppPk....',
  '...kppppppppk...',
  '..kkkppppppkkk..',
  '...kssssssssk...',
  '...kskssskssk...',
  '...kwwwwwwwwk...',
  '..kpwwwwwwwwpk..',
  '..kpPwwwwwwPpk..',
  '..kspPppppPpsk..',
  '..kpppggggpppk..',
  '..kppppppppppk..',
  '..kpppppppppPk..',
  '..kkkkkkkkkkkk..'
]

/** An apprentice: a green hood and a book. */
export const APPRENTICE: Sprite = [
  '................',
  '.....kkkkkk.....',
  '....knnnnnnk....',
  '...knnnnnnnnk...',
  '...knnssssnnk...',
  '...knskssksnk...',
  '...kssssssssk...',
  '....kssSSssk....',
  '...kNnnnnnnNk...',
  '..ksNnnnnnnNsk..',
  '..ksNnggggnNsk..',
  '..kskNnnnnNksk..',
  '...kNnnnnnnNk...',
  '...kNnkkkknNk...',
  '...kbbk..kbbk...',
  '...kkkk..kkkk...'
]

/** The foes: one look per misconception, picked by the foe's number. */
export const SLIME: Sprite = [
  '................',
  '................',
  '................',
  '.....kkkkkk.....',
  '...kknnnnnnkk...',
  '..knnwwnnnnnnk..',
  '..knwnnnnnnnnk..',
  '.knnnnnnnnnnnnk.',
  '.knnkkknnkkknnk.',
  '.knnkwknnkwknnk.',
  '.knnkkknnkkknnk.',
  '.knnnnnkknnnnNk.',
  '.kNnnnnnnnnnNNk.',
  '..kNNNNNNNNNNk..',
  '...kkkkkkkkkk...',
  '................'
]

export const BAT: Sprite = [
  '................',
  '..k..........k..',
  '.kPk........kPk.',
  '.kPPk.kkkk.kPPk.',
  'kPPPPkkppkkPPPPk',
  'kPPpPPkppkPPpPPk',
  'kPpPPPpppppPPPpk',
  '.kPPPPpwkkwpPPPk',
  '..kkPPppkkppPkk.',
  '....kkppppppkk..',
  '.....kwppppwk...',
  '......kppppk....',
  '.......kkkk.....',
  '................',
  '................',
  '................'
]

export const IMP: Sprite = [
  '................',
  '..kk........kk..',
  '..kck......kck..',
  '..kcCkkkkkkCck..',
  '...kccccccccck..',
  '...kcwkcccwkck..',
  '...kccccccccck..',
  '....kcckkkcck...',
  '...kcccwwwccck..',
  '..kcCcccccccCck.',
  '..kccCcccccCcck.',
  '...kccccccccck..',
  '....kcccccccck..',
  '....kcckkkkcck..',
  '...kCCk....kCCk.',
  '...kkkk....kkkk.'
]

export const GHOST: Sprite = [
  '................',
  '.....kkkkkk.....',
  '...kkwwwwwwkk...',
  '..kwwwwwwwwwwk..',
  '..kwwkkwwwkkwk..',
  '.kwwwkykwwkykwwk',
  '.kwwwkkwwwkkwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwkkwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwwwwwwwwwwwk.',
  '.kwwkwwwkwwwkwk.',
  '.kwkkkwkkkwkkkk.',
  '..k..kk..kk..k..',
  '................'
]

export const FOES: readonly Sprite[] = [SLIME, BAT, IMP, GHOST]

/** The boss: a crowned stone golem with glowing eyes. */
export const BOSS: Sprite = [
  '..g.gg..gg.g....'.slice(0, 16),
  '..gggggggggg....'.slice(0, 16),
  '..kGggggggGk....'.slice(0, 16),
  '.kkkmmmmmmmkk...'.slice(0, 16),
  '.kmmmmmmmmmmmk..'.slice(0, 16),
  '.kmmrrmmmrrmmk..'.slice(0, 16),
  '.kmmrwmmmrwmmk..'.slice(0, 16),
  '.kmmmmmkmmmmmk..'.slice(0, 16),
  '..kmmkkkkkmmk...'.slice(0, 16),
  '.kkmMmmmmmMmkk..'.slice(0, 16),
  'kmmkMmmmmmMkmmk.'.slice(0, 16),
  'kmmkmmmgmmmkmmk.'.slice(0, 16),
  'kMMkmmmmmmmkMMk.'.slice(0, 16),
  '.kkkmmMkMmmkkk..'.slice(0, 16),
  '...kmmmkmmmk....'.slice(0, 16),
  '...kkkkkkkkk....'.slice(0, 16)
]

/** The mark over a quest giver whose quest is not taken yet. */
export const MARK_QUEST: Sprite = [
  '................',
  '................',
  '................',
  '................',
  '......kkkk......',
  '.....kggggk.....',
  '....kggkkggk....',
  '....kgkkkgGk....',
  '.......kgGk.....',
  '......kgGk......',
  '......kgGk......',
  '......kkk.......',
  '................',
  '......kggk......',
  '......kGGk......',
  '......kkkk......'
]

export const ALL_SPRITES: Readonly<Record<string, Sprite>> = { HERO, SAGE, APPRENTICE, SLIME, BAT, IMP, GHOST, BOSS, MARK_QUEST }
