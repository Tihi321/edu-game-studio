/**
 * The register of a German text (EGS-39, EGS-56): does it address someone with the informal `du` or the formal `Sie`?
 * Conservative on purpose: only forms that cannot be read another way are counted. A capital `Sie` at the start of a sentence may be
 * "she / they", so it is ignored there; `ihr` (informal plural) is neither. Used by the scene generator's check and the role-play lint.
 */

const DU_WORDS = new Set(['du', 'dich', 'dir', 'dein', 'deine', 'deinen', 'deinem', 'deiner', 'deines', 'bist', 'hast', 'kannst', 'willst', 'musst', 'sollst', 'darfst', 'möchtest', 'wirst'])
/** Formal forms that are capitalised in the middle of a sentence ("Haben Sie", "Ihr Name"). */
const SIE_MID = new Set(['Sie', 'Ihr', 'Ihre', 'Ihren', 'Ihrem', 'Ihrer', 'Ihres'])

export interface GermanRegister {
  du: boolean
  sie: boolean
}

export function registerOf(text: string): GermanRegister {
  const out: GermanRegister = { du: false, sie: false }
  let start = true
  let last = 0
  for (const m of text.matchAll(/\p{L}+/gu)) {
    const between = text.slice(last, m.index)
    if (/[.!?:]/.test(between)) start = true
    last = (m.index ?? 0) + m[0].length
    const w = m[0]
    if (DU_WORDS.has(w.toLowerCase())) out.du = true
    else if (w === 'Ihnen' || (!start && SIE_MID.has(w))) out.sie = true
    start = false
  }
  return out
}
