const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});
const path = require('path');

const PORT = process.env.PORT || 3000;
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;
const GAME_DURATION = 10 * 60 * 1000; // 10 minutes
const BOSS_SPAWN_INTERVAL = 2 * 60 * 1000; // 2 minutes

// Serve static files
app.use(express.static('.'));

// Game rooms
const rooms = new Map();

// Character stats - tăng tốc độ gấp đôi
const characterStats = [
    {
        speed: 11,  // tăng gấp đôi từ 5.5
        damage: 22,
        fireRate: 400,
        size: 60,
        health: 110,
        skillType: 'poison',
        skillChance: 0.15,
        skillCooldown: 20000
    },
    {
        speed: 13,  // tăng gấp đôi từ 6.5
        damage: 18,
        fireRate: 300,
        size: 70,
        health: 95,
        skillType: 'electric',
        skillChance: 0.20,
        skillCooldown: 20000
    },
    {
        speed: 9,   // tăng gấp đôi từ 4.5
        damage: 28,
        fireRate: 600,
        size: 65,
        health: 125,
        skillType: 'fire',
        skillChance: 0.10,
        skillCooldown: 20000
    },
    {
        speed: 11.6,  // tăng gấp đôi từ 5.8
        damage: 24,
        fireRate: 450,
        size: 65,
        health: 105,
        skillType: 'ice',
        skillChance: 0.18,
        skillCooldown: 20000
    }
];

class Room {
    constructor(id, hostId) {
        this.id = id;
        this.hostId = hostId;
        this.players = new Map();
        this.bullets = [];
        this.items = [];
        this.bosses = [];
        this.gameStarted = false;
        this.gameStartTime = null;
        this.lastItemSpawn = Date.now();
        this.itemSpawnInterval = 10000;
        this.lastBossSpawn = Date.now();
        this.nextBossId = 1;
    }

    addPlayer(socket, data) {
        const stats = characterStats[data.characterType];
        this.players.set(socket.id, {
            id: socket.id,
            name: data.playerName,
            x: Math.random() * (WORLD_WIDTH - 200) + 100,
            y: Math.random() * (WORLD_HEIGHT - 200) + 100,
            vx: 0,
            vy: 0,
            health: stats.health,
            maxHealth: stats.health,
            armor: 0,
            maxArmor: 50,
            characterType: data.characterType,
            stats: stats,
            facingLeft: false,
            kills: 0,
            deaths: 0,
            lastShootTime: 0,
            lastSkillTime: 0,
            statusEffects: [],
            joystickActive: false,
            joystickAngle: 0,
            joystickDistance: 0
        });
    }

    removePlayer(socketId) {
        this.players.delete(socketId);
        if (socketId === this.hostId && this.players.size > 0) {
            this.hostId = Array.from(this.players.keys())[0];
        }
    }

    startGame() {
        this.gameStarted = true;
        this.gameStartTime = Date.now();
        this.lastItemSpawn = Date.now();
        this.lastBossSpawn = Date.now();

        setTimeout(() => {
            this.endGame();
        }, GAME_DURATION);
    }

    endGame() {
        if (!this.gameStarted) return;

        this.gameStarted = false;

        const rankings = Array.from(this.players.values())
            .sort((a, b) => {
                if (b.kills !== a.kills) return b.kills - a.kills;
                return a.deaths - b.deaths;
            })
            .map((p, index) => ({
                rank: index + 1,
                name: p.name,
                kills: p.kills,
                deaths: p.deaths
            }));

        io.to(this.id).emit('game-ended', { rankings });
    }

    spawnBoss() {
        const boss = {
            id: 'boss_' + this.nextBossId++,
            x: Math.random() * (WORLD_WIDTH - 400) + 200,
            y: Math.random() * (WORLD_HEIGHT - 400) + 200,
            vx: 0,
            vy: 0,
            health: 2200, // 100 lần bắn * 22 damage trung bình
            maxHealth: 2200,
            size: 120,
            lastShootTime: Date.now(),
            shootInterval: 5000, // 5 giây
            targetX: 0,
            targetY: 0,
            moveTimer: 0
        };

        // Set random movement target
        this.setBossTarget(boss);
        this.bosses.push(boss);

        // Emit camera shake for spawn
        io.to(this.id).emit('camera-shake', { intensity: 15, duration: 800 });
    }

