# -*- coding: utf-8 -*-
"""
lingshan_web.py —— 《灵山掌门》公网服务器（升级版）
- 静态托管（no-cache、禁目录浏览）
- 斗法约战房间 API（两人同时在线：/api/duel/*，内存房间+30 分钟过期，线程锁）
- 静态部分与旧版兼容，可直接替换 C:\lingshan\lingshan_web.py 后重启 LingshanServer
"""
import json
import mimetypes
import os
import threading
import time
import uuid
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.dirname(os.path.abspath(__file__))
PORT = 8090
ROOM_TTL = 30 * 60  # 房间 30 分钟无活动自动清理

mimetypes.add_type('application/javascript', '.js')
mimetypes.add_type('text/css', '.css')
mimetypes.add_type('application/json', '.json')

# ── 斗法房间 ──
ROOMS = {}
ROOMS_LOCK = threading.Lock()

# 招式表（与 data/cultivation.json 同步；启动时从 data 读取覆盖）
MOVES = {}
WEAPONS = []
TECHS = []
WUXING_CYCLE = {'金': '木', '木': '土', '土': '水', '水': '火', '火': '金'}


def load_moves():
    global MOVES, WEAPONS, TECHS
    try:
        with open(os.path.join(ROOT, 'data', 'cultivation.json'), encoding='utf-8') as f:
            cul = json.load(f)
        MOVES = cul.get('moves', {})
        WEAPONS = cul.get('weapons', [])
        TECHS = cul.get('techniques', [])
    except Exception:
        pass


def weapon_of(wid):
    return next((w for w in WEAPONS if w['id'] == wid), None)


def tech_of(tid):
    return next((t for t in TECHS if t['id'] == tid), None)


def move_of(card, kind):
    """card.weapon/technique → 对应招式；无则普攻"""
    wid = card.get('weapon')
    tid = card.get('technique')
    if kind == 'weapon' and wid:
        w = weapon_of(wid)
        m = MOVES.get('weapon_moves', {}).get(wid)
        if m and w:
            return dict(m, element=w['element'])
    if kind == 'tech' and tid:
        t = tech_of(tid)
        m = MOVES.get('technique_moves', {}).get(tid)
        if m and t:
            return dict(m, element=t['element'])
    return {'name': '吐纳掌', 'mult': 1.0, 'element': None}


def element_mult(atk_el, def_el):
    if atk_el and def_el and WUXING_CYCLE.get(atk_el) == def_el:
        return 1.25
    if atk_el and def_el and WUXING_CYCLE.get(def_el) == atk_el:
        return 0.85
    return 1.0


