'use strict';

// 貪吃蛇連線版伺服器：所有遊戲邏輯都在這裡計算，瀏覽器只負責送出方向與繪圖。
// 啟動：npm install && npm start，可用環境變數 PORT 指定埠號（預設 3000）。

const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT) || 3000;
const CLIENT_FILE = path.join(__dirname, 'snake1.html');

const COLS = 64;
const ROWS = 36;
const MAX_PLAYERS = 6;
const MAX_CONNECTIONS = 30; // 玩家加觀戰者的總連線上限
const TICK_MS = 140;
const HEARTBEAT_MS = 15000;
const POINTS_PER_FOOD = 10;
const BASE_FOOD = 3;
const FOOD_PER_PLAYER = 2;
const MAX_FOOD = 60;
const START_LENGTH = 3;
const NAME_MAX_LENGTH = 12;

const DIRECTIONS = {
    up: [0, -1],
    down: [0, 1],
    left: [-1, 0],
    right: [1, 0],
};

// 格子以單一整數表示：cell = y * COLS + x
const toCell = (x, y) => y * COLS + x;
const cellX = (cell) => cell % COLS;
const cellY = (cell) => Math.floor(cell / COLS);

class Game {
    constructor(random = Math.random) {
        this.random = random;
        this.players = new Map(); // seat -> player
        this.food = new Set();
        this.record = { name: '', score: 0 };
        this.refillFood();
    }

    randomInt(min, max) {
        return min + Math.floor(this.random() * (max - min + 1));
    }

    addPlayer(rawName) {
        if (this.players.size >= MAX_PLAYERS) return null;
        let seat = 0;
        while (this.players.has(seat)) seat++;
        const player = {
            id: seat,
            name: cleanName(rawName) || `玩家${seat + 1}`,
            score: 0,
            best: 0,
            body: null,
            dir: DIRECTIONS.right,
            queue: [],
        };
        this.players.set(seat, player);
        return player;
    }

    removePlayer(player) {
        this.players.delete(player.id);
    }

    occupiedCells() {
        const occupied = new Set();
        for (const player of this.players.values()) {
            if (player.body) player.body.forEach((cell) => occupied.add(cell));
        }
        return occupied;
    }

    // 找一塊周圍淨空的位置出生；場地擁擠時逐步放寬距離，真的沒位置才回傳 false。
    spawn(player) {
        if (player.body) return true;
        const occupied = this.occupiedCells();
        const isClear = (x, y, radius) => {
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const nx = x + dx;
                    const ny = y + dy;
                    if (nx < 0 || nx >= COLS || ny < 0 || ny >= ROWS) continue;
                    if (occupied.has(toCell(nx, ny))) return false;
                }
            }
            return true;
        };

        for (const radius of [6, 4, 2]) {
            for (let attempt = 0; attempt < 200; attempt++) {
                const x = this.randomInt(8, COLS - 9);
                const y = this.randomInt(4, ROWS - 5);
                if (!isClear(x, y, radius)) continue;

                const dir = x < COLS / 2 ? DIRECTIONS.right : DIRECTIONS.left;
                player.body = [];
                for (let i = 0; i < START_LENGTH; i++) {
                    const cell = toCell(x - dir[0] * i, y);
                    player.body.push(cell);
                    this.food.delete(cell);
                }
                player.dir = dir;
                player.queue = [];
                player.score = 0;
                this.refillFood();
                return true;
            }
        }
        return false;
    }

    // 最多預存兩次轉向，快速連按也不會掉指令；不允許直接回頭。
    turn(player, dirName) {
        if (!player.body || !Object.hasOwn(DIRECTIONS, dirName)) return;
        const dir = DIRECTIONS[dirName];
        const last = player.queue.at(-1) ?? player.dir;
        const isReverse = dir[0] === -last[0] && dir[1] === -last[1];
        if (dir === last || isReverse || player.queue.length >= 2) return;
        player.queue.push(dir);
    }

    addScore(player) {
        player.score += POINTS_PER_FOOD;
        player.best = Math.max(player.best, player.score);
        if (player.score > this.record.score) {
            this.record = { name: player.name, score: player.score };
        }
    }

    tick() {
        const alive = [...this.players.values()].filter((player) => player.body);
        const dead = new Set();

        // 先讓所有蛇同時前進，再統一判定碰撞，結果才不受玩家順序影響。
        for (const player of alive) {
            if (player.queue.length) player.dir = player.queue.shift();
            const x = cellX(player.body[0]) + player.dir[0];
            const y = cellY(player.body[0]) + player.dir[1];
            if (x < 0 || x >= COLS || y < 0 || y >= ROWS) {
                dead.add(player);
                continue;
            }
            const head = toCell(x, y);
            player.body.unshift(head);
            if (this.food.delete(head)) this.addScore(player);
            else player.body.pop();
        }

        const counts = new Map();
        for (const player of alive) {
            for (const cell of player.body) counts.set(cell, (counts.get(cell) || 0) + 1);
        }
        for (const player of alive) {
            if (counts.get(player.body[0]) > 1) dead.add(player);
        }

        // 陣亡的蛇每隔一節變成食物。
        const dropped = [];
        for (const player of dead) {
            player.body.forEach((cell, i) => {
                if (i % 2 === 0) dropped.push(cell);
            });
            player.body = null;
            player.queue = [];
        }
        const occupied = this.occupiedCells();
        for (const cell of dropped) {
            if (this.food.size < MAX_FOOD && !occupied.has(cell)) this.food.add(cell);
        }

        this.refillFood();
    }

    refillFood() {
        const target = Math.min(MAX_FOOD, BASE_FOOD + this.players.size * FOOD_PER_PLAYER);
        const occupied = this.occupiedCells();
        for (let attempt = 0; attempt < 500 && this.food.size < target; attempt++) {
            const cell = toCell(this.randomInt(0, COLS - 1), this.randomInt(0, ROWS - 1));
            if (!occupied.has(cell)) this.food.add(cell);
        }
    }

    snapshot() {
        return {
            t: 'state',
            players: [...this.players.values()].map(({ id, name, score, best, body }) => ({
                id, name, score, best, body,
            })),
            food: [...this.food],
            record: this.record,
        };
    }
}

