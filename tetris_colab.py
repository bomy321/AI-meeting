# ============================================================
# 俄羅斯方塊 — Google Colab 單一儲存格版本
# 用法：在 Colab 新建筆記本，將本檔全部內容貼入一個儲存格後執行
# ============================================================

!pip install -q ipywidgets matplotlib

import random
import time
from copy import deepcopy

import matplotlib.pyplot as plt
import matplotlib.patches as patches
from matplotlib import animation
import ipywidgets as widgets
from IPython.display import display, HTML

# ── 常數 ──────────────────────────────────────────
COLS, ROWS = 10, 20
CELL = 0.9

SHAPES = {
    'I': [[1, 1, 1, 1]],
    'O': [[1, 1], [1, 1]],
    'T': [[0, 1, 0], [1, 1, 1]],
    'S': [[0, 1, 1], [1, 1, 0]],
    'Z': [[1, 1, 0], [0, 1, 1]],
    'J': [[1, 0, 0], [1, 1, 1]],
    'L': [[0, 0, 1], [1, 1, 1]],
}

COLORS = {
    'I': '#00f0f0', 'O': '#f0f000', 'T': '#a000f0',
    'S': '#00f000', 'Z': '#f00000', 'J': '#0000f0', 'L': '#f0a000',
    'ghost': '#333333', 'grid': '#1a1a2e', 'bg': '#0f0f1a',
}

SCORE_TABLE = [0, 100, 300, 500, 800]


def rotate_cw(matrix):
    return [list(row) for row in zip(*matrix[::-1])]


class Piece:
    def __init__(self, kind=None):
        self.kind = kind or random.choice(list(SHAPES.keys()))
        self.shape = [row[:] for row in SHAPES[self.kind]]
        self.color = COLORS[self.kind]
        self.x = COLS // 2 - len(self.shape[0]) // 2
        self.y = 0

    def rotated(self):
        p = Piece(self.kind)
        p.shape = rotate_cw(self.shape)
        p.x, p.y = self.x, self.y
        return p


class TetrisGame:
    def __init__(self):
        self.reset()

    def reset(self):
        self.board = [[None] * COLS for _ in range(ROWS)]
        self.score = 0
        self.lines = 0
        self.level = 1
        self.game_over = False
        self.paused = False
        self.bag = []
        self.current = self._next_piece()
        self.next = self._next_piece()
        self.last_drop = time.time()
        if self._collides(self.current):
            self.game_over = True

    def _refill_bag(self):
        self.bag = list(SHAPES.keys())
        random.shuffle(self.bag)

    def _next_piece(self):
        if not self.bag:
            self._refill_bag()
        return Piece(self.bag.pop())

    def _collides(self, piece, dx=0, dy=0):
        for r, row in enumerate(piece.shape):
            for c, cell in enumerate(row):
                if not cell:
                    continue
                nx, ny = piece.x + c + dx, piece.y + r + dy
                if nx < 0 or nx >= COLS or ny >= ROWS:
                    return True
                if ny >= 0 and self.board[ny][nx] is not None:
                    return True
        return False

    def _lock_piece(self):
        for r, row in enumerate(self.current.shape):
            for c, cell in enumerate(row):
                if cell and self.current.y + r >= 0:
                    self.board[self.current.y + r][self.current.x + c] = self.current.color
        cleared = self._clear_lines()
        if cleared:
            self.lines += cleared
            self.score += SCORE_TABLE[cleared] * self.level
            self.level = self.lines // 10 + 1
        self.current = self.next
        self.next = self._next_piece()
        if self._collides(self.current):
            self.game_over = True

    def _clear_lines(self):
        new_board = [row for row in self.board if any(cell is None for cell in row)]
        cleared = ROWS - len(new_board)
        while len(new_board) < ROWS:
            new_board.insert(0, [None] * COLS)
        self.board = new_board
        return cleared

    def drop_interval(self):
        return max(0.08, 0.6 - (self.level - 1) * 0.05)

    def ghost_y(self):
        g = deepcopy(self.current)
        while not self._collides(g, dy=1):
            g.y += 1
        return g.y

    def move(self, dx, dy):
        if self.game_over or self.paused:
            return
        if not self._collides(self.current, dx, dy):
            self.current.x += dx
            self.current.y += dy
            if dy > 0:
                self.score += 1

    def rotate(self):
        if self.game_over or self.paused:
            return
        rotated = self.current.rotated()
        for kick in [0, -1, 1, -2, 2]:
            rotated.x = self.current.x + kick
            rotated.y = self.current.y
            if not self._collides(rotated):
                self.current = rotated
                return

    def hard_drop(self):
        if self.game_over or self.paused:
            return
        while not self._collides(self.current, dy=1):
            self.current.y += 1
            self.score += 2
        self._lock_piece()

    def soft_drop_tick(self):
        if self.game_over or self.paused:
            return
        if self._collides(self.current, dy=1):
            self._lock_piece()
        else:
            self.current.y += 1

    def tick(self):
        if self.game_over or self.paused:
            return
        now = time.time()
        if now - self.last_drop >= self.drop_interval():
            self.soft_drop_tick()
            self.last_drop = now

    def toggle_pause(self):
        if not self.game_over:
            self.paused = not self.paused


