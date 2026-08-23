/**
 * Telegram Bot Webhook script for Public Seating Tracker.
 * Implements a state machine in Google Sheets to collect:
 * 1. Photo (auto-extracts EXIF GPS if sent as File/Document, otherwise falls back to location attachment)
 * 2. Location Confirmation (Yes/No)
 * 3. Seating Category (Permanent, Temporary, etc.)
 * 4. Comments (Optional, with [Skip] button)
 * 
 * Sets up file sharing on Google Drive and writes data to SeatingData sheet.
 */

var BOT_TOKEN = '8573820056:AAFiZktGO-A8vd-9xlXf2NwDEW6piD5JNo0'; // <-- Replace with your HTTP API token from @BotFather
var SHEET_NAME_DATA = 'SeatingData';
var SHEET_NAME_STATE = 'UserState';
var DRIVE_FOLDER_PATH = 'Antigravity Projects/Seating_Images_Folder'; // <-- Path in Google Drive to save photos (separated by '/')

/**
 * Handle incoming webhooks from Telegram Bot API
 */
function doPost(e) {
  try {
    var update = JSON.parse(e.postData.contents);
    var message = update.message;
    var callbackQuery = update.callback_query;
    
    var chatId = "";
    var userText = "";
    var isCallback = false;
    var callbackData = "";
    var callbackId = "";
    
    if (message) {
      chatId = message.chat.id.toString();
      userText = message.text ? message.text.trim() : "";
    } else if (callbackQuery) {
      chatId = callbackQuery.message.chat.id.toString();
      isCallback = true;
      callbackData = callbackQuery.data;
      callbackId = callbackQuery.id;
    } else {
      return HtmlService.createHtmlOutput("OK");
    }
    
    // Fetch or initialize user state from UserState sheet
    var stateObj = getUserState(chatId);
    
    // Command overrides (Start over)
    if (userText.toLowerCase() === '/start' || userText.toLowerCase() === '/cancel') {
      clearUserState(chatId);
      tgSendMessage(chatId, "Welcome to the Public Seating Tracker Bot! 🪑\n\nTo log a public seat, please send its photo.\n\n💡 *Tip*: If you want the bot to automatically extract the location from your photo, send the photo as an uncompressed *'File'* or *'Document'*. If you send it as a standard photo (or if it doesn't have GPS data), the bot will ask you to send your location using Telegram's location sharing feature.");
      return HtmlService.createHtmlOutput("OK");
    }
    
    // STATE MACHINE LOGIC
    switch (stateObj.State) {
      
      case 'AWAITING_PHOTO':
        // Check if user sent a file (Document) or standard Photo
        var fileId = "";
        var isJPEG = false;
        
        if (message && message.document) {
          fileId = message.document.file_id;
          var mime = message.document.mime_type || "";
          isJPEG = (mime.toLowerCase() === "image/jpeg" || mime.toLowerCase() === "image/jpg");
        } else if (message && message.photo) {
          // message.photo is an array of different sizes. Get the largest one.
          var photoArray = message.photo;
          fileId = photoArray[photoArray.length - 1].file_id;
          isJPEG = true; // Telegram converts standard photos to JPEG internally
        }
        
        if (fileId !== "") {
          tgSendMessage(chatId, "Analyzing image. Please wait...");
          
          var gpsData = null;
          // Only attempt binary EXIF parsing if they sent it as a JPEG Document (uncompressed)
          if (message.document && isJPEG) {
            var fileBytes = tgDownloadFileById(fileId);
            if (fileBytes) {
              gpsData = getGpsFromExif(fileBytes);
            }
          }
          
          if (gpsData) {
            stateObj.State = 'AWAITING_LOCATION_CONFIRMATION';
            stateObj.Latitude = gpsData.latitude;
            stateObj.Longitude = gpsData.longitude;
            stateObj.FileID = fileId;
            setUserState(chatId, stateObj);
            
            var confirmKeyboard = {
              inline_keyboard: [
                [
                  { text: "🔵 Yes, Confirm Location", callback_data: "confirm_gps_yes" },
                  { text: "🔴 No, Send Manually", callback_data: "confirm_gps_no" }
                ]
              ]
            };
            tgSendMessage(chatId, "📍 Location found in photo metadata:\nLatitude: " + gpsData.latitude + "\nLongitude: " + gpsData.longitude + "\n\nIs this the correct seating location?", confirmKeyboard);
          } else {
            // No EXIF data found (either standard photo or no metadata)
            stateObj.State = 'AWAITING_LOCATION';
            stateObj.FileID = fileId;
            setUserState(chatId, stateObj);
            
            var note = message.document ? "I couldn't find GPS metadata in this file. " : "Standard Telegram photos don't contain location metadata. ";
            tgSendMessage(chatId, note + "Please send the seat's location by tapping the clip icon 📎 and choosing *'Location'*.");
          }
        } else {
          tgSendMessage(chatId, "Please send a photo of a seat (as a standard Photo or uncompressed JPEG Document) to start logging.");
        }
        break;
        
      case 'AWAITING_LOCATION':
        if (message && message.location) {
          stateObj.State = 'AWAITING_LOCATION_CONFIRMATION';
          stateObj.Latitude = message.location.latitude;
          stateObj.Longitude = message.location.longitude;
          setUserState(chatId, stateObj);
          
          var locConfirmKeyboard = {
            inline_keyboard: [
              [
                { text: "🔵 Yes, Confirm Location", callback_data: "confirm_gps_yes" },
                { text: "🔴 Cancel & Start Over", callback_data: "cancel_flow" }
              ]
            ]
          };
          tgSendMessage(chatId, "Received location: " + stateObj.Latitude + ", " + stateObj.Longitude + ".\nConfirm location?", locConfirmKeyboard);
        } else {
          tgSendMessage(chatId, "I'm waiting for a location. Please send a location attachment via the clip menu 📎, or send `/cancel` to start over.");
        }
        break;
        
      case 'AWAITING_LOCATION_CONFIRMATION':
        if (isCallback) {
          tgAnswerCallback(callbackId, "Processing...");
          if (callbackData === "confirm_gps_yes") {
            stateObj.State = 'AWAITING_CATEGORY';
            setUserState(chatId, stateObj);
            
            var categoryKeyboard = {
              inline_keyboard: [
                [
                  { text: "🔵 Permanent", callback_data: "cat_Permanent" },
                  { text: "🟢 Temporary", callback_data: "cat_Temporary" }
                ],
                [
                  { text: "🟠 Off-the-shelf", callback_data: "cat_Off-the-shelf" },
                  { text: "🔴 Site-specific", callback_data: "cat_Site-specific" }
                ]
              ]
            };
            tgSendMessage(chatId, "Location confirmed! Now select the seating category:", categoryKeyboard);
          } else if (callbackData === "confirm_gps_no") {
            stateObj.State = 'AWAITING_LOCATION';
            setUserState(chatId, stateObj);
            tgSendMessage(chatId, "Understood. Please send the correct location using the Telegram clip menu 📎 > *'Location'*.");
          } else {
            clearUserState(chatId);
            tgSendMessage(chatId, "Cancelled. Send a new photo when you're ready to start over.");
          }
        } else {
          tgSendMessage(chatId, "Please confirm the location by tapping the buttons above.");
        }
        break;
        
      case 'AWAITING_CATEGORY':
        if (isCallback && callbackData.indexOf("cat_") === 0) {
          tgAnswerCallback(callbackId, "Category Selected");
          var category = callbackData.replace("cat_", "");
          stateObj.State = 'AWAITING_COMMENTS';
          stateObj.Category = category;
          setUserState(chatId, stateObj);
          
          var skipKeyboard = {
            inline_keyboard: [
              [{ text: "⏩ Skip Comments", callback_data: "skip_comments" }]
            ]
          };
          tgSendMessage(chatId, "Category selected: *" + category + "*.\n\nNow, send any additional comments or design observations. (Or click the button below to skip).", skipKeyboard);
        } else {
          tgSendMessage(chatId, "Please select a category from the buttons above.");
        }
        break;
        
      case 'AWAITING_COMMENTS':
        var comments = "";
        var shouldSave = false;
        
        if (isCallback && callbackData === "skip_comments") {
          tgAnswerCallback(callbackId, "Comments Skipped");
          shouldSave = true;
        } else if (message && userText !== "") {
          comments = userText;
          shouldSave = true;
        }
        
        if (shouldSave) {
          tgSendMessage(chatId, "Uploading photo and saving data to Google Sheets. One moment...");
          
          var publicUrl = "";
          // Download the file from Telegram and save to Google Drive
          if (stateObj.FileID) {
            var fileBlob = tgDownloadFileById(stateObj.FileID);
            if (fileBlob) {
              // Create image name based on date/timestamp
              var name = "Seat_" + Utilities.formatDate(new Date(), "GMT-7", "yyyyMMdd_HHmmss") + ".jpg";
              fileBlob.setName(name);
              
              var folder = getDriveFolder();
              var driveFile = folder.createFile(fileBlob);
              
              // Set sharing to Anyone with link can view
              driveFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
              
              // Direct URL format for Google My Maps
              publicUrl = "https://lh3.googleusercontent.com/d/" + driveFile.getId();
            }
          }
          
          // Write to SeatingData Sheet (self-healing)
          var ss = SpreadsheetApp.getActiveSpreadsheet();
          var dataSheet = ss.getSheetByName(SHEET_NAME_DATA);
          if (!dataSheet) {
            setupDatabase();
            dataSheet = ss.getSheetByName(SHEET_NAME_DATA);
          }
          var timestamp = Utilities.formatDate(new Date(), "GMT-7", "yyyy-MM-dd HH:mm:ss");
          var unifiedLoc = stateObj.Latitude + "," + stateObj.Longitude;
          
          dataSheet.appendRow([
            timestamp,
            unifiedLoc,
            stateObj.Latitude,
            stateObj.Longitude,
            publicUrl,
            stateObj.Category,
            comments
          ]);
          
          clearUserState(chatId);
          tgSendMessage(chatId, "✅ *Seat logged successfully!*\n\n- *Type*: " + stateObj.Category + "\n- *Location*: " + unifiedLoc + "\n- *Comments*: " + (comments || "_None_") + "\n\nThank you for contributing! Send a new photo to log another seat.");
        } else {
          tgSendMessage(chatId, "Please type and send your comments, or tap the button to skip.");
        }
        break;
    }
    
  } catch (err) {
    Logger.log("doPost Error: " + err.toString());
    if (chatId) {
      tgSendMessage(chatId, "❌ *An error occurred in the bot script:*\n`" + err.toString() + "`\n\nPlease check your spreadsheet setup or script permissions.");
    }
  }
  return HtmlService.createHtmlOutput("OK");
}

