import { useMemo } from 'react'
import { useStore } from 'zustand'
import { eduStore } from './store'
import type { AgentView, EduStore } from './store'

export function useEdu<T>(selector: (s: EduStore) => T): T {
  return useStore(eduStore, selector)
}

/** All agents in engine order. */
export function useAgentList(): AgentView[] {
  const agents = useEdu((s) => s.agents)
  const order = useEdu((s) => s.agentOrder)
  return useMemo(() => order.map((id) => agents[id]).filter((a): a is AgentView => !!a), [agents, order])
}
