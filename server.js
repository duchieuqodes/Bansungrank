const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const path = require('path');

// Serve static files
app.use(express.static(__dirname));

// Game constants
const WORLD_WIDTH = 3000;
const WORLD_HEIGHT = 2000;
const GAME_DURATION = 10 * 60 * 1000; // 10 minutes
const POWERUP_SPAWN_INTERVAL = 10000; // 10 seconds

// Character stats
const characterStats = [
    { speed: 6, damage: 20, fireRate: 400, specialCooldown: 20000, size: 60, health: 100, ability: 'poison' },
    { speed: 7, damage: 15, fireRate: 300, specialCooldown: 20000, size: 70, health: 80, ability: 'electric' },
    { speed: 4, damage: 35, fireRate: 600, specialCooldown: 20000, size: 65, health: 120, ability: 'fire' },
    { speed: 5.5, damage: 25, fireRate: 500, specialCooldown: 20000, size: 65, health: 100, ability: 'ice' }
];

// Rooms
const rooms = new Map();

class Room {
    constructor(id, ownerSocketId, ownerName) {
        this.id = id;
        this.ownerSocketId = ownerSocketId;
        this.players = new Map();
        this.gameState = 'waiting'; // waiting, character_select, playing, finished
        this.bullets = [];
        this.powerups = [];
        this.statusEffects = new Map();
        this.gameStartTime = null;
        this.gameInterval = null;
        this.powerupInterval = null;

        // Add owner
        this.addPlayer(ownerSocketId, ownerName, true);
    }

    addPlayer(socketId, name, isOwner = false) {
        this.players.set(socketId, {
            id: socketId,
            name: name,
            isOwner: isOwner,
            characterType: null,
            x: 0,
            y: 0,
            vx: 0,
            vy: 0,
            angle: 0,
            health: 100,
            maxHealth: 100,
            armor: 0,
            maxArmor: 50,
            kills: 0,
            deaths: 0,
            speedBoost: 1,
            speedBoostExpiry: 0
        });
    }

    removePlayer(socketId) {
        this.players.delete(socketId);

        // If owner left, assign new owner
        if (socketId === this.ownerSocketId && this.players.size > 0) {
            const newOwner = this.players.keys().next().value;
            this.ownerSocketId = newOwner;
            this.players.get(newOwner).isOwner = true;
        }
    }

    getRoomInfo() {
        return {
            roomId: this.id,
            players: Array.from(this.players.values()).map(p => ({
                name: p.name,
                isOwner: p.isOwner
            }))
        };
    }

    startGame() {
        this.gameState = 'character_select';
    }

    allPlayersSelectedCharacter() {
        for (let player of this.players.values()) {
            if (player.characterType === null) return false;
        }
        return true;
    }

    initializeGame() {
        this.gameState = 'playing';
        this.gameStartTime = Date.now();
        this.bullets = [];
        this.powerups = [];
        this.statusEffects.clear();

        // Spawn players at random positions
        for (let player of this.players.values()) {
            player.x = Math.random() * (WORLD_WIDTH - 200) + 100;
            player.y = Math.random() * (WORLD_HEIGHT - 200) + 100;
            player.vx = 0;
            player.vy = 0;
            player.angle = 0;
            const stats = characterStats[player.characterType];
            player.health = stats.health;
            player.maxHealth = stats.health;
            player.armor = 0;
            player.kills = 0;
            player.deaths = 0;
        }

        // Start game loop
        this.gameInterval = setInterval(() => this.update(), 1000 / 60);

        // Start powerup spawner
        this.powerupInterval = setInterval(() => this.spawnPowerup(), POWERUP_SPAWN_INTERVAL);
    }

