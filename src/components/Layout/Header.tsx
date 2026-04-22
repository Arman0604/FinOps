import React, { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Search, Bell, User, Settings, LogOut, ChevronDown,
  AlertTriangle, Zap, TrendingUp, X, Shield,
} from 'lucide-react';
import { api } from '../../data/api';
import type { AnomalyItem } from '../../data/api';
import styles from './Header.module.css';

const SEV_COLORS: Record<string, string> = {
  CRITICAL: '#EF4444',
  HIGH:     '#F97316',
  MEDIUM:   '#EAB308',
  LOW:      '#06B6D4',
};

const Header: React.FC = () => {
  const navigate = useNavigate();
  const [notifOpen, setNotifOpen]     = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [anomalies, setAnomalies]     = useState<AnomalyItem[]>([]);
  const [anomCount, setAnomCount]     = useState(0);
  const notifRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Load anomalies for notification bell
  const loadNotifications = useCallback(async () => {
    try {
      const res = await api.anomalies({ limit: 5 });
      setAnomalies(res.items.slice(0, 5));
      setAnomCount(res.total);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const timeSince = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  };

  return (
    <header className={styles.header}>
      {/* Search */}
      <div className={styles.searchBar}>
        <Search className={styles.searchIcon} />
        <input
          type="text"
          placeholder="Search services, teams, anomalies…"
          className={styles.searchInput}
        />
        <span className={styles.kbdHint}>
          <kbd>⌘K</kbd>
        </span>
      </div>

      {/* Right Controls */}
      <div className={styles.rightSection}>
        {/* Live indicator */}
        <div className={styles.liveBadge}>
          <div className={styles.livePulse} />
          Live
        </div>

        {/* ═══════ Notifications ═══════ */}
        <div className={styles.dropdownAnchor} ref={notifRef}>
          <button
            className={`${styles.iconBtn} ${notifOpen ? styles.iconBtnActive : ''}`}
            title="Notifications"
            onClick={() => { setNotifOpen(!notifOpen); setProfileOpen(false); if (!notifOpen) loadNotifications(); }}
          >
            <Bell size={15} />
            {anomCount > 0 && (
              <span className={styles.notificationBadge}>
                {anomCount > 9 ? '9+' : anomCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className={styles.dropdown}>
              <div className={styles.dropdownHeader}>
                <span className={styles.dropdownTitle}>
                  <Bell size={13} /> Notifications
                </span>
                <button className={styles.dropdownClose} onClick={() => setNotifOpen(false)}>
                  <X size={12} />
                </button>
              </div>

              {anomalies.length > 0 ? (
                <div className={styles.dropdownBody}>
                  {anomalies.map(a => (
                    <div
                      key={a.id}
                      className={styles.notifItem}
                      onClick={() => { setNotifOpen(false); navigate('/anomaly-watch'); }}
                    >
                      <div
                        className={styles.notifDot}
                        style={{ background: SEV_COLORS[a.severity] ?? '#64748b' }}
                      />
                      <div className={styles.notifContent}>
                        <div className={styles.notifTitle}>
                          <AlertTriangle size={11} style={{ color: SEV_COLORS[a.severity] }} />
                          <span className={styles.notifSev} style={{ color: SEV_COLORS[a.severity] }}>
                            {a.severity}
                          </span>
                          <span>{a.service}</span>
                        </div>
                        <div className={styles.notifDesc}>
                          {a.team} · {a.deviation_pct > 0 ? '+' : ''}{a.deviation_pct.toFixed(1)}% · ${a.cost_usd.toLocaleString()}
                        </div>
                      </div>
                      <div className={styles.notifTime}>{timeSince(a.detected_at)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className={styles.dropdownEmpty}>
                  <Zap size={16} style={{ opacity: 0.3 }} />
                  No anomalies detected yet
                </div>
              )}

              <div className={styles.dropdownFooter}>
                <button
                  className={styles.dropdownFooterBtn}
                  onClick={() => { setNotifOpen(false); navigate('/anomaly-watch'); }}
                >
                  View All Anomalies →
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ═══════ Profile ═══════ */}
        <div className={styles.dropdownAnchor} ref={profileRef}>
          <div
            className={`${styles.avatarBtn} ${profileOpen ? styles.avatarBtnActive : ''}`}
            onClick={() => { setProfileOpen(!profileOpen); setNotifOpen(false); }}
          >
            <div className={styles.avatar}>
              <img
                src="https://ui-avatars.com/api/?name=FinOps+Admin&background=0891B2&color=fff&bold=true"
                alt="User"
              />
            </div>
            <span className={styles.avatarName}>Admin</span>
            <ChevronDown size={12} className={`${styles.avatarChevron} ${profileOpen ? styles.avatarChevronOpen : ''}`} />
          </div>

          {profileOpen && (
            <div className={`${styles.dropdown} ${styles.profileDropdown}`}>
              <div className={styles.profileHeader}>
                <div className={styles.profileAvatar}>
                  <img
                    src="https://ui-avatars.com/api/?name=FinOps+Admin&background=0891B2&color=fff&bold=true&size=64"
                    alt="User"
                  />
                </div>
                <div>
                  <div className={styles.profileName}>FinOps Admin</div>
                  <div className={styles.profileEmail}>admin@cognifinops.io</div>
                </div>
              </div>

              <div className={styles.profileDivider} />

              <div className={styles.profileMenu}>
                <button className={styles.profileMenuItem}>
                  <User size={14} /> My Profile
                </button>
                <button className={styles.profileMenuItem}>
                  <Settings size={14} /> Settings
                </button>
                <button className={styles.profileMenuItem}>
                  <Shield size={14} /> Security
                </button>
                <button className={styles.profileMenuItem}>
                  <TrendingUp size={14} /> Usage & Billing
                </button>
              </div>

              <div className={styles.profileDivider} />

              <div className={styles.profileMenu}>
                <button className={`${styles.profileMenuItem} ${styles.profileMenuDanger}`}>
                  <LogOut size={14} /> Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
};

export default Header;
