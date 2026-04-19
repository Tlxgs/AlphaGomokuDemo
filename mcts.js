// MCTS 节点与搜索，集成 ONNX Runtime Web
class MCTSNode {
    constructor(parent = null, priorProb = 1.0) {
        this.parent = parent;
        this.children = new Map(); // key: "r,c", value: MCTSNode
        this.priorProb = priorProb;
        this.visitCount = 0;
        this.valueSum = 0.0;
        this.expanded = false;
    }

    getValue(defaultValue = 0.0) {
        return this.visitCount === 0 ? defaultValue : this.valueSum / this.visitCount;
    }

    isLeaf() {
        return !this.expanded || this.children.size === 0;
    }
}

class MCTS {
    constructor(boardSize = 15, c_puct = 1.5, numSimulations = 200, temperature = 0.0) {
        this.boardSize = boardSize;
        this.c_puct = c_puct;
        this.numSimulations = numSimulations;
        this.temperature = temperature;
        this.root = null;
        this.ortSession = null;
        this.modelLoaded = false;
    }

    async loadModel(modelPath = 'model.onnx') {
        try {
            this.ortSession = await ort.InferenceSession.create(modelPath);
            this.modelLoaded = true;
            console.log('ONNX 模型加载成功');
            return true;
        } catch (e) {
            console.error('模型加载失败:', e);
            return false;
        }
    }

    // ONNX 推理
    async infer(state, legalMask) {
        if (!this.modelLoaded) throw new Error('模型未加载');

        // state: Float32Array [2, boardSize, boardSize]
        const inputTensor = new ort.Tensor('float32', state, [1, 2, this.boardSize, this.boardSize]);
        const feeds = { input: inputTensor };
        const results = await this.ortSession.run(feeds);
        const policyLogits = results.policy_logits.data;  // [225]
        const value = results.value.data[0];

        // 应用 legal mask
        if (legalMask) {
            for (let i = 0; i < policyLogits.length; i++) {
                if (legalMask[i] === 0) policyLogits[i] = -1e8;
            }
        }

        // Softmax
        const maxLogit = Math.max(...policyLogits);
        let sum = 0;
        const probs = new Float32Array(policyLogits.length);
        for (let i = 0; i < policyLogits.length; i++) {
            probs[i] = Math.exp(policyLogits[i] - maxLogit);
            sum += probs[i];
        }
        for (let i = 0; i < probs.length; i++) {
            probs[i] /= sum;
        }
        return { probs, value };
    }

    initRoot(game) {
        this.root = null;
    }

