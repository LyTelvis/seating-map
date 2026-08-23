# Telegram Bot Setup Guide: Public Seating Tracker

This guide provides step-by-step instructions to create a Telegram Bot, deploy the webhook in Google Sheets, and link them together to enable automated data collection with EXIF photo coordinate extraction.

---

## Step 1: Create Your Bot on Telegram

1. Open the Telegram app on your phone or computer.
2. Search for the official account **`@BotFather`** and start a chat.
3. Send the command: `/newbot`
4. Follow BotFather's prompts:
   - Enter a display name for your bot (e.g., `Public Seating Tracker`).
   - Enter a username for your bot. This must end in `bot` (e.g., `public_seating_tracker_bot`).
5. BotFather will reply with a confirmation message containing your **HTTP API Token** (a string like `123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ`). Copy this token. Keep it private.

---

## Step 2: Deploy the Apps Script & Initialize Database

Instead of creating worksheets and typing headers manually, you can let the script build them automatically.

1. Open [Google Sheets](https://sheets.google.com/) and create a new blank spreadsheet.
2. Click **Extensions > Apps Script**.
3. Delete any boilerplate code and paste the code from [telegram_bot.js](telegram_bot.js).
4. Paste your Bot Token and customize the Google Drive folder path at the top of the file:
   ```javascript
   var BOT_TOKEN = '8573820056:AAFiZktGO-A8vd-9xlXf2NwDEW6piD5JNo0';
   var DRIVE_FOLDER_PATH = 'Antigravity Projects/Seating_Images_Folder'; // <-- Folder path (subfolders separated by '/')
   ```
5. Click the **Save** (floppy disk) icon.
6. **Initialize the Database Automatically**:
   - In the toolbar dropdown next to the "Debug" button, change the selected function from `doPost` to **`setupDatabase`**.
   - Click the **Run** button.
   - When prompted, click **Review permissions**, choose your Google Account, click **Advanced**, click **Go to Untitled project (unsafe)**, and select **Allow** to give it permission to edit your spreadsheet.
   - Look at the execution log. You will see: `🎉 Database Setup Complete! Your worksheets and columns are ready.`
7. Switch back to your Google Sheet tab. You will see that the worksheets `SeatingData` and `UserState` have been created with the correct columns!

---

## Step 3: Deploy the Web App Webhook

Once your database is initialized, deploy the script as a public web app to receive updates from Telegram.

1. In your Apps Script editor, click the **Deploy** button in the top right and select **New deployment**.
2. Click the gear icon (**Select type**) next to "Configuration" and select **Web app**.
3. Configure the deployment settings:
   - **Description**: `Telegram Bot Webhook`
   - **Execute as**: `Me (your-google-email)`
   - **Who has access**: Select **`Anyone`** (This is crucial, otherwise Telegram will not be allowed to send messages to your script).
8. Click **Deploy**.
9. The script will request access permissions. Click **Authorize access**, choose your Google Account, click **Advanced**, click **Go to Untitled project (unsafe)**, and select **Allow**.
10. Once deployed, copy the **Web app URL** provided under "URL" (it ends with `/exec`).

---

## Step 4: Register the Webhook with Telegram

To tell Telegram to route messages from your bot to your Google Sheet script, you must link them.

2. Copy your unique registration URL below:
   ```txt
   https://api.telegram.org/bot8573820056:AAFiZktGO-A8vd-9xlXf2NwDEW6piD5JNo0/setWebhook?url=https://script.google.com/macros/s/AKfycbwonLmzehphI_dQIwzYoSEcvC0N-DlhVtiaa8pgOkEOGYGdO9KOJ_Ej0HIsQWrgbfrexA/exec
   ```
4. You should see a JSON success confirmation in your browser:
   ```json
   {
     "ok": true,
     "result": true,
     "description": "Webhook was set"
   }
   ```
   *(If you see an error, double-check that your Bot Token is entered correctly and that your Web App URL matches exactly).*

---

## Step 5: Test the Data Collection Flow

Now open Telegram on your iPhone to verify the loop:

1. Search for your bot's username and tap **Start** (or send `/start`).
2. **Test 1: Auto-Extracting Location (Document/File Upload)**:
   - Tap the clip icon `📎` and select **File** (do not select Gallery/Photo).
   - Choose a photo of a seat that has geo-tagging enabled.
   - The bot will reply: `Analyzing image. Please wait...`
   - If GPS coordinates are found, it will output:
     `Location found in photo metadata: [Lat, Lng]. Is this the correct seating location?`
   - Tap `Yes, Confirm Location`.
3. **Test 2: Standard Photo Upload (Fallback)**:
   - Tap the clip icon `📎` and select **Gallery** or take a photo directly. Send it.
   - The bot will notice that standard photos have no EXIF metadata and reply:
     `Standard Telegram photos don't contain location metadata. Please send the seat's location by tapping the clip icon 📎 and choosing 'Location'.`
   - Tap `📎 > Location` and pin your current spot. The bot will then prompt you to confirm.
4. **Select Seating Category**:
   - The bot displays inline buttons: `Permanent`, `Temporary`, `Off-the-shelf`, and `Site-specific`.
   - Tap your choice.
5. **Add Comments**:
   - The bot asks for comments. Type and send your comments, or tap `⏩ Skip Comments` to leave them blank.
6. **Save to Database**:
   - The bot downloads the image, saves it to your Google Drive, creates a direct My Maps link, and appends a row to the `SeatingData` worksheet. It then sends a success message.
7. Open your Google Sheet to verify that the entry has been successfully logged!

---

## Step 6: Connect to Google My Maps & Dashboard

1. In Google My Maps, import the `SeatingData` sheet, mapping `Latitude` and `Longitude` for pins. Set pin styles to group by `Seating Type`. Set photos to read from `Photo URL`.
2. Publish your `SeatingData` sheet to the web as a CSV, and paste the CSV link into `PUBLISHED_CSV_URL` in [index.html](index.html) to display dynamic dashboard counters.