/* ==========================================
   STATE SHEET DATABASE HELPER FUNCTIONS
   ========================================== */

function getUserState(chatId) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var stateSheet = ss.getSheetByName(SHEET_NAME_STATE);
  if (!stateSheet) {
    setupDatabase();
    stateSheet = ss.getSheetByName(SHEET_NAME_STATE);
  }
  var data = stateSheet.getDataRange().getValues();
  
  for (var i = 1; i < data.length; i++) {
    if (data[i][0].toString() === chatId) {
      return {
        ChatID: chatId,
        State: data[i][1],
        Latitude: data[i][2],
        Longitude: data[i][3],
        PhotoURL: data[i][4],
        FileID: data[i][5],
        Category: data[i][6],
        RowIndex: i + 1
      };
    }
  }
  
  // Initialize new state row
  var defaultState = {
    ChatID: chatId,
    State: 'AWAITING_PHOTO',
    Latitude: "",
    Longitude: "",
    PhotoURL: "",
    FileID: "",
    Category: ""
  };
  stateSheet.appendRow([chatId, 'AWAITING_PHOTO', "", "", "", "", ""]);
  defaultState.RowIndex = stateSheet.getLastRow();
  return defaultState;
}

function setUserState(chatId, stateObj) {
  var stateSheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME_STATE);
  var row = stateObj.RowIndex;
  
  stateSheet.getRange(row, 2).setValue(stateObj.State);
  stateSheet.getRange(row, 3).setValue(stateObj.Latitude);
  stateSheet.getRange(row, 4).setValue(stateObj.Longitude);
  stateSheet.getRange(row, 5).setValue(stateObj.PhotoURL);
  stateSheet.getRange(row, 6).setValue(stateObj.FileID);
  stateSheet.getRange(row, 7).setValue(stateObj.Category);
}

