import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { fmt } from './lib.js';

const paths = {
  home: <><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></>,
  list: <><path d="M8 6h13" /><path d="M8 12h13" /><path d="M8 18h13" /><path d="M3 6h.01" /><path d="M3 12h.01" /><path d="M3 18h.01" /></>,
  chart: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
  scale: <><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M8 9a5 5 0 0 1 8 0" /><path d="m12 10 1.5-2" /></>,
  gear: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>,
  mic: <><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0" /><path d="M12 17v4" /></>,
  stop: <rect x="6" y="6" width="12" height="12" rx="2" />,
  plus: <><path d="M12 5v14" /><path d="M5 12h14" /></>,
  minus: <path d="M5 12h14" />,
  close: <><path d="M18 6 6 18" /><path d="m6 6 12 12" /></>,
  trash: <><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /></>,
  drop: <path d="M12 2.7S5 10 5 14.5a7 7 0 0 0 14 0C19 10 12 2.7 12 2.7z" />,
  glass: <><path d="M7 3h10l-1 9a4 4 0 0 1-8 0z" /><path d="M12 16v5" /><path d="M8 21h8" /></>,
  ruler: <><path d="M3 17 17 3l4 4L7 21z" /><path d="m7 13 2 2" /><path d="m10 10 2 2" /><path d="m13 7 2 2" /></>,
  sparkle: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><path d="m6 6 2 2M16 16l2 2M6 18l2-2M16 8l2-2" /></>,
  bell: <><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" /></>,
  edit: <><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></>,
  left: <path d="m15 18-6-6 6-6" />,
  check: <path d="M20 6 9 17l-5-5" />,
  run: <><circle cx="14" cy="4" r="2" /><path d="m6 20 3-5 3 2 1-5 3 3h3" /><path d="m8 9 4-2 3 2" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>
};

export function Icon({ name, size = 24, ...rest }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
      {paths[name]}
    </svg>
  );
}

export function PageHead({ title, sub, children }) {
  return (
    <div className="pagehead">
      <div>
        {sub && <span className="muted small">{sub}</span>}
        <h1>{title}</h1>
      </div>
      {children && <div className="row gap8 wrap">{children}</div>}
    </div>
  );
}

export function Bar({ value, goal, color = 'var(--accent)', over = 'var(--warn)' }) {
  const pct = goal ? (value / goal) * 100 : 0;
  return (
    <div className="bar"><div style={{ width: Math.min(100, Math.max(0, pct)) + '%', background: pct > 105 ? over : color }} /></div>
  );
}

// Anillo de progreso para calorías.
export function Ring({ value, goal, size = 150, stroke = 14, children }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const pct = goal ? Math.min(1, value / goal) : 0;
  const over = goal && value > goal * 1.05;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--ring-track)" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={over ? 'var(--warn)' : 'var(--accent)'} strokeWidth={stroke}
          strokeLinecap="round" strokeDasharray={`${c * pct} ${c}`} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
      </svg>
      <div className="ring-in">{children}</div>
    </div>
  );
}

