import { NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { useStore } from './store.jsx';
import { configured } from './supabase.js';
import { Icon } from './ui.jsx';
import Login from './pages/Login.jsx';
import Profile from './pages/Profile.jsx';
import Today from './pages/Today.jsx';
import MealForm from './pages/MealForm.jsx';
import History from './pages/History.jsx';
import Body from './pages/Body.jsx';
import Reports from './pages/Reports.jsx';
import Settings from './pages/Settings.jsx';

const NAV = [
  { to: '/', label: 'Hoy', icon: 'home', end: true },
  { to: '/comidas', label: 'Comidas', icon: 'list' },
  { to: '/cuerpo', label: 'Cuerpo', icon: 'scale' },
  { to: '/informes', label: 'Informes', icon: 'chart' },
  { to: '/ajustes', label: 'Ajustes', icon: 'gear' }
];

export default function App() {
  const { session, profile, error } = useStore();
  const loc = useLocation();
  const nav = useNavigate();

  if (!configured) {
    return <div className="center-screen"><div className="card narrow"><h1>Falta conectar Supabase</h1><p className="muted">Completá <code>src/config.js</code>.</p></div></div>;
  }
  if (session === undefined || (session && profile === undefined)) {
    return <div className="center-screen"><span className="muted">Cargando…</span></div>;
  }
  if (!session) return <Login />;
  if (profile === null) {
    return (
      <div className="content noform-nav">
        {error && <div className="alert">{error}</div>}
        <Profile first />
      </div>
    );
  }

  const isForm = loc.pathname.startsWith('/registrar') || loc.pathname.startsWith('/comida/');

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><img className="brandimg" src="./icon.svg" alt="" /><span>Registro Corporal</span></div>
        <button type="button" className="btn primary sideadd" onClick={() => nav('/registrar?voz=1')}><Icon name="mic" size={20} />Registrar</button>
        <nav className="sidenav">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'sidelink' + (isActive ? ' active' : '')}>
              <Icon name={n.icon} size={20} />{n.label}
            </NavLink>
          ))}
        </nav>
        <span className="sidefoot">{profile?.display_name}</span>
      </aside>

      <main className={'content' + (isForm ? ' noform-nav' : '')}>
        {error && <div className="alert">{error}</div>}
        <Routes>
          <Route path="/" element={<Today />} />
          <Route path="/registrar" element={<MealForm />} />
          <Route path="/comida/:id" element={<MealForm />} />
          <Route path="/comidas" element={<History />} />
          <Route path="/cuerpo" element={<Body />} />
          <Route path="/informes" element={<Reports />} />
          <Route path="/ajustes" element={<Settings />} />
          <Route path="/perfil" element={<Profile />} />
          <Route path="*" element={<Today />} />
        </Routes>
      </main>

      {!isForm && (
        <>
          <button type="button" className="fab" aria-label="Registrar por voz" onClick={() => nav('/registrar?voz=1')}>
            <Icon name="mic" size={28} />
          </button>
          <nav className="bottomnav">
            {NAV.map((n) => (
              <NavLink key={n.to} to={n.to} end={n.end} className={({ isActive }) => 'bottomlink' + (isActive ? ' active' : '')}>
                <Icon name={n.icon} size={22} />{n.label}
              </NavLink>
            ))}
          </nav>
        </>
      )}
    </div>
  );
}