def draw_board(ax, game):
    ax.set_xlim(-0.5, COLS * CELL + 6)
    ax.set_ylim(-0.5, ROWS * CELL + 0.5)
    ax.set_aspect('equal')
    ax.axis('off')
    ax.set_facecolor(COLORS['bg'])

    for r in range(ROWS):
        for c in range(COLS):
            ax.add_patch(patches.Rectangle(
                (c * CELL, (ROWS - 1 - r) * CELL), CELL, CELL,
                linewidth=0.3, edgecolor=COLORS['grid'],
                facecolor=COLORS['bg'], zorder=0))

    def draw_cells(shape, px, py, color, alpha=1.0, zorder=2):
        for r, row in enumerate(shape):
            for c, cell in enumerate(row):
                if cell:
                    x = (px + c) * CELL
                    y = (ROWS - 1 - (py + r)) * CELL
                    ax.add_patch(patches.FancyBboxPatch(
                        (x + 0.05, y + 0.05), CELL - 0.1, CELL - 0.1,
                        boxstyle='round,pad=0.02', facecolor=color,
                        edgecolor='white', linewidth=0.5, alpha=alpha, zorder=zorder))

    for r in range(ROWS):
        for c in range(COLS):
            if game.board[r][c]:
                draw_cells([[1]], c, r, game.board[r][c])

    if not game.game_over:
        ghost = deepcopy(game.current)
        ghost.y = game.ghost_y()
        draw_cells(ghost.shape, ghost.x, ghost.y, COLORS['ghost'], alpha=0.25, zorder=1)
        draw_cells(game.current.shape, game.current.x, game.current.y, game.current.color, zorder=3)

    info_x = COLS * CELL + 0.8
    ax.text(info_x, ROWS * CELL - 0.5, 'NEXT', color='white', fontsize=11, fontweight='bold')
    for r, row in enumerate(game.next.shape):
        for c, cell in enumerate(row):
            if cell:
                ax.add_patch(patches.FancyBboxPatch(
                    (info_x + c * 0.55, ROWS * CELL - 2.5 - r * 0.55),
                    0.5, 0.5, boxstyle='round,pad=0.01',
                    facecolor=game.next.color, edgecolor='white', linewidth=0.3))

    status = 'GAME OVER' if game.game_over else ('PAUSED' if game.paused else '')
    for i, txt in enumerate([f'Score: {game.score}', f'Lines: {game.lines}', f'Level: {game.level}']):
        ax.text(info_x, ROWS * CELL - 5.5 - i * 0.9, txt, color='white', fontsize=10, family='monospace')
    if status:
        ax.text(info_x, ROWS * CELL - 9, status,
                color='#ff4444' if game.game_over else '#ffcc00', fontsize=12, fontweight='bold')


# ── 啟動 ────────────────────────────────────────────
game = TetrisGame()
fig, ax = plt.subplots(figsize=(7, 12))
fig.patch.set_facecolor(COLORS['bg'])

buttons = {}
for key, desc, style in [
    ('left', '◀ 左', 'info'), ('right', '右 ▶', 'info'), ('down', '▼ 下', 'warning'),
    ('rot', '↻ 旋轉', 'success'), ('drop', '⏬ 落地', 'danger'),
    ('pause', '⏸ 暫停', ''), ('restart', '🔄 重開', 'primary'),
]:
    buttons[key] = widgets.Button(description=desc, button_style=style, layout=widgets.Layout(width='78px'))

controls = widgets.HBox(list(buttons.values()))


def render():
    ax.clear()
    draw_board(ax, game)


buttons['left'].on_click(lambda _: (game.move(-1, 0), render()))
buttons['right'].on_click(lambda _: (game.move(1, 0), render()))
buttons['down'].on_click(lambda _: (game.move(0, 1), render()))
buttons['rot'].on_click(lambda _: (game.rotate(), render()))
buttons['drop'].on_click(lambda _: (game.hard_drop(), render()))
buttons['pause'].on_click(lambda _: game.toggle_pause())
buttons['restart'].on_click(lambda _: (game.reset(), render()))


def update_frame(_):
    game.tick()
    render()


render()
ani = animation.FuncAnimation(fig, update_frame, interval=80, cache_frame_data=False)

display(controls)
display(HTML('<p style="color:#888;font-size:13px">💡 鍵盤：← → ↓ 移動、↑/Z 旋轉、空白鍵落地、P 暫停</p>'))

try:
    from google.colab import output as colab_output

    def handle_key(key):
        actions = {
            'ArrowLeft': lambda: game.move(-1, 0),
            'ArrowRight': lambda: game.move(1, 0),
            'ArrowDown': lambda: game.move(0, 1),
            'ArrowUp': game.rotate, 'z': game.rotate, 'Z': game.rotate,
            ' ': game.hard_drop,
            'p': game.toggle_pause, 'P': game.toggle_pause,
        }
        if key in actions:
            actions[key]()
        elif key in ('r', 'R') and game.game_over:
            game.reset()
        render()

    colab_output.register_callback('tetris_key', handle_key)
    display(HTML('''<script>
    document.addEventListener('keydown', function(e) {
      google.colab.kernel.invokeFunction('tetris_key', [e.key], {});
    });
    </script>'''))
    print('鍵盤控制已啟用 ✓')
except ImportError:
    print('非 Colab 環境，請使用按鈕操作')

display(HTML(ani.to_jshtml()))
print('遊戲已啟動！')