function clearUserState(chatId) {
  var stateObj = getUserState(chatId);
  stateObj.State = 'AWAITING_PHOTO';
  stateObj.Latitude = "";
  stateObj.Longitude = "";
  stateObj.PhotoURL = "";
  stateObj.FileID = "";
  stateObj.Category = "";
  setUserState(chatId, stateObj);
}

function getDriveFolder() {
  var folder = DriveApp.getRootFolder();
  
  if (DRIVE_FOLDER_PATH && DRIVE_FOLDER_PATH.trim() !== "") {
    var parts = DRIVE_FOLDER_PATH.split("/");
    for (var i = 0; i < parts.length; i++) {
      var part = parts[i].trim();
      if (part === "") continue;
      
      var folders = folder.getFoldersByName(part);
      if (folders.hasNext()) {
        folder = folders.next();
      } else {
        // Create folder if missing along the path
        folder = folder.createFolder(part);
        // Ensure folder has public view sharing permissions so images inside load correctly in My Maps
        folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
      }
    }
    return folder;
  }
  
  // Fallback: parent folder of the current Google Sheet, or default to root
  var sheetFile = DriveApp.getFileById(SpreadsheetApp.getActiveSpreadsheet().getId());
  var parents = sheetFile.getParents();
  if (parents.hasNext()) {
    return parents.next();
  }
  return folder;
}