    update() {
        const now = Date.now();

        // Check game duration
        if (now - this.gameStartTime >= GAME_DURATION) {
            this.endGame();
            return;
        }

        // Update players
        for (let player of this.players.values()) {
            // Apply movement
            player.x += player.vx;
            player.y += player.vy;

            // Constrain to world
            player.x = Math.max(50, Math.min(WORLD_WIDTH - 50, player.x));
            player.y = Math.max(50, Math.min(WORLD_HEIGHT - 50, player.y));

            // Check powerup collision
            this.powerups = this.powerups.filter(powerup => {
                const dx = player.x - powerup.x;
                const dy = player.y - powerup.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                if (dist < 30) {
                    this.applyPowerup(player, powerup.type);
                    return false;
                }
                return true;
            });

            // Remove expired speed boost
            if (player.speedBoost > 1 && now > player.speedBoostExpiry) {
                player.speedBoost = 1;
            }
        }

        // Update bullets
        this.bullets = this.bullets.filter(bullet => {
            bullet.x += bullet.vx;
            bullet.y += bullet.vy;

            // Check bounds
            if (bullet.x < 0 || bullet.x > WORLD_WIDTH || bullet.y < 0 || bullet.y > WORLD_HEIGHT) {
                return false;
            }

            // Check player collision
            for (let player of this.players.values()) {
                if (player.id === bullet.shooterId) continue;

                const dx = player.x - bullet.x;
                const dy = player.y - bullet.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const stats = characterStats[player.characterType];

                if (dist < stats.size / 2) {
                    this.handleBulletHit(bullet, player);
                    return false;
                }
            }

            return true;
        });

        // Update status effects
        for (let [playerId, effects] of this.statusEffects.entries()) {
            // Poison damage
            if (effects.poisoned && now < effects.poisonExpiry) {
                if (now - effects.lastPoisonTick > 500) {
                    const player = this.players.get(playerId);
                    if (player) {
                        this.dealDamage(player, 5, effects.poisonAttackerId);
                        effects.lastPoisonTick = now;
                    }
                }
            } else if (effects.poisoned && now >= effects.poisonExpiry) {
                effects.poisoned = false;
            }

            // Remove expired effects
            if (effects.frozen && now >= effects.frozenExpiry) {
                effects.frozen = false;
            }
            if (effects.stunned && now >= effects.stunnedExpiry) {
                effects.stunned = false;
            }
        }

        // Send game state to all players in room
        this.broadcastGameState();
    }

    handleBulletHit(bullet, player) {
        const shooter = this.players.get(bullet.shooterId);
        if (!shooter) return;

        const shooterStats = characterStats[shooter.characterType];
        let damage = bullet.isSpecial ? shooterStats.damage * (shooterStats.ability === 'fire' ? 3 : 1.5) : shooterStats.damage;

        // Apply character abilities
        if (bullet.isSpecial) {
            // Special abilities
            switch (shooterStats.ability) {
                case 'poison':
                    this.applyStatusEffect(player.id, 'poisoned', 3000, bullet.shooterId);
                    break;
                case 'electric':
                    this.applyStatusEffect(player.id, 'stunned', 3000);
                    break;
                case 'fire':
                    // Fire does x3 damage (already applied above)
                    // Could add area damage here
                    break;
                case 'ice':
                    this.applyStatusEffect(player.id, 'frozen', 3000);
                    break;
            }
        } else {
            // Normal abilities
            switch (shooterStats.ability) {
                case 'poison':
                    this.applyStatusEffect(player.id, 'poisoned', 2000, bullet.shooterId);
                    damage *= 0.8; // Slightly less initial damage
                    break;
                case 'electric':
                    this.applyStatusEffect(player.id, 'stunned', 1000);
                    break;
                case 'fire':
                    damage *= 2;
                    break;
                case 'ice':
                    this.applyStatusEffect(player.id, 'frozen', 1500);
                    break;
            }
        }

        this.dealDamage(player, damage, bullet.shooterId);
    }

    dealDamage(player, amount, attackerId) {
        // Apply armor
        if (player.armor > 0) {
            const armorAbsorb = Math.min(player.armor, amount * 0.5);
            player.armor -= armorAbsorb;
            amount -= armorAbsorb;
        }

        player.health -= amount;

        if (player.health <= 0) {
            this.handlePlayerDeath(player, attackerId);
        }
    }

