/**
 * Google Apps Script for Public Seating Tracker.
 * Automatically:
 * 1. Converts relative AppSheet image paths into public Google Drive direct-view URLs.
 * 2. Reads EXIF geolocation metadata from uploaded photos and auto-populates Latitude/Longitude.
 * 
 * SETUP INSTRUCTIONS:
 * 1. Open your Google Sheet.
 * 2. Click on "Extensions" > "Apps Script".
 * 3. Delete any default code and paste this script.
 * 4. Click the Save icon (floppy disk).
 * 5. On the left menu, click the clock icon ("Triggers").
 * 6. Click "+ Add Trigger" in the bottom right.
 * 7. Configure the trigger:
 *    - Choose which function to run: select "generatePublicPhotoUrls"
 *    - Choose which deployment should run: select "Head"
 *    - Select event source: select "From spreadsheet"
 *    - Select event type: select "On change"
 *    - Failure notification settings: select "Notify me immediately"
 * 8. Click Save, and authorize the script when prompted.
 */

function generatePublicPhotoUrls(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  var data = sheet.getDataRange().getValues();
  
  if (data.length <= 1) return; // No rows or only headers
  
  // Find column headers
  var headers = data[0];
  var photoColIdx = headers.indexOf("Photo");
  var locationColIdx = headers.indexOf("Location");
  var latColIdx = headers.indexOf("Latitude");
  var lngColIdx = headers.indexOf("Longitude");
  var publicUrlColIdx = headers.indexOf("Public Photo URL");
  
  if (photoColIdx === -1 || publicUrlColIdx === -1) {
    Logger.log("Error: 'Photo' or 'Public Photo URL' column not found.");
    return;
  }
  
  var updatedCount = 0;
  
  // Loop through rows starting from index 1 (skipping header)
  for (var i = 1; i < data.length; i++) {
    var photoVal = data[i][photoColIdx].toString().trim();
    var publicUrlVal = data[i][publicUrlColIdx].toString().trim();
    var latVal = latColIdx !== -1 ? data[i][latColIdx] : "";
    var lngVal = lngColIdx !== -1 ? data[i][lngColIdx] : "";
    var locationVal = locationColIdx !== -1 ? data[i][locationColIdx].toString().trim() : "";
    
    // Process if there is a photo path
    if (photoVal !== "") {
      var filename = photoVal.split('/').pop();
      var files = DriveApp.getFilesByName(filename);
      
      if (files.hasNext()) {
        var file = files.next();
        
        // 1. Check for EXIF Geolocation if coordinates are currently missing
        var coordinatesUpdated = false;
        var needsLocation = (latVal === "" || lngVal === "" || locationVal === "");
        
        if (needsLocation) {
          Logger.log("Row " + (i + 1) + " is missing location. Extracting EXIF from file: " + filename);
          var gpsData = getGpsFromExif(file);
          
          if (gpsData) {
            Logger.log("Extracted GPS coordinates from EXIF: " + gpsData.latitude + ", " + gpsData.longitude);
            
            // Write latitude
            if (latColIdx !== -1) {
              sheet.getRange(i + 1, latColIdx + 1).setValue(gpsData.latitude);
            }
            // Write longitude
            if (lngColIdx !== -1) {
              sheet.getRange(i + 1, lngColIdx + 1).setValue(gpsData.longitude);
            }
            // Write Location (Lat,Lng format)
            if (locationColIdx !== -1) {
              var unifiedLocation = gpsData.latitude + "," + gpsData.longitude;
              sheet.getRange(i + 1, locationColIdx + 1).setValue(unifiedLocation);
            }
            coordinatesUpdated = true;
          } else {
            Logger.log("No EXIF GPS metadata found in file " + filename);
          }
        }
        
        // 2. Generate Public Link if missing
        if (publicUrlVal === "") {
          try {
            // Set permissions: Anyone with the link can view
            file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
            
            // Generate direct sharing URL
            var directUrl = "https://lh3.googleusercontent.com/d/" + file.getId();
            
            sheet.getRange(i + 1, publicUrlColIdx + 1).setValue(directUrl);
            Logger.log("Generated public photo link for row " + (i + 1) + ": " + directUrl);
            updatedCount++;
          } catch (err) {
            Logger.log("Error generating link for row " + (i + 1) + ": " + err.message);
          }
        } else if (coordinatesUpdated) {
          updatedCount++;
        }
      } else {
        Logger.log("Warning: File '" + filename + "' not found in Drive yet. Will retry.");
      }
    }
  }
  
  Logger.log("Finished execution. Updated rows: " + updatedCount);
}

/**
 * EXIF Geolocation Parser for JPEG files.
 * Extracts Latitude and Longitude from binary EXIF headers.
 */
function getGpsFromExif(file) {
  try {
    var blob = file.getBlob();
    var bytes = blob.getBytes();
    
    // Check JPEG signature: 0xFFD8
    if (bytes.length < 4 || (bytes[0] & 0xFF) !== 0xFF || (bytes[1] & 0xFF) !== 0xD8) {
      return null;
    }
    
    var offset = 2;
    var app1Offset = -1;
    
    // Search for APP1 Marker (0xFFE1) containing EXIF segment
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
        // Advance by block length (2 bytes length info)
        var blockLength = ((bytes[offset + 2] & 0xFF) << 8) | (bytes[offset + 3] & 0xFF);
        offset += blockLength + 2;
      } else {
        offset++;
      }
    }
    
    if (app1Offset === -1) return null;
    
    // EXIF header check: "Exif\0\0" (6 bytes)
    var headerOffset = app1Offset + 4;
    var exifHeader = String.fromCharCode(
      bytes[headerOffset] & 0xFF,
      bytes[headerOffset + 1] & 0xFF,
      bytes[headerOffset + 2] & 0xFF,
      bytes[headerOffset + 3] & 0xFF
    );
    
    if (exifHeader !== "Exif") return null;
    
    // TIFF Header offset
    var tiffOffset = app1Offset + 10;
    
    // Endianness check: "II" (Intel, Little Endian) or "MM" (Motorola, Big Endian)
    var byteOrder = String.fromCharCode(bytes[tiffOffset] & 0xFF, bytes[tiffOffset + 1] & 0xFF);
    var isLittle = (byteOrder === "II");
    
    // Reader Helper
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
    
    // Verify magic number (0x002A / 42)
    var magic = reader.readUShort(2);
    if (magic !== 42) return null;
    
    // Offset to 0th IFD
    var ifd0Offset = reader.readULong(4);
    var gpsIfdOffset = -1;
    
    // Read 0th IFD entries to locate GPS Info IFD Pointer (Tag 0x8825 / 34853)
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
      var type = reader.readUShort(gpsEntryPos + 2);
      var count = reader.readULong(gpsEntryPos + 4);
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
      
      // Round to 6 decimal places for standard maps
      return {
        latitude: Math.round(latitude * 1000000) / 1000000,
        longitude: Math.round(longitude * 1000000) / 1000000
      };
    }
    
  } catch (e) {
    Logger.log("Error parsing EXIF: " + e.toString());
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
