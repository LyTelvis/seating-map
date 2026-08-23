#!/usr/bin/env python3
import os
import sys
import json
import shutil
import glob
import re
import urllib.parse
from datetime import datetime
import http.server
import socketserver
import webbrowser
import threading

# Try importing Pillow
try:
    from PIL import Image, ExifTags
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
INBOX_DIR = os.path.join(WORKSPACE_DIR, "01_Inbox")
MAPPED_DIR = os.path.join(WORKSPACE_DIR, "02_Mapped")
NEEDS_GPS_DIR = os.path.join(WORKSPACE_DIR, "03_Needs_GPS")
DATA_FILE = os.path.join(WORKSPACE_DIR, "chairs_data.json")
CSV_FILE = os.path.join(WORKSPACE_DIR, "chairs_map.csv")
MAP_HTML_FILE = os.path.join(WORKSPACE_DIR, "chairs_map.html")

PORT = 8000

def ensure_directories():
    for d in [INBOX_DIR, MAPPED_DIR, NEEDS_GPS_DIR]:
        os.makedirs(d, exist_ok=True)

def load_data():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {DATA_FILE}: {e}")
    return []

def save_data(data):
    with open(DATA_FILE, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    save_csv(data)

def save_csv(data):
    lines = ["id,filename,image_path,latitude,longitude,timestamp,comment\n"]
    for item in data:
        cid = item.get("id", "")
        fn = item.get("filename", "")
        ip = item.get("image_path", "")
        lat = item.get("latitude", "")
        lng = item.get("longitude", "")
        ts = item.get("timestamp", "")
        c = item.get("comment", "").replace('"', '""')
        lines.append(f'"{cid}","{fn}","{ip}",{lat},{lng},"{ts}","{c}"\n')
    with open(CSV_FILE, "w", encoding="utf-8") as f:
        f.writelines(lines)

def convert_to_degrees(value):
    """Helper to convert EXIF GPS tuple (D, M, S) to float degrees."""
    if not value:
        return None
    try:
        def to_float(x):
            if isinstance(x, tuple) or hasattr(x, 'numerator'):
                return float(x[0]) / float(x[1]) if isinstance(x, tuple) else float(x)
            return float(x)
        
        d = to_float(value[0])
        m = to_float(value[1])
        s = to_float(value[2])
        return d + (m / 60.0) + (s / 3600.0)
    except Exception:
        return None

def extract_exif_data(filepath):
    """Extracts GPS coordinates and timestamp from an image file."""
    if not HAS_PILLOW:
        print("Pillow library not found. Please run: pip install Pillow")
        return None, None, None

    try:
        image = Image.open(filepath)
        exif = image._getexif()
        if not exif:
            return None, None, None

        exif_data = {}
        for tag, val in exif.items():
            tag_name = ExifTags.TAGS.get(tag, tag)
            exif_data[tag_name] = val

        # Timestamp
        timestamp = exif_data.get("DateTimeOriginal") or exif_data.get("DateTime")
        if timestamp:
            timestamp = str(timestamp).strip().replace(":", "-", 2)

        # GPS Info
        gps_info = exif_data.get("GPSInfo")
        if not gps_info:
            return None, None, timestamp

        gps_data = {}
        for t in gps_info:
            sub_tag = ExifTags.GPSTAGS.get(t, t)
            gps_data[sub_tag] = gps_info[t]

        lat_raw = gps_data.get("GPSLatitude")
        lat_ref = gps_data.get("GPSLatitudeRef")
        lng_raw = gps_data.get("GPSLongitude")
        lng_ref = gps_data.get("GPSLongitudeRef")

        if not lat_raw or not lng_raw:
            return None, None, timestamp

        lat = convert_to_degrees(lat_raw)
        lng = convert_to_degrees(lng_raw)

        if lat is not None and lat_ref in ["S", "s"]:
            lat = -lat
        if lng is not None and lng_ref in ["W", "w"]:
            lng = -lng

        return lat, lng, timestamp

    except Exception as e:
        print(f"Error reading EXIF from {os.path.basename(filepath)}: {e}")
        return None, None, None

def process_inbox():
    ensure_directories()
    data = load_data()
    existing_filenames = {item.get("filename") for item in data}

    valid_extensions = {".jpg", ".jpeg", ".png", ".heic"}
    inbox_files = [
        f for f in os.listdir(INBOX_DIR)
        if os.path.isfile(os.path.join(INBOX_DIR, f)) and os.path.splitext(f)[1].lower() in valid_extensions
    ]

    if not inbox_files:
        print("📥 01_Inbox is empty. No new photos to process.")
        return data

    print(f"\n🔍 Found {len(inbox_files)} photo(s) in 01_Inbox. Processing...\n")
    processed_count = 0
    missing_gps_count = 0

    for filename in inbox_files:
        src_path = os.path.join(INBOX_DIR, filename)
        lat, lng, timestamp = extract_exif_data(src_path)

        if lat is not None and lng is not None:
            # Generate unique filename if collision
            dest_filename = filename
            counter = 1
            name_part, ext_part = os.path.splitext(filename)
            while os.path.exists(os.path.join(MAPPED_DIR, dest_filename)):
                dest_filename = f"{name_part}_{counter}{ext_part}"
                counter += 1

            dest_path = os.path.join(MAPPED_DIR, dest_filename)
            shutil.move(src_path, dest_path)

            rel_path = f"02_Mapped/{dest_filename}"
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

            item_id = f"chair_{int(datetime.now().timestamp())}_{processed_count}"
            data.append({
                "id": item_id,
                "filename": dest_filename,
                "image_path": rel_path,
                "latitude": round(lat, 6),
                "longitude": round(lng, 6),
                "timestamp": timestamp or now_str,
                "comment": ""
            })
            processed_count += 1
            print(f"  🟢 [PASSED] '{filename}' -> Mapped at ({lat:.5f}, {lng:.5f})")
        else:
            dest_path = os.path.join(NEEDS_GPS_DIR, filename)
            shutil.move(src_path, dest_path)
            missing_gps_count += 1
            print(f"  🔴 [NO GPS ] '{filename}' -> Missing location data! Moved to 03_Needs_GPS.")

    save_data(data)

    print("\n--------------------------------------------------")
    print(f"✅ Processing Complete:")
    print(f"   • {processed_count} photo(s) added to the map (in 02_Mapped)")
    if missing_gps_count > 0:
        print(f"   • ⚠️ {missing_gps_count} photo(s) MISSING GEOLOCATION (moved to 03_Needs_GPS)")
    print("--------------------------------------------------\n")

    return data

class ChairMapHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WORKSPACE_DIR, **kwargs)

    def do_POST(self):
        if self.path == "/api/save_comment":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                payload = json.loads(post_data.decode("utf-8"))
                item_id = payload.get("id")
                comment = payload.get("comment", "").strip()

                data = load_data()
                updated = False
                for item in data:
                    if item.get("id") == item_id or item.get("image_path") == item_id:
                        item["comment"] = comment
                        updated = True
                        break

                if updated:
                    save_data(data)
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True, "data": data}).encode("utf-8"))
                else:
                    self.send_response(444)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": "Item not found"}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def log_message(self, format, *args):
        # Silence routine static request logging to keep console clean
        pass

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    server_port = PORT
    httpd = None
    for p in range(PORT, PORT + 20):
        try:
            httpd = socketserver.TCPServer(("", p), ChairMapHTTPHandler)
            server_port = p
            break
        except OSError:
            continue

    if not httpd:
        print("Could not find free port for web server.")
        return

    url = f"http://localhost:{server_port}/chairs_map.html?admin=true"
    print(f"🚀 Map Web Server running at: http://localhost:{server_port}/")
    print(f"🌐 Opening interactive map in browser...")
    webbrowser.open(url)

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping web server.")
        httpd.server_close()

def main():
    process_inbox()
    run_server()

if __name__ == "__main__":
    main()