def fighter_of(card):
    """从名片算战斗单位（与前端公式同源）"""
    realm = int(card.get('realm', 0))
    wid = card.get('weapon')
    wsharp = next((w['sharp'] for w in WEAPONS if w['id'] == wid), 3)
    toxic = int(card.get('pill_toxic', 0))
    toxic_cut = max(0.7, 1 - toxic // 10 * 0.03)
    hp = round((80 + realm * 45 + wsharp * 0.8) * toxic_cut)
    atk = round((10 + realm * 6 + wsharp * 0.4))
    el = card.get('root_element') or (weapon_of(wid) or {}).get('element')
    return {'hp': hp, 'hp_max': hp, 'atk': atk, 'toxic': toxic, 'element': el}


def settle_round(room):
    """双方招式齐 → 结算该回合（确定性：种子=room+round）"""
    r = room['round']
    import random
    rnd = random.Random(str(room['id']) + ':' + str(r))
    p1, p2 = room['players'][0], room['players'][1]
    for atker, defer in ((p1, p2), (p2, p1)):
        mv = atker['move'] or {'name': '吐纳掌', 'mult': 1.0, 'element': None}
        mult = mv.get('mult', 1.0)
        em = element_mult(mv.get('element'), defer.get('element'))
        dmg = max(1, round(atker['atk'] * mult * em * (0.9 + rnd.random() * 0.2)))
        # 暴击（5%）与格挡（15%）
        if rnd.random() < 0.05:
            dmg = round(dmg * 1.6)
            mv.setdefault('crit_' + atker['token'], True)
        elif rnd.random() < 0.15:
            dmg = round(dmg * 0.5)
            defer.setdefault('guarded_' + str(r), True)
        defer['hp'] = max(0, defer['hp'] - dmg)
        room['last_dmg_' + atker['token']] = dmg
    room['round'] = r + 1
    room['moves'] = [None, None]
    # 终局判定
    if p1['hp'] <= 0 or p2['hp'] <= 0 or room['round'] > 6:
        room['state'] = 'done'
        room['winner'] = 0 if p1['hp'] >= p2['hp'] else 1


def sweep_rooms():
    now = time.time()
    dead = [rid for rid, r in ROOMS.items() if now - r['ts'] > ROOM_TTL]
    for rid in dead:
        ROOMS.pop(rid, None)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def log_message(self, fmt, *args):
        pass  # 静默访问日志

    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def _json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.startswith('/api/duel/state'):
            qs = self.path.split('?', 1)[1] if '?' in self.path else ''
            params = dict(p.split('=', 1) for p in qs.split('&') if '=' in p)
            room_id = params.get('room', '')
            token = params.get('token', '')
            with ROOMS_LOCK:
                room = ROOMS.get(room_id)
                if not room:
                    return self._json({'ok': False, 'error': '房间不存在或已过期'}, 404)
                me_idx = 0 if room['players'][0]['token'] == token else 1
                if room['players'][me_idx]['token'] != token:
                    return self._json({'ok': False, 'error': '不是本房间玩家'}, 403)
                me = room['players'][me_idx]
                op = room['players'][1 - me_idx]
                sweep_rooms()
                my_move_done = me['move'] is not None
                op_move_done = op['move'] is not None
                both = my_move_done and op_move_done
                return self._json({
                    'ok': True, 'state': room['state'], 'round': room['round'],
                    'me': {'hp': me['hp'], 'hp_max': me['hp_max'], 'move_done': my_move_done},
                    'op': {'dao': op['dao'], 'hp': op['hp'], 'hp_max': op['hp_max'],
                           'op_move': (op['move']['name'] if both and op['move'] else None),
                           'dmg_to_me': (room.get('last_dmg_' + op['token']) if both else None)},
                    'winner': room.get('winner'), 'ready': room.get('ready', False)
                })
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        try:
            body = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            return self._json({'ok': False, 'error': 'bad json'}, 400)

        if self.path == '/api/duel/create':
            with ROOMS_LOCK:
                sweep_rooms()
                room_id = uuid.uuid4().hex[:6].upper()
                token = uuid.uuid4().hex[:12]
                ROOMS[room_id] = {
                    'id': room_id, 'ts': time.time(), 'state': 'waiting', 'round': 1,
                    'moves': [None, None], 'winner': None,
                    'players': [{'token': token, 'dao': body.get('dao', '掌门'),
                                 'card': body.get('card', {}), 'move': None,
                                 **fighter_of(body.get('card', {}))}]
                }
                return self._json({'ok': True, 'room': room_id, 'token': token})

        if self.path == '/api/duel/join':
            with ROOMS_LOCK:
                room = ROOMS.get(body.get('room', ''))
                if not room:
                    return self._json({'ok': False, 'error': '房间不存在或已过期'}, 404)
                if room['state'] != 'waiting' or len(room['players']) >= 2:
                    return self._json({'ok': False, 'error': '房间已满'}, 409)
                token = uuid.uuid4().hex[:12]
                room['players'].append({'token': token, 'dao': body.get('dao', '道友'),
                                        'card': body.get('card', {}), 'move': None,
                                        **fighter_of(body.get('card', {}))})
                room['state'] = 'fighting'  # 双方就绪，进入斗法
                room['ts'] = time.time()
                return self._json({'ok': True, 'token': token})

        if self.path == '/api/duel/move':
            with ROOMS_LOCK:
                room = ROOMS.get(body.get('room', ''))
                token = body.get('token', '')
                if not room:
                    return self._json({'ok': False, 'error': '房间不存在'}, 404)
                me_idx = 0 if room['players'][0]['token'] == token else 1
                me = room['players'][me_idx]
                if me['token'] != token:
                    return self._json({'ok': False, 'error': '不是本房间玩家'}, 403)
                if room['state'] != 'fighting' or me['move'] is not None:
                    return self._json({'ok': False, 'error': '当前不可提交'}, 409)
                me['move'] = body.get('move') or {'name': '吐纳掌', 'mult': 1.0, 'element': None}
                room['ts'] = time.time()
                if room['players'][0]['move'] and room['players'][1]['move']:
                    settle_round(room)
                return self._json({'ok': True})

        return self._json({'ok': False, 'error': 'unknown api'}, 404)


if __name__ == '__main__':
    load_moves()
    server = ThreadingHTTPServer(('0.0.0.0', PORT), Handler)
    print('[lingshan] 静态+斗法API 服务 http://0.0.0.0:%d 根目录=%s' % (PORT, ROOT))
    server.serve_forever()
