import { useState } from 'react';
import { socket } from '../socket';
import type { GameState } from '@monopoly/shared';

interface Props {
  onJoined: (code: string, playerId: string) => void;
  state: GameState | null;
  myId: string | null;
  roomCode: string | null;
}

export default function Lobby({ onJoined, state, myId, roomCode }: Props) {
  const [name, setName] = useState('');
  const [joinCode, setJoinCode] = useState('');
  const [mode, setMode] = useState<'home' | 'host' | 'join'>('home');
  const [err, setErr] = useState('');

  const storedName = sessionStorage.getItem('mono_name') || '';
  const effectiveName = name || storedName || 'Player';

  const remember = (n: string) => {
    setName(n);
    sessionStorage.setItem('mono_name', n);
  };

  const host = () => {
    socket.emit('createRoom', { name: effectiveName }, (res: any) => {
      if (!res.ok) return setErr(res.error);
      sessionStorage.setItem('mono_session', JSON.stringify({ code: res.code, name: effectiveName }));
      onJoined(res.code, res.playerId);
      setMode('host');
    });
  };

  const join = () => {
    const code = joinCode.trim().toUpperCase();
    if (code.length !== 6) return setErr('Enter a 6-character room code');
    socket.emit('joinRoom', { code, name: effectiveName }, (res: any) => {
      if (!res.ok) return setErr(res.error);
      sessionStorage.setItem('mono_session', JSON.stringify({ code: res.code, name: effectiveName }));
      onJoined(res.code, res.playerId);
    });
  };

  // If we already joined a room, show lobby waiting view
  if (roomCode && state && state.roomCode === roomCode) {
    const isHost = state.players[0]?.id === myId;
    const canStart = state.players.length === 3;
    return (
      <div className="lobby">
        <h1>MONOPOLY</h1>
        <div className="subtitle">3-Player Online</div>

        <div className="lobby-panel">
          <h2>Room Code</h2>
          <div className="code-display">{roomCode}</div>
          <div className="hint">Share this code with two friends. They'll enter it on the join screen.</div>

          <div style={{height:16}}/>

          <h2>Players ({state.players.length}/3)</h2>
          <div className="slots">
            {[0, 1, 2].map(i => {
              const p = state.players[i];
              return (
                <div key={i} className={`slot ${p ? 'filled' : ''}`}>
                  {p ? (
                    <>
                      <div className="dot" style={{background: p.color}}/>
                      <div>{p.name}</div>
                      {!p.connected && <div style={{color:'#e05252',fontSize:10}}>reconnecting…</div>}
                    </>
                  ) : (
                    <div>Waiting…</div>
                  )}
                </div>
              );
            })}
          </div>

          {isHost ? (
            <button
              className="btn primary"
              disabled={!canStart}
              onClick={() => socket.emit('startGame')}
            >
              {canStart ? 'Start Game' : `Waiting for ${3 - state.players.length} more…`}
            </button>
          ) : (
            <div className="hint" style={{textAlign:'center',padding:'14px 0'}}>
              Waiting for the host to start the game…
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="lobby">
      <h1>MONOPOLY</h1>
      <div className="subtitle">3-Player Online · Atlantic City</div>

      <div className="lobby-panel">
        {mode === 'home' && (
          <>
            <h2>Your Name</h2>
            <input
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={e => remember(e.target.value)}
              maxLength={16}
            />
            <button className="btn primary" onClick={() => setMode('host')}>
              Create Room
            </button>
            <div className="divider">— or —</div>
            <button className="btn ghost" onClick={() => setMode('join')}>
              Join Room
            </button>
          </>
        )}

        {mode === 'host' && (
          <>
            <h2>Host a Room</h2>
            <p className="hint" style={{marginTop:0}}>
              You'll be the host. We'll generate a room code you can share with your friends.
            </p>
            <button className="btn primary" onClick={host}>
              Create Room
            </button>
            <div style={{height:10}}/>
            <button className="btn ghost" onClick={() => setMode('home')}>
              Back
            </button>
          </>
        )}

        {mode === 'join' && (
          <>
            <h2>Join a Room</h2>
            <input
              type="text"
              placeholder="Your name"
              value={name}
              onChange={e => remember(e.target.value)}
              maxLength={16}
            />
            <div className="join-row">
              <input
                type="text"
                placeholder="CODE"
                value={joinCode}
                onChange={e => setJoinCode(e.target.value.toUpperCase())}
                maxLength={6}
              />
              <button className="btn primary" onClick={join}>Join</button>
            </div>
            <div style={{height:10}}/>
            <button className="btn ghost" onClick={() => setMode('home')}>
              Back
            </button>
          </>
        )}

        {err && <div className="hint" style={{color:'#ff7b6b',marginTop:12,textAlign:'center'}}>{err}</div>}
      </div>
    </div>
  );
}