    async getMoveProbs(game, temp = this.temperature) {
        const legalMoves = game.getLegalMoves();
        if (legalMoves.length === 0) return { probs: {}, bestMove: null };

        // 直接获胜检查
        for (const [r, c] of legalMoves) {
            const gCopy = game.copy();
            gCopy.makeMove(r, c);
            if (gCopy.winner === game.currentPlayer) {
                const probs = {};
                probs[`${r},${c}`] = 1.0;
                return { probs, bestMove: [r, c] };
            }
        }

        // 防守对方直接获胜（简单处理：如果对方下一步有获胜点，必须堵）
        const opponent = -game.currentPlayer;
        const blockMoves = [];
        for (const [r, c] of legalMoves) {
            const gCopy = game.copy();
            gCopy.currentPlayer = opponent;
            gCopy.board[r][c] = opponent;
            if (gCopy.checkWin(r, c)) {
                blockMoves.push([r, c]);
            }
        }
        if (blockMoves.length > 0) {
            const probs = {};
            const prob = 1.0 / blockMoves.length;
            blockMoves.forEach(m => probs[`${m[0]},${m[1]}`] = prob);
            return { probs, bestMove: blockMoves[0] };
        }

        // 初始化根节点
        if (!this.root) {
            const state = game.getCanonicalState();
            const legalMask = new Float32Array(this.boardSize * this.boardSize);
            for (let i = 0; i < legalMask.length; i++) legalMask[i] = 0;
            legalMoves.forEach(([r, c]) => legalMask[r * this.boardSize + c] = 1);

            const { probs } = await this.infer(state, legalMask);

            this.root = new MCTSNode();
            this.root.expanded = true;
            const moveProbs = {};
            legalMoves.forEach(([r, c]) => {
                const idx = r * this.boardSize + c;
                const prob = probs[idx];
                moveProbs[`${r},${c}`] = prob;
                this.root.children.set(`${r},${c}`, new MCTSNode(this.root, prob));
            });
            // 归一化
            const total = Object.values(moveProbs).reduce((a, b) => a + b, 0);
            if (total > 0) {
                for (const key in moveProbs) {
                    moveProbs[key] /= total;
                    const child = this.root.children.get(key);
                    child.priorProb = moveProbs[key];
                }
            }
        } else {
            // 修剪非法子节点
            for (const [key, child] of this.root.children) {
                const [r, c] = key.split(',').map(Number);
                if (!game.isLegalMove(r, c)) {
                    this.root.children.delete(key);
                }
            }
            if (this.root.children.size === 0) {
                this.root = null;
                return this.getMoveProbs(game, temp);
            }
        }

        // 执行模拟
        for (let i = 0; i < this.numSimulations; i++) {
            await this.simulate(game.copy());
        }

        // 收集访问次数
        const visits = {};
        let totalVisits = 0;
        for (const [key, child] of this.root.children) {
            visits[key] = child.visitCount;
            totalVisits += child.visitCount;
        }

        let bestMove = null;
        let maxVisits = -1;
        const probs = {};

        if (temp <= 0.1) {
            // 确定性选择
            for (const key in visits) {
                if (visits[key] > maxVisits) {
                    maxVisits = visits[key];
                    bestMove = key.split(',').map(Number);
                }
            }
            probs[`${bestMove[0]},${bestMove[1]}`] = 1.0;
        } else {
            // 温度采样
            const moves = Object.keys(visits);
            const visitValues = moves.map(k => Math.pow(visits[k], 1.0 / temp));
            const sum = visitValues.reduce((a, b) => a + b, 0);
            const rand = Math.random() * sum;
            let cum = 0;
            for (let i = 0; i < moves.length; i++) {
                cum += visitValues[i];
                probs[moves[i]] = visitValues[i] / sum;
                if (cum >= rand && !bestMove) {
                    bestMove = moves[i].split(',').map(Number);
                }
            }
        }

        return { probs, bestMove };
    }

    async simulate(game) {
        let node = this.root;
        const path = [node];

        // Selection
        while (!node.isLeaf()) {
            const { move, child } = this.selectChild(node, game);
            if (!move) break;
            game.makeMove(move[0], move[1]);
            node = child;
            path.push(node);
        }

        // Evaluation
        let value;
        if (game.gameOver) {
            if (game.winner === 0) value = 0.0;
            else value = (game.winner === game.currentPlayer) ? 1.0 : -1.0;
        } else {
            const state = game.getCanonicalState();
            const legalMask = new Float32Array(this.boardSize * this.boardSize);
            const legalMoves = game.getLegalMoves();
            legalMoves.forEach(([r, c]) => legalMask[r * this.boardSize + c] = 1);
            const { probs, value: v } = await this.infer(state, legalMask);
            value = v;

            // Expansion
            node.expanded = true;
            legalMoves.forEach(([r, c]) => {
                const idx = r * this.boardSize + c;
                const prob = probs[idx];
                node.children.set(`${r},${c}`, new MCTSNode(node, prob));
            });
        }

        // Backpropagation
        for (const n of path) {
            n.visitCount++;
            n.valueSum += value;
            value = -value;
        }
    }

    selectChild(node, game) {
        let bestScore = -Infinity;
        let bestMove = null;
        let bestChild = null;
        const parentVisitSqrt = Math.sqrt(node.visitCount + 1);
        const explorePenalty = 0.05;

        for (const [key, child] of node.children) {
            const [r, c] = key.split(',').map(Number);
            if (!game.isLegalMove(r, c)) continue;

            const q = -child.getValue(node.getValue() - explorePenalty);
            const u = this.c_puct * child.priorProb * parentVisitSqrt / (1 + child.visitCount);
            const score = q + u;

            if (score > bestScore) {
                bestScore = score;
                bestMove = [r, c];
                bestChild = child;
            }
        }
        return { move: bestMove, child: bestChild };
    }

    updateRoot(game, lastMove) {
        if (!this.root) return;
        const key = `${lastMove[0]},${lastMove[1]}`;
        if (this.root.children.has(key)) {
            this.root = this.root.children.get(key);
            this.root.parent = null;
        } else {
            this.root = null;
        }
    }
}