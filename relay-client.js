'use strict';

const io = require('socket.io-client');

const RELAY_URL = 'http://34.31.125.161';

class RelayClient {
  constructor() {
    this.socket = null;
    this.connected = false;
    this.sessionCode = null;
    this.role = null;
    this.dmName = null;
    this.clientId = `client-${Date.now()}-${Math.random()}`;
    this.listeners = {}; // { eventName: [callbacks...] }
  }

  connect() {
    if (this.socket && this.connected) return Promise.resolve();

    return new Promise((resolve, reject) => {
      try {
        this.socket = io(RELAY_URL, {
          reconnection: true,
          reconnectionDelay: 1000,
          reconnectionDelayMax: 5000,
          reconnectionAttempts: 5,
          transports: ['websocket', 'polling'],
        });

        this.socket.on('connect', () => {
          this.connected = true;
          console.log('[Relay] Connected to server');

          // Re-join the room if we were in one before disconnect
          if (this.sessionCode && this.role) {
            console.log(`[Relay] Rejoining session ${this.sessionCode} as ${this.role}`);
            this.socket.emit('session:join', {
              code: this.sessionCode,
              role: this.role,
              dmName: this.dmName || 'DM',
            });
          }

          this._emit('relay:connected');
          resolve();
        });

        this.socket.on('disconnect', (reason) => {
          this.connected = false;
          console.log('[Relay] Disconnected:', reason);
          this._emit('relay:disconnected', { reason });
        });

        this.socket.on('connect_error', (err) => {
          console.error('[Relay] Connection error:', err.message);
          this._emit('relay:error', { error: err.message });
          reject(err);
        });

        this.socket.on('error', (err) => {
          console.error('[Relay] Socket error:', err);
          this._emit('relay:error', { error: err });
        });

        // Listen for broadcast events from other clients in the room
        this.socket.on('roll:broadcast', (data) => {
          if (data.clientId === this.clientId) return; // Skip own echo
          this._emit('roll:broadcast', data);
        });

        this.socket.on('hp:update', (data) => {
          if (data.clientId === this.clientId) return; // Skip own echo
          this._emit('hp:update', data);
        });

        this.socket.on('initiative:sync', (data) => {
          if (data.clientId === this.clientId) return; // Skip own echo
          this._emit('initiative:sync', data);
        });

        this.socket.on('player:joined', (data) => {
          this._emit('player:joined', data);
        });

        this.socket.on('player:left', (data) => {
          this._emit('player:left', data);
        });

        setTimeout(() => {
          if (!this.connected) {
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      } catch (err) {
        reject(err);
      }
    });
  }

  joinSession(code, role, dmName) {
    this.sessionCode = code;
    this.role = role;
    this.dmName = dmName;

    if (!this.socket || !this.connected) {
      console.warn('[Relay] Not connected, will retry when ready');
      // Will be auto-emitted on reconnect
      return;
    }

    console.log(`[Relay] Joining session ${code} as ${role}`);
    this.socket.emit('session:join', {
      code,
      role,
      dmName: dmName || 'DM',
    });
  }

  leaveSession() {
    if (!this.socket || !this.sessionCode) return;

    console.log(`[Relay] Leaving session ${this.sessionCode}`);
    this.socket.emit('session:leave', {
      code: this.sessionCode,
      role: this.role,
    });

    this.sessionCode = null;
    this.role = null;
  }

  broadcastRoll(roll) {
    if (!this.socket || !this.sessionCode) return;
    this.socket.emit('roll:broadcast', { code: this.sessionCode, roll, clientId: this.clientId });
  }

  broadcastHpUpdate(combatantName, hpCurrent, hpMax) {
    if (!this.socket || !this.sessionCode) return;
    this.socket.emit('hp:update', {
      code: this.sessionCode,
      combatant_name: combatantName,
      hp_current: hpCurrent,
      hp_max: hpMax,
      clientId: this.clientId,
    });
  }

  broadcastInitiativeSync(combatants) {
    if (!this.socket || !this.sessionCode) return;
    this.socket.emit('initiative:sync', {
      code: this.sessionCode,
      combatants,
      clientId: this.clientId,
    });
  }

  disconnect() {
    if (this.socket) {
      this.leaveSession();
      this.socket.disconnect();
      this.socket = null;
      this.connected = false;
    }
  }

  on(event, callback) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(callback);
    return () => {
      this.listeners[event] = this.listeners[event].filter(cb => cb !== callback);
    };
  }

  _emit(event, data) {
    if (this.listeners[event]) {
      this.listeners[event].forEach(cb => cb(data));
    }
  }
}

// Singleton instance
const relayClient = new RelayClient();

module.exports = relayClient;
