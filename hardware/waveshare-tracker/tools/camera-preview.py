#!/usr/bin/env python3
"""Local macOS USB camera preview; no Wi-Fi credentials or network camera listener."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import secrets
import select
import struct
import termios
import time
import tty
import zlib
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import urlsplit, parse_qs

class CameraSerial:
    def __init__(self, port, baud=921600):
        self.fd = os.open(port, os.O_RDWR | os.O_NOCTTY | os.O_NONBLOCK)
        self.original = termios.tcgetattr(self.fd)
        tty.setraw(self.fd)
        settings = termios.tcgetattr(self.fd)
        settings[4] = settings[5] = termios.B115200
        termios.tcsetattr(self.fd, termios.TCSANOW, settings)
        if baud != 115200:
            # macOS IOKit/serial/ioss.h: IOSSIOSPEED = _IOW('T', 2, speed_t).
            request = 0x80000000 | (struct.calcsize('L') << 16) | (ord('T') << 8) | 2
            try:
                fcntl.ioctl(self.fd, request, struct.pack('L', baud))
            except OSError:
                termios.tcsetattr(self.fd, termios.TCSANOW, self.original)
                os.close(self.fd)
                raise
        fcntl.ioctl(self.fd, termios.TIOCMBIC, struct.pack('I', termios.TIOCM_DTR | termios.TIOCM_RTS))
        self.buffer = bytearray()

    def read(self, size, deadline):
        while len(self.buffer) < size:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError('Camera did not reply; check USB, CAM switch, and ribbon seating.')
            if select.select([self.fd], [], [], min(1, remaining))[0]:
                chunk = os.read(self.fd, 8192)
                if not chunk:
                    raise ConnectionError('USB disconnected')
                self.buffer.extend(chunk)
        result = bytes(self.buffer[:size])
        del self.buffer[:size]
        return result

    def line(self, deadline):
        result = bytearray()
        while len(result) < 8192:
            value = self.read(1, deadline)
            if value == b'\n':
                return bytes(result)
            result.extend(value)
        raise ValueError('Oversized camera protocol line')

    def snapshot(self, preview=False):
        termios.tcflush(self.fd, termios.TCIFLUSH)
        self.buffer.clear()
        os.write(self.fd, (json.dumps({"command": "cameraSnapshot", "preview": preview}) + "\n").encode())
        deadline = time.monotonic() + 40
        while True:
            try:
                report = json.loads(self.line(deadline))
            except (ValueError, UnicodeDecodeError):
                continue
            if not isinstance(report, dict):
                continue
            if report.get('event') == 'camera_error':
                raise RuntimeError(str(report.get('error', 'Camera error')))
            if report.get('event') != 'camera_frame':
                continue
            length = report.get('bytes')
            if not isinstance(length, int) or not 4 <= length <= 131072:
                raise ValueError('Invalid frame length')
            frame = self.read(length, deadline)
            if zlib.crc32(frame) != report.get('crc32') or not frame.startswith(b'\xff\xd8'):
                raise ValueError('USB image was incomplete; retry the capture')
            return frame, {k: report[k] for k in ('width', 'height', 'bytes', 'sensorPid') if k in report}

    def close(self):
        try:
            os.write(self.fd, b'{"command":"cameraStop"}\n')
            termios.tcdrain(self.fd)
            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                try:
                    report = json.loads(self.line(deadline))
                except (ValueError, UnicodeDecodeError):
                    continue
                if isinstance(report, dict) and report.get('event') == 'camera_stopped':
                    break
        except (OSError, TimeoutError):
            pass
        finally:
            termios.tcsetattr(self.fd, termios.TCSANOW, self.original)
            os.close(self.fd)

PAGE = """<!doctype html><html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Waveshare camera test</title>
<style>body{margin:0;background:#07141d;color:#edf6f5;font:16px system-ui}main{max-width:1000px;margin:auto;padding:24px}button{background:#10b981;color:#041511;border:0;border-radius:10px;padding:12px 18px;font:inherit;cursor:pointer}img{display:block;width:100%;max-width:960px;min-height:200px;object-fit:contain;background:#000;border-radius:14px;margin-top:20px}p{color:#a5b9c0}</style>
<main><h1>Waveshare camera test</h1><p>Local USB preview. Images stay on this computer. GPS tracking remains enabled; captures briefly pause its loop.</p><button id="capture">Take picture</button> <button id="live">Start preview</button><p id="status">Ready to capture</p><img id="picture" alt="Camera preview will appear here"></main>
<script>let live=false,busy=false,previous,frameTimes=[];const status=document.querySelector('#status'),picture=document.querySelector('#picture'),button=document.querySelector('#live');
async function capture(continuous=false){
 if(busy||(continuous&&!live))return;
 busy=true;
 if(!live)status.textContent='Capturing over USB...';
 try{
  const r=await fetch(location.pathname+'frame.jpg'+(continuous?'?preview=1':''),{cache:'no-store'});
  if(!r.ok)throw Error(await r.text());
  const blob=await r.blob();
  if(previous)URL.revokeObjectURL(previous);
  previous=URL.createObjectURL(blob);picture.src=previous;
  await picture.decode();
  if(live){
   frameTimes.push(performance.now());if(frameTimes.length>20)frameTimes.shift();
   const fps=frameTimes.length>1?(frameTimes.length-1)*1000/(frameTimes.at(-1)-frameTimes[0]):0;
   status.textContent='Live preview · '+fps.toFixed(1)+' FPS · '+picture.naturalWidth+' × '+picture.naturalHeight;
  }else status.textContent='Picture received '+new Date().toLocaleTimeString();
 }catch(e){status.textContent=e.message;live=false;button.textContent='Start preview'}
 finally{busy=false;if(live)setTimeout(()=>capture(true),0)}
}
document.querySelector('#capture').onclick=()=>capture();
button.onclick=()=>{live=!live;frameTimes=[];button.textContent=live?'Pause preview':'Start preview';if(live)capture(true)};
capture();</script></html>""".encode("utf-8")

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', default='/dev/cu.usbmodem5B910314521')
    parser.add_argument('--baud', type=int, default=921600, help='USB baud; use 115200 for firmware 0.2.0 or older')
    parser.add_argument('--http-port', type=int, default=8770)
    parser.add_argument('--snapshot', type=Path, help='Save one JPEG and exit instead of opening a preview server')
    args = parser.parse_args()
    camera = CameraSerial(args.port, args.baud)
    try:
        if args.snapshot:
            frame, metadata = camera.snapshot()
            fd = os.open(args.snapshot, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
            with os.fdopen(fd, 'wb') as output:
                output.write(frame)
            print(json.dumps(metadata))
            return
        route = '/' + secrets.token_urlsafe(24) + '/'
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_GET(self):
                request = urlsplit(self.path)
                if request.path == route:
                    payload, mime, code = PAGE, 'text/html; charset=utf-8', 200
                elif request.path == route + 'frame.jpg':
                    try:
                        payload, metadata = camera.snapshot(preview=parse_qs(request.query).get('preview') == ['1'])
                        mime, code = 'image/jpeg', 200
                    except (OSError, RuntimeError, ValueError, TimeoutError) as error:
                        payload, mime, code = str(error).encode(), 'text/plain; charset=utf-8', 503
                else:
                    payload, mime, code = b'Not found', 'text/plain', 404
                self.send_response(code)
                self.send_header('Content-Type', mime)
                self.send_header('Cache-Control', 'no-store')
                self.send_header('X-Content-Type-Options', 'nosniff')
                self.send_header('Content-Length', str(len(payload)))
                self.end_headers()
                try:
                    self.wfile.write(payload)
                except (BrokenPipeError, ConnectionResetError):
                    pass
        server = HTTPServer(('127.0.0.1', args.http_port), Handler)
        print('http://127.0.0.1:' + str(args.http_port) + route, flush=True)
        try:
            server.serve_forever()
        finally:
            server.server_close()
    except KeyboardInterrupt:
        pass
    finally:
        camera.close()

if __name__ == '__main__':
    main()
