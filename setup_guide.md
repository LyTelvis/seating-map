# Setup Guide: Public Seating Tracker

This guide provides step-by-step instructions to connect Google Sheets, Google Apps Script, AppSheet, and Google My Maps, and to deploy the premium web wrapper. By following these steps, you will establish a fully functional, zero-code, mobile data collection pipeline with a live-updating public web dashboard.

---

## Step 1: Initialize the Google Sheet

1. Go to [Google Sheets](https://sheets.google.com/) and create a new blank spreadsheet.
2. Name the sheet (e.g., `Public Seating Tracker`).
3. Import the database template:
   - Click **File > Import > Upload** and select the [seating_tracker_template.csv](seating_tracker_template.csv) file from this workspace.
   - Set the import action to **Replace current sheet** or **Insert new sheet(s)**.
   - Ensure the column headers match exactly:
     `Timestamp` | `Location` | `Latitude` | `Longitude` | `Photo` | `Public Photo URL` | `Seating Type` | `Description`
4. Set the column formats:
   - Select the `Timestamp` column (Column A) and format it as **Format > Number > Date time**.

---

## Step 2: Install the Apps Script Automation

Google My Maps requires absolute public URLs to render images inside pin pop-ups. Additionally, AppSheet does not natively read GPS coordinates from photo metadata (EXIF) when uploading files from your camera roll. 

To solve both issues, the updated `apps_script.js` performs two automated tasks when a spreadsheet change occurs:
1. **Generates Public Photo Links**: Converts relative AppSheet paths into absolute public Google Drive URLs.
2. **Extracts Photo EXIF Coordinates**: Automatically parses GPS coordinates out of the uploaded JPEG image file. If the `Location`, `Latitude`, or `Longitude` fields are empty (e.g. if you uploaded a photo from your camera roll instead of logging live with GPS), the script writes the photo's EXIF location back into the Sheet.

1. In your Google Sheet, click **Extensions > Apps Script**.
2. Rename the project to `Seating Photo Automator`.
3. Open the [apps_script.js](apps_script.js) file from this workspace, copy the entire code, and paste it into the Apps Script editor (replacing any boilerplate code).
4. Click the **Save** (floppy disk) icon.
5. **Configure the Installable Trigger** (Crucial: AppSheet writes via API, which doesn't trigger default simple triggers):
   - On the left sidebar of the Apps Script dashboard, click the clock icon (**Triggers**).
   - Click **+ Add Trigger** in the bottom right corner.
   - Configure the trigger with these settings:
     - **Choose which function to run**: `generatePublicPhotoUrls`
     - **Choose which deployment should run**: `Head`
     - **Select event source**: `From spreadsheet`
     - **Select event type**: `On change`
     - **Failure notification settings**: `Notify me immediately`
   - Click **Save**.
   - A dialog will pop up asking for permissions. Choose your Google Account, click **Advanced** (under the warning screen), and click **Go to Seating Photo Automator (unsafe)**. Click **Allow** to grant permission to read your Drive files and modify Sheets.

---

## Step 3: Create the AppSheet Mobile App

1. In your Google Sheet, click **Extensions > AppSheet > Create an app**.
2. AppSheet will automatically analyze the sheet columns and initialize a basic app. Sign in using your Google account if prompted.
3. Once inside the AppSheet editor, go to **Data > Columns** (or **Data > Tables** then view columns for your table).
4. Configure the column types and formulas as follows:

| Column Name | Type | Initial Value | App Formula | Key Settings / Validations |
| :--- | :--- | :--- | :--- | :--- |
| **Timestamp** | `DateTime` | `NOW()` | *(Leave empty)* | **Show?**: Unchecked (hidden)<br>**Editable**: Unchecked (auto-generated) |
| **Location** | `LatLong` | `HERE()` | *(Leave empty)* | **Show?**: Unchecked (runs silently)<br>**Searchable**: Checked |
| **Latitude** | `Decimal` | *(Leave empty)* | `LAT([Location])` | **Show?**: Unchecked (hidden)<br>**Editable**: Unchecked (auto-derived) |
| **Longitude** | `Decimal` | *(Leave empty)* | `LONG([Location])` | **Show?**: Unchecked (hidden)<br>**Editable**: Unchecked (auto-derived) |
| **Photo** | `Image` | *(Leave empty)* | *(Leave empty)* | **Show?**: Checked<br>**Required**: Checked |
| **Public Photo URL**| `Url` | *(Leave empty)* | *(Leave empty)* | **Show?**: Unchecked (hides input; script runs in background)<br>**Editable**: Unchecked<br>**Required**: Unchecked |
| **Seating Type** | `Enum` | *(Leave empty)* | *(Leave empty)* | **Show?**: Checked<br>**Values**: Add `Permanent`, `Temporary`, `Off-the-shelf`, `Site-specific`. **Input Mode**: Select `Buttons` or `Dropdown`. |
| **Description** | `LongText` | *(Leave empty)* | *(Leave empty)* | **Show?**: Checked<br>**Required**: Unchecked |

5. **Customize the UX Views**:
   - Go to **UX > Views**.
   - Find the primary form view (usually named `Form` or `[TableName]_Form`) and set the **Form layout** to a single-column layout for easy mobile data entry.
   - Under **UX > Options**, toggle on **Advance forms automatically** to make field data collection quick.
6. Click **Save** in the top right of the AppSheet Editor.
7. Go to **Users** and invite yourself (by entering your email address) to test the app on your iPhone.
8. Install the AppSheet app on your iPhone, log in, and launch your newly created application. Try logging a test seat (take a photo and submit).

---

## Step 4: Setup and Style Google My Maps

Google My Maps will serve as the visualization layer.

1. Go to [Google My Maps](https://www.google.com/maps/d/) and click **+ Create A New Map**.
2. Click **Untitled map** in the top left to rename it (e.g., `Public Seating Map`).
3. Click **Import** under the first layer.
4. Select the **Google Drive** tab, choose your Google Sheet (`Public Seating Tracker`), and select the correct worksheet.
5. **Position your pins**: Select `Latitude` and `Longitude` (or the unified `Location` column) to position your placemarks.
6. **Title your markers**: Select `Seating Type` or `Description` as the title for the markers. Click **Finish**.
7. **Configure Dynamic Styling**:
   - Click the **Individual styles** paint roller icon under your layer.
   - Change "Group places by" to **Seating Type**.
   - Your map pins will automatically group by type. Assign these standard colors to make it look premium:
     - **Permanent**: Blue (🔵)
     - **Temporary**: Green (🟢)
     - **Off-the-shelf**: Orange (🟠)
     - **Site-specific**: Red (🔴)
8. **Embed Photos**: Click on any map marker. You will see the details. Google My Maps natively understands the image URLs in the `Public Photo URL` column and renders them inline at the top of the pop-up.
9. **Publish the Map**:
   - Click the **Share** button on the map menu.
   - Enable **Anyone with this link can view**.
   - Click the three dots icon next to the map title (top left menu) and click **Embed on my site**.
   - Copy the `<iframe>` embed code (we will use this link in our web wrapper).

---

## Step 5: Configure and Deploy the Web Wrapper

To wrap the map in a premium, glassmorphic dashboard with dynamic collection progress counters, deploy the provided frontend code.

1. Open [index.html](index.html) in a text editor.
2. Locate the `<iframe>` tag inside the `<div class="map-wrapper">` element:
   ```html
   <iframe 
     id="map-iframe"
     src="https://www.google.com/maps/d/embed?mid=YOUR_MAP_MID_HERE" 
     ...
   >
   ```
   Replace the `src` attribute with the source URL from the iframe embed code you copied from Google My Maps (make sure to include the `&ehbc=...` query param).
3. **Configure Live Data Sync (Stats Counters)**:
   - Go to your Google Sheet.
   - Click **File > Share > Publish to web**.
   - Under the publishing options, change "Entire Document" to your sheet name (e.g., `Sheet1` or `Template`).
   - Change "Web page" to **Comma-separated values (.csv)**.
   - Click **Publish** and copy the generated link.
   - In [index.html](index.html), search for `const PUBLISHED_CSV_URL = '';` (around line 263) and paste your CSV link inside the quotes:
     ```javascript
     const PUBLISHED_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-.../pub?output=csv';
     ```
   - *If left blank, the page will display local mock template data.*
4. Save the file.
5. **Hosting the Website (Completely Free)**:
   - **GitHub Pages**: Create a free GitHub repository, upload `index.html` and `style.css` to the `main` branch, and enable Pages in **Settings > Pages**.
   - **Netlify**: Drag-and-drop the directory containing `index.html` and `style.css` directly onto [Netlify Drop](https://app.netlify.com/drop) for instant hosting.
   - **Vercel**: Run `npx vercel` inside the directory to deploy in seconds.
