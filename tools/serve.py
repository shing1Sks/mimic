"""Serve games/ on http://127.0.0.1:8765 for local play, and receive play recordings.

Threaded, with a deep connection queue, because a game page loads dozens of models, textures and
sounds at once. Recordings (games/lib/recorder.js) arrive as POST /rec/<session>/<file>?append=1
and are written to recordings/<session>/<file> next to games/ (git-ignored).

Also the dev signaling mailbox for the browser controller (games/lib/mimic-link.js, games/phone/):
  POST /signal/<room>                                body {from, to, type, data} -> {seq}
  GET  /signal/<room>?for=<id>&after=<seq>&wait=<ms> -> {seq, msgs: [...]}  (long-poll, <= 15 s)
  GET  /signal-info                                  -> {lan, port, lan_bound}
Held in memory only; the contract is in docs/browser-controller.md.

Usage: python tools/serve.py [port] [--lan]
  --lan  listen on every interface (0.0.0.0) so a phone on the same Wi-Fi can open the pages
         (by default only this PC can: 127.0.0.1, or a USB phone through `adb reverse`)."""
import functools, http.server, json, os, re, socket, sys, threading, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', 'games'))
REC = os.path.abspath(os.path.join(HERE, '..', 'recordings'))
SAFE = re.compile(r'^[A-Za-z0-9._-]{1,80}$')
SIG_ID = re.compile(r'^[A-Za-z0-9_-]{1,40}$')


class Mailbox:
    """Signaling messages per room, in memory. A message lives MSG_TTL seconds (an offer is only
    useful while the phone waits for it); an idle room is dropped after ROOM_TTL seconds."""
    MSG_TTL, ROOM_TTL, MAX_MSGS, MAX_ROOMS, MAX_BODY = 60.0, 600.0, 500, 1000, 64 * 1024

    def __init__(self, clock=time.monotonic):
        self.clock = clock
        self.rooms = {}
        self.cv = threading.Condition()

    def _sweep(self, now):
        for k in [k for k, r in self.rooms.items() if now - r['t'] > self.ROOM_TTL]:
            del self.rooms[k]
        for r in self.rooms.values():
            r['msgs'] = [m for m in r['msgs'] if now - m['_t'] <= self.MSG_TTL]

    def post(self, room, msg):
        """Store one message; returns its seq. Raises ValueError on a bad message."""
        if not SIG_ID.match(room or ''):
            raise ValueError('bad room')
        if not isinstance(msg, dict) or not SIG_ID.match(str(msg.get('from', ''))) or not SIG_ID.match(str(msg.get('to', ''))):
            raise ValueError('bad from/to')
        typ = msg.get('type')
        if not isinstance(typ, str) or not 0 < len(typ) <= 20:
            raise ValueError('bad type')
        with self.cv:
            now = self.clock()
            self._sweep(now)
            r = self.rooms.get(room)
            if r is None:
                if len(self.rooms) >= self.MAX_ROOMS:
                    raise ValueError('too many rooms')
                r = self.rooms[room] = {'seq': 0, 'msgs': [], 't': now}
            r['seq'] += 1
            r['t'] = now
            r['msgs'].append({'seq': r['seq'], 'from': msg['from'], 'to': msg['to'], 'type': typ,
                              'data': msg.get('data'), '_t': now})
            del r['msgs'][:-self.MAX_MSGS]
            self.cv.notify_all()
            return r['seq']

    def get(self, room, who, after, wait=0.0):
        """Messages for `who` newer than `after`, waiting up to `wait` seconds for the first one."""
        deadline = self.clock() + max(0.0, min(15.0, wait))
        with self.cv:
            while True:
                now = self.clock()
                self._sweep(now)
                r = self.rooms.get(room)
                msgs = [{k: v for k, v in m.items() if k != '_t'}
                        for m in (r['msgs'] if r else []) if m['to'] == who and m['seq'] > after]
                if msgs or now >= deadline:
                    return {'seq': r['seq'] if r else 0, 'msgs': msgs}
                self.cv.wait(min(1.0, deadline - now))


MAILBOX = Mailbox()


def lan_ip():
    """This PC's address on the local network (the one a phone on the same Wi-Fi would use)."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('10.255.255.255', 1))   # no packet is sent; this only picks the outgoing interface
        return s.getsockname()[0]
    except OSError:
        return None
    finally:
        s.close()


class Server(http.server.ThreadingHTTPServer):
    request_queue_size = 256
    daemon_threads = True


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def end_headers(self):
        # always revalidate, so an edited game is never run from a stale browser cache (unchanged
        # files still come back as a cheap 304 via Last-Modified)
        if self.command in ('GET', 'HEAD') and not self.path.startswith('/signal'):
            self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        try:
            self.wfile.write(body)
        except ConnectionError:   # the page went away while its long-poll was waiting
            pass

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.send_header('Access-Control-Max-Age', '600')
        self.end_headers()

    def do_GET(self):
        path, _, query = self.path.partition('?')
        if path == '/signal-info':
            host = self.server.server_address[0]
            return self._json(200, {'lan': lan_ip(), 'port': self.server.server_address[1], 'lan_bound': host != '127.0.0.1'})
        if path.startswith('/signal/'):
            q = dict(p.partition('=')[::2] for p in query.split('&') if p)
            try:
                after, wait = int(q.get('after', '0')), float(q.get('wait', '0')) / 1000
            except ValueError:
                return self._json(400, {'error': 'bad after/wait'})
            room, who = path[len('/signal/'):], q.get('for', '')
            if not SIG_ID.match(room) or not SIG_ID.match(who):
                return self._json(400, {'error': 'bad room/for'})
            return self._json(200, MAILBOX.get(room, who, after, wait))
        return super().do_GET()

    def do_POST(self):
        path, _, query = self.path.partition('?')
        if path.startswith('/signal/'):
            n = int(self.headers.get('Content-Length', 0))
            if n > Mailbox.MAX_BODY:
                return self._json(413, {'error': 'too big'})
            try:
                msg = json.loads(self.rfile.read(n) or b'null')
                return self._json(200, {'seq': MAILBOX.post(path[len('/signal/'):], msg)})
            except ValueError as e:   # json.JSONDecodeError is a ValueError
                return self._json(400, {'error': str(e)})
        parts = path.strip('/').split('/')
        if len(parts) != 3 or parts[0] != 'rec' or not SAFE.match(parts[1]) or not SAFE.match(parts[2]):
            self.send_error(400, 'expected /rec/<session>/<file>')
            return
        n = int(self.headers.get('Content-Length', 0))
        if n > 200 * 1024 * 1024:
            self.send_error(413)
            return
        body = self.rfile.read(n)
        folder = os.path.join(REC, parts[1])
        os.makedirs(folder, exist_ok=True)
        with open(os.path.join(folder, parts[2]), 'ab' if 'append=1' in query else 'wb') as f:
            f.write(body)
        self.send_response(204)
        self.end_headers()


if __name__ == '__main__':
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    port = int(args[0]) if args else 8765
    host = '0.0.0.0' if '--lan' in sys.argv else '127.0.0.1'
    lan = f' and http://{lan_ip()}:{port} (LAN)' if host == '0.0.0.0' else ''
    print(f'serving {ROOT} on http://127.0.0.1:{port}{lan} (recordings -> {REC})', flush=True)
    Server((host, port), functools.partial(Handler, directory=ROOT)).serve_forever()
