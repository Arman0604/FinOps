import React from 'react';
import { NavLink } from 'react-router-dom';
import { LayoutDashboard, TriangleAlert, TrendingUp, Zap } from 'lucide-react';
import styles from './Sidebar.module.css';

const Sidebar: React.FC = () => {
  const navItems = [
    { name: 'Command Center',  path: '/',               icon: <LayoutDashboard className={styles.navIcon} /> },
    { name: 'Anomaly Watch',   path: '/anomaly-watch',  icon: <TriangleAlert   className={styles.navIcon} />, badge: true },
    { name: 'Budget Forecast', path: '/budget-forecast', icon: <TrendingUp     className={styles.navIcon} /> },
  ];

  return (
    <aside className={styles.sidebar}>
      {/* ── Logo ─────────────────────────────────────────────────── */}
      <div className={styles.logoContainer}>
        <div className={styles.logoMark}>
          <div className={styles.logoIcon}>
            <Zap size={16} color="#000" strokeWidth={2.5} />
          </div>
          <span className={styles.logoTitle}>CogniFinOps</span>
        </div>
        <div className={styles.logoSubtitle}>Intelligence Platform</div>
      </div>

      <div className={styles.divider} />

      {/* ── Navigation ───────────────────────────────────────────── */}
      <div className={styles.sectionLabel}>Navigation</div>
      <nav className={styles.nav}>
        {navItems.map((item) => (
          <NavLink
            key={item.name}
            to={item.path}
            end={item.path === '/'}
            className={({ isActive }) =>
              `${styles.navItem} ${isActive ? styles.active : ''}`
            }
          >
            {item.icon}
            <span className={styles.navLabel}>{item.name}</span>
          </NavLink>
        ))}
      </nav>

      {/* ── System Status ─────────────────────────────────────────── */}
      <div className={styles.statusPanel}>
        <div className={styles.statusRow}>
          <div className={styles.statusDot} />
          <span className={styles.statusLabel}>API Server</span>
          <span className={styles.statusValue}>LIVE</span>
        </div>
        <div className={styles.statusRow}>
          <div className={styles.statusDot} />
          <span className={styles.statusLabel}>ML Engine</span>
          <span className={styles.statusValue}>READY</span>
        </div>
        <div className={styles.statusRow}>
          <div className={`${styles.statusDot} ${styles.warning}`} />
          <span className={styles.statusLabel}>Data Sync</span>
          <span className={styles.statusValue}>5m ago</span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