/* ==========================================
   TELEGRAM BOT API HELPER FUNCTIONS
   ========================================== */

function tgSendMessage(chatId, text, keyboard) {
  var payload = {
    method: "sendMessage",
    chat_id: chatId,
    text: text,
    parse_mode: "Markdown"
  };
  
  if (keyboard) {
    payload.reply_markup = JSON.stringify(keyboard);
  }
  
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  
  UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/", options);
}

function tgAnswerCallback(callbackId, text) {
  var payload = {
    method: "answerCallbackQuery",
    callback_query_id: callbackId,
    text: text
  };
  
  var options = {
    method: "post",
    contentType: "application/json",
    payload: JSON.stringify(payload)
  };
  
  UrlFetchApp.fetch("https://api.telegram.org/bot" + BOT_TOKEN + "/", options);
}

function tgDownloadFileById(fileId) {
  // 1. Get file path
  var getFileUrl = "https://api.telegram.org/bot" + BOT_TOKEN + "/getFile?file_id=" + fileId;
  var response = UrlFetchApp.fetch(getFileUrl);
  var json = JSON.parse(response.getContentText());
  
  if (json.ok) {
    var filePath = json.result.file_path;
    // 2. Download file stream
    var downloadUrl = "https://api.telegram.org/file/bot" + BOT_TOKEN + "/" + filePath;
    return UrlFetchApp.fetch(downloadUrl).getBlob();
  }
  return null;
}