    setBossTarget(boss) {
        boss.targetX = Math.random() * (WORLD_WIDTH - 400) + 200;
        boss.targetY = Math.random() * (WORLD_HEIGHT - 400) + 200;
        boss.moveTimer = Date.now() + Math.random() * 5000 + 3000; // 3-8 seconds
    }

    dropBossLoot(boss) {
        const now = Date.now();
        const lootTypes = ['health', 'armor', 'speed'];

        // Rớt 8-12 vật phẩm đặc biệt
        const lootCount = Math.floor(Math.random() * 5) + 8;

        for (let i = 0; i < lootCount; i++) {
            const angle = (Math.PI * 2 * i) / lootCount;
            const distance = 60 + Math.random() * 40;

            this.items.push({
                id: now + Math.random(),
                type: lootTypes[Math.floor(Math.random() * lootTypes.length)],
                x: boss.x + Math.cos(angle) * distance,
                y: boss.y + Math.sin(angle) * distance,
                spawnTime: now,
                isBossLoot: true,
                despawnTime: now + 5000 // 5 giây
            });
        }
    }

    update() {
        if (!this.gameStarted) return;

        const now = Date.now();

        // Spawn boss every 2 minutes
        if (now - this.lastBossSpawn > BOSS_SPAWN_INTERVAL) {
            this.spawnBoss();
            this.lastBossSpawn = now;
        }

        // Update bosses
        this.bosses.forEach(boss => {
            // Movement
            if (now > boss.moveTimer) {
                this.setBossTarget(boss);
            }

            const dx = boss.targetX - boss.x;
            const dy = boss.targetY - boss.y;
            const dist = Math.sqrt(dx * dx + dy * dy);

            if (dist > 10) {
                const speed = 2;
                boss.vx = (dx / dist) * speed;
                boss.vy = (dy / dist) * speed;
            } else {
                boss.vx *= 0.9;
                boss.vy *= 0.9;
            }

            boss.x += boss.vx;
            boss.y += boss.vy;

            // Keep in bounds
            boss.x = Math.max(100, Math.min(WORLD_WIDTH - 100, boss.x));
            boss.y = Math.max(100, Math.min(WORLD_HEIGHT - 100, boss.y));

            // Shooting
            if (now - boss.lastShootTime > boss.shootInterval) {
                boss.lastShootTime = now;

                // Bắn 4 tia đạn và laser về 4 hướng
                const directions = [
                    { vx: 1, vy: 0 },   // Phải
                    { vx: -1, vy: 0 },  // Trái
                    { vx: 0, vy: 1 },   // Xuống
                    { vx: 0, vy: -1 }   // Lên
                ];

                directions.forEach(dir => {
                    // Đạn thường
                    this.bullets.push({
                        id: now + Math.random(),
                        x: boss.x,
                        y: boss.y,
                        vx: dir.vx * 10,
                        vy: dir.vy * 10,
                        playerId: boss.id,
                        charType: 'boss',
                        damage: 30,
                        skillEffect: null,
                        impacting: false,
                        impactFrame: 0,
                        isBossBullet: true
                    });

                    // Laser
                    this.bullets.push({
                        id: now + Math.random(),
                        x: boss.x,
                        y: boss.y,
                        vx: dir.vx * 15,
                        vy: dir.vy * 15,
                        playerId: boss.id,
                        charType: 'boss_laser',
                        damage: 45,
                        skillEffect: null,
                        impacting: false,
                        impactFrame: 0,
                        isBossBullet: true,
                        isLaser: true
                    });
                });

                // Camera shake khi boss bắn
                io.to(this.id).emit('camera-shake', { intensity: 10, duration: 500 });
            }
        });

        // Update players
        this.players.forEach(player => {
            player.statusEffects = player.statusEffects.filter(effect => effect.endTime > now);

            const poison = player.statusEffects.find(e => e.type === 'poison');
            if (poison && now % 500 < 50) {
                player.health = Math.max(0, player.health - 5);
            }

            const hasFrozen = player.statusEffects.some(e => e.type === 'frozen');

            if (!hasFrozen) {
                if (player.joystickActive && player.joystickDistance > 0) {
                    const speed = player.stats.speed;
                    player.vx = Math.cos(player.joystickAngle) * player.joystickDistance * speed;
                    player.vy = Math.sin(player.joystickAngle) * player.joystickDistance * speed;

                    if (player.vx < -0.5) {
                        player.facingLeft = true;
                    } else if (player.vx > 0.5) {
                        player.facingLeft = false;
                    }
                } else {
                    player.vx *= 0.85;
                    player.vy *= 0.85;

                    if (Math.abs(player.vx) < 0.1) player.vx = 0;
                    if (Math.abs(player.vy) < 0.1) player.vy = 0;
                }

                player.x += player.vx;
                player.y += player.vy;

                player.x = Math.max(50, Math.min(WORLD_WIDTH - 50, player.x));
                player.y = Math.max(50, Math.min(WORLD_HEIGHT - 50, player.y));
            } else {
                player.vx = 0;
                player.vy = 0;
            }
        });

        // Spawn items
        if (now - this.lastItemSpawn > this.itemSpawnInterval) {
            this.spawnRandomItem();
            this.lastItemSpawn = now;
        }

        // Update bullets
        this.bullets = this.bullets.filter(bullet => {
            if (bullet.impacting) {
                bullet.impactFrame++;
                return bullet.impactFrame <= 15;
            }

            bullet.x += bullet.vx;
            bullet.y += bullet.vy;

            // Boss bullets hit players
            if (bullet.isBossBullet) {
                this.players.forEach(player => {
                    const dx = bullet.x - player.x;
                    const dy = bullet.y - player.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < player.stats.size / 2 && !bullet.impacting) {
                        bullet.impacting = true;
                        bullet.impactFrame = 0;
                        bullet.vx = 0;
                        bullet.vy = 0;

                        let damage = bullet.damage;

                        if (player.armor > 0) {
                            const armorAbsorb = Math.min(player.armor, damage * 0.7);
                            player.armor -= armorAbsorb;
                            damage -= armorAbsorb;
                        }

                        player.health = Math.max(0, player.health - damage);

                        if (player.health <= 0) {
                            player.deaths++;

                            setTimeout(() => {
                                if (this.players.has(player.id)) {
                                    player.health = player.maxHealth;
                                    player.armor = 0;
                                    player.x = Math.random() * (WORLD_WIDTH - 200) + 100;
                                    player.y = Math.random() * (WORLD_HEIGHT - 200) + 100;
                                    player.statusEffects = [];
                                }
                            }, 3000);
                        }
                    }
                });
            } else {
                // Player bullets hit other players
                this.players.forEach(player => {
                    if (bullet.playerId === player.id) return;

                    const dx = bullet.x - player.x;
                    const dy = bullet.y - player.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < player.stats.size / 2 && !bullet.impacting) {
                        bullet.impacting = true;
                        bullet.impactFrame = 0;
                        bullet.vx = 0;
                        bullet.vy = 0;

                        let damage = bullet.damage;

                        if (bullet.skillEffect === 'fire') {
                            damage *= 2;
                        }

                        if (player.armor > 0) {
                            const armorAbsorb = Math.min(player.armor, damage * 0.7);
                            player.armor -= armorAbsorb;
                            damage -= armorAbsorb;
                        }

                        player.health = Math.max(0, player.health - damage);

                        if (bullet.skillEffect) {
                            switch (bullet.skillEffect) {
                                case 'poison':
                                    player.statusEffects.push({
                                        type: 'poison',
                                        endTime: now + 2000
                                    });
                                    break;
                                case 'electric':
                                    player.statusEffects.push({
                                        type: 'stunned',
                                        endTime: now + 2000
                                    });
                                    break;
                                case 'ice':
                                    player.statusEffects.push({
                                        type: 'frozen',
                                        endTime: now + 2000
                                    });
                                    break;
                            }
                        }

                        if (player.health <= 0) {
                            player.deaths++;
                            const shooter = this.players.get(bullet.playerId);
                            if (shooter) {
                                shooter.kills++;
                            }

                            setTimeout(() => {
                                if (this.players.has(player.id)) {
                                    player.health = player.maxHealth;
                                    player.armor = 0;
                                    player.x = Math.random() * (WORLD_WIDTH - 200) + 100;
                                    player.y = Math.random() * (WORLD_HEIGHT - 200) + 100;
                                    player.statusEffects = [];
                                }
                            }, 3000);
                        }
                    }
                });

                // Player bullets hit bosses
                this.bosses.forEach(boss => {
                    const dx = bullet.x - boss.x;
                    const dy = bullet.y - boss.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);

                    if (dist < boss.size / 2 && !bullet.impacting) {
                        bullet.impacting = true;
                        bullet.impactFrame = 0;
                        bullet.vx = 0;
                        bullet.vy = 0;

                        let damage = bullet.damage;
                        if (bullet.skillEffect === 'fire') {
                            damage *= 2;
                        }

                        boss.health -= damage;

                        if (boss.health <= 0) {
                            // Boss chết - camera shake mạnh
                            io.to(this.id).emit('camera-shake', { intensity: 20, duration: 1000 });

                            // Rớt loot
                            this.dropBossLoot(boss);

                            // Xóa boss
                            this.bosses = this.bosses.filter(b => b.id !== boss.id);

                            // Give kill credit
                            const shooter = this.players.get(bullet.playerId);
                            if (shooter) {
                                shooter.kills += 5; // 5 kills cho việc giết boss
                            }
                        }
                    }
                });
            }

