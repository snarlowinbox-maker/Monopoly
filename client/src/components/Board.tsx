import { useEffect, useRef, useState } from 'react';
import { BOARD, COLORS, type GameState, type GameEvent } from '@monopoly/shared';

interface Props {
  state: GameState;
  myId: string;
  events: { evt: GameEvent; at: number }[];
}

/** Return CSS grid cell + orientation for board index i. */
function gridPos(i: number): { row: number; col: number; orient: 'bottom' | 'left' | 'top' | 'right' } {
  if (i <= 10)  return { row: 11, col: 11 - i, orient: 'bottom' };
  if (i <= 20)  return { row: 21 - i, col: 1, orient: 'left' };
  if (i <= 30)  return { row: 1, col: i - 19, orient: 'top' };
  return { row: i - 29, col: 11, orient: 'right' };
}

const FACES = ['⚀','⚁','⚂','⚃','⚄','⚅'];

export default function Board({ state, myId, events }: Props) {
  const boardRef = useRef<HTMLDivElement>(null);
  const [die1, setDie1] = useState(1);
  const [die2, setDie2] = useState(1);
  const [rolling, setRolling] = useState(false);
  const [landedIndex, setLandedIndex] = useState<number | null>(null);
  const [floats, setFloats] = useState<{id:number;text:string;x:number;y:number;color:string}[]>([]);
  const [tokenBounce, setTokenBounce] = useState<Record<string, number>>({});

  /** Play visual effects for each event as it arrives. */
  useEffect(() => {
    if (!events.length) return;
    const { evt } = events[events.length - 1];
    switch (evt.type) {
      case 'dice': {
        setRolling(true);
        let n = 0;
        const iv = setInterval(() => {
          setDie1(1 + Math.floor(Math.random() * 6));
          setDie2(1 + Math.floor(Math.random() * 6));
          if (++n > 8) {
            clearInterval(iv);
            setDie1(evt.d1);
            setDie2(evt.d2);
            setRolling(false);
          }
        }, 60);
        break;
      }
      case 'money': {
        const player = state.players.find(p => p.id === evt.playerId);
        if (player) {
          const cellEl = boardRef.current?.querySelector(`.cell[data-idx="${player.position}"]`) as HTMLElement | null;
          if (cellEl) {
            const rect = cellEl.getBoundingClientRect();
            const boardRect = boardRef.current!.getBoundingClientRect();
            const x = rect.left - boardRect.left + rect.width / 2;
            const y = rect.top - boardRect.top + rect.height / 2;
            const text = (evt.delta > 0 ? '+' : '') + '$' + Math.abs(evt.delta);
            const color = evt.delta > 0 ? '#5ddc8a' : '#ff7b6b';
            const id = Math.random();
            setFloats(f => [...f, { id, text, x, y, color }]);
            setTimeout(() => setFloats(f => f.filter(fl => fl.id !== id)), 1400);
          }
        }
        break;
      }
      case 'move': {
        setLandedIndex(evt.to);
        setTimeout(() => setLandedIndex(null), 500);
        setTokenBounce(b => ({ ...b, [evt.playerId]: Date.now() }));
        break;
      }
      case 'build': {
        setLandedIndex(evt.propId);
        setTimeout(() => setLandedIndex(null), 600);
        break;
      }
    }
  }, [events, state.players]);

  /** Compute absolute pixel positions for a player's token. */
  function tokenPos(playerIdx: number): { left: number; top: number; size: number } {
    const p = state.players[playerIdx];
    const { row, col } = gridPos(p.position);
    const cell = 100 / 11;
    // Same-square players are fanned out a bit
    const sameCell = state.players
      .map((pl, i) => ({ id: pl.id, i }))
      .filter(o => state.players[o.i].position === p.position && state.players[o.i].connected);
    const rank = sameCell.findIndex(o => o.i === playerIdx);
    const n = sameCell.length;
    const offsetX = n > 1 ? (rank - (n - 1) / 2) * 3.2 : 0;
    const offsetY = n > 1 ? ((rank % 2) ? 2.5 : -2.5) : 0;
    const size = 3.2; // % of board
    return {
      left: (col - 1) * cell + cell / 2 - size / 2 + offsetX,
      top:  (row - 1) * cell + cell / 2 - size / 2 + offsetY,
      size,
    };
  }

  const currentPlayer = state.players[state.currentPlayerIndex];

  return (
    <div className="board" ref={boardRef}>
      {/* 40 board cells */}
      {BOARD.map((sp, i) => {
        const { row, col, orient } = gridPos(i);
        const isCorner = i === 0 || i === 10 || i === 20 || i === 30;
        const ownerId = state.board.owner[i];
        const owner = ownerId ? state.players.find(p => p.id === ownerId) : null;
        const houses = state.board.houses[i] || 0;
        const mortgaged = state.board.mortgaged[i];
        const isCurrent = currentPlayer && currentPlayer.position === i && currentPlayer.connected;

        return (
          <div
            key={i}
            data-idx={i}
            className={`cell ${orient} ${isCorner ? 'corner' : ''} ${mortgaged ? 'mortgaged' : ''} ${
              isCurrent ? 'current' : ''} ${landedIndex === i ? 'landed' : ''}`}
            style={{
              gridRow: row, gridColumn: col,
              boxShadow: owner ? `inset 0 0 0 3px ${owner.color}` : undefined,
            }}
          >
            {sp.t === 'prop' && <div className="bar" style={{ background: COLORS[sp.group!] }}/>}
            {sp.t === 'rr' && <div className="bar" style={{ background: '#1b1b1b' }}/>}
            {sp.t === 'util' && <div className="bar" style={{ background: '#1b1b1b' }}/>}

            {houses > 0 && (
              <div className="houses">
                {houses === 5
                  ? <i className="hotel"/>
                  : Array.from({ length: houses }).map((_, k) => <i key={k}/>)
                }
              </div>
            )}

            <div className="body">
              {sp.t === 'go' && (<><div className="name" style={{fontSize:'1.6em',color:'#c0392b'}}>GO</div><div className="price">Collect $200</div></>)}
              {sp.t === 'jail' && (<><div className="icon">🚔</div><div className="name">In Jail</div><div className="price">Just Visiting</div></>)}
              {sp.t === 'free' && (<><div className="icon">🅿️</div><div className="name">Free</div><div className="name">Parking</div></>)}
              {sp.t === 'gotojail' && (<><div className="name" style={{color:'#c0392b'}}>Go To</div><div className="name" style={{color:'#c0392b'}}>Jail</div><div className="icon">➡</div></>)}
              {sp.t === 'chance' && (<><div className="icon" style={{color:'#e05a6a'}}>❓</div><div className="name">Chance</div></>)}
              {sp.t === 'chest' && (<><div className="icon" style={{color:'#3a86c8'}}>📦</div><div className="name">Community Chest</div></>)}
              {sp.t === 'tax' && (<><div className="icon">💸</div><div className="name">{sp.name}</div><div className="price">Pay ${sp.amount}</div></>)}
              {sp.t === 'rr' && (<><div className="icon">🚂</div><div className="name">{sp.name.replace(' Railroad', '')}</div><div className="price">${sp.price}</div></>)}
              {sp.t === 'util' && (<><div className="icon">{i === 12 ? '💡' : '🚰'}</div><div className="name">{sp.name}</div><div className="price">${sp.price}</div></>)}
              {sp.t === 'prop' && (<><div className="name">{sp.name}</div><div className="price">${sp.price}</div></>)}
            </div>
          </div>
        );
      })}

      {/* Board center: title + dice */}
      <div className="board-center">
        <div className="title">MONOPOLY</div>
        <div className="dice">
          <div className={`die ${rolling ? 'rolling' : ''}`}>{FACES[die1 - 1]}</div>
          <div className={`die ${rolling ? 'rolling' : ''}`}>{FACES[die2 - 1]}</div>
        </div>
        <div className="status">
          {state.phase === 'ended'
            ? 'Game Over'
            : currentPlayer
              ? `${currentPlayer.name} — ${state.turnPhase === 'roll' ? 'roll the dice' : state.turnPhase === 'endturn' ? 'end your turn' : '…'}`
              : ''}
        </div>
      </div>

      {/* Player tokens */}
      {state.players.map((p, i) => {
        if (p.bankrupt || !p.connected) return null;
        const pos = tokenPos(i);
        const bounceKey = tokenBounce[p.id] || 0;
        return (
          <div
            key={`${p.id}-${bounceKey}`}
            className="token"
            style={{
              left: `${pos.left}%`,
              top: `${pos.top}%`,
              width: `${pos.size}%`,
              height: `${pos.size}%`,
              background: p.color,
              fontSize: `calc(${pos.size}% * 0.5)`,
            }}
          >
            {p.name[0].toUpperCase()}
          </div>
        );
      })}

      {/* Floating money / status text */}
      {floats.map(f => (
        <div
          key={f.id}
          className="float-text"
          style={{ left: f.x, top: f.y, color: f.color }}
        >
          {f.text}
        </div>
      ))}
    </div>
  );
}