function cleanName(rawName) {
    if (typeof rawName !== 'string') return '';
    return Array.from(rawName.replace(/\p{Cc}/gu, '').trim()).slice(0, NAME_MAX_LENGTH).join('');
}

function startServer() {
    const game = new Game();

    const server = http.createServer((req, res) => {
        // 只提供遊戲頁面，避免把專案目錄內的其他檔案暴露到網路上。
        const { pathname } = new URL(req.url, 'http://localhost');
        if (req.method !== 'GET' || (pathname !== '/' && pathname !== '/snake1.html')) {
            res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
            res.end('Not found');
            return;
        }
        fs.readFile(CLIENT_FILE, (err, html) => {
            if (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
                res.end('無法讀取遊戲頁面');
                return;
            }
            res.writeHead(200, {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-cache',
            });
            res.end(html);
        });
    });

    const wss = new WebSocketServer({ server, maxPayload: 256 });
    const send = (ws, message) => {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message));
    };

    const handleMessage = (ws, msg) => {
        switch (msg.t) {
            case 'join': {
                if (ws.player) return;
                const player = game.addPlayer(msg.name);
                if (!player) {
                    send(ws, { t: 'full' });
                    return;
                }
                ws.player = player;
                send(ws, { t: 'joined', id: player.id, name: player.name });
                if (!game.spawn(player)) send(ws, { t: 'spawnFail' });
                break;
            }
            case 'spawn':
                if (ws.player && !game.spawn(ws.player)) send(ws, { t: 'spawnFail' });
                break;
            case 'turn':
                if (ws.player) game.turn(ws.player, msg.dir);
                break;
            case 'leave':
                if (ws.player) {
                    game.removePlayer(ws.player);
                    ws.player = null;
                }
                break;
        }
    };

    wss.on('connection', (ws) => {
        if (wss.clients.size > MAX_CONNECTIONS) {
            ws.close(1013, 'server full');
            return;
        }
        ws.player = null;
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        ws.on('error', () => ws.terminate());
        ws.on('close', () => {
            if (ws.player) game.removePlayer(ws.player);
            ws.player = null;
        });
        ws.on('message', (data) => {
            let msg;
            try {
                msg = JSON.parse(data);
            } catch {
                return;
            }
            if (msg && typeof msg === 'object') handleMessage(ws, msg);
        });
        send(ws, { t: 'hello', cols: COLS, rows: ROWS, maxPlayers: MAX_PLAYERS });
        send(ws, game.snapshot());
    });

    setInterval(() => {
        game.tick();
        const payload = JSON.stringify(game.snapshot());
        for (const ws of wss.clients) {
            if (ws.readyState === WebSocket.OPEN) ws.send(payload);
        }
    }, TICK_MS);

    // 斷線但沒有正常關閉的連線要清掉，否則會一直佔住 6 個座位之一。
    setInterval(() => {
        for (const ws of wss.clients) {
            if (!ws.isAlive) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            ws.ping();
        }
    }, HEARTBEAT_MS);

    server.on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.error(`埠號 ${PORT} 已被占用，請改用：PORT=其他埠號 npm start`);
            process.exit(1);
        }
        throw err;
    });

    server.listen(PORT, () => {
        console.log('貪吃蛇連線版伺服器已啟動');
        console.log(`  本機：http://localhost:${PORT}`);
        for (const addrs of Object.values(os.networkInterfaces())) {
            for (const addr of addrs) {
                if (addr.family === 'IPv4' && !addr.internal) {
                    console.log(`  區網：http://${addr.address}:${PORT}`);
                }
            }
        }
    });
}

if (require.main === module) startServer();

module.exports = { Game, COLS, ROWS, MAX_PLAYERS, toCell };
