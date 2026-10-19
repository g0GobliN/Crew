import { createContext, useContext } from 'react'
import type { CrewApi } from './api'
import type { CardJson } from './card-types'

// The card page's shared view state: what is selected, which role is in focus, whether the camera follows. CardPage
// provides it; the node cards, the graph and the panel read it. The camera itself (zoom, pan, fit) stays in the
// graph: it listens to the window event `crew-camera` (detail 'fit' | 'reset') that the f and 0 keys send.
export interface CardUi {
  card: CardJson
  api: CrewApi
  selected: string | null
  selStep: number
  focusRole: string | null
  follow: boolean
  paused: boolean
  panelOpen: boolean
  select(id: string): void
  selectStep(id: string, i: number): void
  closePanel(): void
  setFocusRole(role: string | null): void
  setFollow(on: boolean): void
  // The graph sets this while a drag ends so the click that follows a pan does not select (card.js suppressClick).
  suppressClick: { current: boolean }
}

export const CardUiContext = createContext<CardUi | null>(null)

export function useCardUi(): CardUi {
  const ui = useContext(CardUiContext)
  if (!ui) throw new Error('useCardUi: no CardPage above')
  return ui
}
