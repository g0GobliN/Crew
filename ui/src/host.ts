import { createContext, useContext, type ComponentType, type ReactNode } from 'react'

// What the shell may hand the shared components that only the host can do. Desktop provides all three (desktop.tsx,
// from the SDK: the app's markdown renderer, Button, ConfirmDialog); the browser provides none, so the components
// fall back to what they draw today. The components never import the SDK: the host brings its pieces through here.
export const ACTION_NAMES = ['unstuck', 'retry', 'proof', 'stop'] as const
export type ActionName = (typeof ACTION_NAMES)[number]

export interface ActionResult {
  ok: boolean
  text: string
}

export interface ButtonProps {
  variant?: string
  size?: string
  disabled?: boolean
  title?: string
  onClick?: () => void
  id?: string
  children?: ReactNode
}

export interface CrewActions {
  // POST /action/<name> {card, ...extra}: the one allowlisted route per command; the backend validates the name again.
  run(name: ActionName, card: string, extra?: Record<string, unknown>): Promise<ActionResult>
  // The app's own confirm dialog: resolves true on Confirm, false on Cancel or Esc.
  confirm(title: string, body: string): Promise<boolean>
  // The app's Button (ui/button), so the bar looks like the rest of Desktop.
  Button: ComponentType<ButtonProps>
}

// Desktop only: Crew hides the app's own Kanban sidebar row while it is enabled; this is the owner's switch for it.
export interface KanbanRow {
  show: boolean
  set(show: boolean): void
}

export interface CrewHost {
  kanbanRow?: KanbanRow
  // The app's chat markdown renderer for one message's text (code blocks, lists, links, inline code).
  renderMarkdown?: (text: string) => ReactNode
  actions?: CrewActions
}

export const CrewHostContext = createContext<CrewHost>({})
export const useCrewHost = (): CrewHost => useContext(CrewHostContext)
