"""
Bridge Remote - Sentry Guard & Stealth Webcam Controller
Headless background webcam monitor with OpenCV Face Proximity Detection.
"""

import sys
import os
import time
import json
import base64
import ctypes

try:
    import cv2
except ImportError:
    print(json.dumps({"error": "OpenCV not installed"}))
    sys.exit(1)

FACE_CASCADE_PATH = cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
face_cascade = cv2.CascadeClassifier(FACE_CASCADE_PATH)

def lock_workstation():
    try:
        user32 = ctypes.windll.User32
        user32.LockWorkStation()
        return True
    except Exception as e:
        return False

def capture_single_frame(cam_idx=0, quality=60, max_width=640):
    cap = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        return None
    
    # Warm up camera briefly
    for _ in range(3):
        ret, frame = cap.read()
    
    ret, frame = cap.read()
    cap.release()
    
    if not ret or frame is None:
        return None
    
    # Resize for fast network transmission
    h, w = frame.shape[:2]
    if w > max_width:
        ratio = max_width / float(w)
        frame = cv2.resize(frame, (max_width, int(h * ratio)), interpolation=cv2.INTER_AREA)
    
    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), quality]
    ret, buffer = cv2.imencode('.jpg', frame, encode_params)
    if not ret:
        return None
    
    return base64.b64encode(buffer).decode('utf-8')

def run_sentry_guard(cam_idx=0, proximity_threshold=110, check_interval=0.3):
    """
    Continuous sentry monitor:
    - Runs headless without opening any window
    - Detects faces; if face width >= proximity_threshold (indicating person <= 1.5m away):
      1. Locks workstation instantly
      2. Captures intruder snapshot
      3. Outputs JSON alert to stdout
      4. Enters cooldown
    """
    cap = cv2.VideoCapture(cam_idx, cv2.CAP_DSHOW)
    if not cap.isOpened():
        print(json.dumps({"event": "error", "message": "Failed to open camera"}))
        sys.stdout.flush()
        return

    print(json.dumps({"event": "sentry_started", "message": "Sentry Guard is active and monitoring proximity"}))
    sys.stdout.flush()

    last_alert_time = 0
    cooldown_seconds = 15 # Don't re-trigger while locked

    try:
        while True:
            ret, frame = cap.read()
            if not ret or frame is None:
                time.sleep(check_interval)
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            # Detect faces
            faces = face_cascade.detectMultiScale(
                gray,
                scaleFactor=1.2,
                minNeighbors=4,
                minSize=(50, 50)
            )

            now = time.time()
            if len(faces) > 0 and (now - last_alert_time) > cooldown_seconds:
                # Find maximum face width (closest person)
                max_w = max(w for (x, y, w, h) in faces)
                
                # If face is larger than threshold, person is within close proximity
                if max_w >= proximity_threshold:
                    # 1. LOCK WORKSTATION IMMEDIATELY
                    lock_workstation()

                    # Draw subtle indicator box on saved snapshot for proof
                    snapshot = frame.copy()
                    for (x, y, w, h) in faces:
                        cv2.rectangle(snapshot, (x, y), (x + w, y + h), (0, 0, 255), 2)
                        cv2.putText(snapshot, f"INTRUDER: {w}px", (x, y - 10),
                                    cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 255), 2)

                    # Encode snapshot to base64
                    encode_params = [int(cv2.IMWRITE_JPEG_QUALITY), 65]
                    _, buf = cv2.imencode('.jpg', snapshot, encode_params)
                    b64_img = base64.b64encode(buf).decode('utf-8')

                    alert_data = {
                        "event": "trespassing_detected",
                        "timestamp": int(now * 1000),
                        "face_width": int(max_w),
                        "message": "🚨 TRESPASSING DETECTED! Laptop auto-locked.",
                        "imageBase64": b64_img
                    }
                    print(json.dumps(alert_data))
                    sys.stdout.flush()

                    last_alert_time = now

            time.sleep(check_interval)

    except KeyboardInterrupt:
        pass
    finally:
        cap.release()
        print(json.dumps({"event": "sentry_stopped"}))
        sys.stdout.flush()

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'peek'
    
    if mode == 'peek':
        # Single stealth snapshot
        b64 = capture_single_frame()
        if b64:
            print(json.dumps({"ok": True, "camBase64": b64}))
        else:
            print(json.dumps({"ok": False, "error": "Camera capture failed"}))
        sys.stdout.flush()

    elif mode == 'guard':
        threshold = int(sys.argv[2]) if len(sys.argv) > 2 else 110
        run_sentry_guard(proximity_threshold=threshold)