/* ==========================================
   BINARY EXIF GEOLOCATION DECODER
   ========================================== */

function getGpsFromExif(fileBlob) {
  try {
    var bytes = fileBlob.getBytes();
    
    // Check JPEG signature: 0xFFD8
    if (bytes.length < 4 || (bytes[0] & 0xFF) !== 0xFF || (bytes[1] & 0xFF) !== 0xD8) {
      return null;
    }
    
    var offset = 2;
    var app1Offset = -1;
    
    // Search for APP1 Marker (0xFFE1)
    while (offset < bytes.length - 1) {
      var markerByte = bytes[offset] & 0xFF;
      var marker = bytes[offset + 1] & 0xFF;
      
      if (markerByte === 0xFF) {
        if (marker === 0xE1) {
          app1Offset = offset;
          break;
        } else if (marker === 0xD9) { // End of Image
          break;
        }
        var blockLength = ((bytes[offset + 2] & 0xFF) << 8) | (bytes[offset + 3] & 0xFF);
        offset += blockLength + 2;
      } else {
        offset++;
      }
    }
    
    if (app1Offset === -1) return null;
    
    // EXIF header check
    var headerOffset = app1Offset + 4;
    var exifHeader = String.fromCharCode(
      bytes[headerOffset] & 0xFF,
      bytes[headerOffset + 1] & 0xFF,
      bytes[headerOffset + 2] & 0xFF,
      bytes[headerOffset + 3] & 0xFF
    );
    
    if (exifHeader !== "Exif") return null;
    
    var tiffOffset = app1Offset + 10;
    var byteOrder = String.fromCharCode(bytes[tiffOffset] & 0xFF, bytes[tiffOffset + 1] & 0xFF);
    var isLittle = (byteOrder === "II");
    
    // Custom binary reader object
    var reader = {
      readUShort: function(o) {
        var p = tiffOffset + o;
        var b1 = bytes[p] & 0xFF;
        var b2 = bytes[p + 1] & 0xFF;
        return isLittle ? (b2 << 8) | b1 : (b1 << 8) | b2;
      },
      readULong: function(o) {
        var p = tiffOffset + o;
        var b1 = bytes[p] & 0xFF;
        var b2 = bytes[p + 1] & 0xFF;
        var b3 = bytes[p + 2] & 0xFF;
        var b4 = bytes[p + 3] & 0xFF;
        return isLittle ? 
          (b1 + (b2 << 8) + (b3 << 16) + (b4 * 0x1000000)) :
          (b4 + (b3 << 8) + (b2 << 16) + (b1 * 0x1000000));
      },
      readRational: function(o) {
        var num = this.readULong(o);
        var den = this.readULong(o + 4);
        return den === 0 ? 0 : num / den;
      }
    };
    
    // Verify magic number (42)
    var magic = reader.readUShort(2);
    if (magic !== 42) return null;
    
    // Offset to 0th IFD
    var ifd0Offset = reader.readULong(4);
    var gpsIfdOffset = -1;
    
    // Read 0th IFD entries
    var entriesCount = reader.readUShort(ifd0Offset);
    for (var i = 0; i < entriesCount; i++) {
      var entryPos = ifd0Offset + 2 + i * 12;
      var tag = reader.readUShort(entryPos);
      if (tag === 0x8825) { // GPS Info IFD Pointer
        gpsIfdOffset = reader.readULong(entryPos + 8);
        break;
      }
    }
    
    if (gpsIfdOffset === -1) return null;
    
    // Read GPS Directory
    var gpsEntriesCount = reader.readUShort(gpsIfdOffset);
    var latRef = "";
    var latRaw = [];
    var lngRef = "";
    var lngRaw = [];
    
    for (var j = 0; j < gpsEntriesCount; j++) {
      var gpsEntryPos = gpsIfdOffset + 2 + j * 12;
      var gpsTag = reader.readUShort(gpsEntryPos);
      var valOffset = reader.readULong(gpsEntryPos + 8);
      
      if (gpsTag === 1) { // GPSLatitudeRef
        latRef = String.fromCharCode(bytes[tiffOffset + gpsEntryPos + 8] & 0xFF);
      } else if (gpsTag === 2) { // GPSLatitude
        latRaw = readRationalArray(reader, valOffset, 3);
      } else if (gpsTag === 3) { // GPSLongitudeRef
        lngRef = String.fromCharCode(bytes[tiffOffset + gpsEntryPos + 8] & 0xFF);
      } else if (gpsTag === 4) { // GPSLongitude
        lngRaw = readRationalArray(reader, valOffset, 3);
      }
    }
    
    if (latRaw.length === 3 && lngRaw.length === 3) {
      var latitude = convertDmsToDd(latRaw[0], latRaw[1], latRaw[2], latRef);
      var longitude = convertDmsToDd(lngRaw[0], lngRaw[1], lngRaw[2], lngRef);
      
      return {
        latitude: Math.round(latitude * 1000000) / 1000000,
        longitude: Math.round(longitude * 1000000) / 1000000
      };
    }
    
  } catch (e) {
    Logger.log("EXIF Decryption error: " + e.toString());
  }
  return null;
}

