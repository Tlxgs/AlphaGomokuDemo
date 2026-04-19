// UI 管理与交互
class GomokuApp {
    constructor() {
        this.boardSize = 15;
        this.cellSize = 40;
        this.margin = 40;
        this.canvas = document.getElementById('boardCanvas');
        this.ctx = this.canvas.getContext('2d');

        this.game = new GomokuGame(this.boardSize);
        this.mcts = new MCTS(this.boardSize, 1.5, 200, 0.0);

        this.playerColor = 'black'; // 'black' 或 'white'
        this.humanPlayer = 1;  // 黑棋
        this.aiPlayer = -1;    // 白棋

        this.aiThinking = false;
        this.gameOver = false;
        this.displayMode = 'board';

        this.bindEvents();
        this.initUI();
        this.loadModelAndStart();
    }

    async loadModelAndStart() {
        document.getElementById('modelStatus').textContent = '正在加载模型...';
        const success = await this.mcts.loadModel('model.onnx');
        if (success) {
            document.getElementById('modelStatus').textContent = '模型已加载 ✓';
            // 如果AI先手（白棋且人类选白棋则AI黑棋先走）
            if (this.humanPlayer === -1) {
                setTimeout(() => this.aiMove(), 100);
            }
        } else {
            document.getElementById('modelStatus').textContent = '模型加载失败，请刷新';
        }
        this.drawBoard();
    }

    initUI() {
        const colorSelect = document.getElementById('playerColor');
        colorSelect.addEventListener('change', (e) => {
            if (this.game.moveCount > 0) {
                alert('对局已开始，请重置后再切换执子');
                colorSelect.value = this.playerColor;
                return;
            }
            this.playerColor = e.target.value;
            this.humanPlayer = this.playerColor === 'black' ? 1 : -1;
            this.aiPlayer = -this.humanPlayer;
            this.updateStatus();
        });

        document.getElementById('applyBtn').addEventListener('click', () => {
            this.applyParams();
        });

        document.getElementById('resetBtn').addEventListener('click', () => {
            this.resetGame();
        });

        document.getElementById('displayMode').addEventListener('change', (e) => {
            this.displayMode = e.target.value;
            this.drawBoard();
        });

        this.canvas.addEventListener('click', (e) => this.handleCanvasClick(e));
    }

    applyParams() {
        const sims = parseInt(document.getElementById('simulations').value);
        const cpuct = parseFloat(document.getElementById('cpuct').value);
        const temp = parseFloat(document.getElementById('temperature').value);

        this.mcts.numSimulations = sims;
        this.mcts.c_puct = cpuct;
        this.mcts.temperature = temp;
        this.mcts.root = null; // 重置搜索树

        document.getElementById('statusMessage').textContent = '参数已更新';
    }

    resetGame() {
        this.game.reset();
        this.mcts.root = null;
        this.gameOver = false;
        this.aiThinking = false;

        // 更新执子设置
        const colorSelect = document.getElementById('playerColor');
        this.playerColor = colorSelect.value;
        this.humanPlayer = this.playerColor === 'black' ? 1 : -1;
        this.aiPlayer = -this.humanPlayer;

        this.drawBoard();
        this.updateWinrate(0.5);
        this.updateStatus();

        // 如果AI先手
        if (this.humanPlayer === -1) {
            setTimeout(() => this.aiMove(), 100);
        }
    }

    handleCanvasClick(e) {
        if (this.gameOver || this.aiThinking) return;
        if (this.game.currentPlayer !== this.humanPlayer) return;

        const rect = this.canvas.getBoundingClientRect();
        const scaleX = this.canvas.width / rect.width;
        const scaleY = this.canvas.height / rect.height;

        const canvasX = (e.clientX - rect.left) * scaleX;
        const canvasY = (e.clientY - rect.top) * scaleY;

        const col = Math.round((canvasX - this.margin) / this.cellSize);
        const row = Math.round((canvasY - this.margin) / this.cellSize);

        if (row >= 0 && row < this.boardSize && col >= 0 && col < this.boardSize) {
            this.humanMove(row, col);
        }
    }

    humanMove(row, col) {
        if (!this.game.isLegalMove(row, col)) return;

        this.game.makeMove(row, col);
        this.mcts.updateRoot(this.game, [row, col]);
        this.drawBoard();

        if (this.game.gameOver) {
            this.gameOver = true;
            this.showGameOverMessage();
            return;
        }

        this.updateStatus('AI 思考中...');
        this.aiThinking = true;
        setTimeout(() => this.aiMove(), 50);
    }

