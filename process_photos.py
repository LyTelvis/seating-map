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
import subprocess

# Try importing Pillow
try:
    from PIL import Image, ExifTags
    HAS_PILLOW = True
except ImportError:
    HAS_PILLOW = False

WORKSPACE_DIR = os.path.dirname(os.path.abspath(__file__))
INBOX_DIR = os.path.join(WORKSPACE_DIR, "01_Inbox")
MAPPED_DIR = os.path.join(WORKSPACE_DIR, "02_Mapped")
UNMAPPED_DIR = os.path.join(WORKSPACE_DIR, "03_Unmapped")
DATA_FILE = os.path.join(WORKSPACE_DIR, "seating_data.json")
CSV_FILE = os.path.join(WORKSPACE_DIR, "seating_map.csv")
MAP_HTML_FILE = os.path.join(WORKSPACE_DIR, "seating_map.html")

PORT = 8000

def ensure_directories():
    for d in [INBOX_DIR, MAPPED_DIR, UNMAPPED_DIR]:
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

def sync_to_github():
    """Automatically commits and pushes updated data/photos to GitHub if git is configured."""
    try:
        if not os.path.exists(os.path.join(WORKSPACE_DIR, ".git")):
            return
        
        print("\n🔄 Syncing updates to GitHub (LyTelvis/seating-map)...")
        subprocess.run(["git", "add", "seating_data.json", "seating_map.csv", "seating_map.html", "02_Mapped/"], cwd=WORKSPACE_DIR, capture_output=True)
        commit_res = subprocess.run(["git", "commit", "-m", "Auto-update seating map data and photos"], cwd=WORKSPACE_DIR, capture_output=True, text=True)
        
        if "nothing to commit" in commit_res.stdout.lower() or "nothing to commit" in commit_res.stderr.lower():
            print("ℹ️ Everything up to date on GitHub.")
            return

        push_res = subprocess.run(["git", "push", "origin", "main"], cwd=WORKSPACE_DIR, capture_output=True, text=True)
        if push_res.returncode == 0:
            print("✅ Successfully pushed updates to GitHub Pages live map!")
        else:
            print(f"ℹ️ Git push output: {push_res.stderr.strip() or push_res.stdout.strip()}")
    except Exception as e:
        print(f"Note: Git auto-sync skipped: {e}")

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

def check_duplicate(filename, lat, lng, existing_data):
    """Checks if a photo matches an existing mapped photo by filename or location."""
    filename_lower = filename.lower()
    for item in existing_data:
        ex_fn = item.get("filename", "").lower()
        ex_lat = item.get("latitude")
        ex_lng = item.get("longitude")

        fn_match = (filename_lower == ex_fn)
        geo_match = False
        if lat is not None and lng is not None and ex_lat is not None and ex_lng is not None:
            if abs(lat - ex_lat) < 0.00005 and abs(lng - ex_lng) < 0.00005:
                geo_match = True

        if fn_match or geo_match:
            reasons = []
            if fn_match:
                reasons.append("same filename")
            if geo_match:
                reasons.append("identical geolocation")
            return item, " & ".join(reasons)
    return None, None

def get_pending_unmapped():
    """Returns list of non-duplicate photos currently in 01_Inbox that lack GPS metadata."""
    ensure_directories()
    existing_data = load_data()
    valid_extensions = {".jpg", ".jpeg", ".png", ".heic"}
    inbox_files = [
        f for f in os.listdir(INBOX_DIR)
        if os.path.isfile(os.path.join(INBOX_DIR, f)) and os.path.splitext(f)[1].lower() in valid_extensions and not f.startswith(".")
    ]

    pending = []
    for filename in inbox_files:
        src_path = os.path.join(INBOX_DIR, filename)
        lat, lng, timestamp = extract_exif_data(src_path)
        
        # Check duplicate first
        dupe_item, dupe_reason = check_duplicate(filename, lat, lng, existing_data)
        if dupe_item:
            continue # Handled by pending_duplicates API

        if lat is None or lng is None:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            pending.append({
                "filename": filename,
                "image_path": f"01_Inbox/{filename}",
                "timestamp": timestamp or now_str
            })

    return pending

