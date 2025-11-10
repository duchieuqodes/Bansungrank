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

// Serve static files
app.use(express.static('public'));

// Game rooms
const rooms = new Map();

// Character stats - cân bằng
const characterStats = [
    {
        speed: 5.5,
        damage: 22,
        fireRate: 400,
        size: 60,
        health: 110,
        skillType: 'poison', // Độc tính
        skillChance: 0.15,
        skillCooldown: 20000
    },
    {
        speed: 6.5,
        damage: 18,
        fireRate: 300,
        size: 70,
        health: 95,
        skillType: 'electric', // Điện giật
        skillChance: 0.20,
        skillCooldown: 20000
    },
    {
        speed: 4.5,
        damage: 28,
        fireRate: 600,
        size: 65,
        health: 125,
        skillType: 'fire', // Lửa x2 dame
        skillChance: 0.10,
        skillCooldown: 20000
    },
    {
        speed: 5.8,
        damage: 24,
        fireRate: 450,
        size: 65,
        health: 105,
        skillType: 'ice', // Băng đóng băng
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
        this.gameStarted = false;
        this.gameStartTime = null;
        this.lastItemSpawn = Date.now();
        this.itemSpawnInterval = 10000; // 10 seconds
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
            statusEffects: [] // {type: 'poison|frozen|stunned', endTime: timestamp}
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

        // Schedule game end
        setTimeout(() => {
            this.endGame();
        }, GAME_DURATION);
    }

    endGame() {
        if (!this.gameStarted) return;

        this.gameStarted = false;

        // Calculate final rankings
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

    update() {
        if (!this.gameStarted) return;

        const now = Date.now();

        // Update status effects and apply physics
        this.players.forEach(player => {
            player.statusEffects = player.statusEffects.filter(effect => effect.endTime > now);

            // Apply poison damage
            const poison = player.statusEffects.find(e => e.type === 'poison');
            if (poison && now % 500 < 50) { // Damage every 0.5s
                player.health = Math.max(0, player.health - 5);
            }

            // Apply friction when not moving
            if (Math.abs(player.vx) < 0.1) player.vx = 0;
            if (Math.abs(player.vy) < 0.1) player.vy = 0;
        });

        // Spawn items every 10 seconds
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

            // Check collision with players
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

                    // Apply damage
                    let damage = bullet.damage;

                    // Fire skill: x2 damage
                    if (bullet.skillEffect === 'fire') {
                        damage *= 2;
                    }

                    // Apply armor reduction
                    if (player.armor > 0) {
                        const armorAbsorb = Math.min(player.armor, damage * 0.7);
                        player.armor -= armorAbsorb;
                        damage -= armorAbsorb;
                    }

                    player.health = Math.max(0, player.health - damage);

                    // Apply skill effects
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

                    // Check if player died
                    if (player.health <= 0) {
                        player.deaths++;
                        const shooter = this.players.get(bullet.playerId);
                        if (shooter) {
                            shooter.kills++;
                        }

                        // Respawn player after 3 seconds
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

            return bullet.x > 0 && bullet.x < WORLD_WIDTH &&
                   bullet.y > 0 && bullet.y < WORLD_HEIGHT;
        });

        // Update items (despawn after 30 seconds)
        const itemLifespan = 30000;
        this.items = this.items.filter(item => {
            return now - item.spawnTime < itemLifespan;
        });

        // Check remaining time
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
            spawnTime: Date.now()
        });
    }

    getState() {
        const now = Date.now();
        return {
            players: Array.from(this.players.values()),
            bullets: this.bullets,
            items: this.items,
            timeRemaining: this.gameStarted ?
                Math.max(0, GAME_DURATION - (now - this.gameStartTime)) : null
        };
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    // Create room
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

    // Join room
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

    // Start game (host only)
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

    // Player movement
    socket.on('player-move', (data) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        // Check if frozen
        const hasFrozen = player.statusEffects.some(e => e.type === 'frozen');

        if (!hasFrozen) {
            // Update velocity
            player.vx = data.vx || 0;
            player.vy = data.vy || 0;

            // Update position based on velocity
            player.x += player.vx;
            player.y += player.vy;

            // Constrain to world bounds
            player.x = Math.max(50, Math.min(WORLD_WIDTH - 50, player.x));
            player.y = Math.max(50, Math.min(WORLD_HEIGHT - 50, player.y));
        } else {
            // Frozen - stop movement
            player.vx = 0;
            player.vy = 0;
        }

        // Update facing direction
        if (data.facingLeft !== undefined) {
            player.facingLeft = data.facingLeft;
        }
    });

    // Player shoot
    socket.on('player-shoot', (data) => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        // Check if stunned
        const hasStunned = player.statusEffects.some(e => e.type === 'stunned');
        if (hasStunned) return;

        const now = Date.now();
        if (now - player.lastShootTime < player.stats.fireRate) return;

        player.lastShootTime = now;

        // Check for skill activation
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
            impactFrame: 0
        });
    });

    // Player use skill
    socket.on('player-skill', () => {
        const room = rooms.get(socket.roomId);
        if (!room || !room.gameStarted) return;

        const player = room.players.get(socket.id);
        if (!player) return;

        const now = Date.now();
        if (now - player.lastSkillTime < player.stats.skillCooldown) return;

        player.lastSkillTime = now;

        // Skill is activated on next shot
        socket.emit('skill-ready');
    });

    // Item pickup
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
                    // Temporary speed boost
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

    // Disconnect
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

    // Get available rooms
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

// Game loop - update all rooms
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