function useWidth() {
  const ref = useRef(null);
  const [w, setW] = useState(600);
  useLayoutEffect(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

// Gráfico de barras por día con línea de meta.
// data: [{ label, value, color? }]
export function BarChart({ data, goal, height = 190, unit = '', dec = 0, goalLabel = 'meta' }) {
  const [ref, w] = useWidth();
  const padL = 36, padB = 22, padT = 14;
  const max = Math.max(goal || 0, ...data.map((d) => d.value || 0), 1) * 1.1;
  const ih = height - padB - padT;
  const bw = (w - padL) / Math.max(1, data.length);
  const y = (v) => padT + ih - (v / max) * ih;
  const ticks = niceTicks(0, max, 3);
  const every = Math.ceil(data.length / Math.max(1, Math.floor((w - padL) / 42)));
  return (
    <div ref={ref} className="chartbox">
      <svg width={w} height={height} role="img">
        {ticks.map((t) => (
          <g key={t}><line x1={padL} x2={w} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">{fmt(t)}</text></g>
        ))}
        {data.map((d, i) => {
          const v = d.value || 0;
          const bwi = Math.max(2, Math.min(28, bw - 4));
          return (
            <g key={i}>
              {v > 0 && <rect x={padL + i * bw + (bw - bwi) / 2} y={y(v)} width={bwi} height={Math.max(1, padT + ih - y(v))} rx={Math.min(4, bwi / 3)}
                fill={d.color || (goal && v > goal * 1.05 ? 'var(--warn)' : 'var(--accent)')}><title>{`${d.label}: ${fmt(v, dec)} ${unit}`}</title></rect>}
              {i % every === 0 && <text x={padL + i * bw + bw / 2} y={height - 6} textAnchor="middle" className="axis">{d.label}</text>}
            </g>
          );
        })}
        {goal > 0 && <>
          <line x1={padL} x2={w} y1={y(goal)} y2={y(goal)} className="goal" />
          <text x={w - 2} y={y(goal) - 5} textAnchor="end" className="axis goal-t">{goalLabel} {fmt(goal)}</text>
        </>}
      </svg>
    </div>
  );
}

// Gráfico de línea en el tiempo. series: [{ points: [{t, v}], color, dots?, width? }]
export function LineChart({ series, height = 220, goal, dec = 1, unit = '' }) {
  const [ref, w] = useWidth();
  const padL = 40, padB = 22, padT = 14, padR = 10;
  const all = series.flatMap((s) => s.points);
  if (!all.length) return <div ref={ref} className="chartbox empty muted small">Todavía no hay datos.</div>;
  let t0 = Math.min(...all.map((p) => p.t)), t1 = Math.max(...all.map((p) => p.t));
  if (t1 - t0 < 864e5 * 6) { t0 -= 864e5 * 3; t1 += 864e5 * 3; }
  const vals = all.map((p) => p.v).concat(goal ? [goal] : []);
  let v0 = Math.min(...vals), v1 = Math.max(...vals);
  const padV = Math.max(0.5, (v1 - v0) * 0.12);
  v0 -= padV; v1 += padV;
  const ih = height - padB - padT, iw = w - padL - padR;
  const x = (t) => padL + ((t - t0) / (t1 - t0)) * iw;
  const y = (v) => padT + ih - ((v - v0) / (v1 - v0)) * ih;
  const ticks = niceTicks(v0, v1, 4);
  const days = (t1 - t0) / 864e5;
  const nx = Math.max(2, Math.min(6, Math.floor(iw / 70)));
  const xt = Array.from({ length: nx }, (_, i) => t0 + ((t1 - t0) * i) / (nx - 1));
  return (
    <div ref={ref} className="chartbox">
      <svg width={w} height={height} role="img">
        {ticks.map((t) => (
          <g key={t}><line x1={padL} x2={w - padR} y1={y(t)} y2={y(t)} className="grid" /><text x={padL - 6} y={y(t) + 4} textAnchor="end" className="axis">{fmt(t, Math.abs(v1 - v0) < 5 ? 1 : 0)}</text></g>
        ))}
        {xt.map((t, i) => (
          <text key={i} x={x(t)} y={height - 6} textAnchor={i === 0 ? 'start' : i === xt.length - 1 ? 'end' : 'middle'} className="axis">
            {new Date(t).toLocaleDateString('es-AR', days > 300 ? { month: 'short', year: '2-digit' } : { day: 'numeric', month: 'numeric' })}
          </text>
        ))}
        {goal && <><line x1={padL} x2={w - padR} y1={y(goal)} y2={y(goal)} className="goal" /><text x={w - padR} y={y(goal) - 5} textAnchor="end" className="axis goal-t">objetivo {fmt(goal, dec)}</text></>}
        {series.map((s, i) => (
          <g key={i}>
            {s.points.length > 1 && <polyline fill="none" stroke={s.color} strokeWidth={s.width || 2.5} strokeLinejoin="round" strokeLinecap="round"
              points={s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(' ')} />}
            {(s.dots || s.points.length === 1) && s.points.map((p, j) => (
              <circle key={j} cx={x(p.t)} cy={y(p.v)} r={s.dots ? 3 : 4} fill={s.color}><title>{`${new Date(p.t).toLocaleDateString('es-AR')}: ${fmt(p.v, dec)} ${unit}`}</title></circle>
            ))}
          </g>
        ))}
      </svg>
    </div>
  );
}

function niceTicks(min, max, n) {
  const span = max - min;
  if (span <= 0) return [min];
  const step0 = span / n;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

// ───────── Voz ─────────

const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
export const speechSupported = !!SR;

// Dictado en castellano. onFinal recibe el texto final cuando se corta.
export function useSpeech({ onText }) {
  const recRef = useRef(null);
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const [err, setErr] = useState('');
  const finalRef = useRef('');

  useEffect(() => () => recRef.current?.abort(), []);

  function start() {
    if (!SR) { setErr('Este navegador no permite dictado. Usá Chrome o escribí el texto.'); return; }
    setErr(''); setInterim(''); finalRef.current = '';
    const rec = new SR();
    rec.lang = 'es-AR';
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;
    rec.onresult = (e) => {
      let fin = '', tmp = '';
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) fin += r[0].transcript + ' ';
        else tmp += r[0].transcript;
      }
      finalRef.current = fin;
      setInterim((fin + tmp).trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') setErr('No hay permiso para usar el micrófono. Habilitalo en el candado de la barra de direcciones.');
      else if (e.error === 'no-speech') setErr('No te escuché. Probá de nuevo, más cerca del micrófono.');
      else if (e.error !== 'aborted') setErr('Error de dictado: ' + e.error);
    };
    rec.onend = () => {
      setListening(false);
      const text = (finalRef.current || '').trim() || interimRef.current;
      if (text) onText(text);
      setInterim('');
    };
    recRef.current = rec;
    rec.start();
    setListening(true);
  }
  const interimRef = useRef('');
  interimRef.current = interim;

  function stop() { recRef.current?.stop(); }
  return { listening, interim, err, start, stop };
}