def get_pending_duplicates():
    """Returns list of photos in 01_Inbox that match existing mapped photos by filename or location."""
    ensure_directories()
    existing_data = load_data()
    valid_extensions = {".jpg", ".jpeg", ".png", ".heic"}
    inbox_files = [
        f for f in os.listdir(INBOX_DIR)
        if os.path.isfile(os.path.join(INBOX_DIR, f)) and os.path.splitext(f)[1].lower() in valid_extensions and not f.startswith(".")
    ]

    duplicates = []
    for filename in inbox_files:
        src_path = os.path.join(INBOX_DIR, filename)
        lat, lng, timestamp = extract_exif_data(src_path)
        dupe_item, dupe_reason = check_duplicate(filename, lat, lng, existing_data)
        if dupe_item:
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            duplicates.append({
                "filename": filename,
                "image_path": f"01_Inbox/{filename}",
                "latitude": round(lat, 6) if lat is not None else None,
                "longitude": round(lng, 6) if lng is not None else None,
                "timestamp": timestamp or now_str,
                "match_reason": dupe_reason,
                "existing_match": dupe_item
            })

    return duplicates

def process_inbox():
    ensure_directories()
    data = load_data()

    valid_extensions = {".jpg", ".jpeg", ".png", ".heic"}
    inbox_files = [
        f for f in os.listdir(INBOX_DIR)
        if os.path.isfile(os.path.join(INBOX_DIR, f)) and os.path.splitext(f)[1].lower() in valid_extensions and not f.startswith(".")
    ]

    if not inbox_files:
        print("📥 01_Inbox is empty. No new photos to process.")
        return data

    print(f"\n🔍 Found {len(inbox_files)} photo(s) in 01_Inbox. Processing...\n")
    processed_count = 0
    pending_manual_count = 0
    duplicate_count = 0

    for filename in inbox_files:
        src_path = os.path.join(INBOX_DIR, filename)
        lat, lng, timestamp = extract_exif_data(src_path)

        # Check duplicate
        dupe_item, dupe_reason = check_duplicate(filename, lat, lng, data)
        if dupe_item:
            duplicate_count += 1
            print(f"  ⚠️ [POSSIBLE DUPLICATE] '{filename}' matches existing photo ({dupe_reason}) -> Prompting user on map!")
            continue

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

            item_id = f"seating_{int(datetime.now().timestamp())}_{processed_count}"
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
            print(f"  🟢 [AUTO MAPPED] '{filename}' -> Mapped at ({lat:.5f}, {lng:.5f})")
        else:
            pending_manual_count += 1
            print(f"  ⚠️ [NO GPS EXIF ] '{filename}' -> Kept in 01_Inbox for manual pin drop on map!")

    save_data(data)

    print("\n--------------------------------------------------")
    print(f"✅ Auto-Processing Summary:")
    print(f"   • {processed_count} photo(s) auto-mapped with EXIF GPS")
    if duplicate_count > 0:
        print(f"   • ⚠️ {duplicate_count} photo(s) flagged as POSSIBLE DUPLICATE (verify on map)")
    if pending_manual_count > 0:
        print(f"   • ⚠️ {pending_manual_count} photo(s) pending MANUAL PIN DROP on map")
    print("--------------------------------------------------\n")

    if processed_count > 0:
        sync_to_github()

    return data

class SeatingMapHTTPHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WORKSPACE_DIR, **kwargs)

    def do_GET(self):
        if self.path == "/api/pending_unmapped":
            pending = get_pending_unmapped()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "pending": pending}).encode("utf-8"))
        elif self.path == "/api/pending_duplicates":
            duplicates = get_pending_duplicates()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"success": True, "duplicates": duplicates}).encode("utf-8"))
        else:
            super().do_GET()

    def do_POST(self):
        content_length = int(self.headers.get("Content-Length", 0))
        post_data = self.rfile.read(content_length)

        if self.path == "/api/confirm_duplicate":
            try:
                payload = json.loads(post_data.decode("utf-8"))
                filename = payload.get("filename")
                action = payload.get("action") # "add_anyway" or "skip"

                src_path = os.path.join(INBOX_DIR, filename)
                data = load_data()

                if action == "add_anyway":
                    lat, lng, timestamp = extract_exif_data(src_path)
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
                    item_id = f"seating_{int(datetime.now().timestamp())}_{len(data)}"

                    # If lat/lng missing, use existing match coords if available
                    if lat is None or lng is None:
                        existing_match = payload.get("existing_match", {})
                        lat = existing_match.get("latitude", 0.0)
                        lng = existing_match.get("longitude", 0.0)

                    data.append({
                        "id": item_id,
                        "filename": dest_filename,
                        "image_path": rel_path,
                        "latitude": round(lat, 6) if lat is not None else 0.0,
                        "longitude": round(lng, 6) if lng is not None else 0.0,
                        "timestamp": timestamp or now_str,
                        "comment": "Duplicate entry added manually"
                    })
                    save_data(data)
                    sync_to_github()

                elif action == "skip":
                    if os.path.exists(src_path):
                        dest_path = os.path.join(UNMAPPED_DIR, filename)
                        shutil.move(src_path, dest_path)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True, 
                    "data": load_data(), 
                    "duplicates": get_pending_duplicates(),
                    "pending": get_pending_unmapped()
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))

        elif self.path == "/api/manual_pin":
            try:
                payload = json.loads(post_data.decode("utf-8"))
                filename = payload.get("filename")
                lat = float(payload.get("latitude"))
                lng = float(payload.get("longitude"))
                comment = payload.get("comment", "").strip()

                src_path = os.path.join(INBOX_DIR, filename)
                if not os.path.exists(src_path):
                    self.send_response(404)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": False, "error": f"File {filename} not found in Inbox"}).encode("utf-8"))
                    return

                dest_filename = filename
                counter = 1
                name_part, ext_part = os.path.splitext(filename)
                while os.path.exists(os.path.join(MAPPED_DIR, dest_filename)):
                    dest_filename = f"{name_part}_{counter}{ext_part}"
                    counter += 1

                dest_path = os.path.join(MAPPED_DIR, dest_filename)
                shutil.move(src_path, dest_path)

                data = load_data()
                rel_path = f"02_Mapped/{dest_filename}"
                now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

                item_id = f"seating_{int(datetime.now().timestamp())}_{len(data)}"
                data.append({
                    "id": item_id,
                    "filename": dest_filename,
                    "image_path": rel_path,
                    "latitude": round(lat, 6),
                    "longitude": round(lng, 6),
                    "timestamp": now_str,
                    "comment": comment
                })

                save_data(data)
                sync_to_github()

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True, 
                    "data": data, 
                    "pending": get_pending_unmapped(),
                    "duplicates": get_pending_duplicates()
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))

        elif self.path == "/api/skip_unmapped":
            try:
                payload = json.loads(post_data.decode("utf-8"))
                filename = payload.get("filename")

                src_path = os.path.join(INBOX_DIR, filename)
                if os.path.exists(src_path):
                    dest_path = os.path.join(UNMAPPED_DIR, filename)
                    shutil.move(src_path, dest_path)

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "success": True, 
                    "pending": get_pending_unmapped(),
                    "duplicates": get_pending_duplicates()
                }).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"success": False, "error": str(e)}).encode("utf-8"))

        elif self.path == "/api/save_comment":
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
                    sync_to_github()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/json")
                    self.end_headers()
                    self.wfile.write(json.dumps({"success": True, "data": data}).encode("utf-8"))
                else:
                    self.send_response(404)
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
        pass

def run_server():
    socketserver.TCPServer.allow_reuse_address = True
    server_port = PORT
    httpd = None
    for p in range(PORT, PORT + 20):
        try:
            httpd = socketserver.TCPServer(("", p), SeatingMapHTTPHandler)
            server_port = p
            break
        except OSError:
            continue

    if not httpd:
        print("Could not find free port for web server.")
        return

    url = f"http://localhost:{server_port}/seating_map.html?admin=true"
    print(f"🚀 Seating Map Web Server running at: http://localhost:{server_port}/")
    print(f"🌐 Opening interactive seating map in browser...")
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