function readRationalArray(reader, offset, length) {
  var arr = [];
  for (var i = 0; i < length; i++) {
    arr.push(reader.readRational(offset + i * 8));
  }
  return arr;
}

function convertDmsToDd(degrees, minutes, seconds, ref) {
  var dd = degrees + (minutes / 60) + (seconds / 3600);
  if (ref === "S" || ref === "W") {
    dd = -dd;
  }
  return dd;
}

/**
 * Automatically creates and configures the required worksheets ("SeatingData" and "UserState") 
 * and writes their header rows.
 * Select this function in the Apps Script editor dropdown and click "Run" to initialize your database!
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 1. Setup SeatingData Sheet
  var dataSheet = ss.getSheetByName(SHEET_NAME_DATA);
  if (!dataSheet) {
    dataSheet = ss.insertSheet(SHEET_NAME_DATA);
    Logger.log("Created sheet: " + SHEET_NAME_DATA);
  }
  var dataHeaders = ["Timestamp", "Location", "Latitude", "Longitude", "Photo URL", "Seating Type", "Description"];
  dataSheet.getRange(1, 1, 1, dataHeaders.length).setValues([dataHeaders]);
  // Set format for Timestamp column (A) to DateTime
  dataSheet.getRange("A:A").setNumberFormat("yyyy-mm-dd hh:mm:ss");
  Logger.log("Headers configured for " + SHEET_NAME_DATA);

  // 2. Setup UserState Sheet
  var stateSheet = ss.getSheetByName(SHEET_NAME_STATE);
  if (!stateSheet) {
    stateSheet = ss.insertSheet(SHEET_NAME_STATE);
    Logger.log("Created sheet: " + SHEET_NAME_STATE);
  }
  var stateHeaders = ["ChatID", "State", "Latitude", "Longitude", "PhotoURL", "FileID", "Category"];
  stateSheet.getRange(1, 1, 1, stateHeaders.length).setValues([stateHeaders]);
  Logger.log("Headers configured for " + SHEET_NAME_STATE);
  
  // 3. Remove default "Sheet1" if it is empty to keep the database tidy
  var defaultSheet = ss.getSheetByName("Sheet1");
  if (defaultSheet && defaultSheet.getLastRow() === 0 && defaultSheet.getLastColumn() === 0) {
    try {
      ss.deleteSheet(defaultSheet);
      Logger.log("Deleted default Sheet1 since it was empty.");
    } catch(e) {
      // Ignore if it's the only sheet or has issues deleting
    }
  }
  
  Logger.log("🎉 Database Setup Complete! Your worksheets and columns are ready.");
}
