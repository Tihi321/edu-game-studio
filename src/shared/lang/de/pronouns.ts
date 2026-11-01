/** German personal pronouns as the conjugation items label them, and the reflexive pronouns (accusative). */

export const DE_PERSONS = ['ich', 'du', 'er', 'wir', 'ihr', 'sie', 'Sie'] as const
export type DePerson = (typeof DE_PERSONS)[number]

/** The label shown beside an input: `er` covers er / sie / es, `sie` is the plural, `Sie` the formal address. */
export const PRONOUN_LABELS: Record<string, Record<string, string>> = {
  de: { ich: 'ich', du: 'du', er: 'er / sie / es', wir: 'wir', ihr: 'ihr', sie: 'sie', Sie: 'Sie' }
}

/** The accusative reflexive pronoun of each person (sich freuen: ich freue mich). */
export const REFLEXIVE_PRONOUNS: Record<DePerson, string> = { ich: 'mich', du: 'dich', er: 'sich', wir: 'uns', ihr: 'euch', sie: 'sich', Sie: 'sich' }

export function isDePerson(p: string): p is DePerson {
  return (DE_PERSONS as readonly string[]).includes(p)
}
