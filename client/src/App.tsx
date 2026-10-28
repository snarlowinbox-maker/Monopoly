import { useEffect, useState } from 'react';
import { socket } from './socket';
import type { GameState, GameEvent } from '@monopoly/shared';
import Lobby from './components/Lobby';
import Board from './components/Board';
import Sidebar from './components/Sidebar';
import Modals from './components/Modals';
import { sfx } from './sound';

interface EventItem { evt: GameEvent; at: number }

export default function App() {
  const [state, setState] = useState<GameState | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState<string | null>(null);
  const [events, setEvents] = useState<EventItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onState = (s: GameState) => setState(s);
    const onEvent = (evt: GameEvent) => {
      setEvents(prev => [...prev.slice(-20), { evt, at: Date.now() }]);
      // Sound cues
      switch (evt.type) {
        case 'dice': sfx.dice(); break;
        case 'buy': sfx.buy(); break;
        case 'build': sfx.build(); break;
        case 'card': sfx.card(); break;
        case 'jail': sfx.jail(); break;
        case 'money': if (evt.delta > 0) sfx.cash(); break;
        case 'rent': sfx.cash(); break;
        case 'turn': sfx.turn(); break;
      }
    };
    const onError = (msg: string) => {
      setError(msg);
      setTimeout(() => setError(null), 3500);
    };
    socket.on('state', onState);
    socket.on('event', onEvent);
    socket.on('error', onError);

    socket.on('connect', () => {
      // Attempt reconnect if we have a stored session in this browser
      const saved = sessionStorage.getItem('mono_session');
      if (saved) {
        const { code, name } = JSON.parse(saved);
        socket.emit('joinRoom', { code, name }, (res: any) => {
          if (res.ok) { setRoomCode(res.code); setMyId(res.playerId); }
        });
      }
    });

    return () => {
      socket.off('state', onState);
      socket.off('event', onEvent);
      socket.off('error', onError);
    };
  }, []);

  // Wait for game to end — celebrate
  useEffect(() => {
    if (state?.winner) sfx.win();
  }, [state?.winner]);

  const handleJoined = (code: string, playerId: string) => {
    setRoomCode(code);
    setMyId(playerId);
  };

  const inGame = state && state.phase !== 'lobby';

  return (
    <div className="app">
      {!inGame && (
        <Lobby
          onJoined={handleJoined}
          state={state}
          myId={myId}
          roomCode={roomCode}
        />
      )}

      {inGame && state && myId && (
        <>
          <div className="board-wrap">
            <Board state={state} myId={myId} events={events} />
          </div>
          <Sidebar state={state} myId={myId} />
          <Modals state={state} myId={myId} />
        </>
      )}

      {error && <div className="toast error">{error}</div>}
    </div>
  );
}