    async aiMove() {
        if (this.game.gameOver) {
            this.aiThinking = false;
            return;
        }
        if (this.game.currentPlayer !== this.aiPlayer) {
            this.aiThinking = false;
            this.updateStatus();
            return;
        }

        try {
            const { bestMove } = await this.mcts.getMoveProbs(this.game, this.mcts.temperature);
            if (!bestMove) {
                this.aiThinking = false;
                return;
            }

            const [row, col] = bestMove;
            this.game.makeMove(row, col);
            this.mcts.updateRoot(this.game, bestMove);
            this.drawBoard();

            if (this.game.gameOver) {
                this.gameOver = true;
                this.showGameOverMessage();
                this.aiThinking = false;
                return;
            }

            this.aiThinking = false;
            this.updateStatus();

            // 更新胜率显示
            if (this.mcts.root) {
                this.updateWinrateFromRoot();
            }

            // 如果人类回合但显示模式非board，持续更新统计（可选）
        } catch (e) {
            console.error('AI错误:', e);
            this.aiThinking = false;
            this.updateStatus('AI出错，请重置');
        }
    }

    showGameOverMessage() {
        let msg;
        if (this.game.winner === 1) msg = '黑棋获胜！';
        else if (this.game.winner === -1) msg = '白棋获胜！';
        else msg = '平局！';
        document.getElementById('statusMessage').textContent = msg;
        this.updateWinrate(this.game.winner === 1 ? 1.0 : (this.game.winner === -1 ? 0.0 : 0.5));
    }

    updateStatus(customMsg = null) {
        const statusEl = document.getElementById('statusMessage');
        if (customMsg) {
            statusEl.textContent = customMsg;
        } else {
            if (this.game.gameOver) return;
            const playerName = this.game.currentPlayer === 1 ? '黑棋' : '白棋';
            const turn = (this.game.currentPlayer === this.humanPlayer) ? '你的回合' : 'AI 思考中';
            statusEl.textContent = `${playerName} · ${turn}`;
        }
    }

    updateWinrateFromRoot() {
        if (!this.mcts.root) return;
        let totalVisits = 0;
        let valueSum = 0;
        for (const child of this.mcts.root.children.values()) {
            totalVisits += child.visitCount;
            valueSum += child.getValue() * child.visitCount;
        }
        if (totalVisits === 0) return;
        const avgValue = valueSum / totalVisits;
        // 转换到黑棋胜率
        let blackWin;
        if (this.game.currentPlayer === 1) {
            blackWin = (-avgValue + 1) / 2;
        } else {
            blackWin = (avgValue + 1) / 2;
        }
        this.updateWinrate(blackWin);
    }

    updateWinrate(blackWin) {
        blackWin = Math.max(0, Math.min(1, blackWin));
        const whiteWin = 1 - blackWin;
        document.getElementById('blackBar').style.width = `${blackWin * 100}%`;
        document.getElementById('blackBar').textContent = `黑棋 ${(blackWin * 100).toFixed(1)}%`;
        document.getElementById('whiteBar').style.width = `${whiteWin * 100}%`;
        document.getElementById('whiteBar').textContent = `白棋 ${(whiteWin * 100).toFixed(1)}%`;
    }

    drawBoard() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.drawGrid();
        this.drawStars();

        if (this.displayMode === 'board') {
            this.drawPieces();
        } else {
            this.drawStatsOverlay();
        }

