import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Layout from './components/Layout/Layout';
import CommandCenter from './pages/CommandCenter';
import SpendForecasting from './pages/SpendForecasting';
import AnomalyWatch from './pages/AnomalyWatch';
import DataUpload from './pages/DataUpload';
import Login from './pages/Login';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<Layout />}>
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
