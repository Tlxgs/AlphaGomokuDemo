// 五子棋游戏逻辑
class GomokuGame {
    constructor(boardSize = 15) {
        this.boardSize = boardSize;
        this.reset();
    }

    reset() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.currentPlayer = 1; // 1: 黑棋, -1: 白棋
        this.lastMove = null;
        this.gameOver = false;
        this.winner = null;
        this.moveCount = 0;
    }

    getLegalMoves() {
        const moves = [];
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                if (this.board[r][c] === 0) moves.push([r, c]);
            }
        }
        return moves;
    }

    isLegalMove(row, col) {
        if (row < 0 || row >= this.boardSize || col < 0 || col >= this.boardSize) return false;
        return this.board[row][col] === 0 && !this.gameOver;
    }

    makeMove(row, col) {
        if (!this.isLegalMove(row, col)) return false;
        this.board[row][col] = this.currentPlayer;
        this.lastMove = [row, col];
        this.moveCount++;

        if (this.checkWin(row, col)) {
            this.gameOver = true;
            this.winner = this.currentPlayer;
        } else if (this.moveCount >= this.boardSize * this.boardSize) {
            this.gameOver = true;
            this.winner = 0; // 平局
        } else {
            this.currentPlayer = -this.currentPlayer;
        }
        return true;
    }

    checkWin(row, col) {
        if (this.board[row][col] === 0) return false;
        const player = this.board[row][col];
        const directions = [[0, 1], [1, 0], [1, 1], [1, -1]];

        for (const [dr, dc] of directions) {
            let count = 1;
            // 正方向
            let r = row + dr, c = col + dc;
            while (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize && this.board[r][c] === player) {
                count++;
                r += dr;
                c += dc;
            }
            // 负方向
            r = row - dr; c = col - dc;
            while (r >= 0 && r < this.boardSize && c >= 0 && c < this.boardSize && this.board[r][c] === player) {
                count++;
                r -= dr;
                c -= dc;
            }
            if (count >= 5) return true;
        }
        return false;
    }

    getCanonicalState(player = this.currentPlayer) {
        // 返回 2 通道数据：shape [2, boardSize, boardSize]
        const state = new Float32Array(2 * this.boardSize * this.boardSize);
        const offset = this.boardSize * this.boardSize;
        for (let r = 0; r < this.boardSize; r++) {
            for (let c = 0; c < this.boardSize; c++) {
                const idx = r * this.boardSize + c;
                const val = this.board[r][c];
                if (val === player) {
                    state[idx] = 1.0;
                } else if (val === -player) {
                    state[offset + idx] = 1.0;
                }
            }
        }
        return state;
    }

    copy() {
        const newGame = new GomokuGame(this.boardSize);
        newGame.board = this.board.map(row => [...row]);
        newGame.currentPlayer = this.currentPlayer;
        newGame.lastMove = this.lastMove ? [...this.lastMove] : null;
        newGame.gameOver = this.gameOver;
        newGame.winner = this.winner;
        newGame.moveCount = this.moveCount;
        return newGame;
    }
}