        if (this.game.lastMove) {
            this.highlightLastMove(...this.game.lastMove);
        }
    }

    drawGrid() {
        this.ctx.lineWidth = 1.5;
        this.ctx.strokeStyle = '#333';
        const end = this.margin + (this.boardSize - 1) * this.cellSize;

        for (let i = 0; i < this.boardSize; i++) {
            const pos = this.margin + i * this.cellSize;
            // 垂直线
            this.ctx.beginPath();
            this.ctx.moveTo(pos, this.margin);
            this.ctx.lineTo(pos, end);
            this.ctx.stroke();
            // 水平线
            this.ctx.beginPath();
            this.ctx.moveTo(this.margin, pos);
            this.ctx.lineTo(end, pos);
            this.ctx.stroke();
        }
    }

    drawStars() {
        const stars = [[3,3], [11,3], [7,7], [3,11], [11,11]];
        this.ctx.fillStyle = '#333';
        stars.forEach(([r, c]) => {
            const x = this.margin + c * this.cellSize;
            const y = this.margin + r * this.cellSize;
            this.ctx.beginPath();
            this.ctx.arc(x, y, 4, 0, 2 * Math.PI);
            this.ctx.fill();
        });
    }

    drawPieces() {
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const piece = this.game.board[r][c];
                if (piece === 0) continue;
                const x = this.margin + c * this.cellSize;
                const y = this.margin + r * this.cellSize;
                const gradient = this.ctx.createRadialGradient(x-6, y-6, 5, x, y, this.cellSize*0.7);
                if (piece === 1) {
                    gradient.addColorStop(0, '#555');
                    gradient.addColorStop(0.7, '#111');
                    gradient.addColorStop(1, '#000');
                } else {
                    gradient.addColorStop(0, '#f9f9f9');
                    gradient.addColorStop(0.7, '#ddd');
                    gradient.addColorStop(1, '#aaa');
                }
                this.ctx.beginPath();
                this.ctx.arc(x, y, this.cellSize/2 - 3, 0, 2 * Math.PI);
                this.ctx.fillStyle = gradient;
                this.ctx.fill();
                this.ctx.strokeStyle = '#666';
                this.ctx.lineWidth = 1;
                this.ctx.stroke();
            }
        }
    }

    drawStatsOverlay() {
        const root = this.mcts.root;
        if (!root || root.children.size === 0) return;

        // 半透明绘制已有棋子
        this.ctx.save();
        this.ctx.globalAlpha = 0.35;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const piece = this.game.board[r][c];
                if (piece === 0) continue;
                const x = this.margin + c * this.cellSize;
                const y = this.margin + r * this.cellSize;
                this.ctx.beginPath();
                this.ctx.arc(x, y, this.cellSize/2 - 3, 0, 2 * Math.PI);
                this.ctx.fillStyle = piece === 1 ? '#666' : '#ccc';
                this.ctx.fill();
            }
        }
        this.ctx.restore();

        // 收集数据
        const stats = [];
        let maxVal = 0;
        for (const [key, child] of root.children) {
            const [r, c] = key.split(',').map(Number);
            if (this.game.board[r][c] !== 0) continue;
            const visits = child.visitCount;
            const winrate = visits > 0 ? (1 - child.getValue()) / 2 : 0.5;
            const prob = child.priorProb;

            stats.push({ r, c, visits, winrate, prob });
            if (this.displayMode === 'mcts') {
                if (winrate > maxVal) maxVal = winrate;
            } else {
                if (prob > maxVal) maxVal = prob;
            }
        }

        // 找最佳
        let bestMove = null;
        if (this.displayMode === 'mcts') {
            bestMove = stats.reduce((a, b) => a.visits > b.visits ? a : b, {visits:-1});
        } else {
            bestMove = stats.reduce((a, b) => a.prob > b.prob ? a : b, {prob:-1});
        }

        // 绘制统计圆
        stats.forEach(s => {
            const val = this.displayMode === 'mcts' ? s.winrate : s.prob;
            const text = this.displayMode === 'mcts' ? 
                `${s.visits}\n${(s.winrate*100).toFixed(0)}%` : 
                `${(s.prob*100).toFixed(1)}%`;
            this.drawStatCircle(s.r, s.c, val, maxVal, text);
        });

        // 绿圈标记最佳
        if (bestMove && bestMove.r !== undefined) {
            this.ctx.save();
            this.ctx.strokeStyle = '#0a0';
            this.ctx.lineWidth = 4;
            const x = this.margin + bestMove.c * this.cellSize;
            const y = this.margin + bestMove.r * this.cellSize;
            this.ctx.beginPath();
            this.ctx.arc(x, y, this.cellSize/2 + 2, 0, 2 * Math.PI);
            this.ctx.stroke();
            this.ctx.restore();
        }
    }

    drawStatCircle(row, col, value, maxVal, text) {
        const x = this.margin + col * this.cellSize;
        const y = this.margin + row * this.cellSize;
        const radius = this.cellSize / 2.5;
        const norm = maxVal > 0 ? value / maxVal : 0.5;

        // 渐变颜色：红(0) -> 黄(0.5) -> 绿(1)
        let r, g, b;
        if (norm <= 0.5) {
            const t = norm / 0.5;
            r = 255;
            g = Math.floor(100 + 75 * t);
            b = 100;
        } else {
            const t = (norm - 0.5) / 0.5;
            r = Math.floor(255 - 75 * t);
            g = 255;
            b = 100;
        }
        const fillColor = `rgb(${r}, ${g}, ${b})`;

        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x, y, radius, 0, 2 * Math.PI);
        this.ctx.fillStyle = fillColor;
        this.ctx.fill();
        this.ctx.strokeStyle = '#888';
        this.ctx.lineWidth = 1;
        this.ctx.stroke();

        this.ctx.fillStyle = '#111';
        this.ctx.font = 'bold 12px "Segoe UI", "微软雅黑"';
        this.ctx.textAlign = 'center';
        this.ctx.textBaseline = 'middle';
        const lines = text.split('\n');
        if (lines.length === 2) {
            this.ctx.fillText(lines[0], x, y - 8);
            this.ctx.fillText(lines[1], x, y + 8);
        } else {
            this.ctx.fillText(text, x, y);
        }
        this.ctx.restore();
    }

    highlightLastMove(row, col) {
        const x = this.margin + col * this.cellSize;
        const y = this.margin + row * this.cellSize;
        this.ctx.save();
        this.ctx.beginPath();
        this.ctx.arc(x, y, 6, 0, 2 * Math.PI);
        this.ctx.fillStyle = '#e33';
        this.ctx.shadowColor = '#f00';
        this.ctx.shadowBlur = 8;
        this.ctx.fill();
        this.ctx.restore();
    }

    bindEvents() {
        // 防止右键菜单
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }
}