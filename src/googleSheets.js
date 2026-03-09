/**
 * Google Apps Script–based backend for Patch Tracker.
 *
 * Setup (one-time, by any team member):
 *  1. Create a Google Sheet
 *  2. Create a Google Drive folder for patch files, copy its folder ID from the URL
 *  3. Extensions → Apps Script → paste the script from the setup guide
 *  4. Update DRIVE_FOLDER_ID in the script with your folder ID
 *  5. Deploy → Web app → Execute as "Me", access "Anyone"
 *  6. Copy the Web App URL → paste into Patch Tracker settings
 *  7. Share the Google Sheet & Drive folder with your team manually
 *
 * Permissions requested:
 *  - Google Sheets: read/write the CURRENT spreadsheet only
 *  - Google Drive: create files in a SPECIFIC folder only (no delete, no browse)
 */

const SETTINGS_KEY = 'patch_tracker_settings'

/* ── settings persistence ──────────────────────── */

export function loadSettings() {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}
  } catch { return {} }
}

export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

/* ── API calls to Apps Script web app ──────────── */

export async function pushPatches(webAppUrl, patches) {
  const resp = await fetch(webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'save', patches }),
  })
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  return data
}

export async function pullPatches(webAppUrl) {
  const resp = await fetch(`${webAppUrl}?action=pull&t=${Date.now()}`)
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  return data.patches || []
}

export async function uploadFileToDrive(webAppUrl, file, patchName) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(',')[1]
        const resp = await fetch(webAppUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: JSON.stringify({
            action: 'upload',
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            base64Data: base64,
            folderName: patchName || 'Patch Files',
          }),
        })
        const data = await resp.json()
        if (data.error) throw new Error(data.error)
        resolve(data)
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export async function fetchFileFromDrive(webAppUrl, fileId) {
  const resp = await fetch(webAppUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({ action: 'download', fileId }),
  })
  const data = await resp.json()
  if (data.error) throw new Error(data.error)
  // Convert base64 back to Blob
  const binary = atob(data.base64Data)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: data.mimeType || 'application/zip' })
}

/* ── URL parsers ───────────────────────────────── */

export function extractFolderIdFromUrl(url) {
  // https://drive.google.com/drive/folders/FOLDER_ID or just the ID
  const m = url.match(/folders\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : url.trim()
}

export function extractSheetIdFromUrl(url) {
  // https://docs.google.com/spreadsheets/d/SHEET_ID/... or just the ID
  const m = url.match(/spreadsheets\/d\/([a-zA-Z0-9_-]+)/)
  return m ? m[1] : url.trim()
}

/* ── Google Apps Script template ───────────────── */

export function generateAppsScript(folderId = '') {
  return `// ========================================
// Patch Tracker — Google Apps Script
// Auto-generated — paste into Extensions > Apps Script
// Deploy as Web App (Execute as: Me, Access: Anyone)
// ========================================

const SHEET_NAME = 'Patches';
const DRIVE_FOLDER_ID = '${folderId}';

function doGet(e) {
  try {
    return jsonResponse({ patches: readPatches() });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.action === 'save') {
      writePatches(body.patches);
      return jsonResponse({ success: true, count: body.patches.length });
    }

    if (body.action === 'upload') {
      var result = uploadFile(body.fileName, body.mimeType, body.base64Data, body.folderName);
      return jsonResponse(result);
    }

    if (body.action === 'download') {
      var result = downloadFile(body.fileId);
      return jsonResponse(result);
    }

    return jsonResponse({ error: 'Unknown action' });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── Read patches from the sheet ──
function readPatches() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) return [];

  var data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];

  var headers = data[0];
  var patches = [];
  for (var i = 1; i < data.length; i++) {
    var row = data[i];
    var patch = {};
    for (var j = 0; j < headers.length; j++) {
      var val = row[j];
      // Parse JSON fields
      if ((headers[j] === 'codeFiles' || headers[j] === 'dbScripts') &&
          typeof val === 'string' && val.charAt(0) === '[') {
        try { val = JSON.parse(val); } catch(e) { val = []; }
      }
      patch[headers[j]] = val || '';
    }
    if (patch.id) patches.push(patch);
  }
  return patches;
}

// ── Write patches to the sheet ──
function writePatches(patches) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(SHEET_NAME);

  var headers = [
    'id', 'name', 'preparedDate', 'releaseDate',
    'environment', 'testingStatus', 'deploymentStatus',
    'responsiblePerson', 'codeFiles', 'dbScripts'
  ];

  var rows = [headers];
  for (var i = 0; i < patches.length; i++) {
    var p = patches[i];
    var row = [];
    for (var j = 0; j < headers.length; j++) {
      var val = p[headers[j]];
      if (Array.isArray(val)) val = JSON.stringify(val);
      row.push(val || '');
    }
    rows.push(row);
  }

  sheet.clear();
  sheet.getRange(1, 1, rows.length, headers.length).setValues(rows);

  // Format header
  var hr = sheet.getRange(1, 1, 1, headers.length);
  hr.setFontWeight('bold');
  hr.setBackground('#1b1c1e');
  hr.setFontColor('#4ade80');
}

// ── Upload file to Drive (create only, no delete) ──
function uploadFile(fileName, mimeType, base64Data, folderName) {
  if (!DRIVE_FOLDER_ID) {
    return { error: 'DRIVE_FOLDER_ID not set in Apps Script. Edit the script and add your folder ID.' };
  }

  var rootFolder = DriveApp.getFolderById(DRIVE_FOLDER_ID);

  // Find or create sub-folder for this patch
  var subFolder;
  var subs = rootFolder.getFoldersByName(folderName);
  if (subs.hasNext()) {
    subFolder = subs.next();
  } else {
    subFolder = rootFolder.createFolder(folderName);
  }

  // Decode and create file (no sharing change — you share manually)
  var decoded = Utilities.base64Decode(base64Data);
  var blob = Utilities.newBlob(decoded, mimeType, fileName);
  var file = subFolder.createFile(blob);

  return {
    success: true,
    fileId: file.getId(),
    fileName: file.getName(),
    fileUrl: file.getUrl(),
    downloadUrl: 'https://drive.google.com/uc?export=download&id=' + file.getId()
  };
}

// ── Download file from Drive (returns base64) ──
function downloadFile(fileId) {
  if (!fileId) return { error: 'fileId is required' };
  var file = DriveApp.getFileById(fileId);
  var blob = file.getBlob();
  var base64Data = Utilities.base64Encode(blob.getBytes());
  return {
    success: true,
    base64Data: base64Data,
    mimeType: blob.getContentType(),
    fileName: file.getName()
  };
}`
}