    handlePlayerDeath(victim, killerId) {
        victim.deaths++;
        victim.health = victim.maxHealth;
        victim.armor = 0;

        // Respawn at random location
        victim.x = Math.random() * (WORLD_WIDTH - 200) + 100;
        victim.y = Math.random() * (WORLD_HEIGHT - 200) + 100;

        const killer = this.players.get(killerId);
        if (killer && killer.id !== victim.id) {
            killer.kills++;

            // Notify players
            io.to(this.id).emit('playerKilled', {
                victimId: victim.id,
                victimName: victim.name,
                killerId: killer.id,
                killerName: killer.name
            });
        }
    }

    applyStatusEffect(playerId, effect, duration, attackerId = null) {
        if (!this.statusEffects.has(playerId)) {
            this.statusEffects.set(playerId, {});
        }

        const now = Date.now();
        const effects = this.statusEffects.get(playerId);

        switch (effect) {
            case 'poisoned':
                effects.poisoned = true;
                effects.poisonExpiry = now + duration;
                effects.poisonAttackerId = attackerId;
                effects.lastPoisonTick = now;
                break;
            case 'stunned':
                effects.stunned = true;
                effects.stunnedExpiry = now + duration;
                break;
            case 'frozen':
                effects.frozen = true;
                effects.frozenExpiry = now + duration;
                break;
        }
    }

    applyPowerup(player, type) {
        switch (type) {
            case 'health':
                player.health = Math.min(player.maxHealth, player.health + 40);
                break;
            case 'armor':
                player.armor = Math.min(player.maxArmor, player.armor + 30);
                break;
            case 'speed':
                player.speedBoost = 1.5;
                player.speedBoostExpiry = Date.now() + 10000; // 10 seconds
                break;
        }
    }

    spawnPowerup() {
        const types = ['health', 'armor', 'speed'];
        const type = types[Math.floor(Math.random() * types.length)];

        this.powerups.push({
            id: Date.now() + Math.random(),
            type: type,
            x: Math.random() * (WORLD_WIDTH - 100) + 50,
            y: Math.random() * (WORLD_HEIGHT - 100) + 50
        });
    }

    broadcastGameState() {
        const now = Date.now();
        const timeRemaining = Math.max(0, GAME_DURATION - (now - this.gameStartTime));

        io.to(this.id).emit('gameState', {
            players: Object.fromEntries(this.players),
            bullets: this.bullets,
            powerups: this.powerups,
            statusEffects: Object.fromEntries(this.statusEffects),
            timeRemaining: timeRemaining
        });
    }

    endGame() {
        clearInterval(this.gameInterval);
        clearInterval(this.powerupInterval);

        // Generate leaderboard
        const leaderboard = Array.from(this.players.values())
            .sort((a, b) => {
                if (b.kills !== a.kills) return b.kills - a.kills;
                return a.deaths - b.deaths;
            })
            .map(p => ({
                name: p.name,
                kills: p.kills,
                deaths: p.deaths
            }));

        io.to(this.id).emit('gameOver', { leaderboard });

        this.gameState = 'finished';
    }

