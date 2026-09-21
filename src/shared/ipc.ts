/** Single source of truth for IPC channel names. Keep grouped by domain. */
export const CH = {
  settingsGet: 'settings:get',
  settingsSetDataRoot: 'settings:setDataRoot',
  settingsSetTheme: 'settings:setTheme',
  dialogPickFolder: 'dialog:pickFolder',

  workspaceList: 'workspace:list',
  workspaceCreate: 'workspace:create',
  workspaceUpdate: 'workspace:update',
  workspaceDelete: 'workspace:delete',
  workspaceReveal: 'workspace:reveal',

  docList: 'doc:list',
  docCreate: 'doc:create',
  docRead: 'doc:read',
  docWrite: 'doc:write',
  docRename: 'doc:rename',
  docDelete: 'doc:delete',
  docExport: 'doc:export',
  docRevealFile: 'doc:revealFile',

  indexRecents: 'index:recents',
  indexSearch: 'index:search',
  indexRebuild: 'index:rebuild'
} as const

export type Channel = (typeof CH)[keyof typeof CH]
