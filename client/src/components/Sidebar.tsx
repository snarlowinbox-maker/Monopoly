import { useState } from 'react';
import { BOARD, COLORS, type GameState } from '@monopoly/shared';
import { socket } from '../socket';

interface Props { state: GameState; myId: string }

export default function Sidebar({ state, myId }: Props) {
  const me = state.players.find(p => p.id === myId);
  const current = state.players[state.currentPlayerIndex];
  const myTurn = current?.id === myId;

  const [showManage, setShowManage] = useState(false);
  const [showTrade, setShowTrade] = useState(false);

  const myProps = state.board.owner
    .map((o, i) => (o === myId ? i : -1))
    .filter(i => i >= 0);

  const canAct = myTurn && state.turnPhase !== 'action';

  return (
    <aside className="sidebar">
      <div className="panel">
        <h3>Players</h3>
        <div id="players-list">
          {state.players.map((p, i) => {
            const props = state.board.owner
              .map((o, idx) => (o === p.id ? idx : -1))
              .filter(idx => idx >= 0);
            return (
              <div key={p.id} className={`pcard ${i === state.currentPlayerIndex ? 'active' : ''} ${p.bankrupt ? 'bankrupt' : ''}`}>
                <div className="head">
                  <div className="dot" style={{ background: p.color }}>{p.name[0].toUpperCase()}</div>
                  <div className="info">
                    <div className="name">
                      {p.name}{p.id === myId ? ' (you)' : ''}
                      {p.jail ? ' 🚔' : ''}
                      {p.jailCards > 0 ? ` 🎟️×${p.jailCards}` : ''}
                    </div>
                    <div className="meta">
                      {p.bankrupt ? 'Bankrupt' : BOARD[p.position].name}
                    </div>
                  </div>
                  <div className={`money ${p.money < 100 ? 'low' : ''}`}>${p.money}</div>
                </div>
                {props.length > 0 && (
                  <div className="props">
                    {props.map(i => {
                      const sp = BOARD[i];
                      const col = sp.group ? COLORS[sp.group] : '#888';
                      return (
                        <span
                          key={i}
                          className={`chip ${state.board.mortgaged[i] ? 'mort' : ''}`}
                          style={{ borderLeftColor: col }}
                        >
                          {sp.name}
                          {(state.board.houses[i] || 0) > 0 ? ` · ${state.board.houses[i] === 5 ? 'H' : state.board.houses[i] + 'h'}` : ''}
                        </span>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="action-panel">
        <h3 style={{fontSize:11,letterSpacing:'.16em',textTransform:'uppercase',color:'#6d7d95',margin:'0 0 10px',fontWeight:800}}>
          {myTurn ? 'Your Actions' : `Waiting for ${current?.name ?? '…'}`}
        </h3>

        {myTurn && (
          <div style={{ display:'flex', flexDirection:'column', gap:8 }}>
            {state.turnPhase === 'roll' && (
              <>
                {me?.jail ? (
                  <>
                    <button className="btn primary full" onClick={() => socket.emit('roll')}>
                      🎲 Roll for Doubles
                    </button>
                    <div className="btn-row">
                      <button
                        className="btn"
                        disabled={!me || me.money < 50}
                        onClick={() => socket.emit('payFine')}
                      >Pay $50 Fine</button>
                      <button
                        className="btn green"
                        disabled={!me || me.jailCards <= 0}
                        onClick={() => socket.emit('useJailCard')}
                      >Use Card</button>
                    </div>
                  </>
                ) : (
                  <button className="btn primary full" onClick={() => socket.emit('roll')}>
                    🎲 Roll Dice
                  </button>
                )}
              </>
            )}

            {state.turnPhase === 'endturn' && (
              <button className="btn primary full" onClick={() => socket.emit('endTurn')}>
                End Turn ➡
              </button>
            )}

            <div className="btn-row">
              <button className="btn sm" onClick={() => setShowManage(true)}>
                🏠 Properties
              </button>
              <button
                className="btn sm"
                onClick={() => setShowTrade(true)}
                disabled={state.phase !== 'playing'}
              >
                🤝 Trade
              </button>
            </div>
          </div>
        )}

        {!myTurn && (
          <div style={{ color:'#7c8aa5', fontSize:12, textAlign:'center', padding:'10px 0' }}>
            {current?.bankrupt ? 'Advancing…' : `${current?.name} is playing…`}
          </div>
        )}
      </div>

      <div className="log-panel panel">
        <h3>Game Log</h3>
        <div id="log">
          {state.log.map((line, i) => <div key={i}>{line}</div>)}
        </div>
      </div>

      {showManage && <ManageModal state={state} myId={myId} onClose={() => setShowManage(false)} />}
      {showTrade && <TradeModal state={state} myId={myId} onClose={() => setShowTrade(false)} />}
    </aside>
  );
}

/* ---------- Manage Modal ---------- */

function ManageModal({ state, myId, onClose }: { state: GameState; myId: string; onClose: () => void }) {
  const myProps = state.board.owner
    .map((o, i) => (o === myId ? i : -1))
    .filter(i => i >= 0);
  const me = state.players.find(p => p.id === myId)!;

  const groups: Record<string, number[]> = {};
  for (const i of myProps) {
    const sp = BOARD[i];
    const key = sp.group ?? (sp.t === 'rr' ? 'rr' : sp.t === 'util' ? 'util' : 'other');
    (groups[key] ||= []).push(i);
  }

  const groupOrder = ['brown','lblue','pink','orange','red','yellow','green','dblue','rr','util'];

  const canBuild = (i: number) => {
    const sp = BOARD[i];
    if (sp.t !== 'prop' || state.board.mortgaged[i]) return false;
    const gi = BOARD.map((s, idx) => (s.group === sp.group ? idx : -1)).filter(idx => idx >= 0);
    if (!gi.every(x => state.board.owner[x] === myId)) return false;
    if (gi.some(x => state.board.mortgaged[x])) return false;
    const h = state.board.houses[i] || 0;
    if (h >= 5) return false;
    const minH = Math.min(...gi.map(x => state.board.houses[x] || 0));
    if (h > minH) return false;
    return me.money >= (sp.house ?? 0);
  };

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">🏠 Property Manager — {me.name}</div>
        <div className="modal-body">
          <div style={{ display:'flex', justifyContent:'space-between', marginBottom:14, fontSize:13 }}>
            <span>Cash: <b style={{ color:'#5ddc8a' }}>${me.money}</b></span>
            <span>{myProps.length} propert{myProps.length === 1 ? 'y' : 'ies'}</span>
          </div>

          {myProps.length === 0 && (
            <div style={{ color:'#7c8aa5', textAlign:'center', padding:20 }}>You don't own any properties yet.</div>
          )}

          {groupOrder.map(g => groups[g] && (
            <div key={g}>
              <div className="grpTitle" style={{ color: COLORS[g] || '#888' }}>
                {g === 'rr' ? 'Railroads' : g === 'util' ? 'Utilities' : g.toUpperCase()}
              </div>
              <div className="propGrid">
                {groups[g].map(i => {
                  const sp = BOARD[i];
                  const h = state.board.houses[i] || 0;
                  const mort = state.board.mortgaged[i];
                  return (
                    <div key={i} className="pitem" style={{ borderLeftColor: COLORS[sp.group!] || '#888' }}>
                      <div className="t">{sp.name}</div>
                      <div className="s">
                        {h === 5 ? '🏨 Hotel' : h > 0 ? '🏠'.repeat(h) : 'No buildings'}
                        {mort && ' · MORTGAGED'}
                      </div>
                      <div className="acts">
                        {canBuild(i) && (
                          <button className="btn sm green" onClick={() => socket.emit('build', { propId: i })}>
                            Build ${sp.house}
                          </button>
                        )}
                        {h > 0 && (
                          <button className="btn sm" onClick={() => socket.emit('sell', { propId: i })}>
                            Sell +${(sp.house ?? 0) / 2}
                          </button>
                        )}
                        {!mort && h === 0 && (
                          <button className="btn sm" onClick={() => socket.emit('mortgage', { propId: i })}>
                            Mortgage +${sp.mort}
                          </button>
                        )}
                        {mort && (
                          <button
                            className="btn sm green"
                            disabled={me.money < Math.ceil((sp.mort ?? 0) * 1.1)}
                            onClick={() => socket.emit('unmortgage', { propId: i })}
                          >
                            Unmortgage ${Math.ceil((sp.mort ?? 0) * 1.1)}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn primary" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

/* ---------- Trade Modal ---------- */

function TradeModal({ state, myId, onClose }: { state: GameState; myId: string; onClose: () => void }) {
  const me = state.players.find(p => p.id === myId)!;
  const others = state.players.filter(p => p.id !== myId && !p.bankrupt);
  const [partnerId, setPartnerId] = useState(others[0]?.id ?? '');
  const partner = state.players.find(p => p.id === partnerId);
  const [offProps, setOffProps] = useState<Set<number>>(new Set());
  const [reqProps, setReqProps] = useState<Set<number>>(new Set());
  const [offMoney, setOffMoney] = useState(0);
  const [reqMoney, setReqMoney] = useState(0);
  const [offCards, setOffCards] = useState(0);
  const [reqCards, setReqCards] = useState(0);

  if (!partner) return null;

  const myTradable = state.board.owner
    .map((o, i) => (o === myId && (state.board.houses[i] || 0) === 0 ? i : -1))
    .filter(i => i >= 0);
  const theirTradable = state.board.owner
    .map((o, i) => (o === partnerId && (state.board.houses[i] || 0) === 0 ? i : -1))
    .filter(i => i >= 0);

  const toggle = (set: Set<number>, id: number, updater: (s: Set<number>) => void) => {
    const next = new Set(set);
    next.has(id) ? next.delete(id) : next.add(id);
    updater(next);
  };

  const propose = () => {
    socket.emit('proposeTrade', {
      toId: partnerId,
      offer:   { money: offMoney, props: [...offProps], jailCards: offCards },
      request: { money: reqMoney, props: [...reqProps], jailCards: reqCards },
    });
    onClose();
  };

  const renderList = (indices: number[], sel: Set<number>, updater: (s: Set<number>) => void) => (
    indices.length === 0
      ? <div style={{ padding:6, color:'#6d7d95', fontSize:11 }}>No tradable properties</div>
      : indices.map(i => {
          const sp = BOARD[i];
          const col = sp.group ? COLORS[sp.group] : '#888';
          return (
            <label key={i}>
              <input
                type="checkbox"
                checked={sel.has(i)}
                onChange={() => toggle(sel, i, updater)}
              />
              <span style={{ borderLeft: `4px solid ${col}`, paddingLeft: 5 }}>
                {sp.name}
                {state.board.mortgaged[i] ? ' (M)' : ''}
              </span>
            </label>
          );
        })
  );

  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-head">🤝 Propose Trade</div>
        <div className="modal-body">
          <div style={{ marginBottom: 14 }}>
            <label style={{ fontSize: 12, color: '#9fb0c8', display: 'block', marginBottom: 6 }}>
              Trade with
            </label>
            <select value={partnerId} onChange={e => { setPartnerId(e.target.value); setReqProps(new Set()); setReqMoney(0); setReqCards(0); }}>
              {others.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          <div className="tradeCols">
            <div>
              <h4>{me.name} gives</h4>
              <div className="tradeList">{renderList(myTradable, offProps, setOffProps)}</div>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: '#9fb0c8' }}>Cash (max ${me.money})</label>
                <input
                  type="number"
                  min={0}
                  max={me.money}
                  value={offMoney}
                  onChange={e => setOffMoney(Math.max(0, Math.min(me.money, +e.target.value || 0)))}
                />
              </div>
              {me.jailCards > 0 && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: '#9fb0c8' }}>Jail cards (max {me.jailCards})</label>
                  <input
                    type="number"
                    min={0}
                    max={me.jailCards}
                    value={offCards}
                    onChange={e => setOffCards(Math.max(0, Math.min(me.jailCards, +e.target.value || 0)))}
                  />
                </div>
              )}
            </div>
            <div>
              <h4>{partner.name} gives</h4>
              <div className="tradeList">{renderList(theirTradable, reqProps, setReqProps)}</div>
              <div style={{ marginTop: 10 }}>
                <label style={{ fontSize: 11, color: '#9fb0c8' }}>Cash (max ${partner.money})</label>
                <input
                  type="number"
                  min={0}
                  max={partner.money}
                  value={reqMoney}
                  onChange={e => setReqMoney(Math.max(0, Math.min(partner.money, +e.target.value || 0)))}
                />
              </div>
              {partner.jailCards > 0 && (
                <div style={{ marginTop: 8 }}>
                  <label style={{ fontSize: 11, color: '#9fb0c8' }}>Jail cards (max {partner.jailCards})</label>
                  <input
                    type="number"
                    min={0}
                    max={partner.jailCards}
                    value={reqCards}
                    onChange={e => setReqCards(Math.max(0, Math.min(partner.jailCards, +e.target.value || 0)))}
                  />
                </div>
              )}
            </div>
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button
            className="btn primary"
            disabled={!offProps.size && !reqProps.size && !offMoney && !reqMoney && !offCards && !reqCards}
            onClick={propose}
          >Send Offer</button>
        </div>
      </div>
    </div>
  );
}