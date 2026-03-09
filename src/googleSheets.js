/**
 * Google Sheets integration for Patch Tracker.
 *
 * Usage flow:
 *  1. User enters their Google OAuth Client ID (from Google Cloud Console)
 *  2. User clicks "Connect" → OAuth popup → token stored in memory
 *  3. Push: writes all patches to a Google Sheet (creates one if needed)
 *  4. Pull: reads patches from the Google Sheet
 *  5. Auto-sync: optionally pushes on every change
 */

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets'
const DISCOVERY_DOC = 'https://sheets.googleapis.com/$discovery/rest?version=v4'

const SETTINGS_KEY = 'patch_tracker_gsheets'
const SHEET_NAME = 'Patches'

const COLUMNS = [
  'id', 'name', 'preparedDate', 'releaseDate',
  'environment', 'testingStatus', 'deploymentStatus',
  'responsiblePerson', 'filesChanged',
]

const HEADER_ROW = [
  'ID', 'Patch Name', 'Prepared Date', 'Release Date',
  'Environment', 'Testing Status', 'Deployment Status',
  'Responsible Person', 'Files Changed',
]

let tokenClient = null
let gapiInited = false
let gisInited = false

/* ── persist settings ──────────────────────────── */

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch { return {} }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

/* ── init ──────────────────────────────────────── */

function waitForGapi() {
  return new Promise((resolve) => {
    if (window.gapi) return resolve()
    const iv = setInterval(() => {
      if (window.gapi) { clearInterval(iv); resolve() }
    }, 100)
    setTimeout(() => { clearInterval(iv); resolve() }, 5000)
  })
}

function waitForGoogle() {
  return new Promise((resolve) => {
    if (window.google?.accounts) return resolve()
    const iv = setInterval(() => {
      if (window.google?.accounts) { clearInterval(iv); resolve() }
    }, 100)
    setTimeout(() => { clearInterval(iv); resolve() }, 5000)
  })
}

async function initGapi() {
  if (gapiInited) return
  await waitForGapi()
  await new Promise((res, rej) =>
    window.gapi.load('client', { callback: res, onerror: rej })
  )
  await window.gapi.client.init({})
  await window.gapi.client.load(DISCOVERY_DOC)
  gapiInited = true
}

async function initTokenClient(clientId) {
  if (gisInited) return
  await waitForGoogle()
  tokenClient = window.google.accounts.oauth2.initTokenClient({
    client_id: clientId,
    scope: SCOPES,
    callback: () => {}, // replaced at call time
  })
  gisInited = true
}

/* ── auth ──────────────────────────────────────── */

export async function connect(clientId) {
  await initGapi()
  await initTokenClient(clientId)

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) return reject(new Error(resp.error))
      resolve(resp)
    }
    tokenClient.error_callback = (err) => reject(new Error(err.message || 'Auth failed'))
    tokenClient.requestAccessToken({ prompt: 'consent' })
  })
}

export function disconnect() {
  const token = window.gapi?.client?.getToken()
  if (token) {
    window.google.accounts.oauth2.revoke(token.access_token)
    window.gapi.client.setToken(null)
  }
  gapiInited = false
  gisInited = false
  tokenClient = null
}

export function isConnected() {
  return !!window.gapi?.client?.getToken()
}

/* ── spreadsheet ops ───────────────────────────── */

async function createSpreadsheet(title) {
  const resp = await window.gapi.client.sheets.spreadsheets.create({
    resource: {
      properties: { title },
      sheets: [{ properties: { title: SHEET_NAME } }],
    },
  })
  return resp.result.spreadsheetId
}

async function ensureSheet(spreadsheetId) {
  try {
    const resp = await window.gapi.client.sheets.spreadsheets.get({ spreadsheetId })
    const exists = resp.result.sheets.some(s => s.properties.title === SHEET_NAME)
    if (!exists) {
      await window.gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        resource: {
          requests: [{ addSheet: { properties: { title: SHEET_NAME } } }],
        },
      })
    }
  } catch (e) {
    throw new Error('Cannot access spreadsheet. Check the ID and permissions.')
  }
}

/* ── push patches to sheet ─────────────────────── */

export async function pushToSheet(patches, spreadsheetId) {
  if (!spreadsheetId) {
    spreadsheetId = await createSpreadsheet('Patch Tracker')
  } else {
    await ensureSheet(spreadsheetId)
  }

  const rows = [HEADER_ROW]
  for (const p of patches) {
    rows.push(COLUMNS.map(c => p[c] || ''))
  }

  // Clear existing data then write
  await window.gapi.client.sheets.spreadsheets.values.clear({
    spreadsheetId,
    range: `${SHEET_NAME}!A:I`,
  })

  await window.gapi.client.sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    resource: { values: rows },
  })

  return spreadsheetId
}

/* ── pull patches from sheet ───────────────────── */

export async function pullFromSheet(spreadsheetId) {
  await ensureSheet(spreadsheetId)

  const resp = await window.gapi.client.sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `${SHEET_NAME}!A:I`,
  })

  const rows = resp.result.values || []
  if (rows.length <= 1) return [] // only header or empty

  // Skip header row
  return rows.slice(1).map(row => {
    const obj = {}
    COLUMNS.forEach((col, i) => { obj[col] = row[i] || '' })
    if (!obj.id) obj.id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`
    return obj
  })
}
