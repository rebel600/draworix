import { app, BrowserWindow, shell } from 'electron'
import path from 'node:path'
import { registerIpc } from './ipc'
import { openIndexStore } from './store/index-store'
import { ensureDataRoot } from './fs/workspace'

const isDev = !app.isPackaged

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b0d12',
    autoHideMenuBar: true,
    title: 'Drawrix',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      // The renderer is untrusted UI code: no node, isolated context, sandboxed.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Anything trying to open a new window goes to the real browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  const devServer = process.env['ELECTRON_RENDERER_URL']
  if (isDev && devServer) {
    win.loadURL(devServer)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return win
}

app.whenReady().then(async () => {
  const index = openIndexStore(app.getPath('userData'))
  registerIpc(index)

  try {
    await ensureDataRoot()
  } catch (err) {
    console.error('[drawrix] could not prepare data root:', err)
  }

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