            return bullet.x > 0 && bullet.x < WORLD_WIDTH &&
                   bullet.y > 0 && bullet.y < WORLD_HEIGHT;
        });

        // Update items
        this.items = this.items.filter(item => {
            if (item.isBossLoot) {
                return now < item.despawnTime;
            }
            return now - item.spawnTime < 30000;
        });

        const timeRemaining = GAME_DURATION - (now - this.gameStartTime);
        if (timeRemaining <= 0) {
            this.endGame();
        }
    }

    spawnRandomItem() {
        const types = ['health', 'armor', 'speed'];
        const type = types[Math.floor(Math.random() * types.length)];

        this.items.push({
            id: Date.now() + Math.random(),
            type: type,
            x: Math.random() * (WORLD_WIDTH - 200) + 100,
            y: Math.random() * (WORLD_HEIGHT - 200) + 100,
            spawnTime: Date.now(),
            isBossLoot: false
        });
    }

    getState() {
        const now = Date.now();
        return {
            players: Array.from(this.players.values()),
            bullets: this.bullets,
            items: this.items,
            bosses: this.bosses,
            timeRemaining: this.gameStarted ?
                Math.max(0, GAME_DURATION - (now - this.gameStartTime)) : null
        };
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('create-room', (data) => {
        const roomId = generateRoomId();
        const room = new Room(roomId, socket.id);
        room.addPlayer(socket, data);
        rooms.set(roomId, room);

        socket.join(roomId);
        socket.roomId = roomId;

        socket.emit('room-created', {
            roomId: roomId,
            isHost: true
        });

        io.to(roomId).emit('room-update', {
            players: Array.from(room.players.values()),
            hostId: room.hostId
        });
    });

    socket.on('join-room', (data) => {
        const room = rooms.get(data.roomId);

        if (!room) {
            socket.emit('join-error', { message: 'Phòng không tồn tại!' });
            return;
        }

        if (room.gameStarted) {
            socket.emit('join-error', { message: 'Trận đấu đã bắt đầu!' });
            return;
        }

        if (room.players.size >= 8) {
            socket.emit('join-error', { message: 'Phòng đã đầy!' });
            return;
        }

        room.addPlayer(socket, data);
        socket.join(data.roomId);
        socket.roomId = data.roomId;

        socket.emit('room-joined', {
            roomId: data.roomId,
            isHost: socket.id === room.hostId
        });

        io.to(data.roomId).emit('room-update', {
            players: Array.from(room.players.values()),
            hostId: room.hostId
        });
    });

    socket.on('start-game', () => {
        const room = rooms.get(socket.roomId);
        if (!room || room.hostId !== socket.id) return;

        if (room.players.size < 2) {
            socket.emit('start-error', { message: 'Cần ít nhất 2 người chơi!' });
            return;
        }

        room.startGame();
        io.to(socket.roomId).emit('game-started');
    });

    socket.on('player-input', (data) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        player.joystickActive = data.joystickActive || false;
        player.joystickAngle = data.joystickAngle || 0;
        player.joystickDistance = data.joystickDistance || 0;
    });

    socket.on('player-shoot', (data) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        const hasStunned = player.statusEffects.some(e => e.type === 'stunned');
        if (hasStunned) return;

        const now = Date.now();
        if (now - player.lastShootTime < player.stats.fireRate) return;

        player.lastShootTime = now;

        let skillEffect = null;
        const canUseSkill = now - player.lastSkillTime >= player.stats.skillCooldown;

        if (canUseSkill && Math.random() < player.stats.skillChance) {
            skillEffect = player.stats.skillType;
            player.lastSkillTime = now;
        }

        const direction = player.facingLeft ? -1 : 1;
        room.bullets.push({
            id: now + Math.random(),
            x: player.x + (direction * 30),
            y: player.y,
            vx: direction * 12,
            vy: 0,
            playerId: socket.id,
            charType: player.characterType,
            damage: player.stats.damage,
            skillEffect: skillEffect,
            impacting: false,
            impactFrame: 0,
            isBossBullet: false
        });
    });

    socket.on('player-skill', () => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        const now = Date.now();
        if (now - player.lastSkillTime < player.stats.skillCooldown) return;

        player.lastSkillTime = now;
        socket.emit('skill-ready');
    });

    socket.on('pickup-item', (data) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        const itemIndex = room.items.findIndex(item => item.id === data.itemId);
        if (itemIndex === -1) return;

        const item = room.items[itemIndex];
        const dx = player.x - item.x;
        const dy = player.y - item.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < 40) {
            room.items.splice(itemIndex, 1);

            switch (item.type) {
                case 'health':
                    player.health = Math.min(player.maxHealth, player.health + 30);
                    break;
                case 'armor':
                    player.armor = Math.min(player.maxArmor, player.armor + 25);
                    break;
                case 'speed':
                    const originalSpeed = player.stats.speed;
                    player.stats.speed *= 1.5;
                    setTimeout(() => {
                        if (room.players.has(socket.id)) {
                            player.stats.speed = originalSpeed;
                        }
                    }, 10000);
                    break;
            }
        }
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        const room = rooms.get(socket.roomId);
        if (room) {
            room.removePlayer(socket.id);

            if (room.players.size === 0) {
                rooms.delete(socket.roomId);
            } else {
                io.to(socket.roomId).emit('room-update', {
                    players: Array.from(room.players.values()),
                    hostId: room.hostId
                });
            }
        }
    });

    socket.on('get-rooms', () => {
        const availableRooms = Array.from(rooms.values())
            .filter(room => !room.gameStarted && room.players.size < 8)
            .map(room => ({
                id: room.id,
                playerCount: room.players.size
            }));

        socket.emit('rooms-list', availableRooms);
    });
});

// Game loop
setInterval(() => {
    rooms.forEach(room => {
        room.update();
        if (room.gameStarted) {
            io.to(room.id).emit('game-state', room.getState());
        }
    });
}, 1000 / 30); // 30 FPS

function generateRoomId() {
    return Math.random().toString(36).substr(2, 6).toUpperCase();
}

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
