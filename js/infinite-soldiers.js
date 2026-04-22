const infiniteSoldiersGame = (() => {
    const storageKey = "infinite-soldiers-best-run";
    const width = 420;
    const height = 720;
    const road = {
        left: 84,
        right: 336,
        width: 252,
        center: 210
    };
    const convoyY = 624;
    const playerBounds = {
        minX: road.left + 30,
        maxX: road.right - 30
    };
    const trackXs = [126, 210, 294];
    const perspective = {
        horizonY: 118,
        floorY: height - 18,
        farWorldY: -160,
        nearWorldY: height + 112,
        farRoadHalfWidth: 18,
        farShoulderHalfWidth: 34
    };
    const maxSquad = 30;
    const spriteSources = {
        allySoldier: new URL("../images/sprites/ally-soldier.svg", import.meta.url).href,
        enemyBike: new URL("../images/sprites/enemy-bike.png", import.meta.url).href,
        enemyTruck: new URL("../images/sprites/enemy-truck.png", import.meta.url).href
    };

    let activeGame = null;
    let currentDrawingContext = null;
    let spritePromise = null;

    async function init(root) {
        dispose();

        if (!root) {
            return;
        }

        const sprites = await ensureSprites();

        if (!root.isConnected) {
            return;
        }

        activeGame = createGame(root, sprites);
        activeGame.init();
    }

    function dispose() {
        if (!activeGame) {
            return;
        }

        activeGame.dispose();
        activeGame = null;
    }

    function ensureSprites() {
        if (!spritePromise) {
            spritePromise = Promise.all(
                Object.entries(spriteSources).map(async ([key, source]) => [key, await loadImage(source)])
            ).then((entries) => Object.fromEntries(entries));
        }

        return spritePromise;
    }

    function loadImage(source) {
        return new Promise((resolve) => {
            const image = new Image();

            image.addEventListener("load", () => resolve(image), { once: true });
            image.addEventListener("error", () => resolve(null), { once: true });
            image.src = source;
        });
    }

        function createGame(root, sprites) {
            const canvas = root.querySelector('[data-role="canvas"]');
            const squadValue = root.querySelector('[data-role="squad"]');
            const distanceValue = root.querySelector('[data-role="distance"]');
            const scoreValue = root.querySelector('[data-role="score"]');
            const bestValue = root.querySelector('[data-role="best"]');
            const pauseButton = root.querySelector('[data-action="pause"]');
            const restartButton = root.querySelector('[data-action="restart"]');
            const context = canvas?.getContext("2d", { alpha: false });

            if (!canvas || !context) {
                return {
                    init() { },
                    dispose() { }
                };
            }

            const cleanups = [];
            const controls = {
                left: false,
                right: false,
                pointerActive: false,
                pointerId: null
            };

            let animationFrameId = 0;
            let previousFrame = 0;
            let state = createRunState(loadBest());

        function initGame() {
            const devicePixelRatio = Math.max(1, window.devicePixelRatio || 1);
            canvas.width = width * devicePixelRatio;
            canvas.height = height * devicePixelRatio;
            context.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
            context.imageSmoothingEnabled = true;
            currentDrawingContext = context;

            listen(restartButton, "click", () => restartRun());
            listen(pauseButton, "click", () => togglePause());

            listen(canvas, "pointerdown", onCanvasPointerDown);
            listen(canvas, "pointermove", onCanvasPointerMove);
            listen(canvas, "pointerup", stopPointerSteering);
            listen(canvas, "pointercancel", stopPointerSteering);
            listen(canvas, "lostpointercapture", stopPointerSteering);

            listen(window, "keydown", onKeyDown);
            listen(window, "keyup", onKeyUp);

            startRun(state.targetX);
            syncPauseButton();
            drawScene();
            animationFrameId = window.requestAnimationFrame(frame);
        }

        function disposeGame() {
            if (animationFrameId) {
                window.cancelAnimationFrame(animationFrameId);
            }

            if (currentDrawingContext === context) {
                currentDrawingContext = null;
            }

            while (cleanups.length > 0) {
                const cleanup = cleanups.pop();
                cleanup();
            }
        }

        function listen(target, eventName, handler) {
            if (!target) {
                return;
            }

            target.addEventListener(eventName, handler);
            cleanups.push(() => target.removeEventListener(eventName, handler));
        }

        function createRunState(best, startX = road.center) {
            return {
                status: "ready",
                paused: false,
                playerX: startX,
                targetX: startX,
                steeringVelocity: 0,
                scroll: 0,
                distance: 0,
                score: 0,
                squad: 2,
                fireCooldown: 0.18,
                nextEnemyAt: 46,
                nextBoardAt: 102,
                bullets: [],
                enemies: [],
                boardWaves: [],
                popups: [],
                particles: [],
                flash: 0,
                flashColor: "#ffffff",
                best
            };
        }

        function startRun(startX) {
            const clampedX = clamp(startX, playerBounds.minX, playerBounds.maxX);
            state = createRunState(state.best, clampedX);
            state.status = "running";
            updateHud();
            syncPauseButton();
        }

        function restartRun() {
            startRun(state.playerX);
        }

        function togglePause() {
            if (state.status !== "running" && !state.paused) {
                return;
            }

            state.paused = !state.paused;
            controls.left = false;
            controls.right = false;
            controls.pointerActive = false;
            controls.pointerId = null;
            syncPauseButton();
        }

        function syncPauseButton() {
            if (!pauseButton) {
                return;
            }

            pauseButton.setAttribute("aria-label", state.paused ? "Resume run" : "Pause run");
            pauseButton.setAttribute("title", state.paused ? "Resume run" : "Pause run");
            pauseButton.innerHTML = state.paused
                ? `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M8 6l10 6-10 6z" />
                   </svg>`
                : `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path d="M8 6v12" />
                        <path d="M16 6v12" />
                   </svg>`;
        }

        function onCanvasPointerDown(event) {
            if (state.paused) {
                return;
            }

            event.preventDefault();
            controls.pointerActive = true;
            controls.pointerId = event.pointerId;
            controls.left = false;
            controls.right = false;

            canvas.setPointerCapture(event.pointerId);
            updatePointerTarget(event);

            if (state.status !== "running") {
                startRun(state.targetX);
            }
        }

        function onCanvasPointerMove(event) {
            if (!controls.pointerActive || controls.pointerId !== event.pointerId) {
                return;
            }

            updatePointerTarget(event);
        }

        function stopPointerSteering(event) {
            if (event && controls.pointerId !== null && event.pointerId !== undefined && event.pointerId !== controls.pointerId) {
                return;
            }

            controls.pointerActive = false;
            controls.pointerId = null;
        }

        function updatePointerTarget(event) {
            const bounds = canvas.getBoundingClientRect();
            const pointerX = ((event.clientX - bounds.left) / bounds.width) * width;
            state.targetX = clamp(screenXToWorldRoadX(pointerX, convoyY + 72), playerBounds.minX, playerBounds.maxX);
        }

        function onKeyDown(event) {
            const key = event.key.toLowerCase();

            if (key === "p") {
                event.preventDefault();
                togglePause();
            }
            else if (state.paused) {
                return;
            }
            else if (key === "arrowleft" || key === "a") {
                event.preventDefault();
                controls.left = true;
                controls.pointerActive = false;

                if (state.status !== "running") {
                    startRun(state.targetX);
                }
            }
            else if (key === "arrowright" || key === "d") {
                event.preventDefault();
                controls.right = true;
                controls.pointerActive = false;

                if (state.status !== "running") {
                    startRun(state.targetX);
                }
            }
            else if (key === "r") {
                restartRun();
            }
            else if ((key === " " || key === "enter") && state.status !== "running") {
                event.preventDefault();
                startRun(state.targetX);
            }
        }

        function onKeyUp(event) {
            if (state.paused) {
                return;
            }

            const key = event.key.toLowerCase();

            if (key === "arrowleft" || key === "a") {
                controls.left = false;
            }
            else if (key === "arrowright" || key === "d") {
                controls.right = false;
            }
        }

        function frame(timestamp) {
            if (!previousFrame) {
                previousFrame = timestamp;
            }

            const deltaTime = Math.min(0.033, (timestamp - previousFrame) / 1000);
            previousFrame = timestamp;

            update(deltaTime);
            drawScene();

            animationFrameId = window.requestAnimationFrame(frame);
        }

        function update(deltaTime) {
            updatePopups(deltaTime);
            updateParticles(deltaTime);

            if (state.flash > 0) {
                state.flash = Math.max(0, state.flash - deltaTime * 2.4);
            }

            if (state.status !== "running" || state.paused) {
                return;
            }

            const inputDirection = (controls.right ? 1 : 0) - (controls.left ? 1 : 0);

            if (!controls.pointerActive && inputDirection !== 0) {
                state.targetX = clamp(state.targetX + (inputDirection * 300 * deltaTime), playerBounds.minX, playerBounds.maxX);
            }

            const previousPlayerX = state.playerX;
            const roadSpeed = 250 + Math.min(150, state.distance * 0.08);
            const encounterSpeed = 90 + (roadSpeed * 0.25);

            state.scroll = (state.scroll + roadSpeed * deltaTime) % 96;
            state.playerX += (state.targetX - state.playerX) * Math.min(1, deltaTime * 13);
            state.steeringVelocity = (state.playerX - previousPlayerX) / Math.max(deltaTime, 0.001);
            state.distance += deltaTime * 43;
            state.score += deltaTime * (9 + state.squad * 0.55);

            state.fireCooldown -= deltaTime;
            while (state.fireCooldown <= 0) {
                fireVolley();
                state.fireCooldown += 0.46;
            }

            while (state.distance >= state.nextEnemyAt) {
                spawnEnemyWave();
            }

            while (state.distance >= state.nextBoardAt) {
                spawnBoardWave();
            }

            for (const bullet of state.bullets) {
                bullet.x += bullet.vx * deltaTime;
                bullet.y += bullet.vy * deltaTime;

                if (bullet.y < -24 || bullet.x < road.left - 24 || bullet.x > road.right + 24) {
                    bullet.deleted = true;
                }
            }

            for (const enemy of state.enemies) {
                enemy.y += encounterSpeed * deltaTime;
                enemy.hit = Math.max(0, enemy.hit - deltaTime * 4);

                if (enemy.y - enemy.height * 0.5 > height + 40) {
                    enemy.deleted = true;
                }
            }

            for (const boardWave of state.boardWaves) {
                boardWave.y += encounterSpeed * deltaTime;

                for (const board of boardWave.boards) {
                    board.hit = Math.max(0, board.hit - deltaTime * 4.6);
                }

                if (boardWave.resolved) {
                    boardWave.fade = Math.max(0, boardWave.fade - deltaTime * 2.8);
                }

                if (boardWave.y - boardWave.height * 0.5 > height + 60 || (boardWave.resolved && boardWave.fade <= 0.01)) {
                    boardWave.deleted = true;
                }
            }

            handleBulletHits();
            handleBoardImpacts();

            if (state.status !== "running") {
                state.bullets = state.bullets.filter((bullet) => !bullet.deleted);
                state.enemies = state.enemies.filter((enemy) => !enemy.deleted);
                state.boardWaves = state.boardWaves.filter((boardWave) => !boardWave.deleted);
                updateHud();
                return;
            }

            handleEnemyImpacts();

            state.bullets = state.bullets.filter((bullet) => !bullet.deleted);
            state.enemies = state.enemies.filter((enemy) => !enemy.deleted);
            state.boardWaves = state.boardWaves.filter((boardWave) => !boardWave.deleted);

            updateHud();
        }

        function fireVolley() {
            const members = getSquadMembers(state.squad, state.playerX);

            for (const member of members) {
                state.bullets.push({
                    x: member.x,
                    y: member.y - 14,
                    vx: 0,
                    vy: -560,
                    trail: 12,
                    deleted: false
                });
            }
        }

        function getRunIntensity() {
            return 1 - Math.exp(-state.distance / 900);
        }

        function getSquadPressure() {
            return clamp((state.squad - 8) / Math.max(1, maxSquad - 8), 0, 1);
        }

        function getEnemyDifficulty(intensity = getRunIntensity()) {
            return 1 + (state.distance / 390) + (intensity * 1.45);
        }

        function getFormationPressure(intensity = getRunIntensity(), pressure = getSquadPressure()) {
            return clamp((intensity * 0.45) + (pressure * 0.85), 0, 1);
        }

        function spawnEnemyWave() {
            const intensity = getRunIntensity();
            const pressure = getSquadPressure();
            const difficulty = getEnemyDifficulty(intensity);
            const formationPressure = getFormationPressure(intensity, pressure);
            const formation = buildEnemyFormation(formationPressure);

            spawnEnemyFormation(formation, difficulty, intensity);
            state.nextEnemyAt += getEnemyFormationSpacing(formation, formationPressure);
        }

        function buildEnemyFormation(formationPressure) {
            const behemothChance = clamp(0.0008 + (formationPressure * 0.006), 0.0008, 0.0068);

            if (Math.random() < behemothChance) {
                return buildEscortFormation(
                    "behemoth",
                    randomIntBetween(10, Math.max(12, Math.round(lerp(16, 28, formationPressure)))),
                    formationPressure,
                    "behemoth-assault");
            }

            const roll = Math.random();

            if (roll < lerp(0.78, 0.42, formationPressure)) {
                return buildBasicFormation(
                    randomIntBetween(3, Math.max(6, Math.round(lerp(8, 14, formationPressure)))),
                    formationPressure);
            }

            if (roll < lerp(0.96, 0.78, formationPressure)) {
                return buildEscortFormation(
                    "truck",
                    randomIntBetween(6, Math.max(8, Math.round(lerp(14, 24, formationPressure)))),
                    formationPressure,
                    "heavy-squad");
            }

            return buildEscortFormation(
                "truck",
                randomIntBetween(10, Math.max(12, Math.round(lerp(20, 36, formationPressure)))),
                formationPressure,
                "siege-column");
        }

        function buildBasicFormation(basicCount, formationPressure) {
            const cluster = createEnemyClusterSlots(basicCount, {
                minColumns: 2,
                maxColumns: basicCount >= 12 ? 5 : basicCount >= 8 ? 4 : 3,
                columnSpacing: lerp(36, 30, formationPressure),
                rowSpacing: lerp(44, 36, formationPressure),
                staggerFactor: 0.38,
                sideLag: 2.4,
                xJitter: 2.5,
                yJitter: 1.8,
                edgePadding: 20
            });

            return {
                kind: "swarm",
                units: cluster.slots.map((slot) => ({
                    kind: "bike",
                    x: slot.x,
                    yOffset: slot.yOffset
                })),
                rowCount: cluster.rowCount,
                depth: cluster.depth
            };
        }

        function buildEscortFormation(centerKind, escortCount, formationPressure, kind) {
            const cluster = createEnemyClusterSlots(escortCount + 1, {
                minColumns: 3,
                maxColumns: centerKind === "behemoth" ? 5 : escortCount >= 18 ? 6 : 5,
                columnSpacing: centerKind === "behemoth" ? lerp(38, 32, formationPressure) : lerp(36, 30, formationPressure),
                rowSpacing: centerKind === "behemoth" ? lerp(48, 40, formationPressure) : lerp(44, 36, formationPressure),
                staggerFactor: 0.42,
                sideLag: centerKind === "behemoth" ? 3.2 : 2.6,
                xJitter: 2.2,
                yJitter: 1.6,
                edgePadding: centerKind === "behemoth" ? 34 : 26
            });
            const leaderIndex = getFormationLeaderSlot(cluster);

            return {
                kind,
                units: cluster.slots.map((slot, index) => ({
                    kind: index === leaderIndex ? centerKind : "bike",
                    x: slot.x,
                    yOffset: slot.yOffset
                })),
                rowCount: cluster.rowCount,
                depth: cluster.depth
            };
        }

        function createEnemyClusterSlots(count, options = {}) {
            const minColumns = options.minColumns ?? 2;
            const maxColumns = options.maxColumns ?? 4;
            const columnSpacing = options.columnSpacing ?? 34;
            const rowSpacing = options.rowSpacing ?? 40;
            const staggerFactor = options.staggerFactor ?? 0.35;
            const sideLag = options.sideLag ?? 2;
            const xJitter = options.xJitter ?? 0;
            const yJitter = options.yJitter ?? 0;
            const edgePadding = options.edgePadding ?? 20;
            const columns = getEnemyClusterColumns(count, minColumns, maxColumns);
            const frontRowCount = Math.min(columns, count);
            const halfSpread = Math.max(0, ((frontRowCount - 1) * columnSpacing * 0.5) + (columnSpacing * staggerFactor * 0.5));
            const anchorMin = road.left + edgePadding + halfSpread;
            const anchorMax = road.right - edgePadding - halfSpread;
            const anchorX = anchorMin <= anchorMax
                ? randomBetween(anchorMin, anchorMax)
                : road.center;
            const slots = [];
            let depth = 0;

            for (let index = 0; index < count; index += 1) {
                const row = Math.floor(index / columns);
                const firstIndexInRow = row * columns;
                const rowCount = Math.min(columns, count - firstIndexInRow);
                const column = index - firstIndexInRow;
                const centerOffset = (rowCount - 1) / 2;
                const stagger = row % 2 === 0 ? 0 : columnSpacing * staggerFactor;
                const x = clamp(
                    anchorX + ((column - centerOffset) * columnSpacing) + stagger + randomBetween(-xJitter, xJitter),
                    road.left + edgePadding,
                    road.right - edgePadding);
                const yOffset = (row * rowSpacing)
                    + (Math.abs(column - centerOffset) * sideLag)
                    + randomBetween(-yJitter, yJitter);

                depth = Math.max(depth, yOffset);
                slots.push({ x, yOffset, row });
            }

            return {
                anchorX,
                slots,
                rowCount: Math.ceil(count / columns),
                depth
            };
        }

        function getEnemyClusterColumns(count, minColumns, maxColumns) {
            if (count <= 1) {
                return 1;
            }

            const estimatedColumns = Math.ceil(Math.sqrt(count * 1.1));
            return Math.min(count, clamp(estimatedColumns, minColumns, maxColumns));
        }

        function getFormationLeaderSlot(cluster) {
            const targetDepth = cluster.depth * 0.38;
            let bestIndex = 0;
            let bestScore = Number.POSITIVE_INFINITY;

            cluster.slots.forEach((slot, index) => {
                const score = Math.abs(slot.x - cluster.anchorX) + (Math.abs(slot.yOffset - targetDepth) * 0.9);

                if (score >= bestScore) {
                    return;
                }

                bestScore = score;
                bestIndex = index;
            });

            return bestIndex;
        }

        function spawnEnemyFormation(formation, difficulty, intensity) {
            const startY = formation.kind === "behemoth-assault"
                ? -156
                : formation.kind === "swarm"
                    ? -76
                    : -112;

            for (const unit of formation.units) {
                state.enemies.push(createEnemy(unit.x, unit.kind, startY - unit.yOffset, difficulty, intensity));
            }
        }

        function getEnemyFormationSpacing(formation, formationPressure) {
            const baseGap = formation.kind === "behemoth-assault"
                ? lerp(130, 98, formationPressure)
                : formation.kind === "siege-column"
                    ? lerp(102, 74, formationPressure)
                    : formation.kind === "heavy-squad"
                        ? lerp(84, 62, formationPressure)
                        : lerp(68, 52, formationPressure);
            const rowGap = Math.max(0, formation.rowCount - 1) * lerp(18, 12, formationPressure);

            return baseGap + rowGap + randomBetween(12, 26);
        }

        function createEnemy(trackX, kind, y, difficulty, intensity) {
            if (kind === "behemoth") {
                const health = 150 + Math.floor(difficulty * (13 + (intensity * 7)));

                return {
                    kind,
                    x: trackX + randomBetween(-5, 5),
                    y,
                    width: 144,
                    height: 228,
                    collisionWidth: 112,
                    collisionHeight: 188,
                    health,
                    maxHealth: health,
                    damage: maxSquad,
                    reward: 160 + Math.floor(difficulty * 35),
                    tint: "#ef4444",
                    instantKill: true,
                    hit: 0,
                    deleted: false
                };
            }

            if (kind === "truck") {
                const health = 9 + Math.floor(difficulty * (2.4 + (intensity * 1.0)));
                const damage = 7 + Math.floor(difficulty * (1.55 + (intensity * 0.55)));

                return {
                    kind,
                    x: trackX + randomBetween(-7, 7),
                    y,
                    width: 72,
                    height: 114,
                    collisionWidth: 56,
                    collisionHeight: 94,
                    health,
                    maxHealth: health,
                    damage,
                    reward: 42 + Math.floor(difficulty * 14),
                    tint: "#fb923c",
                    hit: 0,
                    deleted: false
                };
            }

            const health = 3 + Math.floor(intensity * 4) + Math.floor(difficulty * 0.55) + (difficulty > 2.1 && Math.random() < (0.5 + (intensity * 0.35)) ? 1 : 0);
            const damage = 3 + Math.floor(difficulty * (1.05 + (intensity * 0.35)));

            return {
                kind,
                x: trackX + randomBetween(-9, 9),
                y,
                width: 48,
                height: 82,
                collisionWidth: 36,
                collisionHeight: 58,
                health,
                maxHealth: health,
                damage,
                reward: 20 + Math.floor(difficulty * 9),
                tint: "#f472b6",
                hit: 0,
                deleted: false
            };
        }

        function spawnBoardWave() {
            const laneIndices = selectBoardWaveLanes();
            const usedValues = new Set();
            const intensity = getRunIntensity();
            const boards = laneIndices.map((laneIndex) => createBoard(laneIndex, usedValues, intensity));

            state.boardWaves.push({
                y: -74,
                height: 92,
                boards,
                resolved: false,
                resolvedLane: null,
                fade: 1,
                deleted: false
            });

            state.nextBoardAt += 154 + Math.random() * 94;
        }

        function selectBoardWaveLanes() {
            const roll = Math.random();

            if (roll < 0.32) {
                return [0, 1, 2];
            }

            if (roll < 0.58) {
                return [0, 2];
            }

            return Math.random() < 0.5 ? [0, 1] : [1, 2];
        }

        function createBoard(laneIndex, usedValues, intensity) {
            let reward = randomBoardReward();
            let attempts = 0;

            while (usedValues.has(reward.value) && attempts < 6) {
                reward = randomBoardReward();
                attempts += 1;
            }

            usedValues.add(reward.value);
            const distanceBonus = Math.floor(intensity * (3 + reward.value));
            const squadPressureBonus = Math.floor(Math.max(0, state.squad - 2) * (0.6 + (reward.value * 0.05)));
            const health = reward.health + distanceBonus + squadPressureBonus;

            return {
                laneIndex,
                x: trackXs[laneIndex],
                width: 64,
                height: 88,
                collisionWidth: 44,
                collisionHeight: 76,
                value: reward.value,
                label: `+${reward.value}`,
                health,
                maxHealth: health,
                reward: 24 + (reward.value * 10),
                tint: reward.tint,
                hit: 0
            };
        }

        function randomBoardReward() {
            const roll = Math.random();

            if (roll < 0.25) {
                return { value: 2, health: 4, tint: "#4ade80" };
            }

            if (roll < 0.55) {
                return { value: 3, health: 6, tint: "#22c55e" };
            }

            if (roll < 0.82) {
                return { value: 5, health: 9, tint: "#84cc16" };
            }

            return { value: 7, health: 12, tint: "#facc15" };
        }

        function getBoardRect(boardWave, board) {
            return {
                x: board.x - (board.collisionWidth * 0.5),
                y: boardWave.y - (board.collisionHeight * 0.5),
                width: board.collisionWidth,
                height: board.collisionHeight
            };
        }

        function getBoardProjection(boardWave, board) {
            return projectPoint(board.x, boardWave.y + (board.height * 0.42));
        }

        function getBoardPanelWidth(projection) {
            const laneWidth = (projection.roadHalfWidth * 2) / 3;
            return Math.min(20 + (projection.depth * 58), Math.max(10, laneWidth - 5));
        }

        function isBoardDamageActive(boardWave, board) {
            const projection = getBoardProjection(boardWave, board);
            return projection.depth >= 0.15 && getBoardPanelWidth(projection) >= 24;
        }

        function resolveBoardWave(boardWave, board, didDestroy) {
            if (boardWave.resolved) {
                return;
            }

            boardWave.resolved = true;
            boardWave.resolvedLane = board.laneIndex;
            boardWave.fade = 1;

            if (didDestroy) {
                state.squad = clamp(state.squad + board.value, 1, maxSquad);
                state.score += board.reward;
                setFlash(board.tint, 0.26);
                spawnPopup(board.x, boardWave.y - 18, board.label, board.tint);
                spawnBurst(board.x, boardWave.y + 8, board.tint, 14, 160);
                return;
            }

            state.squad = Math.max(0, state.squad - board.value);
            setFlash("#fb7185", 0.4);
            spawnPopup(state.playerX, convoyY - 104, `-${board.value}`, "#fb7185");
            spawnBurst(state.playerX, convoyY - 12, "#fb7185", 18, 180);

            if (state.squad <= 0) {
                finishRun();
            }
        }

        function handleBulletHits() {
            for (const bullet of state.bullets) {
                if (bullet.deleted) {
                    continue;
                }

                let hitBoard = false;

                for (const boardWave of state.boardWaves) {
                    if (boardWave.deleted || boardWave.resolved) {
                        continue;
                    }

                    for (const board of boardWave.boards) {
                        if (board.health <= 0) {
                            continue;
                        }

                        if (!isBoardDamageActive(boardWave, board)) {
                            continue;
                        }

                        const boardRect = getBoardRect(boardWave, board);

                        if (!circleIntersectsRect(bullet.x, bullet.y, 3, boardRect.x, boardRect.y, boardRect.width, boardRect.height)) {
                            continue;
                        }

                        bullet.deleted = true;
                        board.health = Math.max(0, board.health - 1);
                        board.hit = 0.18;

                        if (board.health === 0) {
                            resolveBoardWave(boardWave, board, true);
                        }

                        hitBoard = true;
                        break;
                    }

                    if (hitBoard) {
                        break;
                    }
                }

                if (bullet.deleted) {
                    continue;
                }

                for (const enemy of state.enemies) {
                    if (enemy.deleted) {
                        continue;
                    }

                    const rectX = enemy.x - (enemy.collisionWidth * 0.5);
                    const rectY = enemy.y - (enemy.collisionHeight * 0.5);

                    if (!circleIntersectsRect(bullet.x, bullet.y, 3, rectX, rectY, enemy.collisionWidth, enemy.collisionHeight)) {
                        continue;
                    }

                    bullet.deleted = true;
                    enemy.health -= 1;
                    enemy.hit = 0.15;

                    if (enemy.health <= 0) {
                        enemy.deleted = true;
                        state.score += enemy.reward;
                        spawnPopup(enemy.x, enemy.y - 18, `+${enemy.reward}`, "#facc15");
                        spawnBurst(enemy.x, enemy.y, enemy.tint, 14, 160);
                    }

                    break;
                }
            }
        }

        function handleBoardImpacts() {
            const convoyRect = getConvoyCoreBounds();

            for (const boardWave of state.boardWaves) {
                if (boardWave.deleted || boardWave.resolved) {
                    continue;
                }

                for (const board of boardWave.boards) {
                    if (board.health <= 0) {
                        continue;
                    }

                    if (!rectanglesOverlap(convoyRect, getBoardRect(boardWave, board))) {
                        continue;
                    }

                    resolveBoardWave(boardWave, board, false);
                    return;
                }
            }
        }

        function handleEnemyImpacts() {
            const members = getSquadMembers(state.squad, state.playerX);
            const playerRect = getFormationBounds(members);

            for (const enemy of state.enemies) {
                if (enemy.deleted) {
                    continue;
                }

                const enemyRect = {
                    x: enemy.x - (enemy.collisionWidth * 0.5),
                    y: enemy.y - (enemy.collisionHeight * 0.5),
                    width: enemy.collisionWidth,
                    height: enemy.collisionHeight
                };

                if (!rectanglesOverlap(playerRect, enemyRect)) {
                    continue;
                }

                enemy.deleted = true;
                setFlash("#fb7185", enemy.instantKill ? 0.62 : 0.42);
                spawnBurst(state.playerX, convoyY - 10, "#fb7185", enemy.instantKill ? 28 : 18, enemy.instantKill ? 240 : 180);

                if (enemy.instantKill) {
                    state.squad = 0;
                    spawnPopup(state.playerX, convoyY - 112, "Fatal impact", "#fb7185");
                    finishRun();
                    return;
                }

                state.squad = Math.max(0, state.squad - enemy.damage);
                spawnPopup(state.playerX, convoyY - 98, `-${enemy.damage}`, "#fb7185");

                if (state.squad <= 0) {
                    finishRun();
                    return;
                }
            }
        }

        function finishRun() {
            if (state.status !== "running") {
                return;
            }

            state.status = "lost";
            updateBest();
            updateHud();
            spawnPopup(state.playerX, convoyY - 148, "Convoy wiped", "#fb7185");
            spawnPopup(state.playerX, convoyY - 118, "Press restart to go again", "#fecdd3");

            syncPauseButton();
        }

        function updateBest() {
            const nextBest = {
                score: Math.max(state.best.score, Math.floor(state.score)),
                distance: Math.max(state.best.distance, Math.floor(state.distance))
            };

            state.best = nextBest;
            saveBest(nextBest);
        }

        function updateHud() {
            squadValue.textContent = state.squad.toString();
            distanceValue.textContent = `${Math.floor(state.distance)}m`;
            scoreValue.textContent = formatNumber(Math.floor(state.score));
            bestValue.textContent = formatNumber(state.best.score);
        }

        function updatePopups(deltaTime) {
            for (const popup of state.popups) {
                popup.y += popup.velocityY * deltaTime;
                popup.life -= deltaTime;
            }

            state.popups = state.popups.filter((popup) => popup.life > 0);
        }

        function updateParticles(deltaTime) {
            for (const particle of state.particles) {
                particle.x += particle.vx * deltaTime;
                particle.y += particle.vy * deltaTime;
                particle.vy += 260 * deltaTime;
                particle.life -= deltaTime;
            }

            state.particles = state.particles.filter((particle) => particle.life > 0);
        }

        function spawnPopup(x, y, text, color) {
            state.popups.push({
                x,
                y,
                text,
                color,
                life: 0.9,
                maxLife: 0.9,
                velocityY: -46
            });
        }

        function spawnBurst(x, y, color, count, speed) {
            for (let index = 0; index < count; index += 1) {
                const angle = Math.random() * Math.PI * 2;
                const magnitude = 25 + Math.random() * speed;

                state.particles.push({
                    x,
                    y,
                    vx: Math.cos(angle) * magnitude,
                    vy: Math.sin(angle) * magnitude - 80,
                    size: 2 + Math.random() * 3,
                    color,
                    life: 0.55 + Math.random() * 0.35
                });
            }
        }

        function setFlash(color, strength) {
            state.flashColor = color;
            state.flash = Math.max(state.flash, strength);
        }

        function getProjection(worldY) {
            const normalizedDepth = (worldY - perspective.farWorldY) / (perspective.nearWorldY - perspective.farWorldY);
            const rawDepth = clamp(normalizedDepth, 0, 1);
            const depth = smoothstep(rawDepth);
            const roadHalfWidth = lerp(perspective.farRoadHalfWidth, road.width * 0.5, depth);

            return {
                normalizedDepth,
                inBounds: normalizedDepth >= 0 && normalizedDepth <= 1,
                rawDepth,
                depth,
                y: lerp(perspective.horizonY, perspective.floorY, rawDepth),
                roadHalfWidth,
                shoulderHalfWidth: lerp(perspective.farShoulderHalfWidth, (road.width * 0.5) + 26, depth),
                scale: lerp(0.18, 1, depth)
            };
        }

        function projectPoint(worldX, worldY) {
            const projection = getProjection(worldY);
            const normalizedX = (worldX - road.center) / (road.width * 0.5);

            return {
                x: road.center + (normalizedX * projection.roadHalfWidth),
                y: projection.y,
                scale: projection.scale,
                depth: projection.depth,
                inBounds: projection.inBounds,
                normalizedDepth: projection.normalizedDepth,
                rawDepth: projection.rawDepth,
                roadHalfWidth: projection.roadHalfWidth,
                shoulderHalfWidth: projection.shoulderHalfWidth
            };
        }

        function isDynamicProjectionVisible(projection, minimumDepth = 0.02) {
            return projection.inBounds && projection.normalizedDepth <= 0.965 && projection.depth > minimumDepth;
        }

        function screenXToWorldRoadX(screenX, worldY) {
            const projection = getProjection(worldY);
            const normalizedX = (screenX - road.center) / Math.max(14, projection.roadHalfWidth);
            return road.center + (normalizedX * (road.width * 0.5));
        }

        function drawScene() {
            context.clearRect(0, 0, width, height);

            drawBackdrop();
            drawRoad();
            drawBoardWaves();
            drawEnemies();
            drawBullets();
            drawParticles();
            drawPlayerConvoy();
            drawPopups();
            drawFlash();
        }

        function drawBackdrop() {
            const sky = context.createLinearGradient(0, 0, 0, height);
            sky.addColorStop(0, "#082f49");
            sky.addColorStop(0.26, "#0b2941");
            sky.addColorStop(0.58, "#07172a");
            sky.addColorStop(1, "#020617");

            context.fillStyle = sky;
            context.fillRect(0, 0, width, height);

            const glow = context.createRadialGradient(road.center, perspective.horizonY - 14, 8, road.center, perspective.horizonY - 14, 180);
            glow.addColorStop(0, "rgba(125, 211, 252, 0.34)");
            glow.addColorStop(0.45, "rgba(56, 189, 248, 0.12)");
            glow.addColorStop(1, "rgba(56, 189, 248, 0)");

            context.fillStyle = glow;
            context.fillRect(0, 0, width, height);

            for (let postY = perspective.farWorldY + (state.scroll % 110); postY < perspective.nearWorldY; postY += 110) {
                drawRoadsidePost(-1, postY);
                drawRoadsidePost(1, postY);
            }
        }

        function drawRoadsidePost(side, worldY) {
            const base = getProjection(worldY);
            const top = getProjection(worldY - 96);

            if (base.depth <= 0.02) {
                return;
            }

            const topX = road.center + (side * (top.shoulderHalfWidth + 12 + (top.depth * 12)));
            const baseX = road.center + (side * (base.shoulderHalfWidth + 8 + (base.depth * 10)));

            context.strokeStyle = hexToRgba("#7dd3fc", 0.08 + (base.depth * 0.14));
            context.lineWidth = 1 + (base.depth * 2.2);
            context.beginPath();
            context.moveTo(topX, top.y);
            context.lineTo(baseX, base.y);
            context.stroke();

            context.fillStyle = hexToRgba("#e2e8f0", 0.05 + (base.depth * 0.1));
            context.beginPath();
            context.arc(topX, top.y, Math.max(1, base.scale * 2.3), 0, Math.PI * 2);
            context.fill();
        }

        function drawRoad() {
            const shoulderTop = getProjection(perspective.farWorldY);
            const shoulderBottom = getProjection(perspective.nearWorldY);

            fillPerspectiveQuad(
                road.center - shoulderTop.shoulderHalfWidth,
                shoulderTop.y,
                road.center + shoulderTop.shoulderHalfWidth,
                shoulderTop.y,
                road.center + shoulderBottom.shoulderHalfWidth,
                shoulderBottom.y,
                road.center - shoulderBottom.shoulderHalfWidth,
                shoulderBottom.y,
                "#111827");

            const bandLength = 58;
            let bandIndex = 0;
            for (let bandY = perspective.farWorldY - bandLength + (state.scroll % bandLength); bandY < perspective.nearWorldY; bandY += bandLength) {
                const top = getProjection(bandY);
                const bottom = getProjection(bandY + bandLength);
                const bandColor = bandIndex % 2 === 0 ? "#0f172a" : "#111b2e";

                fillPerspectiveQuad(
                    road.center - top.roadHalfWidth,
                    top.y,
                    road.center + top.roadHalfWidth,
                    top.y,
                    road.center + bottom.roadHalfWidth,
                    bottom.y,
                    road.center - bottom.roadHalfWidth,
                    bottom.y,
                    bandColor);

                bandIndex += 1;
            }

            drawProjectedStrip(road.left, perspective.farWorldY, perspective.nearWorldY, 5, "rgba(103, 232, 249, 0.28)");
            drawProjectedStrip(road.right, perspective.farWorldY, perspective.nearWorldY, 5, "rgba(103, 232, 249, 0.28)");

            const laneDividerXs = [
                road.left + (road.width / 3),
                road.left + ((road.width / 3) * 2)
            ];

            for (const laneDividerX of laneDividerXs) {
                for (let markerY = perspective.farWorldY - 140 + state.scroll; markerY < perspective.nearWorldY; markerY += 96) {
                    drawProjectedStrip(laneDividerX, markerY, markerY + 44, 7, "rgba(248, 250, 252, 0.34)");
                }
            }
        }

        function drawBoardWaves() {
            const highlightedLane = getNearestTrackIndex(state.playerX);

            for (const boardWave of state.boardWaves.slice().sort((leftWave, rightWave) => leftWave.y - rightWave.y)) {
                const opacity = boardWave.resolved ? boardWave.fade : 1;

                for (const board of boardWave.boards) {
                    if (boardWave.resolved && board.laneIndex !== boardWave.resolvedLane) {
                        continue;
                    }

                    drawBoardCard(boardWave, board, opacity, !boardWave.resolved && board.laneIndex === highlightedLane);
                }
            }
        }

        function drawBoardCard(boardWave, board, opacity, selected) {
            const projection = getBoardProjection(boardWave, board);

            if (!isDynamicProjectionVisible(projection, 0.03) || opacity <= 0.01) {
                return;
            }

            const panelWidth = getBoardPanelWidth(projection);

            if (panelWidth < 14) {
                return;
            }

            const panelHeight = Math.max(16, panelWidth * 1.18);
            const legHeight = Math.max(5, panelHeight * 0.3);
            const baseY = projection.y + 4 + (projection.scale * 10);
            const top = baseY - panelHeight - legHeight;
            const cornerRadius = Math.max(5, panelWidth * 0.16);

            context.save();
            context.globalAlpha = opacity;
            context.lineWidth = 1 + (projection.scale * (selected ? 2.6 : 1.9));
            context.strokeStyle = selected ? "#f8fafc" : "#0f172a";
            context.beginPath();
            context.moveTo(projection.x - (panelWidth * 0.33), top + panelHeight);
            context.lineTo(projection.x - (panelWidth * 0.36), baseY);
            context.moveTo(projection.x + (panelWidth * 0.33), top + panelHeight);
            context.lineTo(projection.x + (panelWidth * 0.36), baseY);
            context.stroke();

            drawRoundedRect(projection.x - (panelWidth * 0.5), top, panelWidth, panelHeight, cornerRadius, board.tint);
            strokeRoundedRect(projection.x - (panelWidth * 0.5), top, panelWidth, panelHeight, cornerRadius);

            const barWidth = Math.max(10, panelWidth - 8);
            const barHeight = Math.max(3, projection.scale * 5);
            const barX = projection.x - (barWidth * 0.5);
            const barY = top + 6 + (projection.scale * 2);
            const healthRatio = board.health / board.maxHealth;

            context.fillStyle = "#0f172a";
            context.fillRect(barX, barY, barWidth, barHeight);
            context.fillStyle = healthRatio > 0.45 ? "#4ade80" : healthRatio > 0.2 ? "#fbbf24" : "#fb7185";
            context.fillRect(barX, barY, barWidth * healthRatio, barHeight);

            context.fillStyle = "#020617";
            context.font = `bold ${Math.max(7, Math.min(12, panelWidth * 0.4))}px Inter, Segoe UI, sans-serif`;
            context.textAlign = "center";
            context.fillText(board.label, projection.x, top + (panelHeight * 0.7));

            if (projection.depth > 0.18 && panelWidth >= 26) {
                context.fillStyle = "#0f172a";
                context.font = `${Math.max(6, Math.min(9, panelWidth * 0.22))}px Inter, Segoe UI, sans-serif`;
                context.fillText("SQUAD", projection.x, top + (panelHeight * 0.44));
            }

            context.restore();
        }

        function drawEnemies() {
            for (const enemy of state.enemies.slice().sort((leftEnemy, rightEnemy) => leftEnemy.y - rightEnemy.y)) {
                const projection = projectPoint(enemy.x, enemy.y + (enemy.height * 0.42));
                const isBehemoth = enemy.kind === "behemoth";
                const sprite = enemy.kind === "bike" ? sprites.enemyBike : sprites.enemyTruck;
                const minDrawWidth = isBehemoth ? 42 : enemy.kind === "truck" ? 20 : 15;
                const minDrawHeight = isBehemoth ? 64 : enemy.kind === "truck" ? 30 : 20;
                const drawWidth = Math.max(minDrawWidth, enemy.width * projection.scale * 0.92);
                const drawHeight = Math.max(minDrawHeight, enemy.height * projection.scale * 0.92);

                if (!isDynamicProjectionVisible(projection)) {
                    continue;
                }

                context.fillStyle = isBehemoth ? "rgba(15, 23, 42, 0.26)" : "rgba(2, 8, 23, 0.18)";
                context.beginPath();
                context.ellipse(projection.x, projection.y + 4, drawWidth * (isBehemoth ? 0.32 : 0.28), Math.max(2, projection.scale * (isBehemoth ? 7 : 5)), 0, 0, Math.PI * 2);
                context.fill();

                if (sprite) {
                    if (isBehemoth) {
                        context.save();
                        context.shadowColor = hexToRgba(enemy.tint, enemy.hit > 0 ? 0.5 : 0.34);
                        context.shadowBlur = 14 + (projection.scale * 18);
                        drawAnchoredImage(sprite, projection.x, projection.y + 3, drawWidth, drawHeight, enemy.hit > 0 ? 0.88 : 1);
                        context.restore();

                        context.save();
                        context.lineWidth = Math.max(2, 1 + (projection.scale * 2.5));
                        context.strokeStyle = hexToRgba(enemy.tint, enemy.hit > 0 ? 0.9 : 0.68);
                        strokeRoundedRect(
                            projection.x - (drawWidth * 0.43),
                            projection.y - drawHeight + (projection.scale * 4),
                            drawWidth * 0.86,
                            drawHeight * 0.82,
                            Math.max(6, drawWidth * 0.14));
                        context.restore();
                    }
                    else {
                        drawAnchoredImage(sprite, projection.x, projection.y + 3, drawWidth, drawHeight, enemy.hit > 0 ? 0.78 : 1);
                    }
                }
                else {
                    drawRoundedRect(projection.x - (drawWidth * 0.5), projection.y - drawHeight, drawWidth, drawHeight, Math.max(6, drawWidth * 0.15), enemy.hit > 0 ? "#fef2f2" : enemy.tint);
                }

                if (enemy.maxHealth > 1 && projection.depth > 0.08) {
                    const barWidth = Math.max(14, drawWidth - 10);
                    const barY = projection.y - drawHeight - (4 + (projection.scale * 10));
                    const healthRatio = enemy.health / enemy.maxHealth;

                    context.fillStyle = "rgba(15, 23, 42, 0.7)";
                    context.fillRect(projection.x - (barWidth * 0.5), barY, barWidth, Math.max(3, projection.scale * 6));
                    context.fillStyle = isBehemoth
                        ? (healthRatio > 0.45 ? "#ef4444" : healthRatio > 0.2 ? "#f97316" : "#facc15")
                        : "#34d399";
                    context.fillRect(projection.x - (barWidth * 0.5), barY, barWidth * healthRatio, Math.max(3, projection.scale * 6));

                    if (isBehemoth) {
                        context.fillStyle = "#fee2e2";
                        context.font = `bold ${Math.max(7, 7 + (projection.scale * 8))}px Inter, Segoe UI, sans-serif`;
                        context.textAlign = "center";
                        context.fillText("ELITE", projection.x, barY - Math.max(4, projection.scale * 5));
                    }
                }
            }
        }

        function drawBullets() {
            context.lineCap = "round";

            for (const bullet of state.bullets.slice().sort((leftBullet, rightBullet) => leftBullet.y - rightBullet.y)) {
                const head = projectPoint(bullet.x, bullet.y);
                const tail = projectPoint(bullet.x - (bullet.vx * 0.04), bullet.y + bullet.trail);

                if (!isDynamicProjectionVisible(head) || !isDynamicProjectionVisible(tail)) {
                    continue;
                }

                const gradient = context.createLinearGradient(head.x, head.y, tail.x, tail.y);
                gradient.addColorStop(0, "rgba(186, 230, 253, 1)");
                gradient.addColorStop(1, "rgba(34, 211, 238, 0)");

                context.strokeStyle = gradient;
                context.lineWidth = Math.max(1, 1 + (head.scale * 1.8));
                context.beginPath();
                context.moveTo(head.x, head.y);
                context.lineTo(tail.x, tail.y);
                context.stroke();
            }
        }

        function drawParticles() {
            for (const particle of state.particles.slice().sort((leftParticle, rightParticle) => leftParticle.y - rightParticle.y)) {
                const projection = projectPoint(particle.x, particle.y);

                if (!isDynamicProjectionVisible(projection)) {
                    continue;
                }

                context.fillStyle = hexToRgba(particle.color, particle.life);
                context.beginPath();
                context.arc(projection.x, projection.y, Math.max(1, particle.size * projection.scale), 0, Math.PI * 2);
                context.fill();
            }
        }

        function drawPlayerConvoy() {
            const members = getSquadMembers(state.squad, state.playerX);

            for (const member of members) {
                const projection = projectPoint(member.x, member.y + 8);
                const sizeScale = projection.scale * member.scale * 1.22;

                if (!projection.inBounds || projection.depth <= 0.02) {
                    continue;
                }

                context.fillStyle = `rgba(103, 232, 249, ${0.08 + (projection.depth * 0.16)})`;
                context.beginPath();
                context.ellipse(
                    projection.x,
                    projection.y - (8 * sizeScale),
                    Math.max(5, 9 * sizeScale),
                    Math.max(4, 6 * sizeScale),
                    0,
                    0,
                    Math.PI * 2);
                context.fill();

                if (sprites.allySoldier) {
                    drawAnchoredImage(
                        sprites.allySoldier,
                        projection.x,
                        projection.y + 2,
                        Math.max(10, 18 * sizeScale),
                        Math.max(14, 25 * sizeScale),
                        1);
                }
                else {
                    drawRoundedRect(
                        projection.x - (6 * sizeScale),
                        projection.y - (20 * sizeScale),
                        12 * sizeScale,
                        20 * sizeScale,
                        4 * sizeScale,
                        "#67e8f9");
                }
            }
        }

        function drawPopups() {
            for (const popup of state.popups) {
                const projection = projectPoint(popup.x, popup.y);

                if (!isDynamicProjectionVisible(projection)) {
                    continue;
                }

                context.fillStyle = hexToRgba(popup.color, popup.life / popup.maxLife);
                context.font = `bold ${Math.max(11, 10 + (projection.scale * 12))}px Inter, Segoe UI, sans-serif`;
                context.textAlign = "center";
                context.fillText(popup.text, projection.x, projection.y);
            }
        }

        function drawFlash() {
            if (state.flash <= 0) {
                return;
            }

            context.fillStyle = hexToRgba(state.flashColor, state.flash * 0.4);
            context.fillRect(0, 0, width, height);
        }

        function drawAnchoredImage(image, centerX, baseY, drawWidth, drawHeight, alpha = 1) {
            context.save();
            context.globalAlpha = alpha;
            context.drawImage(image, centerX - (drawWidth * 0.5), baseY - drawHeight, drawWidth, drawHeight);
            context.restore();
        }

        function drawCenteredImage(image, centerX, centerY, drawWidth, drawHeight, alpha = 1) {
            context.save();
            context.globalAlpha = alpha;
            context.drawImage(image, centerX - (drawWidth * 0.5), centerY - (drawHeight * 0.5), drawWidth, drawHeight);
            context.restore();
        }

        function fillPerspectiveQuad(leftTopX, topY, rightTopX, topRightY, rightBottomX, bottomY, leftBottomX, bottomLeftY, fillStyle) {
            context.beginPath();
            context.moveTo(leftTopX, topY);
            context.lineTo(rightTopX, topRightY);
            context.lineTo(rightBottomX, bottomY);
            context.lineTo(leftBottomX, bottomLeftY);
            context.closePath();
            context.fillStyle = fillStyle;
            context.fill();
        }

        function drawProjectedStrip(worldX, startWorldY, endWorldY, stripWidth, fillStyle) {
            const top = projectPoint(worldX, startWorldY);
            const bottom = projectPoint(worldX, endWorldY);
            const topHalfWidth = Math.max(0.7, stripWidth * top.scale * 0.45);
            const bottomHalfWidth = Math.max(1.2, stripWidth * bottom.scale * 0.55);

            fillPerspectiveQuad(
                top.x - topHalfWidth,
                top.y,
                top.x + topHalfWidth,
                top.y,
                bottom.x + bottomHalfWidth,
                bottom.y,
                bottom.x - bottomHalfWidth,
                bottom.y,
                fillStyle);
        }

        function getSquadMembers(count, anchorX) {
            const members = [];
            const columns = count <= 10 ? 4 : count <= 18 ? 5 : 6;
            const columnSpacing = count <= 18 ? 18 : 16;
            const rowSpacing = count <= 18 ? 22 : 19;

            for (let index = 0; index < count; index += 1) {
                const row = Math.floor(index / columns);
                const firstIndexInRow = row * columns;
                const rowCount = Math.min(columns, count - firstIndexInRow);
                const column = index - firstIndexInRow;
                const centerOffset = (rowCount - 1) / 2;
                const stagger = row % 2 === 0 ? 0 : columnSpacing * 0.35;
                const x = clamp(anchorX + ((column - centerOffset) * columnSpacing) + stagger, road.left + 14, road.right - 14);
                const y = convoyY + 56 + (row * rowSpacing) + (Math.abs(column - centerOffset) * 0.7);
                const scale = 0.9 - Math.min(row, 5) * 0.06;

                members.push({
                    x,
                    y,
                    row,
                    scale
                });
            }

            return members;
        }

        function getFormationBounds(members) {
            let minX = Number.POSITIVE_INFINITY;
            let maxX = Number.NEGATIVE_INFINITY;
            let minY = Number.POSITIVE_INFINITY;
            let maxY = Number.NEGATIVE_INFINITY;

            for (const member of members) {
                minX = Math.min(minX, member.x - 8);
                maxX = Math.max(maxX, member.x + 8);
                minY = Math.min(minY, member.y - 12);
                maxY = Math.max(maxY, member.y + 12);
            }

            return {
                x: minX,
                y: minY,
                width: maxX - minX,
                height: maxY - minY,
                centerX: (minX + maxX) * 0.5
            };
        }

        function getConvoyCoreBounds() {
            return {
                x: state.playerX - 24,
                y: convoyY + 26,
                width: 48,
                height: 86
            };
        }

        function getNearestTrackIndex(worldX) {
            let nearestIndex = 0;
            let nearestDistance = Number.POSITIVE_INFINITY;

            for (let index = 0; index < trackXs.length; index += 1) {
                const distance = Math.abs(trackXs[index] - worldX);

                if (distance >= nearestDistance) {
                    continue;
                }

                nearestDistance = distance;
                nearestIndex = index;
            }

            return nearestIndex;
        }

        function loadBest() {
            try {
                const rawValue = window.localStorage.getItem(storageKey);

                if (!rawValue) {
                    return { score: 0, distance: 0 };
                }

                const parsedValue = JSON.parse(rawValue);
                return {
                    score: Number(parsedValue.score) || 0,
                    distance: Number(parsedValue.distance) || 0
                };
            }
            catch {
                return { score: 0, distance: 0 };
            }
        }

        function saveBest(best) {
            try {
                window.localStorage.setItem(storageKey, JSON.stringify(best));
            }
            catch {
            }
        }

        return {
            init: initGame,
            dispose: disposeGame
        };
    }

    function circleIntersectsRect(circleX, circleY, radius, rectX, rectY, rectWidth, rectHeight) {
        const nearestX = clamp(circleX, rectX, rectX + rectWidth);
        const nearestY = clamp(circleY, rectY, rectY + rectHeight);
        const deltaX = circleX - nearestX;
        const deltaY = circleY - nearestY;
        return (deltaX * deltaX) + (deltaY * deltaY) <= radius * radius;
    }

    function rectanglesOverlap(leftRect, rightRect) {
        return leftRect.x < rightRect.x + rightRect.width
            && leftRect.x + leftRect.width > rightRect.x
            && leftRect.y < rightRect.y + rightRect.height
            && leftRect.y + leftRect.height > rightRect.y;
    }

    function clamp(value, minimum, maximum) {
        return Math.max(minimum, Math.min(maximum, value));
    }

    function lerp(start, end, amount) {
        return start + ((end - start) * amount);
    }

    function smoothstep(value) {
        return value * value * (3 - (2 * value));
    }

    function drawRoundedRect(x, y, rectWidth, rectHeight, radius, fillStyle) {
        const context = currentDrawingContext;

        if (!context) {
            return;
        }

        context.beginPath();
        roundedRectPath(context, x, y, rectWidth, rectHeight, radius);
        context.fillStyle = fillStyle;
        context.fill();
    }

    function strokeRoundedRect(x, y, rectWidth, rectHeight, radius) {
        const context = currentDrawingContext;

        if (!context) {
            return;
        }

        context.beginPath();
        roundedRectPath(context, x, y, rectWidth, rectHeight, radius);
        context.stroke();
    }

    function roundedRectPath(context, x, y, rectWidth, rectHeight, radius) {
        const safeRadius = Math.min(radius, rectWidth * 0.5, rectHeight * 0.5);

        context.moveTo(x + safeRadius, y);
        context.arcTo(x + rectWidth, y, x + rectWidth, y + rectHeight, safeRadius);
        context.arcTo(x + rectWidth, y + rectHeight, x, y + rectHeight, safeRadius);
        context.arcTo(x, y + rectHeight, x, y, safeRadius);
        context.arcTo(x, y, x + rectWidth, y, safeRadius);
        context.closePath();
    }

    function hexToRgba(hex, alpha) {
        const normalized = hex.replace("#", "");
        const value = normalized.length === 3
            ? normalized.split("").map((character) => character + character).join("")
            : normalized;

        const red = parseInt(value.slice(0, 2), 16);
        const green = parseInt(value.slice(2, 4), 16);
        const blue = parseInt(value.slice(4, 6), 16);

        return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
    }

    function formatNumber(value) {
        return value.toLocaleString("en-US");
    }

    function randomBetween(minimum, maximum) {
        return minimum + (Math.random() * (maximum - minimum));
    }

    function randomIntBetween(minimum, maximum) {
        return Math.floor(randomBetween(minimum, maximum + 1));
    }

    function sample(values) {
        return values[Math.floor(Math.random() * values.length)];
    }

    function shuffle(values) {
        for (let index = values.length - 1; index > 0; index -= 1) {
            const swapIndex = Math.floor(Math.random() * (index + 1));
            [values[index], values[swapIndex]] = [values[swapIndex], values[index]];
        }

        return values;
    }

    return {
        init,
        dispose
    };
})();

export { infiniteSoldiersGame };