    cleanup() {
        if (this.gameInterval) clearInterval(this.gameInterval);
        if (this.powerupInterval) clearInterval(this.powerupInterval);
    }
}

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);

    socket.on('createRoom', (data) => {
        const roomId = generateRoomId();
        const room = new Room(roomId, socket.id, data.playerName);
        rooms.set(roomId, room);

        socket.join(roomId);
        socket.emit('roomCreated', room.getRoomInfo());

        broadcastRoomsList();
    });

    socket.on('joinRoom', (data) => {
        const room = rooms.get(data.roomId);

        if (!room) {
            socket.emit('error', 'Phòng không tồn tại!');
            return;
        }

        if (room.gameState !== 'waiting') {
            socket.emit('error', 'Trận đấu đã bắt đầu!');
            return;
        }

        if (room.players.size >= 10) {
            socket.emit('error', 'Phòng đã đầy!');
            return;
        }

        room.addPlayer(socket.id, data.playerName);
        socket.join(data.roomId);

        socket.emit('roomJoined', room.getRoomInfo());
        io.to(data.roomId).emit('roomUpdate', room.getRoomInfo());

        broadcastRoomsList();
    });

    socket.on('leaveRoom', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;

        room.removePlayer(socket.id);
        socket.leave(room.id);

        if (room.players.size === 0) {
            room.cleanup();
            rooms.delete(room.id);
        } else {
            io.to(room.id).emit('roomUpdate', room.getRoomInfo());
        }

        broadcastRoomsList();
    });

    socket.on('startGame', () => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;

        if (room.ownerSocketId !== socket.id) {
            socket.emit('error', 'Chỉ trưởng phòng mới có thể bắt đầu!');
            return;
        }

        room.startGame();
        io.to(room.id).emit('gameStarting');
    });

    socket.on('selectCharacter', (data) => {
        const room = findPlayerRoom(socket.id);
        if (!room) return;

        const player = room.players.get(socket.id);
        if (player) {
            player.characterType = data.characterType;

            if (room.allPlayersSelectedCharacter()) {
                room.initializeGame();
                io.to(room.id).emit('gameStarted');
            }
        }
    });

    socket.on('playerMove', (data) => {
        const room = findPlayerRoom(socket.id);
        if (!room || room.gameState !== 'playing') return;

        const player = room.players.get(socket.id);
        if (!player) return;

        // Check if frozen or stunned
        const effects = room.statusEffects.get(socket.id);
        if (effects && (effects.frozen || effects.stunned)) {
            player.vx = 0;
            player.vy = 0;
            return;
        }

        const stats = characterStats[player.characterType];
        const speed = stats.speed * player.speedBoost;

        player.vx = Math.cos(data.angle) * data.distance * speed;
        player.vy = Math.sin(data.angle) * data.distance * speed;
        player.angle = data.angle;
    });

    socket.on('shoot', (data) => {
        const room = findPlayerRoom(socket.id);
        if (!room || room.gameState !== 'playing') return;

        const player = room.players.get(socket.id);
        if (!player) return;

        // Check if stunned (frozen allows shooting)
        const effects = room.statusEffects.get(socket.id);
        if (effects && effects.stunned) return;

        const stats = characterStats[player.characterType];
        const speed = 15;

        room.bullets.push({
            id: Date.now() + Math.random(),
            x: player.x,
            y: player.y,
            vx: Math.cos(player.angle) * speed,
            vy: Math.sin(player.angle) * speed,
            shooterId: socket.id,
            characterType: player.characterType,
            isSpecial: data.isSpecial
        });
    });

    socket.on('getRooms', () => {
        sendRoomsList(socket);
    });

    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);

        const room = findPlayerRoom(socket.id);
        if (room) {
            room.removePlayer(socket.id);

            if (room.players.size === 0) {
                room.cleanup();
                rooms.delete(room.id);
            } else {
                io.to(room.id).emit('roomUpdate', room.getRoomInfo());
            }

            broadcastRoomsList();
        }
    });
});

// Helper functions
function generateRoomId() {
    return 'ROOM_' + Math.random().toString(36).substr(2, 6).toUpperCase();
}

function findPlayerRoom(socketId) {
    for (let room of rooms.values()) {
        if (room.players.has(socketId)) {
            return room;
        }
    }
    return null;
}

function sendRoomsList(socket) {
    const roomsList = Array.from(rooms.values())
        .filter(room => room.gameState === 'waiting')
        .map(room => ({
            id: room.id,
            name: `Phòng ${room.id}`,
            players: room.players.size,
            maxPlayers: 10
        }));

    socket.emit('roomsList', roomsList);
}

function broadcastRoomsList() {
    const roomsList = Array.from(rooms.values())
        .filter(room => room.gameState === 'waiting')
        .map(room => ({
            id: room.id,
            name: `Phòng ${room.id}`,
            players: room.players.size,
            maxPlayers: 10
        }));

    io.emit('roomsList', roomsList);
}

const PORT = process.env.PORT || 3000;

http.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
