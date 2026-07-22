import { useEffect, useState } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import CommandCenter from './pages/CommandCenter';
import SpendForecasting from './pages/SpendForecasting';
import AnomalyWatch from './pages/AnomalyWatch';
import DataUpload from './pages/DataUpload';
import Login from './pages/Login';
import { api, clearAuthSession, getAuthToken, getStoredUser, setAuthSession } from './data/api';

const ProtectedLayout = () => {
  const [status, setStatus] = useState<'checking' | 'authed' | 'guest'>(() => (
    getAuthToken() ? 'checking' : 'guest'
  ));
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    if (!getAuthToken()) return;

    let active = true;
    api.me()
      .then(({ user }) => {
        if (!active) return;
        const token = getAuthToken();
        if (token) setAuthSession({ access_token: token, token_type: 'bearer', expires_in: 0, user });
        setStatus('authed');
      })
      .catch(() => {
        if (!active) return;
        clearAuthSession();
        setStatus('guest');
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const onExpired = () => {
      clearAuthSession();
      setStatus('guest');
      navigate('/login', { replace: true, state: { from: location } });
    };
    window.addEventListener('finops:auth-expired', onExpired);
    return () => window.removeEventListener('finops:auth-expired', onExpired);
  }, [location, navigate]);

  if (status === 'checking') {
    const user = getStoredUser();
    return <div className="loader-screen">Securing workspace{user ? ` for ${user.name}` : ''}...</div>;
  }

  if (status === 'guest') {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Layout />;
};

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<ProtectedLayout />}>
          <Route index element={<CommandCenter />} />
          <Route path="budget-forecast" element={<SpendForecasting />} />
          <Route path="anomaly-watch" element={<AnomalyWatch />} />
          <Route path="data-upload" element={<DataUpload />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
