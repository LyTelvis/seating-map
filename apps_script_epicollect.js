/**
 * Google Apps Script for Epicollect5 Google Sheets Sync.
 * Automatically fetches entries from your public Epicollect5 project and populates your Google Sheet.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet.
 * 2. Click "Extensions" > "Apps Script".
 * 3. Copy this entire file and paste it into the editor.
 * 4. Replace 'YOUR-PROJECT-SLUG' with your Epicollect5 project shortname (line 22).
 * 5. Click Save.
 * 6. Set up a Time-driven Trigger:
 *    - Click the clock icon ("Triggers") on the left.
 *    - Click "+ Add Trigger".
 *    - Run function: select "syncEpicollectData"
 *    - Select event source: select "Time-driven"
 *    - Select type of time based trigger: select "Hour timer" (runs once an hour)
 *    - Click Save and authorize.
 */

var PROJECT_SLUG = 'public-seating-tracker'; // <-- Replace with your Epicollect5 slug (e.g., 'public-seating-tracker')

function syncEpicollectData() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  
  // Epicollect5 JSON endpoint
  var url = "https://five.epicollect.net/api/export/entries/" + PROJECT_SLUG + "?format=json";
  
  try {
    var response = UrlFetchApp.fetch(url);
    var json = JSON.parse(response.getContentText());
    var entries = json.data.entries;
    
    if (!entries || entries.length === 0) {
      Logger.log("No entries found in Epicollect5 project.");
      return;
    }
    
    // Clear sheet and rewrite header
    sheet.clear();
    var headers = ["Timestamp", "Location", "Latitude", "Longitude", "Photo", "Public Photo URL", "Seating Type", "Description"];
    sheet.appendRow(headers);
    
    var rowsToWrite = [];
    
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i];
      
      // Extract properties (using Epicollect field IDs)
      var timestamp = entry.created_at || "";
      var seatingType = entry.seating_type || "";
      var description = entry.description || "";
      var photoName = entry.photo || "";
      
      // Compile direct public photo URL from Epicollect servers
      var publicPhotoUrl = "";
      if (photoName) {
        publicPhotoUrl = "https://five.epicollect.net/api/export/media/" + PROJECT_SLUG + "?name=" + photoName + "&type=photo";
      }
      
      // Parse coordinates from Epicollect location object
      var latitude = "";
      var longitude = "";
      var locationUnified = "";
      
      if (entry.location && typeof entry.location === 'object') {
        latitude = entry.location.latitude || "";
        longitude = entry.location.longitude || "";
        if (latitude !== "" && longitude !== "") {
          locationUnified = latitude + "," + longitude;
        }
      }
      
      // Align with our template columns
      rowsToWrite.push([
        timestamp,
        locationUnified,
        latitude,
        longitude,
        photoName,
        publicPhotoUrl,
        seatingType,
        description
      ]);
    }
    
    // Batch write to sheet for performance
    if (rowsToWrite.length > 0) {
      sheet.getRange(2, 1, rowsToWrite.length, headers.length).setValues(rowsToWrite);
      Logger.log("Successfully synced " + rowsToWrite.length + " entries from Epicollect5.");
    }
    
  } catch (error) {
    Logger.log("Error syncing Epicollect5 data: " + error.toString());
  }
}
