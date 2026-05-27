'use strict';

const { io } = require('socket.io-client');

const RELAY_URL = 'http://34.31.125.161:3000';

let socket = null;
let currentSession = null;

function connect() {
  if (socket) return socket;

  socket = io(RELAY_URL, {
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
    transports: ['websocket', 'polling'],
  });

  socket.on('connect', () => {
    console.log('[Relay] Connected to relay server');
  });

  socket.on('disconnect', () => {
    console.log('[Relay] Disconnected from relay server');
  });

  socket.on('connect_error', (error) => {
    console.error('[Relay] Connection error:', error.message);
  });

  return socket;
}

function joinSession(sessionCode, role, dmName = null) {
  if (!socket) connect();

  currentSession = { code: sessionCode, role };

  const payload = { code: sessionCode, role };
  if (dmName) payload.dmName = dmName;

  socket.emit('session:join', payload);
  console.log(`[Relay] Joined session ${sessionCode} as ${role}`);

  return currentSession;
}

function leaveSession() {
  if (!socket || !currentSession) return;

  socket.emit('session:leave', {
    code: currentSession.code,
    role: currentSession.role,
  });

  currentSession = null;
  console.log('[Relay] Left session');
}

function broadcastRoll(roll) {
  if (!socket || !currentSession) return;

  socket.emit('roll:broadcast', {
    code: currentSession.code,
    roll,
  });
}

function broadcastHpUpdate(combatantName, hpCurrent) {
  if (!socket || !currentSession) return;

  socket.emit('hp:update', {
    code: currentSession.code,
    combatant_name: combatantName,
    hp_current: hpCurrent,
  });
}

function broadcastInitiativeSync(combatants) {
  if (!socket || !currentSession) return;

  socket.emit('initiative:sync', {
    code: currentSession.code,
    combatants,
  });
}

function onRollBroadcast(callback) {
  if (!socket) connect();
  socket.on('roll:broadcast', callback);
}

function onHpUpdate(callback) {
  if (!socket) connect();
  socket.on('hp:update', callback);
}

function onInitiativeSync(callback) {
  if (!socket) connect();
  socket.on('initiative:sync', callback);
}

function onPlayerJoined(callback) {
  if (!socket) connect();
  socket.on('player:joined', callback);
}

function onPlayerLeft(callback) {
  if (!socket) connect();
  socket.on('player:left', callback);
}

function disconnect() {
  if (socket) {
    socket.disconnect();
    socket = null;
    currentSession = null;
    console.log('[Relay] Relay client disconnected');
  }
}

module.exports = {
  connect,
  joinSession,
  leaveSession,
  broadcastRoll,
  broadcastHpUpdate,
  broadcastInitiativeSync,
  onRollBroadcast,
  onHpUpdate,
  onInitiativeSync,
  onPlayerJoined,
  onPlayerLeft,
  disconnect,
};
